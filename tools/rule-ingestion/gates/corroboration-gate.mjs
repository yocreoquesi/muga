/**
 * MUGA: GATE 2 — corroboration-gate (#776, #798)
 *
 * Reduces false positives by requiring INDEPENDENT CORROBORATION: a candidate
 * is accepted when ANY of the three arms passes (OR predicate):
 *   1. signals.length >= MIN_SIGNALS  (signal-count arm)
 *   2. entropy !== null && entropy >= ENTROPY_FLOOR  (entropy arm)
 *   3. crossSiteFrequency !== null && crossSiteFrequency >= CSF_FLOOR  (CSF arm)
 *
 * SCOPE-AWARE since #1229: arm 1's threshold is SCOPED_MIN_SIGNALS for a
 * candidate carrying a real host anchor, and MIN_SIGNALS for a global claim.
 * Nothing is relaxed on the global path. See SCOPED_MIN_SIGNALS for why an
 * anchored fact answers to a lower bar, and `hasHostAnchor` for why `"*"` is
 * deliberately NOT an anchor here even though `isScoped` counts it as scoped.
 *
 * Null values on heuristic arms (entropy/CSF) cause that arm to be SKIPPED
 * entirely — they do not count as failing. This preserves the existing
 * signal-count-only behaviour for candidates where enrichment produced no data.
 *
 * Accepted results include a `passedArm` field
 * ("signals" | "anchor" | "entropy" | "csf") identifying which arm caused
 * acceptance; when multiple arms qualify, the FIRST in the precedence order
 * above is recorded. "anchor" is arm 1 passing ONLY because the candidate is
 * host-anchored — an anchored candidate that clears the global bar anyway
 * reports "signals", so the report distinguishes a fact that NEEDED its scope
 * from one that merely has it.
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
 *   SCOPED_MIN_SIGNALS       → number (host-anchored signal threshold = 1)
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

/**
 * Signal threshold for a candidate that carries a REAL HOST ANCHOR (#1229).
 *
 * MIN_SIGNALS is 2 because everything this pipeline promotes to the global list
 * applies to the whole web, and one upstream's word is not enough to strip a
 * param on every site anyone visits. An anchored fact makes a much smaller
 * claim: it says "this param is a tracker ON THIS HOST", which is the claim
 * upstream itself made, at the scope upstream chose. Taking it at that scope is
 * running the same risk upstream's own users already run; widening it to global
 * is claiming more than upstream ever did, and that is #1212's shape.
 *
 * Still 1 rather than 0. A candidate no upstream reported at all is exactly the
 * failure mode this gate exists to catch, and that reasoning does not depend on
 * scope.
 *
 * What this unlocks is measured: AdGuard's host-anchored coverage is a SINGLE
 * adapter, so at MIN_SIGNALS=2 none of the 1541 gate-admitted (param, host)
 * pairs in #1229 can pass the signals arm. This threshold is the difference
 * between that import being possible and being empty.
 *
 * @type {number}
 */
export const SCOPED_MIN_SIGNALS = 1;

// ── Predicate ─────────────────────────────────────────────────────────────────

/**
 * Does this candidate name a real host to anchor its claim to?
 *
 * DELIBERATELY NOT `orchestrate.mjs`'s `isScoped`, which counts `"*"` as
 * scoped. The two fail closed in OPPOSITE directions and both are right:
 *
 *   - `isScoped` decides what to keep OUT of the global signed list, so an
 *     ambiguous `"*"` must count as scoped — exclusion only costs reach.
 *   - this decides who gets a RELAXED threshold, so an ambiguous `"*"` must
 *     count as unanchored — `"*"` is the global claim itself, and relaxing
 *     corroboration for it is precisely the thing that must never happen.
 *
 * Sharing one predicate between the two would make one of them wrong, and the
 * wrong one would be silent.
 *
 * @param {object|null|undefined} candidate
 * @returns {boolean}
 */
function hasHostAnchor(candidate) {
  const scope = candidate?.scope;
  return typeof scope === "string" && scope !== "" && scope !== "*";
}

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
 * @param {{ scope?: string, signals?: string[], entropy?: number | null, crossSiteFrequency?: number | null } | null | undefined} candidate
 * @param {object} [opts]
 * @param {number} [opts.minSignals]
 * @param {number} [opts.scopedMinSignals]
 * @param {number} [opts.entropyFloor]
 * @param {number} [opts.csfFloor]
 * @returns {{ rejected: boolean, passedArm?: string, reason?: string, detail?: object }}
 */
export function checkCorroborationGate(candidate, {
  minSignals = MIN_SIGNALS,
  scopedMinSignals = SCOPED_MIN_SIGNALS,
  entropyFloor = ENTROPY_FLOOR,
  csfFloor = CSF_FLOOR,
} = {}) {
  // Array.isArray is the correct guard — strings, null, undefined all yield 0.
  const signalCount = Array.isArray(candidate?.signals)
    ? candidate.signals.length
    : 0;

  const entropy = candidate?.entropy ?? null;
  const csf = candidate?.crossSiteFrequency ?? null;

  // #1229: an anchored fact answers to its own threshold. Chosen explicitly
  // rather than as a min() of the two so a caller lowering `minSignals` for a
  // one-off run cannot accidentally raise the bar on the scoped path, or the
  // reverse — each path's threshold is the one its own option names.
  const anchored = hasHostAnchor(candidate);
  const effectiveMinSignals = anchored ? scopedMinSignals : minSignals;

  // Arm 1: signals
  if (signalCount >= effectiveMinSignals) {
    // "anchor" is reported only when the relaxation is what carried it. An
    // anchored candidate that clears the global bar anyway reports "signals",
    // so the quarantine report distinguishes a fact that needed the scope from
    // one that merely has it.
    return {
      rejected: false,
      passedArm: anchored && signalCount < minSignals ? "anchor" : "signals",
    };
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
      minSignals: effectiveMinSignals,
      anchored,
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
 * Supports the full opts shape:
 * { minSignals?, scopedMinSignals?, entropyFloor?, csfFloor? }.
 *
 * @param {Array<{ scope?: string, signals?: string[], entropy?: number | null, crossSiteFrequency?: number | null }>} candidates
 * @param {object} [opts]
 * @param {number} [opts.minSignals]
 * @param {number} [opts.scopedMinSignals]
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
