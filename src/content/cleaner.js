/**
 * MUGA — Content Script
 * Injected into every page. Intercepts link clicks before navigation occurs
 * and communicates with the service worker to get a clean URL.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * All URL processing is delegated to the service worker via messaging.
 * Toast strings are kept inline and read from storage for i18n.
 */

(function () {
  "use strict";

  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Prevent double execution in iframes
  if (window.self !== window.top) return;
  if (window.__mugaActive) return;
  window.__mugaActive = true;

  // Toast strings — default English, overridden by stored language preference
  const STRINGS = {
    en: {
      toast_title:   "MUGA detected a third-party affiliate",
      toast_tag_msg: "has an affiliate tag that isn't ours:",
      toast_allow:   "Allow",
      toast_block:   "Block",
      toast_ours:    "Use ours",
      toast_dismiss: "Dismiss",
    },
    es: {
      toast_title:   "MUGA detectó un afiliado ajeno",
      toast_tag_msg: "tiene un tag de afiliado que no es nuestro:",
      toast_allow:   "Permitir",
      toast_block:   "Bloquear",
      toast_ours:    "Usar el nuestro",
      toast_dismiss: "Descartar",
    },
  };

  let s = STRINGS.en;
  // Load language preference asynchronously — toast will use it if shown after load
  chrome.storage.sync.get({ language: "en" }, (r) => {
    s = STRINGS[r.language] ?? STRINGS.en;
  });

  // Handle clipboard copy requests from the service worker (context menu "Copy clean link")
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SHOW_TEST_TOAST") {
      showAffiliateNotice(
        { param: "tag", value: "competitor-21" },
        "https://amazon.es/dp/B08N5WRWNW?tag=competitor-21",
        "https://amazon.es/dp/B08N5WRWNW",
        undefined,
        () => {}
      );
      return;
    }
    if (message.type !== "COPY_TO_CLIPBOARD") return;
    navigator.clipboard.writeText(message.text).catch(() => {
      // Fallback for pages where the Clipboard API is unavailable
      const el = document.createElement("textarea");
      el.value = message.text;
      el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand("copy"); } catch {}
      el.remove();
    });
  });

  // Matches http/https URLs including query strings, stops at whitespace or common trailing punctuation
  const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/g;

  /**
   * Intercepts Ctrl+C / copy.
   * - If the entire selection is a URL: cleans it (existing behaviour).
   * - If the selection is mixed text containing URLs: cleans each embedded URL
   *   and puts the modified text on the clipboard, leaving all non-URL text intact.
   * Note: address bar copies are a browser UI element and cannot be intercepted.
   */
  document.addEventListener("copy", async (e) => {
    const selected = window.getSelection()?.toString();
    if (!selected) return;

    const trimmed = selected.trim();
    if (!trimmed) return;

    // Find all URLs in the selected text
    const matches = [...trimmed.matchAll(URL_RE)];
    if (matches.length === 0) return;

    e.preventDefault();

    try {
      // Clean each unique URL found in the text
      let result = trimmed;
      for (const match of matches) {
        const rawUrl = match[0];
        // Strip trailing punctuation that is unlikely to be part of the URL
        const cleanCandidate = rawUrl.replace(/[.,;:!?)\]]+$/, "");

        const response = await chrome.runtime.sendMessage({
          type: "PROCESS_URL",
          url: cleanCandidate,
          skipNotify: true,
        });
        if (response?.cleanUrl && response.cleanUrl !== cleanCandidate) {
          result = result.replace(cleanCandidate, response.cleanUrl);
        }
      }

      await navigator.clipboard.writeText(result).catch(() => {
        const el = document.createElement("textarea");
        el.value = result;
        el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
        document.body.appendChild(el);
        el.focus();
        el.select();
        try { document.execCommand("copy"); } catch {}
        el.remove();
      });
    } catch {
      navigator.clipboard.writeText(trimmed).catch(() => {});
    }
  });

  /**
   * Intercepts link clicks before navigation.
   * The service worker handles processing and responds with the clean URL.
   *
   * ARCHITECTURE NOTE — navigation interception scope:
   *   MUGA intercepts clicks on <a> elements within pages where this content
   *   script is already running (injected via manifest content_scripts rules).
   *   The following navigation types CANNOT be intercepted in MV3:
   *     - Typing or pasting a URL directly into the address bar
   *     - Opening a bookmark
   *     - External apps (e.g. clicking a link in an email client or Slack)
   *     - Google Search result clicks that navigate the top-level frame to Amazon
   *       before the content script has loaded on that tab
   *   Cleaning these would require declarativeNetRequest (DNR) rules, which must
   *   be declared statically and cannot be generated dynamically from user prefs.
   *   The popup preview always reflects what WOULD be cleaned if the URL were
   *   processed; actual cleaning only happens on in-page link clicks.
   */
  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a[href]");
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

    // Preserve Ctrl/Cmd/Shift+click and target="_blank" (open in new tab/window)
    const opensNewTab = e.ctrlKey || e.metaKey || e.shiftKey ||
      anchor.target === "_blank";

    e.preventDefault();

    try {
      const response = await chrome.runtime.sendMessage({
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
          else if (choice === "clean") navigate(cleanUrl, opensNewTab);
          else if (choice === "ours" && response.withOurAffiliate) {
            navigate(response.withOurAffiliate, opensNewTab);
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
    if (newTab) {
      window.open(url, "_blank");
    } else {
      window.location.href = url;
    }
  }

  /**
   * Shows a non-intrusive toast when a foreign affiliate tag is detected.
   * Auto-dismisses after 5 seconds if the user does not interact.
   * @param {object} affiliate
   * @param {string} originalUrl
   * @param {string} cleanUrl
   * @param {string|undefined} withOurAffiliate - URL with our tag (only when allowReplaceAffiliate is on)
   * @param {function} callback
   */
  function showAffiliateNotice(affiliate, originalUrl, cleanUrl, withOurAffiliate, callback) {
    document.getElementById("muga-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "muga-notice";
    notice.style.cssText = [
      "position:fixed", "bottom:20px", "right:20px",
      "background:#1c1c1e", "color:#f0f0f0", "border-radius:10px",
      "padding:12px 16px",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:13px", "line-height:1.5", "max-width:300px",
      "z-index:2147483647", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
      "border:0.5px solid rgba(255,255,255,0.1)",
    ].join(";");

    const domain = new URL(originalUrl).hostname.replace("www.", "");

    const btnStyle = "flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer";
    const codeStyle = "background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px";

    // "Use ours" button only shown when allowReplaceAffiliate is on and we have our tag
    const oursBtn = withOurAffiliate
      ? `<button data-choice="ours" style="${btnStyle}">${s.toast_ours}</button>`
      : "";

    notice.innerHTML = `
      <div style="font-weight:500;margin-bottom:6px;font-size:12px;color:#aaa">${s.toast_title}</div>
      <div style="margin-bottom:10px;font-size:12px;color:#ddd">
        ${escHtml(domain)} ${s.toast_tag_msg} <code style="${codeStyle}">${escHtml(affiliate.param)}=${escHtml(affiliate.value)}</code>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-choice="original" style="${btnStyle}">${s.toast_allow}</button>
        <button data-choice="clean" style="${btnStyle}">${s.toast_block}</button>
        ${oursBtn}
      </div>
      <div style="margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer" id="muga-dismiss">${s.toast_dismiss}</div>
    `;

    document.body.appendChild(notice);

    const timer = setTimeout(() => {
      notice.remove();
      callback("clean");
    }, 15000);

    notice.querySelectorAll("button[data-choice]").forEach(btn => {
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        notice.remove();
        const choice = btn.dataset.choice;
        if (choice === "original") {
          // "Allow" — add to whitelist
          const tag = `${affiliate.param}=${affiliate.value}`;
          chrome.runtime.sendMessage({ type: "ADD_TO_WHITELIST", tag });
        } else if (choice === "clean") {
          // "Block" — add to blacklist
          const tag = `${affiliate.param}=${affiliate.value}`;
          chrome.runtime.sendMessage({ type: "ADD_TO_BLACKLIST", tag });
        }
        callback(choice);
      });
    });

    document.getElementById("muga-dismiss")?.addEventListener("click", () => {
      clearTimeout(timer);
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
    if (!prefs || !prefs.enabled) return;
    if (prefs.blockPings) {
      // Strip the ping attribute from all existing and future <a ping> elements
      function removePingAttrs(root) {
        root.querySelectorAll("a[ping]").forEach(a => a.removeAttribute("ping"));
      }
      removePingAttrs(document);
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.hasAttribute?.("ping")) node.removeAttribute("ping");
            removePingAttrs(node);
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  });
})();
