/**
 * MUGA — Redirect Unwrap Content Script
 * Detects redirect wrapper URLs (e.g. tracking redirectors) and unwraps
 * the final destination URL, navigating there directly.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * Prefs are fetched from the service worker via messaging.
 */

(function () {
  "use strict";

  chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
    if (!prefs || !prefs.enabled || !prefs.unwrapRedirects) return;

    const currentUrl = window.location.href;

    // Common redirect wrapper patterns — look for a destination URL in query params
    // "location", "return", "continue" intentionally excluded — too generic,
    // common in SPA routing and OAuth flows, high false-positive risk.
    const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "destination", "dest", "target", "to", "goto", "next", "returnUrl", "return_url"];

    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return;
    }

    for (const param of REDIRECT_PARAMS) {
      const value = parsed.searchParams.get(param);
      if (!value) continue;

      let destination;
      try {
        destination = new URL(value);
      } catch {
        // Try decoding if it's percent-encoded
        try {
          destination = new URL(decodeURIComponent(value));
        } catch {
          continue;
        }
      }

      if (!["http:", "https:"].includes(destination.protocol)) continue;

      // Only unwrap if the destination host differs (it's an actual redirect wrapper)
      if (destination.hostname === parsed.hostname) continue;

      window.location.replace(destination.href);
      return;
    }
  });
})();
