/**
 * MUGA: Affiliate and tracking parameter database
 *
 * AFFILIATE_PATTERNS is the consolidated view of caps-spec's
 * direct-injection programs. The program identity (id, name, domains,
 * param) is sourced from the vendored `caps-spec/manifest.json` (#523
 * phase 1, now hand-maintained in `src/rules/manifest.data.js`).
 *
 * drop-affiliate-injection (PR 1a): MUGA no longer injects its own
 * affiliate tag. The hand-maintained OUR_TAGS map and `resolveOurTag()`
 * were removed, along with the `ourTag` field on each AFFILIATE_PATTERNS
 * entry. AFFILIATE_PATTERNS still doubles as the PRESERVATION table
 * (third-party/creator affiliate tags and whitelist/blacklist matching) —
 * only the injection half of its former responsibility is gone.
 *
 * Entry shape:
 *   {
 *     id:         caps-spec program id (e.g. "amazon-associates")
 *     name:       human-readable program name
 *     group:      MUGA display label ("Amazon", "eBay", "Booking.com", ...)
 *     domains:    array of host strings the program covers
 *     param:      URL query parameter that carries the tag value
 *     type:       always "affiliate" (legacy field preserved for clarity)
 *     references: array of source citations from caps-spec
 *   }
 *
 * To add a NEW program: edit `src/rules/manifest.data.js` directly and
 * update `EXPECTED_PROGRAM_IDS` in `tests/unit/caps-manifest-sync.test.mjs`.
 *
 * ── #826 module split ────────────────────────────────────────────────────
 * The static tracking-param dataset (TRACKING_PARAMS, TRACKING_PREFIXES,
 * TRACKING_PARAM_CATEGORIES) was extracted to affiliates-data.js.
 * The redirect-network table and lookup helpers were extracted to
 * redirect-networks.js. Re-exports below keep ALL existing importers
 * working unchanged — importer migration to direct imports can happen
 * organically later (no forced churn in this PR).
 */

import { CAPS_DIRECT_INJECTION_PROGRAMS } from "../rules/manifest.data.js";

// ── Re-exports from affiliates-data.js (domain a) ─────────────────────
// Importers that previously got these from affiliates.js continue to work.
// Future PRs may migrate individual importers to import directly from
// affiliates-data.js; remove the re-export when the last importer migrates.
export {
  TRACKING_PARAMS,
  TRACKING_PREFIXES,
  TRACKING_PARAM_CATEGORIES,
} from "./affiliates-data.js";

// ── Re-exports from redirect-networks.js (domain c) ───────────────────
// Same rationale as above.
export {
  REDIRECT_NETWORK_PATTERNS,
  getRedirectNetworkPatterns,
  getRedirectNetworkForRedirectHost,
  getLandingParamsForReferrer,
  getLandingParamsForHost,
  // affiliate-autoinject-notice: platform-auto-injected tag detection.
  AUTOINJECTOR_PATTERNS,
  getAutoInjectorForReferrer,
  detectAutoInjectedTag,
  // affiliate-autoinject-notice LOW-1/LOW-2: precise same-nav tag removal +
  // stale-signal gate for the passive popup badge.
  stripAutoInjectedTag,
  isAutoInjectedTagPresent,
} from "./redirect-networks.js";

// ────────────────────────────────────────────────────────────────────────
// AFFILIATE_PATTERNS — caps-spec direct-injection programs, used for
// PRESERVATION (third-party/creator tag detection + whitelist/blacklist
// matching). The program identity (id, name, domains, param) is sourced
// from `src/rules/manifest.data.js`.
//
// drop-affiliate-injection (PR 1a): OUR_TAGS (MUGA's hand-maintained own-tag
// map) was removed — MUGA no longer injects its own affiliate tag on any
// program. To add a NEW program: update the rule artifact and regenerate
// via the rules pipeline.
// ────────────────────────────────────────────────────────────────────────

// Maps caps-spec program ids to MUGA's existing display "group" so the
// popup / attribution-ledger UI keeps showing familiar labels (e.g.
// "Amazon" instead of "Amazon Associates"). Programs not listed here
// fall back to the caps-spec `name`.
const GROUP_OVERRIDES = {
  "amazon-associates":    "Amazon",
  "ebay-partner-network": "eBay",
};

function _deriveGroup(prog) {
  return GROUP_OVERRIDES[prog.id] || prog.name;
}

/**
 * Affiliate-pattern table consumed by `cleaner.js` and friends.
 * Built once at module load from caps-spec's direct-injection programs.
 *
 * Entry shape:
 *   { id, name, group, domains, param, type, references }
 *
 * drop-affiliate-injection (PR 1a): the `ourTag` field was removed — MUGA
 * no longer injects its own affiliate tag, so there is nothing to resolve
 * per hostname anymore. This table is now used for PRESERVATION only
 * (third-party/creator tag detection + whitelist/blacklist matching).
 */
export const AFFILIATE_PATTERNS = CAPS_DIRECT_INJECTION_PROGRAMS.map((prog) => ({
  id: prog.id,
  name: prog.name,
  group: _deriveGroup(prog),
  domains: prog.domains.slice(),
  param: prog.param,
  type: "affiliate",
  references: prog.references || [],
}));

const _hostIndex = new Map();
let _indexedLength = 0;

function _rebuildHostIndex() {
  _hostIndex.clear();
  for (const p of AFFILIATE_PATTERNS) {
    for (const d of p.domains) {
      const clean = d.replace(/^www\./, "");
      if (!_hostIndex.has(clean)) _hostIndex.set(clean, []);
      _hostIndex.get(clean).push(p);
    }
  }
  _indexedLength = AFFILIATE_PATTERNS.length;
}
_rebuildHostIndex();

/**
 * Returns all affiliate patterns that match the given hostname.
 * @param {string} hostname
 * @returns {Array}
 */
export function getPatternsForHost(hostname) {
  // Rebuild index if AFFILIATE_PATTERNS was modified (e.g. by tests)
  if (AFFILIATE_PATTERNS.length !== _indexedLength) _rebuildHostIndex();
  const host = hostname.replace(/^www\./, "");
  const exact = _hostIndex.get(host);
  if (exact) return exact;
  // Suffix scan: when multiple suffixes match (e.g. "amazon" and "amazon.co.uk"
  // both match "shop.amazon.co.uk") return the LONGEST matching domain so that
  // the most-specific rule always wins (#831 latent-footgun guard).
  let bestDomain = "";
  let bestPatterns = [];
  for (const [domain, patterns] of _hostIndex) {
    if (host.endsWith("." + domain) && domain.length > bestDomain.length) {
      bestDomain = domain;
      bestPatterns = patterns;
    }
  }
  return bestPatterns;
}

/**
 * Per-patterns-array cached Set of lowercased affiliate param names.
 * Callers used to build `new Set(patterns.map(p => p.param.toLowerCase()))`
 * on every `processUrl` call — millions of redundant allocations. Now the
 * Set is built once per patterns array (each value of `_hostIndex` is a
 * stable reference) and reused. #629 win 2.
 */
const _affiliateParamSetCache = new WeakMap();

/**
 * Returns the lowercased affiliate param Set for the given hostname.
 * The Set is cached per (host → patterns) array — building it once and
 * reusing on subsequent calls (#629 win 2). Returns an empty Set when the
 * host has no patterns.
 *
 * @param {string} hostname
 * @returns {Set<string>}
 */
export function getAffiliateParamSetForHost(hostname) {
  const patterns = getPatternsForHost(hostname);
  if (!patterns || patterns.length === 0) return _EMPTY_AFFILIATE_PARAM_SET;
  let cached = _affiliateParamSetCache.get(patterns);
  if (cached) return cached;
  cached = new Set(patterns.map((p) => p.param.toLowerCase()));
  _affiliateParamSetCache.set(patterns, cached);
  return cached;
}

const _EMPTY_AFFILIATE_PARAM_SET = new Set();

/**
 * Returns the list of stores with active affiliate support for display in the UI.
 * Only includes entries with known domains.
 */
export function getSupportedStores() {
  return AFFILIATE_PATTERNS.filter(p => p.domains.length > 0);
}

/**
 * Returns a flat array of all unique hostnames (without www.) where
 * affiliate logic may apply. Used by the content script to decide
 * whether a link click needs interception.
 * @returns {string[]}
 */
export function getAffiliateDomains() {
  const set = new Set();
  for (const p of AFFILIATE_PATTERNS) {
    for (const d of p.domains) set.add(d.replace(/^www\./, ""));
  }
  return [...set];
}

