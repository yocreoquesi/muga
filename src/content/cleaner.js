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

  // Toast strings: default English, overridden by stored language preference
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
      toast_dismiss: "Dispensar",
    },
    de: {
      toast_title:   "MUGA hat ein fremdes Affiliate-Tag gefunden",
      toast_tag_msg: "hat ein Affiliate-Tag, das nicht uns gehört:",
      toast_allow:   "Behalten",
      toast_block:   "Entfernen",
      toast_dismiss: "Schließen",
    },
  };

  const SUPPORTED_LANGS = { en: 1, es: 1, pt: 1, de: 1 };
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
      const urlMap = new Map();
      for (const url of allUrls) {
        let r;
        try {
          r = window.__mugaCleaner.processUrl(url, _contentPrefs, domainRules);
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
      let resultText = trimmed;
      let totalJunkRemoved = 0;
      const allRemovedTracking = [];
      for (const match of sortedMatches) {
        const rawUrl = match[0];
        const cleanCandidate = rawUrl.replace(/[.,;:!?)\]]+$/, "");
        let r;
        try {
          r = window.__mugaCleaner.processUrl(cleanCandidate, _contentPrefs, domainRules);
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

  // ── Self-clean: clean the current page URL on load ────────────────────────
  // (#356) Cleans locally via the bundled cleaner attached to
  // `window.__mugaCleaner` by content/cleaner-bundle.js (loaded just before
  // this script per the manifest). Eliminates the service-worker round-trip
  // on every page load, which previously meant a 3s timeout fall-through if
  // the SW was cold-killed.
  //
  // (#371) Skipped on Chrome MV3 — DNR strips tracking params at the network
  // layer BEFORE document_start fires, so by the time this code runs,
  // window.location.href is already clean and processUrl() returns it
  // unchanged. The self-clean is only meaningful on Firefox MV2 (no DNR).
  // We feature-detect rather than hardcode-target so a future browser that
  // ships DNR also skips automatically.
  //
  // Domain rules are fetched once at IIFE start (see getDomainRulesCached
  // hoisted above). Stats and badge updates fire-and-forget; SW death is
  // not fatal — only the badge lags by one nav.

  const _hasDNR = typeof chrome.declarativeNetRequest !== "undefined";

  if (!_hasDNR) Promise.all([getContentPrefs(), getDomainRulesCached()]).then(([prefs, domainRules]) => {
    if (!prefs || !prefs.enabled || !prefs.onboardingDone) return;
    const href = window.location.href;
    if (!href.startsWith("http")) return;
    if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") {
      // Bundle didn't load — should never happen in production. Silent
      // degrade: leave the URL alone rather than crash.
      return;
    }
    let result;
    try {
      result = window.__mugaCleaner.processUrl(href, prefs, domainRules);
    } catch (err) {
      console.error("[MUGA] local self-clean failed:", err);
      return;
    }
    if (!result || !result.cleanUrl || result.cleanUrl === href) return;
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
        originalUrl: href,
      }).catch(() => { /* SW dead — badge will catch up next nav */ });
    }
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
      result = window.__mugaCleaner.processUrl(href, _contentPrefs, domainRules);
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
        u.searchParams.set(detectedAffiliate.pattern.param, detectedAffiliate.pattern.ourTag);
        withOurAffiliate = u.toString();
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

  function runRedirectUnwrap() {
    chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
      void chrome.runtime.lastError;
      if (!prefs || !prefs.enabled || !prefs.onboardingDone || !prefs.unwrapRedirects) return;

      const currentUrl = window.location.href;

      // Common redirect wrapper patterns: look for a destination URL in query params.
      // "location", "return", "continue" intentionally excluded: too generic,
      // common in SPA routing and OAuth flows, high false-positive risk.
      // "destination" intentionally excluded: used in SSO/corporate flows to indicate
      // where to redirect AFTER authentication. Unwrapping it would bypass login. (#158)
      const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "dest", "goto", "returnurl", "return_url"];

      // Affiliate network redirect domains: these intermediaries embed the real
      // destination in a domain-specific param. We unwrap them client-side so the
      // user goes straight to the store without passing through the tracking server.
      const AFFILIATE_REDIRECT_PARAMS = {
        "awin1.com":              "ued",
        "shareasale.com":         "urllink",
        "ad.admitad.com":         "ulp",
        "alitems.com":            "ulp",
        "redirect.viglink.com":   "u",
        "clk.tradedoubler.com":   "url",
      };

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
