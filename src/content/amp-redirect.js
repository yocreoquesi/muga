/**
 * MUGA: AMP Redirect Content Script
 * Detects AMP pages and redirects to the canonical non-AMP URL.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * Prefs are fetched from the service worker via messaging.
 */

(function () {
  "use strict";

  chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
    void chrome.runtime.lastError;
    if (!prefs || !prefs.enabled || !prefs.onboardingDone || !prefs.ampRedirect) return;

    // #allowlist-full-inert: this script rewrites window.location on its own
    // (not through processUrl, not one of the four muga:history-gate
    // active-defense scripts), so a fully-exempt domain (domain-only
    // whitelist entry) needs its own explicit check here. Relevant mainly
    // on Firefox MV2, where this file is injected as its own content_scripts
    // entry (manifest.v2.json) sharing
    // the isolated-world window with cleaner-bundle.js from the entry
    // registered earlier in the same manifest - window.__mugaCleaner is set
    // there. On Chrome MV3 this file is not loaded at all (AMP redirects run
    // via the amp_redirect DNR ruleset instead). Fail-safe: if the bundle
    // helper is unavailable, throws, or prefs is malformed, `exempt` stays
    // false and the AMP redirect behaves as before.
    let exempt = false;
    try {
      if (window.__mugaCleaner && typeof window.__mugaCleaner.isSiteFullyExempt === "function") {
        exempt = window.__mugaCleaner.isSiteFullyExempt(location.hostname, prefs);
      }
    } catch {
      // Fail-safe: treat as not exempt, AMP redirect stays governed by prefs.ampRedirect.
    }
    if (exempt) return;

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
      parsedCurrent.searchParams.has("amp")
    );
    const isAmp =
      document.documentElement.hasAttribute("amp") ||
      document.documentElement.hasAttribute("⚡") ||
      isAmpByUrl;

    if (!isAmp) return;
    if (canonicalUrl === currentUrl) return;
    // Cap the redirect-target length (parity with the 2000-char redirect cap
    // enforced in wrapper-engine.js) before window.location.replace — guards
    // against pathological canonical hrefs on the Firefox MV2 path. (#728 item 17)
    if (canonicalUrl.length > 2000) return;

    try {
      const canonical_ = new URL(canonicalUrl);
      const current_ = new URL(currentUrl);
      // Only redirect to https (prevent accidental http downgrade from a bad canonical tag)
      if (canonical_.protocol !== "https:") return;
      // Only follow canonical tags on pages with an explicit "amp." subdomain prefix.
      // This is the canonical AMP use-case (amp.example.com → example.com) and prevents
      // abuse via injected canonical tags on non-subdomain AMP pages controlled by the
      // page author. html[amp] / html[⚡] attributes alone are not trusted for redirects.
      if (!current_.hostname.startsWith("amp.")) return;
      // Redirect only if the canonical is on a parent domain (subdomain → parent)
      if (current_.hostname.endsWith("." + canonical_.hostname)) {
        window.location.replace(canonicalUrl);
      }
    } catch {
      // Invalid URL. Do nothing.
    }
  });
})();
