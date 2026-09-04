/**
 * MUGA: rule-ingestion candidate format — the common contract (#773).
 *
 * Every source adapter normalizes its upstream list into a SET of literal param
 * names (facts, not the curated compilation — see PROVENANCE.md, #774).
 * `mergeCandidates` folds those sets into the shared candidate shape that the
 * EPIC C gate stack (#775-#778) consumes.
 *
 * SINGLE SOURCE in B2 (AdGuard TP). The contract still carries `signals[]` as an
 * array so a second source can be added later WITHOUT a contract change — but we
 * deliberately do NOT compute a corroboration/confidence score here. Confidence
 * by cross-source agreement is only meaningful with ≥2 independent sources, and
 * it is NOT the safety mechanism anyway — the EPIC C gates (affiliate-guard,
 * canary) are. Cross-corroboration scoring lands in #776, where a second source
 * is actually added and the score is actually consumed. Building it now would be
 * machinery that carries no weight (and a false sense of safety).
 *
 * Candidate shape:
 *   {
 *     param:             "fbclid",        // normalized lowercase name
 *     signals:           ["adguard-tp"],  // provenance: which adapters reported it
 *     entropy:           null,            // populated by enrich-candidates.mjs between ingest and orchestrate (#798)
 *     crossSiteFrequency:null,            // populated by enrich-candidates.mjs between ingest and orchestrate (#798)
 *     firstSeenAt:       "<iso8601>"      // when ingestion first saw it
 *   }
 *
 * entropy / crossSiteFrequency lifecycle:
 *   - Set to `null` at ingest time (no URL corpus available at that stage).
 *   - Populated by `enrich-candidates.mjs` (tools/rule-ingestion/enrich-candidates.mjs)
 *     AFTER ingest and BEFORE `runOrchestration`. Enrichment reads verified discovered/
 *     artifact files and computes:
 *       entropy             — arithmetic mean of `value_entropy` across artifacts that
 *                             mention this param; null when no artifact carries the field.
 *       crossSiteFrequency  — count of DISTINCT `first_seen_on` hostnames for this param
 *                             across all verified artifacts; null when the param is absent.
 *   - Never fabricated: both fields remain null when no artifact data is available for a param.
 *   - These are analytical scores derived from caps-crawler artifact metadata, NOT entries
 *     in `signals[]` (see PROVENANCE.md — caps-crawler is not a corroboration source, #821).
 */

// Separator for the composite dedup key below. A NUL joiner cannot be forged
// by a crafted param or a validated host (neither passes through with a
// literal `\0`).
//
// WARNING-2 fix (verify-report-slice-2, obs #1527): the key used to be
// `${scope || GLOBAL}${KEY_SEP}${param}` with `GLOBAL = "*"`. Because GLOBAL
// was itself a value a legal scope could also hold, a candidate whose `scope`
// happened to BE "*" produced the exact same key as an unscoped candidate —
// `"*" || "*"` and `undefined || "*"` are both `"*"`. That silently merged two
// candidates orchestrate.mjs#isScoped intends to keep apart (it treats
// scope:"*" as scoped-and-excluded), inflating a GATE 2 signal count from 1 to
// 2. The key below distinguishes the axis by IDENTITY — whether a scope
// argument was passed at all — never by comparing the scope's VALUE against a
// sentinel, so no legal (or illegal) scope string can ever impersonate the
// unscoped axis.
const KEY_SEP = "\0";

/**
 * Build a fresh candidate for a param first seen via `signalId`.
 *
 * @param {string} param Raw param name (lowercased here).
 * @param {string} signalId Adapter id that reported it.
 * @param {object} [opts]
 * @param {string} [opts.now] ISO timestamp override (for deterministic tests).
 * @param {string} [opts.scope] Host this fact is scoped to (Slice 2, rules-scope-normalization).
 *   Added to the candidate ONLY when truthy — an unscoped call keeps today's exact shape
 *   (no `scope` key at all), which is what every existing caller/test pins.
 * @returns {object} Candidate carrying one provenance signal.
 */
export function makeCandidate(param, signalId, { now, scope } = {}) {
  return {
    param: String(param).trim().toLowerCase(),
    signals: [signalId],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: now || new Date().toISOString(),
    ...(scope ? { scope } : {}),
  };
}

/**
 * Fold per-adapter param sets into the shared candidate format, accumulating
 * provenance in `signals[]`. With a single adapter every candidate carries one
 * signal; the array shape means adding a source later is a no-op on the contract.
 *
 * Slice 2 (rules-scope-normalization): each adapter result may also carry an
 * optional `scopedParams` list of `{param, scope}` facts. These are merged
 * using the SAME accumulation logic as `params`, but keyed on `(scope, param)`
 * instead of `param` alone — a global fact and a host-scoped fact sharing a
 * name stay distinct candidates (REQ-2). `params` is iterated first (order/
 * semantics unchanged from before this slice), then `scopedParams`.
 *
 * @param {Array<{id:string, params:Iterable<string>, scopedParams?:Array<{param:string, scope:string}>}>} adapterResults
 * @param {object} [opts]
 * @param {string} [opts.now] ISO timestamp override for deterministic tests.
 * @returns {{ candidates: object[], emptyDropped: number }} Candidates + empty-drop count.
 */
export function mergeCandidates(adapterResults, { now } = {}) {
  const byKey = new Map();
  let emptyDropped = 0;

  const accumulate = (rawParam, id, scope) => {
    const param = String(rawParam).trim().toLowerCase();
    if (!param) { emptyDropped++; return; }
    // Identity, not value: `scope` is `undefined` for every `params` entry and
    // always a string for every `scopedParams` entry (see the WARNING-2 note
    // above `KEY_SEP`), so the axis a candidate belongs to can never be forged
    // by a scope value that happens to equal a sentinel.
    const key =
      scope === undefined ? `unscoped${KEY_SEP}${param}` : `scoped${KEY_SEP}${scope}${KEY_SEP}${param}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, makeCandidate(param, id, { now, scope }));
    } else if (!existing.signals.includes(id)) {
      existing.signals.push(id);
    }
  };

  for (const { id, params, scopedParams } of adapterResults) {
    for (const raw of params) accumulate(raw, id, undefined);
    if (scopedParams) {
      for (const { param, scope } of scopedParams) accumulate(param, id, scope);
    }
  }

  for (const candidate of byKey.values()) {
    candidate.signals.sort();
  }

  const candidates = [...byKey.values()].sort(
    (a, b) =>
      b.signals.length - a.signals.length ||
      a.param.localeCompare(b.param) ||
      (a.scope ?? "").localeCompare(b.scope ?? ""),
  );

  return { candidates, emptyDropped };
}
