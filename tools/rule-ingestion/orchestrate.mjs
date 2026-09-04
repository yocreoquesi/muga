/**
 * MUGA — orchestrate.mjs (EPIC C, issue #779, v2.3.0)
 *
 * Pure decision module: zero I/O, zero crypto.
 * Wires GATES 1-4 into a deterministic binary-bucket pipeline and produces
 * a signed-artifact body (unsigned; signing is the CLI's job).
 *
 * Public API (named exports only — no default export):
 *   DEFAULT_GATES    — ordered GATE_DESCRIPTORS array
 *   canonicalMessage — (version, published, params) → string
 *   buildParams      — (autoMerge) → string[]
 *   runOrchestration — ({ candidates, gates?, gateOpts?, version, published }) → result
 */

import { checkAffiliateGuard } from "./gates/affiliate-guard.mjs";
import { checkCorroborationGate } from "./gates/corroboration-gate.mjs";
import { checkCanaryGate } from "./gates/canary-gate.mjs";
import { checkFunctionalBiasGate } from "./gates/functional-bias-gate.mjs";

// ── Gate descriptor array (insertion order IS the gate order — never reorder) ──

/**
 * Ordered array of gate descriptors. Each descriptor has:
 *   gate             — string label (must match spec R2-S2 table)
 *   check            — (candidate, opts) → { rejected, ...nativePayload }
 *   optsKey          — key into gateOpts to extract per-gate options
 *   normalize        — (rejected verdict) → { gate, reason, evidence }
 *   normalizeAccepted — (accepted verdict) → { gate, ...auditMeta }  [OPTIONAL]
 *                       Surfaces accept-path audit data (e.g. corroboration
 *                       passedArm, #878). Descriptors without it contribute no
 *                       accept metadata.
 *
 * ORDER IS FIXED AND MUST NOT CHANGE. Array iteration IS the gate evaluation
 * order. No Set or object-key iteration anywhere in the decision path.
 */
export const DEFAULT_GATES = [
  {
    gate: "affiliate-guard",
    check: checkAffiliateGuard,
    optsKey: "affiliateGuard",
    normalize: (v) => ({
      gate: "affiliate-guard",
      reason: v.reason,
      evidence: { collidingPrograms: v.collidingPrograms },
    }),
  },
  {
    gate: "corroboration-gate",
    check: checkCorroborationGate,
    optsKey: "corroborationGate",
    normalize: (v) => ({
      gate: "corroboration-gate",
      reason: v.reason,
      evidence: { detail: v.detail },
    }),
    // Accepted-side audit (#878): capture WHICH arm corroborated an accepted
    // candidate ("signals" | "entropy" | "csf"). Symmetric to normalize, but for
    // the no-short-circuit accept path. Only this gate emits accept metadata.
    normalizeAccepted: (v) => ({
      gate: "corroboration-gate",
      passedArm: v.passedArm,
    }),
  },
  {
    gate: "canary-gate",
    check: checkCanaryGate,
    optsKey: "canaryGate",
    normalize: (v) => ({
      gate: "canary-gate",
      reason: v.reason,
      evidence: { brokenCanaries: v.brokenCanaries },
    }),
  },
  {
    gate: "functional-bias-gate",
    check: checkFunctionalBiasGate,
    optsKey: "functionalBiasGate",
    normalize: (v) => ({
      gate: "functional-bias-gate",
      reason: v.reason,
      evidence: { detail: v.detail },
    }),
  },
];

// ── Pure primitives ───────────────────────────────────────────────────────────

/**
 * Constructs the canonical signed message.
 * Format: `${version}|${published}|${params.join(",")}`
 *
 * IDENTICAL to the format in src/lib/remote-rules.js canonicalMessage —
 * the existing verifySignature() validates this string unchanged.
 *
 * NOTE: params must already be sorted + deduped before passing here.
 *
 * @param {number}   version   - Target source version integer.
 * @param {string}   published - ISO8601 published timestamp (verbatim).
 * @param {string[]} params    - Sorted+deduped params array.
 * @returns {string}
 */
export function canonicalMessage(version, published, params) {
  return `${version}|${published}|${params.join(",")}`;
}

/**
 * Slice 2 (rules-scope-normalization): identifies a host-scoped candidate.
 *
 * A `scope` of `"*"` counts as scoped (i.e. excluded from the global path) —
 * fail closed. Exclusion only ever costs reach; inclusion is the #1212-shaped
 * bug this whole change exists to stop.
 *
 * @param {object} c Candidate (may or may not carry a `scope` field).
 * @returns {boolean}
 */
export function isScoped(c) {
  return typeof c.scope === "string" && c.scope !== "";
}

/**
 * Deduplicates and sorts auto-merge candidate params for use in the
 * signed artifact body. Set-based dedup + localeCompare sort.
 *
 * Params are already lowercased by the candidate pipeline (candidate.mjs:44).
 * Dedup via Set iteration order is irrelevant to output because we sort AFTER
 * dedup — this is the determinism keystone.
 *
 * Slice 2 (rules-scope-normalization): scoped candidates are filtered out
 * BEFORE dedup/sort — this is the exported, directly-unit-tested function
 * where the #1212-shaped leak (a host-scoped fact reaching the global signed
 * list) would occur, so the guard lives here rather than only at the caller.
 *
 * @param {object[]} autoMerge - Array of candidates that passed all gates.
 * @returns {string[]} Sorted, deduplicated param strings (global candidates only).
 */
export function buildParams(autoMerge) {
  return [...new Set(autoMerge.filter((c) => !isScoped(c)).map((c) => c.param))].sort(
    (a, b) => a.localeCompare(b)
  );
}

// ── Core orchestration ────────────────────────────────────────────────────────

/**
 * Runs all candidates through the gate pipeline and partitions them into
 * binary buckets: autoMerge (ALL gates pass) or quarantine (ANY gate rejects).
 *
 * Properties:
 * - COLLECT ALL rejections per candidate (no short-circuit).
 * - Input order preserved within each bucket.
 * - Gate evaluation order is the DEFAULT_GATES array order (or injected gates).
 * - Deterministic: same input → byte-identical output (params sorted+deduped).
 *
 * @param {object}   args
 * @param {object[]} args.candidates              - Candidate[] from ingest (input order preserved)
 * @param {Array}    [args.gates=DEFAULT_GATES]   - Injectable ordered gate descriptors
 * @param {object}   [args.gateOpts={}]           - Per-gate opts keyed by descriptor.optsKey
 * @param {number}   args.version                 - Target source version (CLI supplies; never invented here)
 * @param {string}   args.published               - ISO8601 timestamp (injected for determinism)
 * @returns {{
 *   autoMerge: object[],
 *   quarantine: Array<{ candidate: object, rejections: Array<{ gate: string, reason: string, evidence: object }> }>,
 *   acceptances: Array<{ candidate: object, accepted: Array<{ gate: string, passedArm?: string }> }>,
 *   artifactBody: { version: number, published: string, params: string[] },
 *   scopedAutoMerge: object[]
 * }}
 *   `acceptances` is PARALLEL to `autoMerge` (same order, same length): entry i
 *   holds the accept-path audit metadata (from each gate's normalizeAccepted, if
 *   any) for autoMerge[i]. Gates without normalizeAccepted contribute nothing, so
 *   `accepted` may be empty. Quarantined candidates never appear here (#878).
 *
 *   `scopedAutoMerge` (Slice 2, rules-scope-normalization) is the SUBSET of
 *   `autoMerge` for which `isScoped()` is true. `autoMerge` itself stays a
 *   superset — unchanged shape/semantics, so existing tests and the
 *   `acceptances` parallelism are untouched. All four EPIC C gates run
 *   IDENTICALLY on scoped and unscoped candidates; no gate reads `scope`.
 *   Only `artifactBody.params` (via `buildParams`) excludes scoped entries.
 */
export function runOrchestration({
  candidates,
  gates = DEFAULT_GATES,
  gateOpts = {},
  version,
  published,
}) {
  const autoMerge = [];
  const quarantine = [];
  const acceptances = [];

  for (const candidate of candidates) {
    const rejections = [];
    const accepted = [];

    // Evaluate EVERY gate in order — no short-circuit (R3)
    for (const descriptor of gates) {
      const opts = gateOpts[descriptor.optsKey] || {};
      const verdict = descriptor.check(candidate, opts);

      if (verdict.rejected) {
        rejections.push(descriptor.normalize(verdict));
      } else if (descriptor.normalizeAccepted) {
        // Accept-path audit, collected only for candidates that ultimately
        // auto-merge (a later gate may still quarantine this one).
        accepted.push(descriptor.normalizeAccepted(verdict));
      }
    }

    if (rejections.length === 0) {
      autoMerge.push(candidate);
      acceptances.push({ candidate, accepted });
    } else {
      quarantine.push({ candidate, rejections });
    }
  }

  const params = buildParams(autoMerge);
  const artifactBody = { version, published, params };
  const scopedAutoMerge = autoMerge.filter(isScoped);

  return { autoMerge, quarantine, acceptances, artifactBody, scopedAutoMerge };
}
