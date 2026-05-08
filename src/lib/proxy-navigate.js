/**
 * MUGA: Privacy Proxy navigation helper (B20 #453, W-1)
 *
 * Pure function that decides whether to route an opaque affiliate link click
 * through the Privacy Proxy service worker message (UNWRAP_VIA_PROXY) or to
 * let the browser handle the navigation naturally.
 *
 * Extracted from src/content/cleaner.js click handler so it can be unit-tested
 * in Node.js without DOM or Chrome API globals. The cleaner.js wrapper injects
 * all real implementations as dependencies.
 *
 * SYNC NOTE: src/content/cleaner.js inlines this same logic because content
 * scripts are IIFE and cannot import ES modules. Drift between the two is
 * caught at CI time by the structural tests in
 * tests/unit/service-worker-privacy-proxy.test.mjs and the trigger-condition
 * tests in tests/unit/proxy-navigate.test.mjs. If you change either, change
 * both — and re-run those tests.
 *
 * Return values
 * ─────────────
 *   "proxy-navigate"   — SW resolved successfully; caller navigated to destination
 *   "fallback"         — SW failed/timed out; caller navigated to original URL
 *   "default-navigate" — conditions not met; caller lets the browser navigate
 *
 * Conditions required to enter the proxy path (all four must be true):
 *   1. prefs.privacyProxyEnabled === true
 *   2. host is in opaqueHosts
 *   3. detectWrapper(url) returns truthy
 *   4. unwrap(url) returns null (cannot be unwrapped client-side)
 *
 * @module proxy-navigate
 */

/** Maximum destination URL length accepted from the SW response. */
const MAX_DESTINATION_LENGTH = 2000;

/** Default outer timeout for the SW message round-trip (ms). */
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Handles the proxy-navigation decision for a clicked opaque affiliate link.
 *
 * @param {object}   opts
 * @param {string}   opts.url             - Absolute URL that was clicked (href at click time)
 * @param {object}   opts.event           - The click event (must have preventDefault())
 * @param {object}   opts.prefs           - Content prefs cache (requires .privacyProxyEnabled)
 * @param {string[]} opts.opaqueHosts     - Frozen array of opaque affiliate hostnames
 * @param {Function} opts.detectWrapper   - (url: string) => object|null
 * @param {Function} opts.unwrap          - (url: string) => object|null
 * @param {Function} opts.sendMessage     - (msg: object) => Promise<object> — injects chrome.runtime.sendMessage
 * @param {Function} opts.navigate        - (url: string) => void — injects window.location.href assignment
 * @param {number}   [opts.timeoutMs]     - Outer timeout for SW round-trip (default: 6000ms)
 *
 * @returns {Promise<"proxy-navigate"|"fallback"|"default-navigate">}
 */
export async function handleProxyNavigation(opts) {
  const {
    url,
    event,
    prefs,
    opaqueHosts,
    detectWrapper,
    unwrap,
    sendMessage,
    navigate,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  // Condition 1: proxy must be enabled
  if (!prefs?.privacyProxyEnabled) return "default-navigate";

  // Condition 2: host must be in the opaque networks list
  let rawHostname;
  try {
    rawHostname = new URL(url).hostname;
  } catch {
    return "default-navigate";
  }
  const hostname = rawHostname.replace(/^www\./, "");
  if (!opaqueHosts.includes(hostname) && !opaqueHosts.includes(rawHostname)) {
    return "default-navigate";
  }

  // Condition 3: must be a recognized wrapper pattern
  if (!detectWrapper(url)) return "default-navigate";

  // Condition 4: must NOT be locally unwrappable (opaque — destination unknown client-side)
  if (unwrap(url) !== null) return "default-navigate";

  // All conditions met → enter proxy path
  event.preventDefault();

  // Send UNWRAP_VIA_PROXY with an outer timeout guard.
  // The SW handler enforces a 5s fetch timeout; we add a 6s outer cushion so
  // if the message channel itself dies we still navigate (fall back) rather than hang.
  let response;
  try {
    response = await Promise.race([
      sendMessage({ type: "UNWRAP_VIA_PROXY", url }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("proxy-navigate timeout")), timeoutMs)
      ),
    ]);
  } catch {
    // SW message failed or timed out — fall back to original URL
    navigate(url);
    return "fallback";
  }

  // Validate the response before navigating
  if (response?.ok === true) {
    const dest = response.destination;

    // Defense in depth: validate scheme and length even though SW already validated
    if (
      typeof dest === "string" &&
      dest.length <= MAX_DESTINATION_LENGTH &&
      (dest.startsWith("https://") || dest.startsWith("http://"))
    ) {
      // Final scheme validation via URL parser
      try {
        const destUrl = new URL(dest);
        if (destUrl.protocol === "http:" || destUrl.protocol === "https:") {
          navigate(dest);
          return "proxy-navigate";
        }
      } catch { /* fall through to fallback */ }
    }
  }

  // SW returned ok:false, or destination failed validation → fall back
  navigate(url);
  return "fallback";
}
