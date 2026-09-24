/**
 * MUGA: Google AMP detour unwrap (#1441).
 *
 * Pure and chrome-free, so the runtime cleaner (processUrl) can skip the two
 * Google-hosted AMP shapes on every browser:
 *
 *   https://www.google.<tld>/amp/s/<publisher-host>/<path>
 *   https://[<publisher-with-dashes>.]cdn.ampproject.org/{c|v}/s/<publisher-host>/<path>
 *
 * These mirror rules 100 and 101 of src/rules/amp-redirect.json, which Chrome
 * applies at the network layer. Firefox does not declare that ruleset, so
 * without this step the Firefox navigation stripper, link clicks and
 * copy-clean left both shapes in place. A publisher's own `amp.` subdomain
 * (rule 102) is NOT handled here: the destination is not in the URL itself.
 *
 * Only the `/s/` (https origin) form is handled, matching the DNR rules.
 */

const GOOGLE_HOST_RE = /^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/;
const AMP_CACHE_HOST_RE = /^(?:[a-z0-9-]+\.)?cdn\.ampproject\.org$/;
const MAX_TARGET_LENGTH = 2000;

/**
 * Returns the publisher URL behind a Google AMP detour, or null when `url` is
 * not one of the two Google AMP shapes (or the embedded destination is not a
 * plausible https URL).
 *
 * @param {URL} url
 * @returns {string|null}
 */
export function unwrapAmpUrl(url) {
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  let rest = null;
  if (GOOGLE_HOST_RE.test(host) && path.startsWith("/amp/s/")) {
    rest = path.slice("/amp/s/".length);
  } else if (AMP_CACHE_HOST_RE.test(host) && (path.startsWith("/c/s/") || path.startsWith("/v/s/"))) {
    rest = path.slice("/c/s/".length);
  }
  if (!rest) return null;

  const target = "https://" + rest + url.search + url.hash;
  if (target.length > MAX_TARGET_LENGTH) return null;
  try {
    const dest = new URL(target);
    // A real publisher host has a dot; this rejects "localhost" and empty hosts.
    if (!dest.hostname.includes(".")) return null;
    return dest.href;
  } catch {
    return null;
  }
}
