/**
 * MUGA rule-ingestion adapter: ClearURLs Rules (#776).
 *
 * License: LGPL-3.0 (library copyleft — ships alongside MUGA without
 * relicensing the extension). Used as a SIGNAL only: we extract individual
 * literal param-name facts from providers[*].rules[] and independently
 * re-derive each through MUGA's EPIC C gates. See PROVENANCE.md (#774).
 *
 * SAFETY-CRITICAL: providers[*].referralMarketing[] entries MUST NEVER reach
 * the output Set. These are affiliate attribution parameters that belong to
 * MUGA's preserve set. Ingesting them as strip candidates would cause
 * catastrophic revenue loss for creators. Exclusion uses a TWO-PASS GLOBAL
 * union algorithm (see extractClearurlsLiterals) so a param that appears in
 * any provider's referralMarketing is excluded from every provider's output.
 *
 * Public API (named exports only — no default):
 *   extractClearurlsLiterals(rawText) → { params: Set<string>, skipped: number }
 *   clearurls                         → Adapter (id, name, license, url, parse, fetchRaw)
 */

/** @type {import("./index.mjs").Adapter} */

// Canonical raw URL for the ClearURLs rules database (data.min.json is the
// minified production file published on the master branch of ClearURLs/Rules).
// Verified at apply time: https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json
const SOURCE_URL =
  "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";

const USER_AGENT =
  "muga-rule-ingestion/1.0 (+https://github.com/yocreoquesi/muga)";

// Locked contract: safe literal param name — alphanumeric, underscore, hyphen.
// NO dot (conservative; dotted param names are rare in tracking lists and the
// skip-direction is safe). Mirrors adguard-tp precedent but stricter per design.
const LITERAL = /^[a-z0-9_-]+$/;

/**
 * Normalize a ClearURLs entry to a comparable bare name: strip trivial regex
 * anchors (leading `^`, trailing `$`), trim, lowercase.
 *
 * WHY shared: rules[] and referralMarketing[] MUST be normalized identically so
 * the affiliate-exclusion comparison can never miss due to normalization drift
 * (e.g. a `^tag$` referralMarketing entry must still exclude a bare `tag` rule).
 *
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeName(raw) {
  return String(raw).replace(/^\^/, "").replace(/\$$/, "").trim().toLowerCase();
}

// ── Core extraction (testable seam) ──────────────────────────────────────────

/**
 * Extracts safe literal tracking param names from a ClearURLs rules JSON string.
 *
 * WHY two-pass global algorithm: a param that is in rules[] of provider A
 * but referralMarketing[] of provider B must still be excluded. A per-provider
 * exclusion would incorrectly admit it from A. The global union collects ALL
 * referralMarketing names across ALL providers first, then subtracts that entire
 * union during extraction — making referralMarketing exclusion provider-agnostic.
 *
 * Extraction rules (providers[*].rules[] only):
 * 1. Strip trivial regex anchors: leading `^` and trailing `$`.
 * 2. Lowercase.
 * 3. Keep only entries matching /^[a-z0-9_-]+$/ (LITERAL). Others → skipped++.
 * 4. Subtract global referralMarketing union (affiliate preserve — SAFETY).
 * 5. Add to output Set (Set deduplicates across providers automatically).
 *
 * Does NOT read: top-level globalRules / rawGlobalRules (locked out-of-scope).
 *
 * @param {string} rawText Raw ClearURLs rules JSON string.
 * @returns {{ params: Set<string>, skipped: number }}
 */
export function extractClearurlsLiterals(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("ClearURLs parse failed: invalid JSON");
  }

  // Guard: providers must be a non-null object; otherwise treat as empty.
  const providers =
    data?.providers && typeof data.providers === "object"
      ? data.providers
      : {};

  const providerList = Object.values(providers);

  // PASS 1: Build a global Set of ALL referralMarketing names across ALL providers.
  // WHY first: ensures cross-provider exclusion — see docblock above.
  const globalReferral = new Set();
  for (const provider of providerList) {
    if (!Array.isArray(provider?.referralMarketing)) continue;
    for (const raw of provider.referralMarketing) {
      // Normalize IDENTICALLY to rules[] (PASS 2) — anchor-strip included — so
      // an anchored affiliate entry can never slip past the exclusion check.
      globalReferral.add(normalizeName(raw));
    }
  }

  // PASS 2: Extract safe literals from providers[*].rules[], subtract global referral union.
  const params = new Set();
  let skipped = 0;

  for (const provider of providerList) {
    const rules = Array.isArray(provider?.rules) ? provider.rules : [];
    for (const raw of rules) {
      // Strip trivial anchors before literal check (^gclid$ → gclid).
      // Same normalization as the referralMarketing union (PASS 1).
      const name = normalizeName(raw);

      if (!name) {
        // Empty or whitespace-only rule — skip+count (parse failure, not affiliate).
        skipped++;
        continue;
      }

      if (!LITERAL.test(name)) {
        // Regex metacharacters or other non-literal patterns — skip+count.
        // No silent truncation: skipped count surfaces via return value.
        skipped++;
        continue;
      }

      // SAFETY-CRITICAL: affiliate preserve check using global union.
      // Excluded entries are intentional — NOT counted as skip (parse success,
      // deliberate exclusion).
      if (globalReferral.has(name)) continue;

      params.add(name);
    }
  }

  return { params, skipped };
}

// ── Adapter object ────────────────────────────────────────────────────────────

/**
 * ClearURLs adapter. Mirrors adguard-tp.mjs shape exactly.
 * @type {import("./index.mjs").Adapter}
 */
export const clearurls = {
  id: "clearurls",
  name: "ClearURLs Rules",
  license: "LGPL-3.0",
  url: SOURCE_URL,

  /**
   * Extract literal tracking param names from a ClearURLs rules JSON string.
   * Delegates to extractClearurlsLiterals and returns the params Set directly
   * to honor the Adapter typedef contract (parse → Set<string>).
   * @param {string} rawText Raw rules JSON.
   * @returns {Set<string>} Lowercased param names (referralMarketing excluded).
   */
  parse(rawText) {
    return extractClearurlsLiterals(rawText).params;
  },

  /**
   * Fetch the raw rules JSON. Returns raw text for the caller to quarantine
   * before parsing (raw bytes are ephemeral — never committed/bundled).
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetchImpl] Injectable fetch for testing.
   * @returns {Promise<string>}
   */
  async fetchRaw({ fetchImpl = fetch } = {}) {
    const res = await fetchImpl(SOURCE_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(
        `ClearURLs fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.text();
  },
};
