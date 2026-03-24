/**
 * MUGA — AMP Redirect Content Script
 * Detects AMP pages and redirects to the canonical non-AMP URL.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * Prefs are fetched from the service worker via messaging.
 */

(function () {
  "use strict";

  chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
    void chrome.runtime.lastError;
    if (!prefs || !prefs.enabled || !prefs.ampRedirect) return;

    // Find the canonical link pointing to the non-AMP version
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical || !canonical.href) return;

    const currentUrl = window.location.href;
    const canonicalUrl = canonical.href;

    // Only redirect if we are on an AMP page and canonical differs.
    // Strict URL checks prevent false positives for paths like /trampoline,
    // /campaign, or /example-amp-meter (#189).
    const parsedCurrent = (() => { try { return new URL(currentUrl); } catch { return null; } })();
    const isAmpByUrl = parsedCurrent && (
      parsedCurrent.hostname.startsWith("amp.") ||
      parsedCurrent.pathname.startsWith("/amp/") ||
      parsedCurrent.pathname === "/amp" ||
      parsedCurrent.pathname.endsWith("/amp") ||
      parsedCurrent.search.includes("?amp") ||
      parsedCurrent.search.startsWith("?amp") ||
      parsedCurrent.searchParams.has("amp")
    );
    const isAmp =
      document.documentElement.hasAttribute("amp") ||
      document.documentElement.hasAttribute("⚡") ||
      isAmpByUrl;

    if (!isAmp) return;
    if (canonicalUrl === currentUrl) return;

    try {
      const canonical_ = new URL(canonicalUrl);
      const current_ = new URL(currentUrl);
      // Only redirect to https (prevent accidental http downgrade from a bad canonical tag)
      if (canonical_.protocol !== "https:") return;
      // Redirect only if the canonical is on the same or a parent domain
      if (
        canonical_.hostname === current_.hostname ||
        current_.hostname.endsWith("." + canonical_.hostname)
      ) {
        window.location.replace(canonicalUrl);
      }
    } catch {
      // Invalid URL — do nothing
    }
  });
})();
