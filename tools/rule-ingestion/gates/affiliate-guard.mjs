/**
 * MUGA: GATE 1 — affiliate-guard (#775)
 *
 * Guards against catastrophic mis-promotion of affiliate attribution parameters
 * into the universal TRACKING_PARAMS strip list. Any ingestion candidate whose
 * bare param name collides with a known affiliate/redirect-landing param is
 * rejected. The gate NEVER mutates TRACKING_PARAMS or any source array.
 *
 * Preserve set is derived LIVE at module load from two sources in
 * src/lib/affiliates.js so it auto-expands whenever those source arrays gain
 * entries (today hand-maintained in src/lib/affiliates.js and
 * src/rules/manifest.data.js) — no edits to this file required.
 */

import {
  AFFILIATE_PATTERNS,
  REDIRECT_NETWORK_PATTERNS,
} from "../../../src/lib/affiliates.js";

// ── Preserve-index construction ─────────────────────────────────────────────

/**
 * Builds a preserve-name Set and owner Map from the two live source arrays.
 * Exported as a testability seam — tests can feed synthetic fixtures without
 * touching the live singletons.
 *
 * @param {Array<{id: string, param: string}>} affiliatePatterns
 * @param {Array<{id: string, landingParams: string[]}>} redirectNetworks
 * @returns {{ set: Set<string>, owners: Map<string, {id: string, source: string}> }}
 */
export function buildPreserveIndex(affiliatePatterns, redirectNetworks) {
  const set = new Set();
  // Maps lowercased param name to its owner record; first-writer-wins so
  // affiliate entries take precedence over redirect-network entries when
  // (hypothetically) both contain the same name.
  const owners = new Map();

  for (const p of affiliatePatterns) {
    const name = String(p.param).toLowerCase();
    set.add(name);
    if (!owners.has(name)) {
      owners.set(name, { id: p.id, source: "affiliate" });
    }
  }

  for (const net of redirectNetworks) {
    for (const raw of net.landingParams) {
      const name = String(raw).toLowerCase();
      set.add(name);
      if (!owners.has(name)) {
        owners.set(name, { id: net.id, source: "redirect-network" });
      }
    }
  }

  return { set, owners };
}

// ── Live singleton (module-load) ─────────────────────────────────────────────

// Built once at import time from the real affiliates manifest; any new CAPS
// program or redirect network added to the source arrays is automatically
// included — no gate edit required.
const { set: _PRESERVE_SET, owners: _OWNER_INDEX } = buildPreserveIndex(
  AFFILIATE_PATTERNS,
  REDIRECT_NETWORK_PATTERNS
);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks a single ingestion candidate against the affiliate-preservation set.
 *
 * Returns `{ rejected: false }` when the param is safe to promote.
 * Returns `{ rejected: true, reason, collidingPrograms }` when the param
 * collides with a known affiliate/redirect-landing name — the candidate MUST
 * NOT be added to TRACKING_PARAMS.
 *
 * The gate is intentionally conservative: `ref` (Vercel) and `at` (Apple PHG)
 * are rejected globally even though per-domain stripping of those params is
 * handled separately by the runtime cleaner via getAffiliateParamSetForHost.
 * GATE 1 is domain-agnostic by design — asymmetric risk means a false-reject
 * (a new tracker that happens to share a name) is trivially recoverable, but
 * a false-accept (stripping an affiliate param globally) causes unbounded
 * revenue loss for creators.
 *
 * @param {{ param?: string } | null | undefined} candidate
 * @returns {{ rejected: boolean, reason?: string, collidingPrograms?: Array<{id: string, source: string}> }}
 */
export function checkAffiliateGuard(candidate) {
  // Defensive extraction: treat any non-string or missing param as no-match.
  // Pipeline already lowercases candidate.param (candidate.mjs:44), but we
  // lowercase defensively — never trust the caller.
  const name =
    typeof candidate?.param === "string" ? candidate.param.toLowerCase() : "";

  if (!name) {
    return { rejected: false };
  }

  if (!_PRESERVE_SET.has(name)) {
    return { rejected: false };
  }

  const owner = _OWNER_INDEX.get(name);
  // owner.source is already the public contract value ("affiliate" |
  // "redirect-network") — the builder records it directly, no mapping needed.
  return {
    rejected: true,
    reason: "affiliate-collision",
    collidingPrograms: [{ id: owner.id, source: owner.source }],
  };
}

// ── Batch partition ──────────────────────────────────────────────────────────

/**
 * Partitions an array of ingestion candidates into accepted and rejected
 * buckets in a single pass. Input order is preserved in both output arrays.
 *
 * Rejected items carry the full rejection metadata so the caller/logger
 * doesn't need to re-run the check.
 *
 * @param {Array<{param?: string}>} candidates
 * @returns {{ accepted: Array, rejected: Array<{candidate: object, reason: string, collidingPrograms: Array}> }}
 */
export function partitionCandidates(candidates) {
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const result = checkAffiliateGuard(candidate);
    if (result.rejected) {
      rejected.push({
        candidate,
        reason: result.reason,
        collidingPrograms: result.collidingPrograms,
      });
    } else {
      accepted.push(candidate);
    }
  }

  return { accepted, rejected };
}
