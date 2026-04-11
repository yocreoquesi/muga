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

  // Matches http/https URLs including query strings, stops at whitespace or common trailing punctuation
  const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

  // Timer ID for the toast auto-dismiss. Cleared when a new toast replaces the old one.
  let _toastTimer = null;

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

      // 4. Ask service worker to clean each URL
      Promise.all(
        allUrls.map(url => chrome.runtime.sendMessage({ type: "PROCESS_URL", url, skipNotify: true, skipStats: true }))
      ).then(results => {
        const urlMap = new Map(allUrls.map((url, i) => [url, results[i]?.cleanUrl ?? url]));

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
  document.addEventListener("copy", async (e) => {
    // Do nothing when extension is disabled or onboarding not done.
    if (!_contentPrefs?.enabled || !_contentPrefs?.onboardingDone) return;

    const selected = window.getSelection()?.toString();
    if (!selected) return;

    const trimmed = selected.trim();
    if (!trimmed) return;

    // Find all URLs in the selected text
    const matches = [...trimmed.matchAll(URL_RE)];
    if (matches.length === 0) return;

    e.preventDefault();

    try {
      // Clean each unique URL found in the text.
      // Sort matches by length descending so longer URLs are replaced first,
      // preventing a shorter URL that is a prefix of a longer one from
      // corrupting the longer URL during replaceAll.
      const sortedMatches = [...matches].sort((a, b) => b[0].length - a[0].length);
      let result = trimmed;
      for (const match of sortedMatches) {
        const rawUrl = match[0];
        // Strip trailing punctuation that is unlikely to be part of the URL
        const cleanCandidate = rawUrl.replace(/[.,;:!?)\]]+$/, "");

        const response = await chrome.runtime.sendMessage({
          type: "PROCESS_URL",
          url: cleanCandidate,
          skipNotify: true,
        });
        if (response?.cleanUrl && response.cleanUrl !== cleanCandidate) {
          result = result.replaceAll(cleanCandidate, response.cleanUrl);
        }
      }

      await copyToClipboard(result);
    } catch {
      navigator.clipboard.writeText(trimmed).catch(() => { /* best-effort fallback */ });
    }
  });

  // Eagerly load prefs so they're available synchronously for click/copy handlers
  getContentPrefs();

  // ── Self-clean: clean the current page URL on load ────────────────────────
  // DNR (Chrome MV3) strips tracking params before the page loads, but Firefox
  // MV2 has no DNR. This fallback asks the service worker to clean the current
  // URL and, if it changed, updates the address bar via history.replaceState.
  // This also acts as a safety net for Chrome when DNR rules don't cover a param.
  getContentPrefs().then((prefs) => {
    if (!prefs || !prefs.enabled || !prefs.onboardingDone) return;
    const href = window.location.href;
    if (href.startsWith("http")) {
      chrome.runtime.sendMessage({ type: "PROCESS_URL", url: href, skipNotify: false }, (result) => {
        void chrome.runtime.lastError;
        if (!result || !result.cleanUrl || result.cleanUrl === href) return;
        try {
          history.replaceState(history.state, "", result.cleanUrl);
        } catch { /* cross-origin or sandboxed — ignore */ }
      });
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

    // Wrap sendMessage in a 3-second timeout so that if the service worker is
    // dead or unresponsive the user is not left with a dead click. On timeout
    // we fall through to the catch block which navigates to the original href.
    const sendWithTimeout = (msg) => Promise.race([
      chrome.runtime.sendMessage(msg),
      new Promise((_, reject) => setTimeout(() => reject(new Error("muga_sw_timeout")), 3000)),
    ]);

    try {
      const response = await sendWithTimeout({
        type: "PROCESS_URL",
        url: href,
      });

      if (!response || !response.cleanUrl) {
        navigate(href, opensNewTab);
        return;
      }

      const { cleanUrl, action, detectedAffiliate } = response;

      if (action === "detected_foreign" && detectedAffiliate) {
        showAffiliateNotice(detectedAffiliate, href, cleanUrl, response.withOurAffiliate, (choice) => {
          if (choice === "original") navigate(href, opensNewTab);
          else if (choice === "clean") {
            // If user has injection enabled, navigate with our tag; otherwise clean URL
            navigate(response.withOurAffiliate || cleanUrl, opensNewTab);
          }
        });
      } else {
        navigate(cleanUrl, opensNewTab);
      }
    } catch {
      navigate(href, opensNewTab);
    }
  }, true);

  /**
   * Navigates to the given URL, preserving new-tab behaviour when needed.
   */
  function navigate(url, newTab) {
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

    const domain = new URL(originalUrl).hostname.replace(/^www\./, "");

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
          const hostname = new URL(originalUrl).hostname.replace(/^www\./, "");
          const tag = `${hostname}::${affiliate.param}::${affiliate.value}`;
          chrome.runtime.sendMessage({ type: "ADD_TO_WHITELIST", tag }).catch(() => { /* expected: channel may close */ });
        } else if (choice === "clean") {
          // "Block": add to blacklist in domain::param::value format (#229)
          const hostname = new URL(originalUrl).hostname.replace(/^www\./, "");
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

  // --- Module-level prefs cache (#142) ---
  // Avoids repeated storage reads on every page load / click interception.
  let _contentPrefs = null;
  let _contentPrefsPending = null;

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
})();
