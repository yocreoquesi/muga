/**
 * MUGA: ClearURLs competitor adapter — A6 phase 2b (#506).
 *
 * Loads the vendored ClearURLs ruleset from data/clearurls.json and
 * applies its provider-scoped strip logic to a single URL. The
 * benchmark uses this to score MUGA against ClearURLs on the same
 * corpus — what ClearURLs would have done on this URL if running by
 * itself, with no MUGA in the picture.
 *
 * Source: https://rules2.clearurls.xyz/data.minify.json (vendored
 * snapshot under data/clearurls.json — refresh via
 * `npm run benchmark:refresh-competitors`).
 *
 * What this adapter implements (matches ClearURLs default config):
 *   - urlPattern host gating per provider
 *   - exceptions (URLs that opt out of a provider's rules)
 *   - rules (regexes against query param NAMES, case-insensitive,
 *     strip if matching)
 *   - referralMarketing (treated identically to rules in ClearURLs
 *     default config — both removed; this is where MUGA's wedge
 *     diverges, but the benchmark must show what ClearURLs DOES,
 *     not what we wish it did)
 *   - rawRules (regexes applied to the full URL string, matched
 *     substrings stripped)
 *
 * What this adapter does NOT implement:
 *   - completeProvider: true (would block the URL entirely; the
 *     benchmark contract says clean() returns a URL string, never
 *     an empty / null sentinel — completeProvider providers are
 *     skipped entirely in this adapter, scored as "no opinion").
 *   - redirections (URL-unwrap is a different scope from param strip;
 *     ClearURLs handles it separately and so does MUGA via its
 *     wrapper-engine — comparing redirect-unwrap belongs in its own
 *     benchmark slice, not the param-strip column).
 *
 * Structural privacy: the adapter is pure. It reads the input URL,
 * applies regexes from the JSON snapshot, returns a string. No I/O,
 * no globals beyond `URL` / `RegExp`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "data", "clearurls.json");

const _raw = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const _providers = _raw.providers || {};

// Pre-compile every regex once so the per-URL hot path doesn't pay
// the RegExp() cost 200+ times per call. Compilation failures
// (malformed source) are skipped silently — a future ClearURLs
// release that adds a syntax we don't handle should not break the
// benchmark, just narrow the adapter's coverage.
const _compiled = (() => {
  const out = [];
  for (const [name, p] of Object.entries(_providers)) {
    if (p.completeProvider) continue; // see docblock — skipped by design
    let urlPattern;
    try { urlPattern = new RegExp(p.urlPattern, "i"); } catch { continue; }
    const exceptions = (p.exceptions || []).map((src) => {
      try { return new RegExp(src, "i"); } catch { return null; }
    }).filter(Boolean);
    const rules = [...(p.rules || []), ...(p.referralMarketing || [])].map((src) => {
      // ClearURLs param-rule regexes are evaluated against the param
      // name. They expect `^…$` anchoring implicitly in the official
      // engine. We apply that anchor explicitly so a rule like
      // `utm_source` doesn't match `xx_utm_source_xx`.
      try { return new RegExp("^" + src + "$", "i"); } catch { return null; }
    }).filter(Boolean);
    const rawRules = (p.rawRules || []).map((src) => {
      try { return new RegExp(src, "ig"); } catch { return null; }
    }).filter(Boolean);
    out.push({ name, urlPattern, exceptions, rules, rawRules });
  }
  return out;
})();

/**
 * @param {string} rawUrl
 * @returns {string} cleaned URL or rawUrl unchanged when no provider applied
 */
function cleanClearUrls(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

  let working = rawUrl;
  let changed = false;

  for (const p of _compiled) {
    if (!p.urlPattern.test(working)) continue;
    if (p.exceptions.some((r) => r.test(working))) continue;

    // rawRules: full-URL regex substring removal.
    if (p.rawRules.length > 0) {
      let next = working;
      for (const r of p.rawRules) {
        next = next.replace(r, "");
      }
      if (next !== working) {
        working = next;
        changed = true;
      }
    }

    // Param rules: drop matching query-param names.
    if (p.rules.length > 0) {
      let parsed;
      try { parsed = new URL(working); } catch { continue; }
      const keys = [...parsed.searchParams.keys()];
      let providerChanged = false;
      for (const key of keys) {
        if (p.rules.some((r) => r.test(key))) {
          parsed.searchParams.delete(key);
          providerChanged = true;
        }
      }
      if (providerChanged) {
        working = parsed.toString();
        changed = true;
      }
    }
  }

  return changed ? working : rawUrl;
}

export const clearurlsAdapter = {
  name: "clearurls",
  label: "ClearURLs (data.minify.json default config)",
  source: "https://rules2.clearurls.xyz/data.minify.json",
  // Captured in scripts/refresh-competitor-snapshots.mjs and committed
  // under data/clearurls.json. The capture date + hash live in
  // README-CONTRACT.txt's Snapshots section.
  version: "vendored",
  clean: cleanClearUrls,
};

// Exposed for tests. Not part of the public adapter contract.
export const _compiledForTests = _compiled;
