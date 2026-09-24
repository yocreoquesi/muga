/**
 * MUGA: canonical mixed-case spellings of tracking params, for the DNR rules.
 *
 * Why this exists (#1436): Chrome's declarativeNetRequest removes query params
 * by exact, case-sensitive comparison (Chromium ruleset_matcher_base.cc,
 * GetModifiedQuery: std::binary_search on the raw key). Every param source in
 * MUGA is lowercase, because the runtime cleaner compares case-insensitively.
 * So a tracker whose real-world key is mixed-case (camelCase, or a locale
 * suffix) was never removed at the network layer on Chrome: it reached the
 * server on the first request and was only rewritten after the page loaded.
 *
 * Each key is the lowercase param as it appears in TRACKING_PARAMS or in a
 * domain-rules.json stripParams list. Each value lists the spellings the
 * tracker really uses. tools/generate-rules.mjs emits a variant ONLY into a
 * rule that already removes the lowercase form, so a host that preserves the
 * param never gains a variant, and no variant can widen what a rule strips.
 *
 * Keep this list reviewed and small: only spellings observed in real links.
 * Build-time only (not shipped in the extension).
 */

/** @type {Readonly<Record<string, readonly string[]>>} */
export const DNR_CASE_VARIANTS = Object.freeze({
  // HubSpot CTA click tracking.
  hsctatracking: Object.freeze(["hsCtaTracking"]),
  // Snapchat click ID.
  sccid: Object.freeze(["ScCid"]),
  // Oracle Eloqua email campaign IDs.
  elqtrackid: Object.freeze(["elqTrackId"]),
  elqcampaignid: Object.freeze(["elqCampaignId"]),
  // Omnisend contact ID.
  omnisendcontactid: Object.freeze(["omnisendContactID"]),
  // Amazon marketplace/keyboard locale selector (CHANGELOG 1.9.5 first shipped these).
  __mk_es_es: Object.freeze(["__mk_es_ES"]),
  __mk_de_de: Object.freeze(["__mk_de_DE"]),
  __mk_fr_fr: Object.freeze(["__mk_fr_FR"]),
  __mk_it_it: Object.freeze(["__mk_it_IT"]),
  __mk_en_us: Object.freeze(["__mk_en_US"]),
  __mk_en_gb: Object.freeze(["__mk_en_GB"]),
  __mk_pt_br: Object.freeze(["__mk_pt_BR"]),
  __mk_ja_jp: Object.freeze(["__mk_ja_JP"]),
  // New York Times share attribution (domain-rules.json, nytimes.com).
  referringsource: Object.freeze(["referringSource"]),
  // Bloomberg lead attribution (domain-rules.json, bloomberg.com).
  leadsource: Object.freeze(["leadSource"]),
});

/**
 * Returns `removeParams` followed by the canonical mixed-case variant of every
 * lowercase entry it contains. The original entries keep their order (byte
 * stability of the existing output); the appended variants are deduplicated,
 * never repeat an entry already present, and are sorted by codepoint.
 *
 * @param {readonly string[]} removeParams
 * @param {Readonly<Record<string, readonly string[]>>} [variants=DNR_CASE_VARIANTS]
 * @returns {string[]}
 */
export function withCaseVariants(removeParams, variants = DNR_CASE_VARIANTS) {
  const present = new Set(removeParams);
  const extra = new Set();
  for (const p of removeParams) {
    if (p !== p.toLowerCase()) continue;
    const forms = Object.prototype.hasOwnProperty.call(variants, p) ? variants[p] : undefined;
    if (!forms) continue;
    for (const v of forms) {
      if (!present.has(v)) extra.add(v);
    }
  }
  const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...removeParams, ...[...extra].sort(byCodepoint)];
}
