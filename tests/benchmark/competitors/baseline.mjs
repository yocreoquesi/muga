/**
 * MUGA: Synthetic baseline adapter — A6 phase 2a (#506).
 *
 * NOT a real competitor. Represents the FLOOR of URL-cleaning coverage:
 * the 9 UTM params plus the most common cross-network click IDs. Any
 * dedicated URL cleaner — ClearURLs, AdGuard URL Tracking Protection,
 * Brave Shields, Firefox built-in — covers at least these. So the
 * baseline is a useful "if you do nothing else" reference line in
 * comparison reports.
 *
 * Why ship a synthetic baseline before the real adapters: it exercises
 * the #519 adapter contract end-to-end with actual report data, and it
 * gives the report a stable lower-bound that doesn't depend on external
 * snapshots being current. Real competitor adapters land in phases 2b
 * (ClearURLs), 2c (AdGuard), 2d (Brave), 2e (Firefox) — each will be
 * scored against this baseline AND MUGA.
 *
 * Coverage list is INTENTIONALLY conservative. Adding anything beyond
 * the canonical UTM + click IDs would muddle "this is what every
 * cleaner does" — that distinction is what makes the baseline useful.
 */

const STRIP = new Set([
  // UTM family (Google Analytics standard, 9 params)
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
  // Cross-network click IDs every dedicated cleaner strips
  "fbclid",         // Facebook
  "gclid",          // Google Ads
  "gclsrc",         // Google Ads source attribution
  "dclid",          // DoubleClick
  "msclkid",        // Microsoft Bing
  "twclid",         // Twitter / X
  "yclid",          // Yandex
  "gbraid",         // Google iOS attribution (web→app)
  "wbraid",         // Google iOS attribution (app→web)
  "_gl",            // Google Analytics cross-domain linker
]);

/**
 * @param {string} rawUrl
 * @returns {string} the cleaned URL or rawUrl unchanged if no changes were made
 */
function cleanBaseline(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

  let changed = false;
  // Snapshot keys before iterating — searchParams.delete() during
  // forEach would skip the next entry.
  for (const key of [...url.searchParams.keys()]) {
    if (STRIP.has(key.toLowerCase())) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.toString() : rawUrl;
}

export const baselineAdapter = {
  name: "baseline",
  label: "Synthetic baseline (UTM + common click IDs)",
  source: "synthetic — represents the floor coverage of any URL cleaner",
  version: "1",
  clean: cleanBaseline,
};

// Exposed for tests. Not part of the public adapter contract.
export const _STRIP = STRIP;
