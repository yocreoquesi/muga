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
    // "destination" intentionally excluded — used in SSO/corporate flows to indicate
    // where to redirect AFTER authentication. Unwrapping it would bypass login. (#158)
    // All entries lowercase — param keys are normalised to lowercase at lookup time (#191).
    const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "dest", "goto", "returnurl", "return_url"];

    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return;
    }

    // Normalise param names to lowercase before lookup so ?URL=, ?Redirect=,
    // ?returnUrl= etc. all match entries in REDIRECT_PARAMS (#191).
    for (const [rawKey, value] of parsed.searchParams) {
      const param = rawKey.toLowerCase();
      if (!REDIRECT_PARAMS.includes(param)) continue;
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
