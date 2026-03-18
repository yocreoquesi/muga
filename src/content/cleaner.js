/**
 * MUGA — Content Script
 * Injected into every page. Intercepts link clicks before navigation occurs
 * and communicates with the service worker to get a clean URL.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * All URL processing is delegated to the service worker via messaging.
 */

(function () {
  "use strict";

  // Prevent double execution in iframes
  if (window.self !== window.top) return;
  if (window.__mugaActive) return;
  window.__mugaActive = true;

  /**
   * Intercepts link clicks before navigation.
   * The service worker handles processing and responds with the clean URL.
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

    // No query string means nothing to clean
    if (!url.search) return;

    // Preserve Ctrl/Cmd/Shift+click and target="_blank" (open in new tab/window)
    const opensNewTab = e.ctrlKey || e.metaKey || e.shiftKey ||
      (anchor.target && anchor.target !== "_self" && anchor.target !== "_top" && anchor.target !== "_parent");

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
        // Show a non-intrusive notification so the user can decide
        showAffiliateNotice(detectedAffiliate, href, cleanUrl, (choice) => {
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
   */
  function showAffiliateNotice(affiliate, originalUrl, cleanUrl, callback) {
    // Remove any existing toast
    document.getElementById("muga-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "muga-notice";
    notice.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1a1a1a;
      color: #f0f0f0;
      border-radius: 10px;
      padding: 12px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.5;
      max-width: 300px;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      border: 0.5px solid rgba(255,255,255,0.1);
    `;

    const domain = new URL(originalUrl).hostname.replace("www.", "");

    notice.innerHTML = `
      <div style="font-weight:500;margin-bottom:6px;font-size:12px;color:#aaa">
        MUGA detectó un referido
      </div>
      <div style="margin-bottom:10px;font-size:12px;color:#ddd">
        ${domain} lleva el tag <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px">${affiliate.param}=${affiliate.value}</code>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-choice="original" style="flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer">Mantener</button>
        <button data-choice="clean" style="flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer">Quitar</button>
      </div>
      <div style="margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer" id="muga-dismiss">Descartar</div>
    `;

    document.body.appendChild(notice);

    // Auto-dismiss after 5 seconds → fall back to original URL
    const timer = setTimeout(() => {
      notice.remove();
      callback("original");
    }, 5000);

    notice.querySelectorAll("button[data-choice]").forEach(btn => {
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        notice.remove();
        callback(btn.dataset.choice);
      });
    });

    document.getElementById("muga-dismiss")?.addEventListener("click", () => {
      clearTimeout(timer);
      notice.remove();
      callback("original");
    });
  }
})();
