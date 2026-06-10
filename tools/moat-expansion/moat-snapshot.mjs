/**
 * MUGA — moat-expansion moat snapshot loader (#793).
 *
 * Reads the live affiliate moat READ-ONLY via direct Node import from src/lib.
 * These imports are verified safe at module load time: affiliates.js and
 * redirect-networks.js have no chrome/window/document references at import
 * time (only in factory functions or comments). remote-rules.js AFFILIATE_PARAM_GUARD
 * is a plain frozen Set exported at module level — safe to import.
 *
 * Design D2/D3: direct import is the single source of truth; no extraction
 * or vendored mirror needed. If import cost becomes an issue, a fallback
 * vendored mirror with a guard-sync test can be substituted (documented in
 * the design as the D3 fallback path).
 *
 * Injectable seam: production code imports src/lib tables directly; tests
 * can pass pre-built snapshots via the optional `{ affiliatePatterns,
 * redirectPatterns, guard }` parameter to avoid touching src/ at test time.
 *
 * Public API (named export only — no default):
 *   loadMoatSnapshot({ affiliatePatterns?, redirectPatterns?, guard? }?)
 *     → { coveredByDomain, guardParams, knownByProgramId }
 */

// Production imports — read-only; no modifications to src/ files.
import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";
import { REDIRECT_NETWORK_PATTERNS } from "../../src/lib/redirect-networks.js";
import { AFFILIATE_PARAM_GUARD } from "../../src/lib/remote-rules.js";

// ── loadMoatSnapshot ─────────────────────────────────────────────────────────

/**
 * Build a normalized snapshot of the live affiliate moat for the differ.
 *
 * Coverage sources (mirrors spec §Coverage Differ):
 *   (a) AFFILIATE_PATTERNS — per-program {id, domains[], param}
 *   (b) REDIRECT_NETWORK_PATTERNS — per-network landingParams[]
 *   (c) AFFILIATE_PARAM_GUARD — global case-insensitive param blocklist
 *
 * The snapshot shape is designed for fast O(1) lookup during diffing:
 *   - coveredByDomain: Map<domain, Set<param>>
 *       For coverage source (a): allows the differ to check if a (domain, param)
 *       pair is already covered by any AFFILIATE_PATTERNS entry.
 *   - guardParams: Set<string> (lowercased)
 *       For coverage source (c): case-insensitive param membership test.
 *   - knownByProgramId: Map<programId, {param, domains[]}>
 *       Allows the differ to resolve a lookup-table programId to its moat param
 *       and domain set for coverage source (a) checks.
 *
 * Landing params from REDIRECT_NETWORK_PATTERNS (source b) are embedded in
 * coveredByDomain under each redirectHost domain so the differ's uniform
 * domain-lookup covers both (a) and (b) in one pass. Additionally they are
 * available via the landingParamSet on the returned object for explicit (b)
 * checks without a domain constraint.
 *
 * @param {object} [opts] Injectable overrides for testing.
 * @param {Array} [opts.affiliatePatterns] Override AFFILIATE_PATTERNS.
 * @param {Array} [opts.redirectPatterns] Override REDIRECT_NETWORK_PATTERNS.
 * @param {Set|ReadonlySet} [opts.guard] Override AFFILIATE_PARAM_GUARD.
 * @returns {{
 *   coveredByDomain: Map<string, Set<string>>,
 *   guardParams: Set<string>,
 *   knownByProgramId: Map<string, {param: string, domains: string[]}>,
 *   landingParamSet: Set<string>
 * }}
 */
export function loadMoatSnapshot({
  affiliatePatterns = AFFILIATE_PATTERNS,
  redirectPatterns = REDIRECT_NETWORK_PATTERNS,
  guard = AFFILIATE_PARAM_GUARD,
} = {}) {
  // ── (a) AFFILIATE_PATTERNS → coveredByDomain + knownByProgramId ────────────

  /** @type {Map<string, Set<string>>} */
  const coveredByDomain = new Map();

  /** @type {Map<string, {param: string, domains: string[]}>} */
  const knownByProgramId = new Map();

  for (const pattern of affiliatePatterns) {
    if (!pattern.id || !pattern.param || !Array.isArray(pattern.domains)) continue;

    knownByProgramId.set(pattern.id, {
      param: pattern.param,
      domains: pattern.domains.slice(),
    });

    for (const domain of pattern.domains) {
      // Normalize: strip leading www. for consistent lookup
      const normalized = domain.replace(/^www\./, "");
      if (!coveredByDomain.has(normalized)) {
        coveredByDomain.set(normalized, new Set());
      }
      coveredByDomain.get(normalized).add(pattern.param);
    }
  }

  // ── (b) REDIRECT_NETWORK_PATTERNS → landingParamSet + coveredByDomain ─────

  /** @type {Set<string>} */
  const landingParamSet = new Set();

  for (const network of redirectPatterns) {
    if (!Array.isArray(network.landingParams)) continue;
    for (const param of network.landingParams) {
      landingParamSet.add(param);
    }

    // Also index landing params under each redirectHost domain for uniform (a)+(b) lookup
    if (!Array.isArray(network.redirectHosts)) continue;
    for (const host of network.redirectHosts) {
      // Skip wildcard entries (*.domain) — they can't be keyed by exact domain
      if (host.startsWith("*.")) continue;
      const normalized = host.replace(/^www\./, "");
      if (!coveredByDomain.has(normalized)) {
        coveredByDomain.set(normalized, new Set());
      }
      for (const param of network.landingParams) {
        coveredByDomain.get(normalized).add(param);
      }
    }
  }

  // ── (c) AFFILIATE_PARAM_GUARD → guardParams (lowercased) ──────────────────

  /** @type {Set<string>} */
  const guardParams = new Set();
  for (const param of guard) {
    guardParams.add(param.toLowerCase());
  }

  return {
    coveredByDomain,
    guardParams,
    knownByProgramId,
    landingParamSet,
  };
}
