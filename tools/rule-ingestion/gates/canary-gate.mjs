/**
 * MUGA: GATE 3 — canary-gate (#777)
 *
 * Guards against the behavioral failure of auto-promoting a param that, at
 * runtime, would STRIP an affiliate attribution param. The gate simulates
 * adding `candidate.param` to the runtime strip list via `remoteParams` and
 * runs EVERY PRESERVE canary through the live cleaner. Any canary break means
 * REJECTION.
 *
 * GATE 3 is COMPLEMENTARY to GATE 1 (affiliate-guard): GATE 1 = structural
 * (is this param a known affiliate NAME?); GATE 3 = behavioral (does adding
 * this param BREAK any affiliate canary?). Additive and independent.
 *
 * The gate NEVER mutates TRACKING_PARAMS, TRACKING_PARAMS_SET, or any
 * module-level singleton. It passes `candidate.param` as a per-call
 * `remoteParams` pref to processUrlFn — pure simulation, zero side-effects.
 *
 * Public API (named exports only — no default):
 *   checkCanaryGate(candidate, opts?) → { rejected }
 *   partitionCandidates(candidates, opts?) → { accepted, rejected }
 */

import { processUrl } from "../../../src/lib/cleaner.js";
import { PRESERVE_CANARIES } from "../../affiliate-safety/canaries.mjs";
import { evaluateCanary } from "../../affiliate-safety/evaluate.mjs";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks a single ingestion candidate against the PRESERVE canary set.
 *
 * Returns `{ rejected: false }` when the candidate param does not break any
 * canary. Returns `{ rejected: true, reason: "canary-break", brokenCanaries }`
 * when at least one canary breaks — `brokenCanaries` is PARAM-LEVEL and
 * collect-all (no short-circuit), matching the runner's existing granularity.
 *
 * WHY — LANDING_CANARIES are excluded: they exercise getLandingPolicy(), an
 * orthogonal code-path driven by referrer heuristics rather than remoteParams
 * stripping. Including them here would be a false behavioral simulation.
 *
 * WHY — zero TRACKING_PARAMS mutation: `candidate.param` is passed ONLY as a
 * transient `remoteParams` override in the prefs given to processUrlFn. The
 * module-level singleton is never touched.
 *
 * WHY — seam via opts: the testability seam (`canaries` / `processUrlFn`) lets
 * tests inject synthetic fixtures and a fake processUrlFn for the rejection
 * path. A live break is unconstructable with the real PRESERVE_CANARIES because
 * every mustSurvive key is affiliate-protected at cleaner.js:303 and immune to
 * remoteParams stripping.
 *
 * @param {{ param?: string } | null | undefined} candidate
 * @param {{ canaries?: object[], processUrlFn?: Function }} [opts]
 * @returns {{ rejected: boolean, reason?: string, brokenCanaries?: object[] }}
 */
export function checkCanaryGate(
  candidate,
  { canaries = PRESERVE_CANARIES, processUrlFn = processUrl } = {}
) {
  // Defensive extraction: treat any non-string or missing/empty param as no-op.
  // Schema validation is an upstream gate's job (mirrors GATE 1 defensive style).
  const param =
    typeof candidate?.param === "string" ? candidate.param.toLowerCase() : "";

  if (!param) {
    return { rejected: false };
  }

  // Loop ALL canaries — collect-all, no short-circuit.
  // evaluateCanary wraps processUrlFn in try/catch so a throwing canary
  // becomes a recorded failure rather than an uncaught exception.
  const brokenCanaries = [];
  for (const c of canaries) {
    brokenCanaries.push(...evaluateCanary(c, processUrlFn, [param]));
  }

  if (brokenCanaries.length > 0) {
    return { rejected: true, reason: "canary-break", brokenCanaries };
  }

  return { rejected: false };
}

// ── Batch partition ────────────────────────────────────────────────────────────

/**
 * Partitions an array of ingestion candidates into accepted and rejected
 * buckets in a single pass. Input order is preserved in both output arrays.
 *
 * Forwards `opts` to each `checkCanaryGate` call so the testability seam
 * (synthetic canaries + fake processUrlFn) works at batch level too.
 *
 * Rejected items carry the full rejection metadata so the caller/logger
 * doesn't need to re-run the check.
 *
 * @param {Array<{ param?: string }>} candidates
 * @param {{ canaries?: object[], processUrlFn?: Function }} [opts]
 * @returns {{ accepted: Array, rejected: Array<{ candidate: object, reason: string, brokenCanaries: object[] }> }}
 */
export function partitionCandidates(candidates, opts = {}) {
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const result = checkCanaryGate(candidate, opts);
    if (result.rejected) {
      rejected.push({
        candidate,
        reason: result.reason,
        brokenCanaries: result.brokenCanaries,
      });
    } else {
      accepted.push(candidate);
    }
  }

  return { accepted, rejected };
}
