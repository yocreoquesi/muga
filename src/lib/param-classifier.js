/**
 * MUGA — PARAM_PAIRS bounded scoping classifier (#530, slice 1 of PRD #529).
 *
 * Pure decision module — no DOM, no storage, no network, no clock. Given a
 * URL and the user's prefs, returns the lists of params that should be
 * stripped, preserved, and a per-param reasoning trail.
 *
 * ── Bounded scoping ──────────────────────────────────────────────────────
 * Some parameters are intrinsically ambiguous: `pid` is a Facebook tracking
 * pixel id on one site and a project id on GitHub. Stripping `pid` globally
 * would break functional URLs. Bounded scoping is the answer:
 *
 *   "Strip an ambiguous param ONLY when a definitive tracker proves the URL
 *    came from a marketing pipeline."
 *
 * The definitive trackers (ANCHOR_TRACKERS) are click ids and UTM tags that
 * carry no functional meaning in any sane URL — their presence proves intent
 * to track. When any anchor is present in a URL, the bounded params
 * (PARAM_PAIRS) get stripped along with it. When no anchor is present, the
 * bounded params are preserved (functional URL protected).
 *
 * ── Forward compatibility ─────────────────────────────────────────────────
 * This implements what will be formalized as the CAPS Contextual conformance
 * level (tracked in muga#541, caps-spec follow-up). The function shape
 * `(url, prefs) → { stripParams, preserveParams, ruleHits }` is deliberately
 * tracker-agnostic so future per-domain or per-anchor pairs can be added
 * without rewriting cleaner.js integration.
 *
 * ── Affiliate precedence ──────────────────────────────────────────────────
 * If a param is BOTH in PARAM_PAIRS and in the host's affiliate param set
 * (passed via `prefs._affiliateParamSet`), the affiliate wins. cleaner.js
 * already protects affiliate params in its strip phase; classify() honors
 * the same precedence so callers can rely on a single decision.
 */

/**
 * Ambiguous params that get stripped only in the presence of an anchor.
 * Listed in their canonical "wild" casing — comparison is case-insensitive
 * downstream, but tests should be able to confirm intent at a glance.
 *
 * @type {string[]}
 */
export const PARAM_PAIRS = [
  "pid",      // Facebook pixel id / generic "partner id" — also project id on GitHub
  "icid",     // Internal Campaign ID — generic CMS marketing
  "icmp",     // Internal Campaign — generic CMS marketing
  "CMP",      // Campaign — generic newsletter param
  "NLID",     // Newsletter ID — generic newsletter param
  "soc_src",  // Social source — generic social-share tracking
];

/**
 * Definitive trackers whose presence proves the URL came from a marketing
 * pipeline. The set is intentionally narrow and high-confidence: every entry
 * carries no legitimate functional meaning on a clean URL.
 *
 * @type {Set<string>}
 */
export const ANCHOR_TRACKERS = new Set([
  // Google / Meta / Microsoft click ids
  "gclid",
  "fbclid",
  "msclkid",
  "dclid",
  "twclid",
  "gbraid",
  "wbraid",
  // UTM core
  "utm_source",
  "utm_medium",
  "utm_campaign",
  // Mailchimp campaign / email ids
  "mc_eid",
  "mc_cid",
]);

// Lowercased mirror of PARAM_PAIRS for O(1) case-insensitive lookup.
const PARAM_PAIRS_LOWER = new Set(PARAM_PAIRS.map(p => p.toLowerCase()));

/**
 * Classifies a URL's params into strip/preserve buckets using bounded scoping.
 *
 * @param {string} url
 *   The URL to classify. Non-string or unparseable input returns an empty
 *   result (defensive — never throws).
 * @param {object} [prefs]
 *   User preferences. Recognized keys:
 *     - `_affiliateParamSet`: optional `Set<string>` of lowercased affiliate
 *       param names for the URL's host. When a PARAM_PAIRS entry is also in
 *       this set, the affiliate wins (param goes to preserveParams, NOT
 *       stripParams).
 *
 * @returns {{
 *   stripParams: string[],
 *   preserveParams: string[],
 *   ruleHits: Array<{ param: string, reason: string }>
 * }}
 *   `stripParams` are param names (in their original casing as they appeared
 *   in the URL) that the caller should remove. `preserveParams` are PARAM_PAIRS
 *   entries that the classifier explicitly chose to keep (only populated when
 *   affiliate precedence overrides). `ruleHits` is a parallel reasoning log
 *   for debugging and future telemetry.
 */
export function classify(url, prefs) {
  const empty = { stripParams: [], preserveParams: [], ruleHits: [] };
  if (typeof url !== "string" || !url) return empty;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }

  const params = [...parsed.searchParams.keys()];
  if (params.length === 0) return empty;

  // Detect anchor presence (case-insensitive — params are conventionally
  // lowercase but the URL spec is case-sensitive, so we normalize for the
  // check while keeping original casing in the output).
  let hasAnchor = false;
  for (const name of params) {
    if (ANCHOR_TRACKERS.has(name.toLowerCase())) {
      hasAnchor = true;
      break;
    }
  }

  if (!hasAnchor) return empty;

  const affiliateSet =
    prefs && prefs._affiliateParamSet instanceof Set
      ? prefs._affiliateParamSet
      : null;

  const stripParams = [];
  const preserveParams = [];
  const ruleHits = [];
  const seen = new Set();

  for (const name of params) {
    const lower = name.toLowerCase();
    if (!PARAM_PAIRS_LOWER.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);

    if (affiliateSet && affiliateSet.has(lower)) {
      preserveParams.push(name);
      ruleHits.push({
        param: name,
        reason: "affiliate-precedence: param is an affiliate param for this host",
      });
      continue;
    }

    stripParams.push(name);
    ruleHits.push({
      param: name,
      reason: "bounded-scope: anchor tracker co-occurred",
    });
  }

  return { stripParams, preserveParams, ruleHits };
}
