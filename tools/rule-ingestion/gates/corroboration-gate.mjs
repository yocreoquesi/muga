/**
 * MUGA: GATE 2 — corroboration-gate (#776, #798)
 *
 * Reduces false positives by requiring INDEPENDENT CORROBORATION: a candidate
 * is accepted when ANY of the three arms passes (OR predicate):
 *   1. signals.length >= MIN_SIGNALS  (signal-count arm)
 *   2. entropy !== null && entropy >= ENTROPY_FLOOR  (entropy arm)
 *   3. crossSiteFrequency !== null && crossSiteFrequency >= CSF_FLOOR  (CSF arm)
 *
 * Null values on heuristic arms (entropy/CSF) cause that arm to be SKIPPED
 * entirely — they do not count as failing. This preserves the existing
 * signal-count-only behaviour for candidates where enrichment produced no data.
 *
 * Accepted results include a `passedArm` field ("signals" | "entropy" | "csf")
 * identifying which arm caused acceptance; when multiple arms qualify, the FIRST
 * in the precedence order above is recorded.
 *
 * Rejected results include an extended `detail` object with all evaluated arm
 * values (signalCount, minSignals, entropy, entropyFloor, crossSiteFrequency,
 * csfFloor) for quarantine-report transparency.
 *
 * WHY malformed → REJECT (inverse of GATE 1/3 accept-malformed posture):
 * - GATE 1/3 reject = "this param is dangerous to strip" → accept-malformed
 *   is the safe direction (don't block a param that didn't prove danger).
 * - GATE 2 reject = "this param is NOT YET corroborated" → accept-malformed
 *   would defeat the gate entirely. A candidate with no provable signals IS
 *   the failure mode GATE 2 exists to catch (signalCount 0 < MIN_SIGNALS).
 *
 * INDEPENDENCE INVARIANT (#821): entropy and crossSiteFrequency are ANALYTICAL
 * SCORES derived from caps-crawler discovered/ artifact metadata; they are NOT
 * entries in signals[]. caps-crawler is NOT a corroboration source. The signals[]
 * semantics are unchanged — each entry must still come from a DISTINCT,
 * SEPARATELY MAINTAINED upstream adapter (see adapters/index.mjs).
 *
 * Public API (named exports only — no default):
 *   MIN_SIGNALS              → number (default signal threshold = 2)
 *   ENTROPY_FLOOR            → number (default entropy threshold = 4.0)
 *   CSF_FLOOR                → number (default cross-site-frequency threshold = 3)
 *   checkCorroborationGate   → (candidate, opts?) → { rejected, passedArm? }
 *   partitionCandidates      → (candidates, opts?) → { accepted, rejected }
 */

// ── Threshold constants ───────────────────────────────────────────────────────

/**
 * Minimum number of independent upstream signal sources required for a
 * candidate to pass GATE 2 via the signals arm. Configurable at call-site
 * via opts.minSignals.
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

/**
 * Minimum mean Shannon entropy (bits) of observed URL parameter values for a
 * candidate to pass GATE 2 via the entropy arm. Derived from the
 * `value_entropy` field populated by enrich-candidates.mjs (caps-crawler
 * artifact metadata). Configurable at call-site via opts.entropyFloor.
 *
 * Set to 4.0 — aligns with the runtime ENTROPY_THRESHOLD used for value-level
 * entropy classification. A mean of 4.0 bits indicates reasonably high-entropy
 * observed values (consistent with token/session parameters, not static paths).
 *
 * @type {number}
 */
export const ENTROPY_FLOOR = 4.0;

/**
 * Minimum cross-site frequency (count of DISTINCT first_seen_on hostnames
 * across all verified discovered/ artifacts) for a candidate to pass GATE 2
 * via the CSF arm. Populated by enrich-candidates.mjs. Configurable at
 * call-site via opts.csfFloor.
 *
 * Set to 3 — requires a param to have appeared on at least 3 distinct sites,
 * providing breadth corroboration even when fewer than MIN_SIGNALS adapters
 * report it.
 *
 * @type {number}
 */
export const CSF_FLOOR = 3;

// ── Predicate ─────────────────────────────────────────────────────────────────

/**
 * Checks a single ingestion candidate against the three-arm OR corroboration
 * predicate.
 *
 * Returns `{ rejected: false, passedArm }` when ANY of the following is true:
 *   1. signals.length >= minSignals              (passedArm: "signals")
 *   2. entropy !== null && entropy >= entropyFloor  (passedArm: "entropy")
 *   3. crossSiteFrequency !== null && csf >= csfFloor  (passedArm: "csf")
 *
 * Null/undefined values on arms 2 and 3 cause that arm to be skipped entirely
 * (not treated as failing). When multiple arms qualify, the FIRST in the
 * precedence order above is recorded as passedArm.
 *
 * Returns `{ rejected: true, reason, detail }` when no arm passes. The detail
 * object includes all evaluated arm values for quarantine-report transparency.
 *
 * PURE: no file writes, no network calls, no singleton mutations.
 *
 * @param {{ signals?: string[], entropy?: number | null, crossSiteFrequency?: number | null } | null | undefined} candidate
 * @param {object} [opts]
 * @param {number} [opts.minSignals]
 * @param {number} [opts.entropyFloor]
 * @param {number} [opts.csfFloor]
 * @returns {{ rejected: boolean, passedArm?: string, reason?: string, detail?: object }}
 */
export function checkCorroborationGate(candidate, {
  minSignals = MIN_SIGNALS,
  entropyFloor = ENTROPY_FLOOR,
  csfFloor = CSF_FLOOR,
} = {}) {
  // Array.isArray is the correct guard — strings, null, undefined all yield 0.
  const signalCount = Array.isArray(candidate?.signals)
    ? candidate.signals.length
    : 0;

  const entropy = candidate?.entropy ?? null;
  const csf = candidate?.crossSiteFrequency ?? null;

  // Arm 1: signals
  if (signalCount >= minSignals) {
    return { rejected: false, passedArm: "signals" };
  }

  // Arm 2: entropy (null-skip guard — null does NOT rescue)
  if (entropy !== null && entropy >= entropyFloor) {
    return { rejected: false, passedArm: "entropy" };
  }

  // Arm 3: cross-site frequency (null-skip guard — null does NOT rescue)
  if (csf !== null && csf >= csfFloor) {
    return { rejected: false, passedArm: "csf" };
  }

  return {
    rejected: true,
    reason: "corroboration-below-threshold",
    detail: {
      signalCount,
      minSignals,
      entropy,
      entropyFloor,
      crossSiteFrequency: csf,
      csfFloor,
    },
  };
}

// ── Batch partition ───────────────────────────────────────────────────────────

/**
 * Partitions an array of ingestion candidates into accepted and rejected
 * buckets in a single pass. Input order is preserved in both output arrays.
 *
 * Forwards `opts` to each `checkCorroborationGate` call so callers can
 * override thresholds at batch level (mirrors GATE 3's partition signature).
 * Supports the full opts shape: { minSignals?, entropyFloor?, csfFloor? }.
 *
 * @param {Array<{ signals?: string[], entropy?: number | null, crossSiteFrequency?: number | null }>} candidates
 * @param {object} [opts]
 * @param {number} [opts.minSignals]
 * @param {number} [opts.entropyFloor]
 * @param {number} [opts.csfFloor]
 * @returns {{ accepted: Array, rejected: Array<{ candidate: object, reason: string, detail: object }> }}
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
