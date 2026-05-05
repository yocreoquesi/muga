/**
 * MUGA: Firefox built-in URL Query Stripping adapter — A6 phase 2e (#506).
 *
 * Loads Firefox's Remote Settings `query-stripping` collection (the
 * source of truth for both ETP Strict-mode auto-stripping and the
 * "Copy Link Without Site Tracking" feature) and applies its
 * stripList to a single URL. The benchmark uses this to score MUGA
 * against Firefox's built-in URL cleaner on a shared corpus.
 *
 * Source: https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/query-stripping/records
 * Vendored under data/firefox.json — refresh via
 * `npm run benchmark:refresh-competitors`.
 *
 * Schema (Firefox Remote Settings response):
 *
 *   {
 *     data: [
 *       { stripList: string[], allowList: string[], schema, id, last_modified },
 *       ...
 *     ]
 *   }
 *
 * Multiple records exist because Firefox publishes additive deltas;
 * the runtime merges them. We do the same here: union of every
 * record's stripList = the params we strip; union of every record's
 * allowList = the hostnames where we suppress the strip.
 *
 * What this adapter does NOT implement:
 *
 *   - Custom strip-on-share rules pushed via Nimbus experiments
 *     (those layer on top of the Remote Settings base; not exposed
 *     publicly, and have a much smaller user-visible footprint).
 *   - The QueryStrippingExceptList preference (per-user override
 *     via about:config — irrelevant to a benchmark of defaults).
 *
 * Firefox's list is intentionally conservative — it ships only
 * params Mozilla has audited as never-functional. That conservatism
 * shows up in the benchmark as a low coverage number relative to
 * ClearURLs / AdGuard. The number IS the story: Firefox does the
 * least, but every entry in its list is rock-solid.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "data", "firefox.json");

const _raw = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const _stripList = new Set();
const _allowList = new Set();
for (const record of (_raw.data || [])) {
  for (const p of (record.stripList || [])) _stripList.add(p.toLowerCase());
  for (const d of (record.allowList || [])) _allowList.add(d.toLowerCase());
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

/**
 * @param {string} rawUrl
 * @returns {string} cleaned URL, or rawUrl unchanged when no strip applied
 */
function cleanFirefox(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

  // Firefox suppresses query-stripping on allowList hosts (e.g.
  // googleadservices.com) so click-tracking redirects stay intact.
  // Mirroring that here keeps the benchmark faithful to default
  // browser behaviour.
  const hostname = url.hostname.toLowerCase();
  for (const allowDomain of _allowList) {
    if (hostMatches(hostname, allowDomain)) return rawUrl;
  }

  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (_stripList.has(key.toLowerCase())) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.toString() : rawUrl;
}

export const firefoxAdapter = {
  name: "firefox",
  label: "Firefox built-in URL Query Stripping (Remote Settings)",
  source: "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/query-stripping/records",
  version: "vendored",
  clean: cleanFirefox,
};

// Exposed for tests. Not part of the public adapter contract.
export { _stripList as _stripListForTests, _allowList as _allowListForTests };
