/**
 * MUGA: Redirect Unwrap Content Script
 * Detects redirect wrapper URLs (e.g. tracking redirectors) and unwraps
 * the final destination URL, navigating there directly.
 *
 * Note: ES module imports are not supported in MV3 content scripts.
 * Prefs are fetched from the service worker via messaging.
 */

(function () {
  "use strict";
  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* incognito/quota */ }
  }

  chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
    void chrome.runtime.lastError;
    if (!prefs || !prefs.enabled || !prefs.onboardingDone || !prefs.unwrapRedirects) return;

    const currentUrl = window.location.href;

    // Common redirect wrapper patterns: look for a destination URL in query params.
    // "location", "return", "continue" intentionally excluded: too generic,
    // common in SPA routing and OAuth flows, high false-positive risk.
    // "destination" intentionally excluded: used in SSO/corporate flows to indicate
    // where to redirect AFTER authentication. Unwrapping it would bypass login. (#158)
    // All entries lowercase: param keys are normalised to lowercase at lookup time (#191).
    const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "dest", "goto", "returnurl", "return_url"];

    // Affiliate network redirect domains: these intermediaries embed the real
    // destination in a domain-specific param. We unwrap them client-side so the
    // user goes straight to the store without passing through the tracking server.
    // Redirect-based affiliate tracking forces users through external servers
    // unnecessarily. We believe users should reach stores directly and choose
    // freely, so we strip these intermediaries when we can.
    const AFFILIATE_REDIRECT_PARAMS = {
      "awin1.com":              "ued",      // Awin (Zalando, SHEIN, Fnac, MediaMarkt, PcComponentes, ECI)
      "shareasale.com":         "urllink",  // ShareASale (SHEIN, others)
      "ad.admitad.com":         "ulp",      // Admitad (AliExpress, SHEIN)
      "alitems.com":            "ulp",      // Admitad via AliExpress
      "redirect.viglink.com":   "u",        // Sovrn/VigLink (MediaMarkt, others)
      "clk.tradedoubler.com":   "url",      // Tradedoubler (Fnac, others)
    };

    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return;
    }

    // --- Affiliate network redirect unwrap (domain-specific params) ---
    // Check if the current page is on a known affiliate redirect domain and
    // extract the destination from the domain-specific param.
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
          if (!sessionStorage.getItem(sessionKey)) {
            safeSessionSet(sessionKey, "1");
            window.location.replace(dest.href);
            return;
          }
        }
      }
    }

    // --- Pepper network deal sites (Chollometro, mydealz, dealabs, etc.) ---
    // /visit/{section}/{dealId} pages use a <meta http-equiv="refresh"> to bounce
    // through digidip.net or path.*.com intermediaries before reaching the store.
    // We extract the final destination from the intermediary's "url" param and
    // navigate directly, skipping all tracking servers.
    const PEPPER_DOMAINS = [
      "chollometro.com", "mydealz.de", "dealabs.com", "hotukdeals.com",
      "pepper.pl", "pepper.it", "pepper.ru", "pepper.com",
      "promodescuentos.com", "pelando.com.br", "preisjaeger.at",
      "nl.pepper.com", "pepper.se", "pepper.fr",
    ];
    if (/^\/visit\//.test(parsed.pathname) && PEPPER_DOMAINS.some(d => currentHost === d || currentHost === "www." + d)) {
      // The page body contains a meta refresh with the intermediary URL.
      // We look for it in the DOM (already parsed by the time content script runs).
      const meta = document.querySelector('meta[http-equiv="refresh"]');
      if (meta) {
        const content = meta.getAttribute("content") || "";
        // Format: "0;url='https://chollometro.digidip.net/visit?url=...'"
        const urlMatch = content.match(/url=['"]*([^'">\s]+)/i);
        if (urlMatch) {
          let intermediary;
          try { intermediary = new URL(urlMatch[1]); } catch { /* skip */ }
          if (intermediary) {
            // Extract the real destination from the intermediary's "url" param
            const destRaw = intermediary.searchParams.get("url");
            if (destRaw && destRaw.length <= 2000) {
              let dest;
              try { dest = new URL(destRaw); } catch {
                try { dest = new URL(decodeURIComponent(destRaw)); } catch { /* skip */ }
              }
              if (dest && ["http:", "https:"].includes(dest.protocol)) {
                const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
                if (!sessionStorage.getItem(sessionKey)) {
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
    // /sspa/click URLs embed the real product URL in the "url" param as a
    // relative path (e.g. /dp/B01N5VHLUG/ref=...). We resolve it against the
    // current origin and navigate directly, skipping the tracking redirect.
    if (parsed.pathname === "/sspa/click") {
      const raw = parsed.searchParams.get("url");
      if (raw && raw.length <= 2000) {
        let decoded;
        try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
        let dest;
        try { dest = new URL(decoded, parsed.origin); } catch { /* skip */ }
        if (dest && ["http:", "https:"].includes(dest.protocol)) {
          const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
          if (!sessionStorage.getItem(sessionKey)) {
            safeSessionSet(sessionKey, "1");
            window.location.replace(dest.href);
            return;
          }
        }
      }
    }

    // --- Generic redirect wrapper unwrap ---
    // Only unwrap on pages whose path looks like a redirect endpoint
    const REDIRECT_PATH_RE = /\/(redirect|bounce|out|away|leave|goto|jump|click|track|link|redir|forward|proxy|url|exit)\b/i;
    if (!REDIRECT_PATH_RE.test(location.pathname)) return;

    // Normalise param names to lowercase before lookup so ?URL=, ?Redirect=,
    // ?returnUrl= etc. all match entries in REDIRECT_PARAMS (#191).
    for (const [rawKey, value] of parsed.searchParams) {
      const param = rawKey.toLowerCase();
      if (!REDIRECT_PARAMS.includes(param)) continue;
      if (!value || value.length > 2000) continue;

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
      if (!destination.hostname) continue;

      // Only unwrap if the destination host differs (it's an actual redirect wrapper)
      if (destination.hostname === parsed.hostname) continue;

      // Guard against redirect loops: if the destination points back to a page
      // that could redirect to us, bail out.
      const sessionKey = "__muga_ruw_" + location.hostname + location.pathname;
      if (sessionStorage.getItem(sessionKey)) return;
      safeSessionSet(sessionKey, "1");

      window.location.replace(destination.href);
      return;
    }
  });
})();
