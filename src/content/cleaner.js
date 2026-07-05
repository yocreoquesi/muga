/**
 * MUGA: Content Script
 * Injected into every page. Intercepts link clicks before navigation occurs
 * and communicates with the service worker to get a clean URL.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * All URL processing is delegated to the service worker via messaging.
 * Toast strings are kept inline and read from storage for i18n.
 */

(function () {
  "use strict";

  // Prevent double execution in iframes
  if (window.self !== window.top) return;
  if (window.__mugaActive) return;
  window.__mugaActive = true;

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand("copy"); } catch { /* legacy fallback — failure is silent by design */ }
      el.remove();
    });
  }

  // Matches http/https URLs including query strings, stops at whitespace or common trailing punctuation.
  // NOTE: background/service-worker.js contains an identical copy of this regex. Content scripts
  // cannot import ES modules, so the definition must stay in both files. The sync
  // regression test at tests/unit/url-regex-sync.test.mjs enforces identical literals.
  const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

  // Parses a URL and returns its hostname without a leading "www." prefix.
  // Returns "" if the input is not a valid URL — never throws. Callers that
  // key storage by hostname must handle the empty-string case defensively.
  function safeHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // Timer ID for the toast auto-dismiss. Cleared when a new toast replaces the old one.
  let _toastTimer = null;

  // Module-level prefs cache (#142). Declared at the top of the IIFE so event
  // handlers registered below (copy/click/message listeners) cannot hit the
  // Temporal Dead Zone on Firefox when they fire before the IIFE reaches the
  // getContentPrefs definition.
  let _contentPrefs = null;
  let _contentPrefsPending = null;

  // Module-level domain-rules cache (#356/#366). Hoisted to the top of the
  // IIFE for the same reason as _contentPrefs — event handlers below
  // reference it via getDomainRulesCached() / direct read on the click and
  // copy paths.
  let _domainRulesCache = null;
  let _domainRulesPending = null;
  function getDomainRulesCached() {
    if (_domainRulesCache) return Promise.resolve(_domainRulesCache);
    if (_domainRulesPending) return _domainRulesPending;
    _domainRulesPending = fetch(chrome.runtime.getURL("rules/domain-rules.json"))
      .then(r => r.json())
      .then(data => { _domainRulesCache = data; _domainRulesPending = null; return data; })
      .catch(err => {
        console.error("[MUGA] domain-rules fetch failed:", err);
        _domainRulesPending = null;
        return [];
      });
    return _domainRulesPending;
  }
  // Eagerly start the fetch so click/copy handlers find the cache populated
  // by the time the user actually clicks. The fetch is local (extension
  // package), takes <10ms.
  getDomainRulesCached();

  // Module-level path-rules cache (#951). Mirrors getDomainRulesCached()
  // above: lazy-once fetch + pending-promise dedupe, hoisted to the top of
  // the IIFE so the click/copy/self-clean call sites below can read the
  // warm cache synchronously. Before this fix, none of the content-script
  // processUrl() call sites passed pathStripRules/pathAffiliateRules, so
  // path-based stripping (e.g. Amazon trailing "/ref=") and path-based
  // affiliate injection (e.g. Bookshop.org) were silently dead on every
  // in-page navigation and copy/click action — only the service-worker
  // path (copy-clean-link, context menu) had the real rules threaded in.
  let _pathRulesCache = null;
  let _pathRulesPending = null;
  function getPathRulesCached() {
    if (_pathRulesCache) return Promise.resolve(_pathRulesCache);
    if (_pathRulesPending) return _pathRulesPending;
    _pathRulesPending = Promise.all([
      fetch(chrome.runtime.getURL("rules/path-strip-rules.json")).then(r => r.json()),
      fetch(chrome.runtime.getURL("rules/path-affiliate-rules.json")).then(r => r.json()),
    ])
      .then(([pathStripRules, pathAffiliateRules]) => {
        _pathRulesCache = { pathStripRules, pathAffiliateRules };
        _pathRulesPending = null;
        return _pathRulesCache;
      })
      .catch(err => {
        console.error("[MUGA] path-rules fetch failed:", err);
        _pathRulesPending = null;
        // Fail-safe: never block cleaning. applyPathStrip/getPathAffiliatePolicy
        // both no-op on empty arrays, same as an unloaded domain-rules cache.
        return { pathStripRules: [], pathAffiliateRules: [] };
      });
    return _pathRulesPending;
  }
  // Eagerly start the fetch, same rationale as getDomainRulesCached() above.
  getPathRulesCached();

  // Rewrite loop guard: prevents infinite URL rewriting if another extension
  // or the page itself re-injects tracking params after MUGA cleans them.
  const _rewriteLog = new Map(); // hostname -> { count, firstTs }
  function isRewriteLoop(hostname) {
    const now = Date.now();
    // Evict stale entries older than 2s instead of bulk-clearing the entire map
    if (_rewriteLog.size > 50) {
      for (const [key, val] of _rewriteLog) {
        if (now - val.firstTs > 2000) _rewriteLog.delete(key);
      }
      // Safety cap: if still over 200 after eviction, clear all
      if (_rewriteLog.size > 200) _rewriteLog.clear();
    }
    const entry = _rewriteLog.get(hostname);
    if (!entry || now - entry.firstTs > 2000) {
      _rewriteLog.set(hostname, { count: 1, firstTs: now });
      return false;
    }
    entry.count++;
    return entry.count > 3;
  }

  // Toast strings: default English, overridden by stored language preference.
  // IMPORTANT: keep this table in sync with the five toast_* keys in
  // src/lib/i18n.js — the drift guard test content-cleaner-toast-sync.test.mjs
  // will fail red if they diverge. Do NOT edit translations here directly;
  // update i18n.js first, then copy the values here (#819, #834).
  const STRINGS = {
    en: {
      toast_title:   "MUGA found someone else's affiliate tag",
      toast_tag_msg: "has an affiliate tag that isn't ours:",
      toast_allow:   "Keep it",
      toast_block:   "Remove it",
      toast_dismiss: "Dismiss",
    },
    es: {
      toast_title:   "MUGA encontró el tag de afiliado de otro",
      toast_tag_msg: "tiene un tag de afiliado que no es nuestro:",
      toast_allow:   "Mantenerlo",
      toast_block:   "Eliminarlo",
      toast_dismiss: "Descartar",
    },
    pt: {
      toast_title:   "MUGA encontrou a tag de afiliado de outra pessoa",
      toast_tag_msg: "tem uma tag de afiliado que não é nossa:",
      toast_allow:   "Manter",
      toast_block:   "Remover",
      toast_dismiss: "Ignorar",
    },
    de: {
      toast_title:   "MUGA hat ein fremdes Affiliate-Tag gefunden",
      toast_tag_msg: "hat ein Affiliate-Tag, das nicht unseres ist:",
      toast_allow:   "Behalten",
      toast_block:   "Entfernen",
      toast_dismiss: "Schließen",
    },
    fr: {
      toast_title:   "MUGA a trouvé un tag d'affiliation de quelqu'un d'autre",
      toast_tag_msg: "a un tag d'affiliation qui n'est pas le nôtre :",
      toast_allow:   "Conserver",
      toast_block:   "Supprimer",
      toast_dismiss: "Ignorer",
    },
    it: {
      toast_title:   "MUGA ha trovato il tag di affiliazione di qualcun altro",
      toast_tag_msg: "ha un tag di affiliazione che non è il nostro:",
      toast_allow:   "Mantieni",
      toast_block:   "Rimuovi",
      toast_dismiss: "Ignora",
    },
    ja: {
      toast_title:   "MUGAは他者のアフィリエイトタグを検出しました",
      toast_tag_msg: "には当方のものではないアフィリエイトタグがあります:",
      toast_allow:   "保持",
      toast_block:   "削除",
      toast_dismiss: "閉じる",
    },
  };

  const SUPPORTED_LANGS = { en: 1, es: 1, pt: 1, de: 1, fr: 1, it: 1, ja: 1 };
  const navLang = (navigator.language || "en").slice(0, 2);
  const browserLang = navLang in SUPPORTED_LANGS ? navLang : "en";
  let s = STRINGS[browserLang];
  // Load language preference asynchronously. Toast will use it if shown after load.
  chrome.storage.sync.get({ language: browserLang }, (r) => {
    s = STRINGS[r.language] ?? STRINGS.en;
  });

  // Handle clipboard copy requests from the service worker (context menu "Copy clean link")
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "GET_AND_COPY_CLEAN_SELECTION") {
      if (!_contentPrefs?.enabled || !_contentPrefs?.onboardingDone) { sendResponse({ ok: false }); return true; }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { sendResponse({ ok: false }); return true; }

      // 1. Get the HTML of the selection
      const container = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) {
        container.appendChild(sel.getRangeAt(i).cloneContents());
      }

      // 2. Clean all href attributes
      const anchors = container.querySelectorAll("a[href]");
      const urlsToClean = [];
      anchors.forEach(a => urlsToClean.push(a.getAttribute("href")));

      // 3. Also find plain URLs in text content
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) textNodes.push(node);
      const textUrls = [];
      textNodes.forEach(n => { const m = n.textContent.match(URL_RE); if (m) textUrls.push(...m); });

      const allUrls = [...new Set([...urlsToClean, ...textUrls])];

      if (allUrls.length === 0) {
        // Nothing to clean. Copy plain text as-is.
        const plainText = sel.toString();
        navigator.clipboard.writeText(plainText).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      }

      // 4. Clean each URL locally (#366). No SW round-trip per URL.
      if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") {
        // Bundle didn't load — copy plain text as fallback.
        navigator.clipboard.writeText(sel.toString())
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      const domainRules = _domainRulesCache || [];
      const pathRules = _pathRulesCache || { pathStripRules: [], pathAffiliateRules: [] };
      // Copy-safe prefs (#946): the user is copying, not navigating, so
      // MUGA must never inject its own affiliate tag nor surface the
      // foreign-affiliate toast on a copy action. Mirrors the effectivePrefs
      // pattern in background/service-worker.js#handleProcessUrl (skipNotify
      // branch) — third-party attribution tags are still preserved, only
      // MUGA's own injection + notification are suppressed.
      const copyPrefs = { ..._contentPrefs, notifyForeignAffiliate: false, injectOwnAffiliate: false };
      const urlMap = new Map();
      for (const url of allUrls) {
        let r;
        try {
          r = window.__mugaCleaner.processUrl(
            url, copyPrefs, domainRules,
            undefined, undefined, undefined,
            pathRules.pathStripRules, pathRules.pathAffiliateRules,
          );
        } catch { r = null; }
        urlMap.set(url, r?.cleanUrl ?? url);
      }

      // Defer the rest in a microtask so the original Promise-then chain
      // shape is preserved for the rest of this branch.
      Promise.resolve().then(() => {
        // Apply to anchors
        anchors.forEach(a => {
          const orig = a.getAttribute("href");
          const clean = urlMap.get(orig);
          if (clean && clean !== orig) a.setAttribute("href", clean);
        });

        // Apply to text nodes
        let finalText = sel.toString();
        for (const [orig, clean] of urlMap) {
          if (clean !== orig) finalText = finalText.split(orig).join(clean);
        }

        // Count as 1 clean action regardless of how many URLs were in the selection
        const anyChanged = [...urlMap.values()].some((clean, i) => clean !== allUrls[i]);
        if (anyChanged) chrome.runtime.sendMessage({ type: "INCREMENT_STAT", key: "urlsCleaned" }).catch(() => { /* expected: channel may close */ });

        navigator.clipboard.writeText(finalText)
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
      }).catch(() => sendResponse({ ok: false }));
      return true;
    }

    // B14 (#452): popup asks the active tab for its document.referrer so
    // the cleaner can decide whether to honor the creator's referral chain.
    // No prefs gate — returning an empty string when nothing is known is
    // safe (the cleaner treats no-referrer as "do not honor").
    if (message.type === "GET_REFERRER") {
      try {
        sendResponse({ ok: true, referrer: document.referrer || "" });
      } catch { /* channel closed */ }
      return true;
    }

    if (message.type === "SHOW_TEST_TOAST") {
      showAffiliateNotice(
        { param: "tag", value: "somestore-21" },
        "https://amazon.es/dp/B08N5WRWNW?tag=somestore-21",
        "https://amazon.es/dp/B08N5WRWNW",
        undefined,
        () => {}
      );
      return;
    }

    if (message.type !== "COPY_TO_CLIPBOARD") return;
    copyToClipboard(message.text);
  });

  /**
   * Intercepts Ctrl+C / copy.
   * - If the entire selection is a URL: cleans it (existing behaviour).
   * - If the selection is mixed text containing URLs: cleans each embedded URL
   *   and puts the modified text on the clipboard, leaving all non-URL text intact.
   * Note: address bar copies are a browser UI element and cannot be intercepted.
   */
  document.addEventListener("copy", (e) => {
    // Do nothing when extension is disabled or onboarding not done.
    if (!_contentPrefs?.enabled || !_contentPrefs?.onboardingDone) return;

    const selected = window.getSelection()?.toString();
    if (!selected) return;

    const trimmed = selected.trim();
    if (!trimmed) return;

    // Find all URLs in the selected text
    const matches = [...trimmed.matchAll(URL_RE)];
    if (matches.length === 0) return;

    // Local cleaning (#366). No SW round-trip per URL.
    if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") return;

    e.preventDefault();

    try {
      // Clean each unique URL found in the text.
      // Sort matches by length descending so longer URLs are replaced first,
      // preventing a shorter URL that is a prefix of a longer one from
      // corrupting the longer URL during replaceAll.
      const sortedMatches = [...matches].sort((a, b) => b[0].length - a[0].length);
      const domainRules = _domainRulesCache || [];
      const pathRules = _pathRulesCache || { pathStripRules: [], pathAffiliateRules: [] };
      // Copy-safe prefs (#946): same rationale as the GET_AND_COPY_CLEAN_SELECTION
      // handler above — Ctrl+C is a copy action, not a navigation, so MUGA's own
      // affiliate injection and the foreign-affiliate toast must both be suppressed.
      const copyPrefs = { ..._contentPrefs, notifyForeignAffiliate: false, injectOwnAffiliate: false };
      let resultText = trimmed;
      let totalJunkRemoved = 0;
      const allRemovedTracking = [];
      for (const match of sortedMatches) {
        const rawUrl = match[0];
        const cleanCandidate = rawUrl.replace(/[.,;:!?)\]]+$/, "");
        let r;
        try {
          r = window.__mugaCleaner.processUrl(
            cleanCandidate, copyPrefs, domainRules,
            undefined, undefined, undefined,
            pathRules.pathStripRules, pathRules.pathAffiliateRules,
          );
        } catch { continue; }
        if (r?.cleanUrl && r.cleanUrl !== cleanCandidate) {
          resultText = resultText.replaceAll(cleanCandidate, r.cleanUrl);
          totalJunkRemoved += r.junkRemoved ?? 0;
          if (Array.isArray(r.removedTracking)) allRemovedTracking.push(...r.removedTracking);
        }
      }

      copyToClipboard(resultText);

      // Single fire-and-forget for the whole copy event — counts as ONE
      // urlsCleaned increment regardless of how many URLs were in the
      // selection (matches the prior skipStats=true semantics).
      if (totalJunkRemoved > 0) {
        chrome.runtime.sendMessage({
          type: "INCREMENT_STAT",
          key: "urlsCleaned",
        }).catch(() => { /* expected: channel may close */ });
      }
    } catch {
      navigator.clipboard.writeText(trimmed).catch(() => { /* best-effort fallback */ });
    }
  });

  // Eagerly load prefs so they're available synchronously for click/copy handlers
  getContentPrefs();

  // ── Reclean helper (#951 Layer B) ───────────────────────────────────────
  // Single code path for "re-run the full local cleaning pipeline against a
  // given URL". Used by:
  //   1. The document_start self-clean below (initial page load).
  //   2. history-defuser.js's `muga:history-committed` listener, so a
  //      same-document SPA navigation (history.pushState/replaceState) gets
  //      the SAME path-aware + query-aware cleaning as a real navigation —
  //      DNR only intercepts network requests, so pushState traffic never
  //      hits the network layer at all.
  //   3. history-defuser.js's popstate/hashchange listeners (also
  //      same-document navigations DNR never sees).
  //
  // Exposed as a global because history-defuser.js runs as a separate
  // content script in the SAME isolated world — `window.*` properties are
  // shared between isolated-world scripts (unlike MAIN-world scripts, which
  // need a CustomEvent to cross the boundary).
  let _lastRecleanUrl = null;
  // Per-URL loop cap for the SPA reclean path (see __mugaReclean below).
  // Keyed on the resolved input URL so a genuine loop (same dirty URL
  // re-cleaned repeatedly) trips it while legitimate rapid navigation
  // (distinct URLs) never does.
  const _recleanLog = new Map(); // resolved url -> { count, firstTs }
  function isRecleanLoop(url) {
    const now = Date.now();
    if (_recleanLog.size > 100) {
      for (const [key, val] of _recleanLog) {
        if (now - val.firstTs > 3000) _recleanLog.delete(key);
      }
      if (_recleanLog.size > 300) _recleanLog.clear();
    }
    const entry = _recleanLog.get(url);
    if (!entry || now - entry.firstTs > 3000) {
      _recleanLog.set(url, { count: 1, firstTs: now });
      return false;
    }
    entry.count++;
    return entry.count > 5;
  }

  window.__mugaReclean = function (rawUrl) {
    if (!_contentPrefs || !_contentPrefs.enabled || !_contentPrefs.onboardingDone) return;
    // Resolve to an absolute URL before anything else. `rawUrl` here is
    // frequently RELATIVE — history.pushState()/replaceState() accept
    // relative URLs (the common case for real SPA routers, e.g. React
    // Router), and the muga:history-committed event forwards whatever
    // shape the page originally passed (see cleanUrl()'s "same shape"
    // comment in history-defuser-mainworld.js). By the time this runs the
    // native pushState/replaceState call has already committed, so
    // window.location.href is always a safe resolution base.
    let url;
    try {
      url = new URL(rawUrl || window.location.href, window.location.href).href;
    } catch {
      return;
    }
    if (!url.startsWith("http")) return;
    // Loop guard: a successful reclean below calls history.replaceState(),
    // which re-enters the main-world pushState/replaceState wrap and
    // re-dispatches `muga:history-committed` with the URL we JUST wrote.
    // Without this short-circuit that would call back into this function
    // forever. Terminates because the second call sees
    // `url === _lastRecleanUrl` and returns before ever calling
    // replaceState again — the recursion depth is bounded to exactly 1.
    if (url === _lastRecleanUrl) return;
    // Loop cap keyed on the RESOLVED INPUT url (not hostname): a genuine
    // loop is the SAME dirty URL re-cleaned repeatedly (e.g. a page that
    // re-adds a tracking param after each strip), which trips this cap;
    // legitimate rapid SPA browsing produces DISTINCT urls and is never
    // throttled. Keying by hostname (as the click-rewrite path's
    // isRewriteLoop does) would wrongly drop cleaning on fast same-host
    // navigation, and sharing that budget would starve either path.
    if (isRecleanLoop(url)) return;
    if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") return;
    // Perf note: this runs a full processUrl() per pushState/replaceState
    // on high-frequency SPA routers. The loop guard above prevents runaway
    // recursion, but bursty routers (e.g. scroll-driven URL updates) could
    // still call this often. Not coalesced (microtask/rAF) for now — keep
    // an eye on this if profiling shows it matters; the main-world sync
    // subset intentionally avoids this cost for the common case.
    const domainRules = _domainRulesCache || [];
    const pathRules = _pathRulesCache || { pathStripRules: [], pathAffiliateRules: [] };
    let result;
    try {
      result = window.__mugaCleaner.processUrl(
        url, _contentPrefs, domainRules,
        undefined, undefined, undefined,
        pathRules.pathStripRules, pathRules.pathAffiliateRules,
      );
    } catch (err) {
      console.error("[MUGA] reclean failed:", err);
      return;
    }
    if (!result || !result.cleanUrl || result.cleanUrl === window.location.href) return;
    _lastRecleanUrl = result.cleanUrl;
    try {
      history.replaceState(history.state, "", result.cleanUrl);
    } catch { /* cross-origin or sandboxed — ignore */ }
    // Fire-and-forget: tell the SW to update badge + stats. Failure here
    // doesn't roll back the URL change — the user's address bar already
    // reflects the cleaned URL.
    if (result.junkRemoved > 0) {
      chrome.runtime.sendMessage({
        type: "BADGE_AND_STATS",
        junkRemoved: result.junkRemoved,
        removedTracking: result.removedTracking,
        cleanUrl: result.cleanUrl,
        originalUrl: url,
      }).catch(() => { /* SW dead — badge will catch up next nav */ });
    }
  };

  // ── Self-clean: clean the current page URL on load ────────────────────────
  // (#356) Cleans locally via the bundled cleaner attached to
  // `window.__mugaCleaner` by content/cleaner-bundle.js (loaded just before
  // this script per the manifest). Eliminates the service-worker round-trip
  // on every page load, which previously meant a 3s timeout fall-through if
  // the SW was cold-killed.
  //
  // (#371 / #905) `chrome.declarativeNetRequest` is a background-only API and
  // is NOT exposed to content scripts, so `_hasDNR` below is ALWAYS false here
  // — even on Chrome (verified empirically). This branch therefore runs on
  // BOTH Chrome and Firefox. On Chrome it is a practical no-op for STRIPPING
  // (DNR already cleaned tracking params at the network layer before
  // document_start, so processUrl returns the URL unchanged), but it STILL
  // performs Step 6 affiliate-tag injection when injectOwnAffiliate is on —
  // DNR cannot inject — which is how our tag lands on direct Amazon
  // navigations (address bar / bookmark) on Chrome. The `!_hasDNR` guard was
  // originally meant to skip this on a DNR-capable browser; since the API is
  // unavailable to content scripts it never actually skips. Left as-is
  // (harmless: the stripping path is idempotent) — do not rely on it to gate.
  //
  // Domain rules are fetched once at IIFE start (see getDomainRulesCached
  // hoisted above). Stats and badge updates fire-and-forget; SW death is
  // not fatal — only the badge lags by one nav.
  //
  // Delegates to window.__mugaReclean (#951) so the document_start path and
  // the SPA-navigation reclean path (history-defuser.js) share one
  // implementation. By the time the Promise.all below resolves, each
  // getXCached() has already set its module-level cache as a side effect
  // (see definitions above), so __mugaReclean can read them synchronously.

  const _hasDNR = typeof chrome.declarativeNetRequest !== "undefined";

  if (!_hasDNR) Promise.all([getContentPrefs(), getDomainRulesCached(), getPathRulesCached()]).then(() => {
    window.__mugaReclean(window.location.href);
  });

  /**
   * Checks if a hostname matches any known affiliate store domain.
   * Used to decide whether a click needs interception for affiliate logic.
   * Non-affiliate clicks go through naturally (DNR + self-clean handle params).
   */
  function isAffiliateDomain(hostname) {
    const host = hostname.replace(/^www\./, "");
    const domains = _contentPrefs?._affiliateDomains;
    if (!domains || !domains.length) return false;
    return domains.some(d => host === d || host.endsWith("." + d));
  }

  /**
   * Intercepts link clicks ONLY on affiliate store domains.
   * Non-affiliate clicks go through naturally: Chrome DNR strips tracking
   * params before navigation, and the self-clean replaceState handles Firefox.
   * This avoids disrupting SPA navigation on YouTube, forums, etc.
   */
  document.addEventListener("click", async (e) => {
    // Do nothing when extension is disabled or onboarding not done.
    // Uses cached prefs (loaded eagerly above) for synchronous access.
    if (!_contentPrefs?.enabled || !_contentPrefs?.onboardingDone) return;

    const anchor = e.target.closest("a[href], area[href]");
    if (!anchor) return;

    const href = anchor.href;
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;

    // Only handle http/https URLs
    let url;
    try {
      url = new URL(href);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) return;

    // Only intercept clicks to affiliate store domains. All other clicks
    // pass through unmodified: DNR (Chrome) and self-clean (Firefox) handle
    // tracking param removal without disrupting SPA navigation.
    if (!isAffiliateDomain(url.hostname)) return;

    // #allowlist-full-inert: a fully-exempt destination domain must not even
    // have its click intercepted (preventDefault + reconstructed navigate).
    // processUrl() would return the URL untouched anyway, but the native
    // click should be allowed to proceed as-is rather than being replaced by
    // an equivalent window.location assignment. Fail-safe: if the bundle
    // helper is unavailable, throws, or prefs is malformed, interception
    // proceeds as before.
    try {
      if (window.__mugaCleaner && typeof window.__mugaCleaner.isSiteFullyExempt === "function" &&
          window.__mugaCleaner.isSiteFullyExempt(url.hostname, _contentPrefs)) {
        return;
      }
    } catch {
      // Fail-safe: fall through to normal interception.
    }

    // Rewrite loop guard: bail if this domain is being rewritten too rapidly
    if (isRewriteLoop(url.hostname)) return;

    // Preserve Ctrl/Cmd/Shift+click and target="_blank" (open in new tab/window)
    const opensNewTab = e.ctrlKey || e.metaKey || e.shiftKey ||
      anchor.target === "_blank";

    e.preventDefault();

    // Local cleaning (#366). Synchronous, no service-worker round-trip,
    // no 3-second timeout fall-through. The cleaner library is bundled
    // into this content script via cleaner-bundle.js (#356) which
    // attaches window.__mugaCleaner. If the bundle did not load (should
    // never happen in production), silent-degrade by navigating to the
    // original href.
    if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") {
      navigate(href, opensNewTab);
      return;
    }

    let result;
    try {
      const domainRules = _domainRulesCache || [];
      const pathRules = _pathRulesCache || { pathStripRules: [], pathAffiliateRules: [] };
      result = window.__mugaCleaner.processUrl(
        href, _contentPrefs, domainRules,
        undefined, undefined, undefined,
        pathRules.pathStripRules, pathRules.pathAffiliateRules,
      );
    } catch (err) {
      console.error("[MUGA] local click clean failed:", err);
      navigate(href, opensNewTab);
      return;
    }

    if (!result || !result.cleanUrl) {
      navigate(href, opensNewTab);
      return;
    }

    const { cleanUrl, action, detectedAffiliate } = result;

    // Compute withOurAffiliate locally (was previously added by the SW
    // in handleProcessUrl). Mirrors the SW logic exactly: if injection
    // is enabled and the detected pattern has an ourTag, build the
    // alternative URL the user can pick from the toast's "Remove it"
    // action.
    let withOurAffiliate;
    if (action === "detected_foreign"
        && detectedAffiliate?.pattern?.ourTag
        && _contentPrefs?.injectOwnAffiliate) {
      try {
        const u = new URL(cleanUrl);
        const p = detectedAffiliate.pattern;
        // #904: pattern.ourTag is a { host -> tag } map, not a flat string.
        // Resolve by hostname (mirrors resolveOurTag() in lib/affiliates.js —
        // MV3 content scripts cannot import ES modules). Passing the map object
        // straight to searchParams.set() serialized it to "[object Object]".
        const host = u.hostname.replace(/^www\./, "");
        const ourTagForHost = p.ourTag[host] || p.ourTag[u.hostname] || "";
        if (ourTagForHost) {
          u.searchParams.set(p.param, ourTagForHost);
          withOurAffiliate = u.toString();
        }
      } catch { /* malformed cleanUrl — toast falls back to cleanUrl */ }
    }

    // Fire-and-forget stats + history. SW death is no longer fatal.
    chrome.runtime.sendMessage({
      type: "BADGE_AND_STATS",
      junkRemoved: result.junkRemoved ?? 0,
      removedTracking: result.removedTracking ?? [],
      cleanUrl,
      originalUrl: href,
      action,
    }).catch(() => { /* SW dead — badge will catch up next nav */ });

    if (action === "detected_foreign" && detectedAffiliate
        && _contentPrefs?.notifyForeignAffiliate) {
      showAffiliateNotice(detectedAffiliate, href, cleanUrl, withOurAffiliate, (choice) => {
        if (choice === "original") navigate(href, opensNewTab);
        else if (choice === "clean") {
          navigate(withOurAffiliate || cleanUrl, opensNewTab);
        }
      });
    } else {
      // ADR-0004 phase 5 (#701): Privacy Proxy decommissioned. Opaque affiliate
      // redirect networks (awin, CJ, etc.) and generic shorteners (bit.ly, t.co,
      // etc.) both pass through the standard navigate() path. Generic shorteners
      // are resolved natively via the "Follow shortener redirects" opt-in flow
      // (RESOLVE_SHORTENER message + followShortenersEnabled pref), which is
      // handled separately by the isGenericShortener check below.
      //
      // For opaque affiliate networks: just navigate. Their redirect is the
      // attribution event and must pass through unchanged (2.1 pivot).
      //
      // redirector-coverage-expansion (T12): isOpaqueNetworkHost is provided
      // by the content bundle (window.__mugaCleaner). Single source of truth
      // lives in src/lib/opaque-networks.js.
      if (window.__mugaCleaner?.isGenericShortener(url.hostname)) {
        if (_contentPrefs?.followShortenersEnabled) {
          // Follow-shorteners ON: attempt to resolve via RESOLVE_SHORTENER.
          const _SHORTENER_TIMEOUT_MS = 6000;
          (async () => {
            let response;
            try {
              response = await Promise.race([
                chrome.runtime.sendMessage({ type: "RESOLVE_SHORTENER", url: href }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("shortener-resolve timeout")), _SHORTENER_TIMEOUT_MS)
                ),
              ]);
            } catch {
              // SW message failed or timed out — let original navigation proceed.
              navigate(href, opensNewTab);
              return;
            }
            if (response?.ok === true) {
              const dest = response.destination;
              // Defense in depth: validate scheme and length even though SW validated.
              if (
                typeof dest === "string" &&
                dest.length <= 2000 &&
                (dest.startsWith("https://") || dest.startsWith("http://"))
              ) {
                try {
                  const destParsed = new URL(dest);
                  if (destParsed.protocol === "http:" || destParsed.protocol === "https:") {
                    navigate(dest, opensNewTab);
                    return;
                  }
                } catch { /* fall through */ }
              }
            }
            // SW returned ok:false, or destination failed validation — let original navigation proceed.
            navigate(href, opensNewTab);
          })();
          return; // Async branch took over; skip the synchronous navigate below.
        }
        // followShortenersEnabled is OFF — navigate to the shortener URL directly.
      }
      navigate(cleanUrl, opensNewTab);
    }
  }, true);

  /**
   * Navigates to the given URL, preserving new-tab behaviour when needed.
   */
  function navigate(url, newTab) {
    if (typeof url !== "string" || url.length > 2000) return;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
    } catch { return; }
    if (newTab) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = url;
    }
  }

  /**
   * Shows a non-intrusive toast when a foreign affiliate tag is detected.
   * Auto-dismisses after 15 seconds if the user does not interact.
   * @param {object} affiliate
   * @param {string} originalUrl
   * @param {string} cleanUrl
   * @param {string|undefined} withOurAffiliate - URL with our tag (when injectOwnAffiliate is on)
   * @param {function} callback
   */
  function showAffiliateNotice(affiliate, originalUrl, cleanUrl, withOurAffiliate, callback) {
    if (_toastTimer) clearTimeout(_toastTimer);
    document.getElementById("muga-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "muga-notice";
    notice.setAttribute("role", "alert");
    notice.setAttribute("aria-live", "assertive");
    notice.style.cssText = [
      "position:fixed", "bottom:20px", "right:20px",
      "background:#1c1c1e", "color:#f0f0f0", "border-radius:10px",
      "padding:12px 16px",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:13px", "line-height:1.5", "max-width:300px",
      "z-index:2147483647", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
      "border:0.5px solid rgba(255,255,255,0.1)",
    ].join(";");

    const domain = safeHostname(originalUrl);

    const btnStyle = "flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer";
    const codeStyle = "background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px";

    // Build toast using DOM API to avoid innerHTML with user-controlled strings
    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "font-weight:500;margin-bottom:6px;font-size:12px;color:#aaa";
    titleDiv.textContent = s.toast_title;

    const msgDiv = document.createElement("div");
    msgDiv.style.cssText = "margin-bottom:10px;font-size:12px;color:#ddd";
    msgDiv.appendChild(document.createTextNode(domain + " " + s.toast_tag_msg + " "));
    const codeEl = document.createElement("code");
    codeEl.style.cssText = codeStyle;
    codeEl.textContent = `${affiliate.param}=${affiliate.value}`;
    msgDiv.appendChild(codeEl);

    const btnDiv = document.createElement("div");
    btnDiv.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";

    const allowBtn = document.createElement("button");
    allowBtn.dataset.choice = "original";
    allowBtn.style.cssText = btnStyle;
    allowBtn.textContent = s.toast_allow;
    allowBtn.setAttribute("aria-label", s.toast_allow);
    btnDiv.appendChild(allowBtn);

    const blockBtn = document.createElement("button");
    blockBtn.dataset.choice = "clean";
    blockBtn.style.cssText = btnStyle;
    blockBtn.textContent = s.toast_block;
    blockBtn.setAttribute("aria-label", s.toast_block);
    btnDiv.appendChild(blockBtn);

    const dismissDiv = document.createElement("button");
    dismissDiv.style.cssText = "margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer;background:none;border:none;display:block;width:100%";
    dismissDiv.id = "muga-dismiss";
    dismissDiv.textContent = s.toast_dismiss;
    dismissDiv.setAttribute("aria-label", s.toast_dismiss);

    notice.appendChild(titleDiv);
    notice.appendChild(msgDiv);
    notice.appendChild(btnDiv);
    notice.appendChild(dismissDiv);

    document.body.appendChild(notice);
    notice.tabIndex = -1;
    notice.focus();

    const rawDuration = _contentPrefs?.toastDuration || 15;
    const duration = Math.max(5, Math.min(60, rawDuration)) * 1000;
    _toastTimer = setTimeout(() => {
      _toastTimer = null;
      notice.remove();
      callback("original");
    }, duration);

    notice.querySelectorAll("button[data-choice]").forEach(btn => {
      btn.addEventListener("click", () => {
        clearTimeout(_toastTimer);
        _toastTimer = null;
        notice.remove();
        const choice = btn.dataset.choice;
        if (choice === "original") {
          // "Allow": add to whitelist in domain::param::value format so parseListEntry
          // can match it correctly against the affiliate patterns (#229)
          const hostname = safeHostname(originalUrl);
          const tag = `${hostname}::${affiliate.param}::${affiliate.value}`;
          chrome.runtime.sendMessage({ type: "ADD_TO_WHITELIST", tag }).catch(() => { /* expected: channel may close */ });
        } else if (choice === "clean") {
          // "Block": add to blacklist in domain::param::value format (#229)
          const hostname = safeHostname(originalUrl);
          const tag = `${hostname}::${affiliate.param}::${affiliate.value}`;
          chrome.runtime.sendMessage({ type: "ADD_TO_BLACKLIST", tag }).catch(() => { /* expected: channel may close */ });
        }
        callback(choice);
      });
    });

    document.getElementById("muga-dismiss")?.addEventListener("click", () => {
      clearTimeout(_toastTimer);
      _toastTimer = null;
      notice.remove();
      callback("original");
    });
  }

  // Module-level prefs cache (#142). Declarations hoisted to top of IIFE; see comment there.
  function getContentPrefs() {
    if (_contentPrefs) return Promise.resolve(_contentPrefs);
    if (_contentPrefsPending) return _contentPrefsPending;
    _contentPrefsPending = new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        _contentPrefs = prefs;
        _contentPrefsPending = null;
        resolve(prefs);
      });
    });
    return _contentPrefsPending;
  }

  // Invalidate cache when sync storage changes (e.g. user toggles a pref)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      _contentPrefs = null;
      _contentPrefsPending = null;
    }
  });

  // --- Ping blocking (conditional on prefs.blockPings) ---
  getContentPrefs().then((prefs) => {
    if (!prefs || !prefs.enabled || !prefs.onboardingDone) return;
    // #allowlist-full-inert: a fully-exempt domain (domain-only whitelist
    // entry or #995 per-site pause) must not have its <a ping> attributes
    // touched either - this is a content behavior that does not run through
    // processUrl and was not gated on the muga:history-gate event, so it
    // needs its own explicit check against the same choke-point predicate.
    // Fail-safe: if the bundle helper is unavailable, throws, or prefs is
    // malformed, `exempt` stays false and ping blocking behaves as before.
    let exempt = false;
    try {
      if (window.__mugaCleaner && typeof window.__mugaCleaner.isSiteFullyExempt === "function") {
        exempt = window.__mugaCleaner.isSiteFullyExempt(location.hostname, prefs);
      }
    } catch {
      // Fail-safe: treat as not exempt, ping blocking stays governed by prefs.blockPings.
    }
    if (exempt) return;
    if (prefs.blockPings) {
      // Strip the ping attribute from all existing and future <a ping> elements
      function removePingAttrs(root) {
        root.querySelectorAll("a[ping]").forEach(a => a.removeAttribute("ping"));
      }
      removePingAttrs(document);
      let _pingBatchId = 0;
      const observer = new MutationObserver(mutations => {
        // Attribute changes: handle immediately (ping must be removed before click)
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.attributeName === "ping") {
            mutation.target.removeAttribute("ping");
          }
        }
        // New nodes: batch via rAF to avoid per-mutation DOM walks
        if (!_pingBatchId) {
          _pingBatchId = requestAnimationFrame(() => {
            _pingBatchId = 0;
            removePingAttrs(document);
          });
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["ping"] });

      // sendBeacon override removed: MV3 content scripts run in an isolated world,
      // so overriding navigator.sendBeacon here has no effect on page-initiated
      // beacons. Ping blocking is handled via <a ping> attribute removal instead.
    }
  });

  // ── Redirect unwrap (#371) ────────────────────────────────────────────────
  // Merged from the previously separate src/content/redirect-unwrap.js. The
  // unwrap logic needs document_end timing (it reads <meta http-equiv="refresh">
  // for Pepper deal sites), so we defer to DOMContentLoaded inside this
  // document_start-loaded script.
  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch { return null; /* incognito/quota */ }
  }
  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* incognito/quota */ }
  }

  // ── Inline AFFILIATE_REDIRECT_NETWORKS guard (#920) ──────────────────────
  // Mirrors src/lib/opaque-networks.js AFFILIATE_REDIRECT_NETWORKS so the
  // generic redirect-unwrap below can hard-bail on any host in the 2.1
  // pass-through bucket. detectWrapper (wrapper-engine.js) and
  // inlineDetectWrapper (bounce-state-cleaner.js) already null these hosts
  // first; runRedirectUnwrap's generic loop had no equivalent guard, so a
  // pass-through network serving a redirect-shaped path (/redirect, /out, …)
  // with a ?url= param would be client-side unwrapped — defeating the
  // network's 30x and killing the merchant's first-party attribution cookie
  // at landing (the exact #907 bug class). Content scripts can't import from
  // lib at runtime, hence this inline mirror. Kept byte-for-byte identical to
  // the copy in bounce-state-cleaner.js and pinned to the canonical list by
  // tests/unit/content-unwrap-no-affiliate-redirect.test.mjs. Wildcard entries
  // use the `*.suffix` shape (matches `endsWith(".suffix")`).
  const INLINE_AFFILIATE_REDIRECT_NETWORKS = [
    "s.click.aliexpress.com",
    "awin1.com",
    "www.awin1.com",
    "anrdoezrs.net",
    "dpbolvw.net",
    "jdoqocy.com",
    "kqzyfj.com",
    "tkqlhce.com",
    "emjcd.com",
    "qksrv.net",
    "cj.dotomi.com",
    "ad.admitad.com",
    "prf.hn",
    "px.a8.net",
    "*.pxf.io",
    "click.linksynergy.com",
    "tc.tradetracker.net",
    "clk.tradedoubler.com",
    "alitems.com",
    "redirect.viglink.com",
    "go.redirectingat.com",
    "go.skimresources.com",
    "shareasale.com",
    "www.shareasale.com",
  ];

  function isInlineAffiliateRedirectNetwork(host) {
    for (const entry of INLINE_AFFILIATE_REDIRECT_NETWORKS) {
      if (entry.startsWith("*.")) {
        if (host.endsWith(entry.slice(1))) return true;
      } else if (host === entry) {
        return true;
      }
    }
    return false;
  }

  function runRedirectUnwrap() {
    const apply = (prefs) => {
      if (!prefs || !prefs.enabled || !prefs.onboardingDone || !prefs.unwrapRedirects) return;

      // #allowlist-full-inert: this rewrites window.location directly based
      // on the CURRENT page's own URL - it does not go through processUrl and
      // is not one of the four active-defense scripts gated on
      // muga:history-gate, so it needs its own explicit exemption check.
      // Fail-safe: if the bundle helper is unavailable, throws, or prefs is
      // malformed, `exempt` stays false and redirect-unwrap behaves as before.
      try {
        if (window.__mugaCleaner && typeof window.__mugaCleaner.isSiteFullyExempt === "function") {
          if (window.__mugaCleaner.isSiteFullyExempt(location.hostname, prefs)) return;
        }
      } catch {
        // Fail-safe: treat as not exempt, redirect-unwrap stays governed by prefs.unwrapRedirects.
      }

      const currentUrl = window.location.href;

      // Common redirect wrapper patterns: look for a destination URL in query params.
      // "location", "return", "continue" intentionally excluded: too generic,
      // common in SPA routing and OAuth flows, high false-positive risk.
      // "destination" intentionally excluded: used in SSO/corporate flows to indicate
      // where to redirect AFTER authentication. Unwrapping it would bypass login. (#158)
      const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "dest", "goto", "returnurl", "return_url"];

      // Affiliate network redirect domains: these intermediaries embed the real
      // destination in a domain-specific param.
      //
      // #695: hosts that live in AFFILIATE_REDIRECT_NETWORKS (the 2.1 pass-through
      // bucket) MUST NOT appear here — client-side unwrap would silently defeat
      // the network's 30x and kill the merchant's first-party attribution cookie.
      // awin1.com / ad.admitad.com / alitems.com / clk.tradedoubler.com /
      // redirect.viglink.com were retired from this map in #695; a regression
      // test in tests/unit/content-unwrap-no-affiliate-redirect.test.mjs enforces
      // the invariant.
      //
      // shareasale.com retired from this map in #907: reclassified as
      // pass-through (AFFILIATE_REDIRECT_NETWORKS in opaque-networks.js), same
      // policy as Awin/Impact/Rakuten/TradeTracker — local-unwrap risked
      // dropping the network's 30x attribution context.
      const AFFILIATE_REDIRECT_PARAMS = {};

      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return;
      }

      // --- Affiliate network redirect unwrap (domain-specific params) ---
      const currentHost = parsed.hostname.replace(/^www\./, "");
      const affiliateParam = AFFILIATE_REDIRECT_PARAMS[currentHost];
      if (affiliateParam) {
        const raw = parsed.searchParams.get(affiliateParam);
        if (raw && raw.length <= 2000) {
          let dest;
          try {
            dest = new URL(raw);
          } catch {
            try { dest = new URL(decodeURIComponent(raw)); } catch { /* skip */ }
          }
          if (dest && ["http:", "https:"].includes(dest.protocol) && dest.hostname && dest.hostname !== parsed.hostname) {
            const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
            if (!safeSessionGet(sessionKey)) {
              safeSessionSet(sessionKey, "1");
              window.location.replace(dest.href);
              return;
            }
          }
        }
      }

      // --- Pepper network deal sites (Chollometro, mydealz, dealabs, etc.) ---
      // /visit/{section}/{dealId} pages use a <meta http-equiv="refresh"> to
      // bounce through digidip.net or path.*.com intermediaries before the
      // store. We extract the final destination from the intermediary's
      // "url" param and navigate directly, skipping all tracking servers.
      const PEPPER_DOMAINS = [
        "chollometro.com", "mydealz.de", "dealabs.com", "hotukdeals.com",
        "pepper.pl", "pepper.it", "pepper.ru", "pepper.com",
        "promodescuentos.com", "pelando.com.br", "preisjaeger.at",
        "nl.pepper.com", "pepper.se", "pepper.fr",
      ];
      // Known Pepper intermediary hostnames. We only extract ?url= from these
      // domains. Any injected <meta refresh> pointing to a non-allowlisted
      // intermediary is ignored. Matching rules:
      //   digidip.net  — any subdomain (e.g. chollometro.digidip.net)
      //   path.*.com   — Pepper CDN subdomains (e.g. path.chollometro.com)
      const PEPPER_INTERMEDIARY_ALLOWLIST = Object.freeze(["digidip.net", "path"]);
      function isPepperIntermediary(hostname) {
        if (hostname === "digidip.net" || hostname.endsWith(".digidip.net")) return true;
        const parts = hostname.split(".");
        if (parts.length >= 3 && parts[0] === "path") return true;
        return false;
      }
      // Suppress unused-variable lint: PEPPER_INTERMEDIARY_ALLOWLIST is documentation.
      void PEPPER_INTERMEDIARY_ALLOWLIST;
      if (/^\/visit\//.test(parsed.pathname) && PEPPER_DOMAINS.some(d => currentHost === d || currentHost === "www." + d)) {
        const meta = document.querySelector('meta[http-equiv="refresh"]');
        if (meta) {
          const content = meta.getAttribute("content") || "";
          const urlMatch = content.match(/url=['"]*([^'">\s]+)/i);
          if (urlMatch) {
            let intermediary;
            try { intermediary = new URL(urlMatch[1]); } catch { /* skip */ }
            if (intermediary && isPepperIntermediary(intermediary.hostname)) {
              const destRaw = intermediary.searchParams.get("url");
              if (destRaw && destRaw.length <= 2000) {
                let dest;
                try { dest = new URL(destRaw); } catch {
                  try { dest = new URL(decodeURIComponent(destRaw)); } catch { /* skip */ }
                }
                if (dest && ["http:", "https:"].includes(dest.protocol)) {
                  const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
                  if (!safeSessionGet(sessionKey)) {
                    safeSessionSet(sessionKey, "1");
                    window.location.replace(dest.href);
                    return;
                  }
                }
              }
            }
          }
        }
      }

      // --- Amazon Sponsored Products redirect unwrap ---
      if (parsed.pathname === "/sspa/click") {
        const raw = parsed.searchParams.get("url");
        if (raw && raw.length <= 2000) {
          let decoded;
          try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
          let dest;
          try { dest = new URL(decoded, parsed.origin); } catch { /* skip */ }
          if (dest && ["http:", "https:"].includes(dest.protocol)) {
            const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
            if (!safeSessionGet(sessionKey)) {
              safeSessionSet(sessionKey, "1");
              window.location.replace(dest.href);
              return;
            }
          }
        }
      }

      // --- Generic redirect wrapper unwrap ---
      // 2.1 pass-through invariant (#920): bail BEFORE the generic loop when
      // the current host is an affiliate-redirect network. The path/param
      // heuristics below cannot tell an attribution-bearing 30x apart from a
      // plain redirector, so unwrapping a pass-through host here would strip
      // the creator's commission. Mirrors the hard-null guards in
      // detectWrapper / inlineDetectWrapper.
      if (isInlineAffiliateRedirectNetwork(location.hostname.toLowerCase())) return;
      const REDIRECT_PATH_RE = /\/(redirect|bounce|out|away|leave|goto|jump|click|track|link|redir|forward|proxy|url|exit)\b/i;
      if (!REDIRECT_PATH_RE.test(location.pathname)) return;

      for (const [rawKey, value] of parsed.searchParams) {
        const param = rawKey.toLowerCase();
        if (!REDIRECT_PARAMS.includes(param)) continue;
        if (!value || value.length > 2000) continue;

        let destination;
        try {
          destination = new URL(value);
        } catch {
          try {
            destination = new URL(decodeURIComponent(value));
          } catch {
            continue;
          }
        }

        if (!["http:", "https:"].includes(destination.protocol)) continue;
        if (!destination.hostname) continue;
        if (destination.hostname === parsed.hostname) continue;

        const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
        if (safeSessionGet(sessionKey)) return;
        safeSessionSet(sessionKey, "1");

        window.location.replace(destination.href);
        return;
      }
    };
    // #726: prefer the module-scoped prefs cache (populated by the IIFE init)
    // and skip the getPrefs round-trip. Fall back to sendMessage only when the
    // cache is still null (very early in the content-script lifecycle).
    if (_contentPrefs) { apply(_contentPrefs); return; }
    chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
      void chrome.runtime.lastError;
      apply(prefs);
    });
  }

  // Defer redirect-unwrap to DOMContentLoaded so the Pepper meta-refresh
  // detection sees a parsed DOM (the original document_end timing of the
  // standalone redirect-unwrap.js content script).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runRedirectUnwrap);
  } else {
    runRedirectUnwrap();
  }
})();
