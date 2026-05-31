/**
 * MUGA: GATE 4 — functional-bias-gate (#778)
 *
 * Guards the rule-ingestion pipeline against auto-promoting universally-
 * functional URL parameters into the global TRACKING_PARAMS strip list.
 * A functional param (search, pagination, identity, locale, sort/filter/view)
 * in that list would silently break search, pagination, and i18n across the
 * web — catastrophically and silently. Policy: FAIL-SAFE TOWARD PRESERVATION.
 *
 * When a candidate's param name matches the functional roster the gate REJECTS
 * it (routing to human review); it never auto-strips. When the param is absent,
 * non-string, or empty the gate ACCEPTS (fail-safe: no name = no match possible).
 *
 * The roster is a hardcoded global exact-name denylist — NOT derived from
 * domain-rules.json — because functional params are domain-scoped in MUGA's
 * data model (e.g. `s` is a tracker elsewhere; `k` is an affiliate alias in
 * domain-rules.json) while this gate guards the GLOBAL strip list. Domain-
 * specific protection stays in domain-rules.json.
 *
 * COMPLEMENTARITY with other gates:
 *   GATE 1 (affiliate-guard)      — guards by attribution param NAME collision
 *   GATE 2 (corroboration-gate)   — guards by minimum corroboration signal count
 *   GATE 3 (canary-gate)          — guards by behavioral canary break
 *   GATE 4 (functional-bias-gate) — guards by "is this NAME universally functional?"
 *
 * PURE — no I/O, no mutations, no quarantine writes. Orchestrator wiring: #779.
 */

// AUTHORITATIVE — 43 names. asin excluded (domain-scoped, Amazon-specific).
// Disjointness with TRACKING_PARAMS enforced by test (fail-closed drift guard).
// WHY conservative breadth: ambiguous short names included per fail-safe-toward-
// preservation mandate — a false-reject is recoverable; a false-strip is not.

/** @type {Set<string>} */
export const FUNCTIONAL_PARAM_NAMES = new Set([
  // search / query (10)
  "q", "query", "search", "s", "keyword", "keywords", "kw", "k", "term", "text",

  // pagination (10)
  "page", "p", "offset", "limit", "start", "per_page", "pagesize", "size", "num", "count",

  // identity / product (7)
  "id", "pid", "uid", "item", "sku", "product_id", "item_id",

  // locale / i18n (7)
  "lang", "language", "locale", "hl", "lr", "gl", "region",

  // sort / filter / view (9)
  "sort", "order", "filter", "view", "tab", "type", "category", "cat", "section",
]);

/**
 * Checks a single ingestion candidate against the functional param roster.
 *
 * Returns `{ rejected: false }` when the param is safe to consider for
 * promotion (it is not a universally-functional name).
 * Returns `{ rejected: true, reason: "functional-param", detail: { param } }`
 * when the param name is on the roster — the candidate MUST NOT be added to
 * TRACKING_PARAMS without human review.
 *
 * Fail-safe posture: null/undefined/missing/non-string/empty param → accept.
 * WHY: the predicate is "does this NAME match a functional shape?" — no name
 * means the gate cannot fire; failing safe means we do not quarantine what we
 * cannot evaluate. Mirrors GATE 1/3 accept-malformed posture.
 *
 * @param {{ param?: string } | null | undefined} candidate
 * @param {{ functionalNames?: Set<string> }} [opts]
 * @returns {{ rejected: boolean, reason?: string, detail?: { param: string } }}
 */
export function checkFunctionalBiasGate(
  candidate,
  { functionalNames = FUNCTIONAL_PARAM_NAMES } = {}
) {
  // Defensive extraction: treat any non-string or missing param as no-match.
  // Pipeline already lowercases candidate.param (candidate.mjs:43-48), but we
  // lowercase defensively — never trust the caller. Mirrors affiliate-guard.mjs:94.
  const param =
    typeof candidate?.param === "string" ? candidate.param.toLowerCase() : "";

  // Empty string means no name to evaluate — fail safe toward acceptance.
  if (!param) {
    return { rejected: false };
  }

  if (functionalNames.has(param)) {
    return { rejected: true, reason: "functional-param", detail: { param } };
  }

  return { rejected: false };
}

/**
 * Partitions an array of ingestion candidates into accepted and rejected
 * buckets in a single pass. Input order is preserved in both output arrays.
 *
 * Rejected items carry the full rejection metadata so the caller/logger does
 * not need to re-run the check. `opts` is forwarded to each individual
 * `checkFunctionalBiasGate` call (injectable `functionalNames` seam works at
 * batch level too — mirrors GATE 3 opts-forwarding pattern).
 *
 * @param {Array<{param?: string}>} candidates
 * @param {{ functionalNames?: Set<string> }} [opts]
 * @returns {{ accepted: Array, rejected: Array<{candidate: object, reason: string, detail: {param: string}}> }}
 */
export function partitionCandidates(candidates, opts = {}) {
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const result = checkFunctionalBiasGate(candidate, opts);
    if (result.rejected) {
      rejected.push({
        candidate,
        reason: result.reason,
        detail: result.detail,
      });
    } else {
      accepted.push(candidate);
    }
  }

  return { accepted, rejected };
}
