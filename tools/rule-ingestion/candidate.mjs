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
 *     entropy:           null,            // derived in EPIC C (no corpus in B2)
 *     crossSiteFrequency:null,            // derived in EPIC C (#776)
 *     firstSeenAt:       "<iso8601>"      // when ingestion first saw it
 *   }
 *
 * entropy / crossSiteFrequency are part of the contract (the issue requires the
 * provenance fields) but stay `null`: B2 has no URL corpus to derive them
 * honestly. They are filled by the cross-corroboration gate (#776), never
 * fabricated at ingestion.
 */

/**
 * Build a fresh candidate for a param first seen via `signalId`.
 *
 * @param {string} param Raw param name (lowercased here).
 * @param {string} signalId Adapter id that reported it.
 * @param {object} [opts]
 * @param {string} [opts.now] ISO timestamp override (for deterministic tests).
 * @returns {object} Candidate carrying one provenance signal.
 */
export function makeCandidate(param, signalId, { now } = {}) {
  return {
    param: String(param).trim().toLowerCase(),
    signals: [signalId],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: now || new Date().toISOString(),
  };
}

/**
 * Fold per-adapter param sets into the shared candidate format, accumulating
 * provenance in `signals[]`. With a single adapter every candidate carries one
 * signal; the array shape means adding a source later is a no-op on the contract.
 *
 * @param {Array<{id:string, params:Iterable<string>}>} adapterResults
 * @param {object} [opts]
 * @param {string} [opts.now] ISO timestamp override for deterministic tests.
 * @returns {{ candidates: object[], emptyDropped: number }} Candidates + empty-drop count.
 */
export function mergeCandidates(adapterResults, { now } = {}) {
  const byParam = new Map();
  let emptyDropped = 0;

  for (const { id, params } of adapterResults) {
    for (const raw of params) {
      const param = String(raw).trim().toLowerCase();
      if (!param) { emptyDropped++; continue; }
      const existing = byParam.get(param);
      if (!existing) {
        byParam.set(param, makeCandidate(param, id, { now }));
      } else if (!existing.signals.includes(id)) {
        existing.signals.push(id);
      }
    }
  }

  for (const candidate of byParam.values()) {
    candidate.signals.sort();
  }

  const candidates = [...byParam.values()].sort(
    (a, b) => b.signals.length - a.signals.length || a.param.localeCompare(b.param),
  );

  return { candidates, emptyDropped };
}
