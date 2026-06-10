/**
 * MUGA: GATE 2 — corroboration-gate (#776)
 *
 * Reduces false positives by requiring INDEPENDENT CORROBORATION: a candidate
 * is accepted only when ≥ MIN_SIGNALS independent upstream signal sources
 * reported it. Signal count is the SOLE predicate.
 *
 * WHY signal-count-only: entropy and cross-site-frequency fields are HARDCODED
 * null at ingestion time (candidate.mjs:46-47). Adding entropy/CSF arms here
 * would be dead code — deferred to #798 where real heuristics are planned.
 *
 * WHY malformed → REJECT (inverse of GATE 1/3 accept-malformed posture):
 * - GATE 1/3 reject = "this param is dangerous to strip" → accept-malformed
 *   is the safe direction (don't block a param that didn't prove danger).
 * - GATE 2 reject = "this param is NOT YET corroborated" → accept-malformed
 *   would defeat the gate entirely. A candidate with no provable signals IS
 *   the failure mode GATE 2 exists to catch (signalCount 0 < MIN_SIGNALS).
 *
 * Public API (named exports only — no default):
 *   MIN_SIGNALS              → number (default threshold = 2)
 *   checkCorroborationGate   → (candidate, opts?) → { rejected }
 *   partitionCandidates      → (candidates, opts?) → { accepted, rejected }
 */

// ── Threshold constant ────────────────────────────────────────────────────────

/**
 * Minimum number of independent upstream signal sources required for a
 * candidate to pass GATE 2. Configurable at call-site via opts.minSignals.
 *
 * CORRECTNESS INVARIANT — INDEPENDENCE MAINTENANCE REQUIRED:
 * The gate counts signals.length as independent corroboration only when each
 * signal entry was produced by a DISTINCT, SEPARATELY MAINTAINED adapter
 * (see tools/rule-ingestion/adapters/index.mjs). If two adapters share the
 * same upstream dataset (e.g., one is a re-packaged mirror of the other),
 * their combined signal count is NOT independent corroboration and defeats
 * the false-positive guard this gate provides. Every adapter added to
 * ENABLED_ADAPTERS must come from an independently maintained upstream source.
 *
 * @type {number}
 */
export const MIN_SIGNALS = 2;

// ── Predicate ─────────────────────────────────────────────────────────────────

/**
 * Checks a single ingestion candidate against the corroboration threshold.
 *
 * Returns `{ rejected: false }` when `candidate.signals.length >= minSignals`.
 * Returns `{ rejected: true, reason, detail }` when under-corroborated,
 * including when the candidate is null / missing `signals` / signals is
 * not an array — all treated as signalCount = 0 (under-corroborated by
 * definition).
 *
 * PURE: no file writes, no network calls, no singleton mutations.
 *
 * @param {{ signals?: string[] } | null | undefined} candidate
 * @param {{ minSignals?: number }} [opts]
 * @returns {{ rejected: boolean, reason?: string, detail?: { signalCount: number, minSignals: number } }}
 */
export function checkCorroborationGate(candidate, { minSignals = MIN_SIGNALS } = {}) {
  // Array.isArray is the correct guard — strings, null, undefined all yield 0.
  const signalCount = Array.isArray(candidate?.signals)
    ? candidate.signals.length
    : 0;

  if (signalCount >= minSignals) {
    return { rejected: false };
  }

  return {
    rejected: true,
    reason: "corroboration-below-threshold",
    detail: { signalCount, minSignals },
  };
}

// ── Batch partition ───────────────────────────────────────────────────────────

/**
 * Partitions an array of ingestion candidates into accepted and rejected
 * buckets in a single pass. Input order is preserved in both output arrays.
 *
 * Forwards `opts` to each `checkCorroborationGate` call so callers can
 * override the threshold at batch level (mirrors GATE 3's partition signature).
 *
 * @param {Array<{ signals?: string[] }>} candidates
 * @param {{ minSignals?: number }} [opts]
 * @returns {{ accepted: Array, rejected: Array<{ candidate: object, reason: string, detail: { signalCount: number, minSignals: number } }> }}
 */
export function partitionCandidates(candidates, opts = {}) {
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const result = checkCorroborationGate(candidate, opts);
    if (result.rejected) {
      rejected.push({ candidate, reason: result.reason, detail: result.detail });
    } else {
      accepted.push(candidate);
    }
  }

  return { accepted, rejected };
}
