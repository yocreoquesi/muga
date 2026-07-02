/**
 * MUGA: Affiliate and tracking parameter database
 *
 * AFFILIATE_PATTERNS is the consolidated view of caps-spec's
 * direct-injection programs joined with MUGA's hand-maintained OUR_TAGS
 * map. The program identity (id, name, domains, param) is sourced from
 * the vendored `caps-spec/manifest.json` (#523 phase 1, now hand-maintained
 * in `src/rules/manifest.data.js`). The per-host affiliate tag values
 * MUGA injects on its own behalf live in OUR_TAGS in this file — they
 * are intentionally NOT in the open standard.
 *
 * Entry shape:
 *   {
 *     id:         caps-spec program id (e.g. "amazon-associates")
 *     name:       human-readable program name
 *     group:      MUGA display label ("Amazon", "eBay", "Booking.com", ...)
 *     domains:    array of host strings the program covers
 *     param:      URL query parameter that carries the tag value
 *     type:       always "affiliate" (legacy field preserved for clarity)
 *     ourTag:     { host -> tag } map. Programs MUGA has no account on
 *                 carry an empty {} — preservation still works (caps-spec
 *                 declares it preservable); only injection is skipped.
 *     references: array of source citations from caps-spec
 *   }
 *
 * To add a NEW per-marketplace tag for an existing program: edit
 * OUR_TAGS only. To add a NEW program: edit `src/rules/manifest.data.js`
 * directly and update `EXPECTED_PROGRAM_IDS` in `tests/unit/caps-manifest-sync.test.mjs`.
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
} from "./redirect-networks.js";

// ────────────────────────────────────────────────────────────────────────
// AFFILIATE_PATTERNS — caps-spec direct-injection programs joined with
// MUGA's per-host affiliate tag values (#523).
// ────────────────────────────────────────────────────────────────────────
//
// The program identity (id, name, domains, param) is sourced from
// `src/rules/manifest.data.js`. The per-host tag values MUGA
// injects on its own behalf live in OUR_TAGS below — they are
// intentionally NOT in the rule artifact (`ourTag` is per-implementer).
//
// To add a NEW per-marketplace tag for an existing program: edit
// OUR_TAGS only. To add a NEW program: update the rule artifact and
// regenerate via the rules pipeline.
const OUR_TAGS = {
  "amazon-associates": {
    "amazon.com":   "muga0b-20",
    "amazon.es":    "muga0b-21",
    "amazon.de":    "muga0f-21",
    "amazon.fr":    "muga08a-21",
    "amazon.it":    "muga04f-21",
    "amazon.co.uk": "muga0a-21",
  },
  "ebay-partner-network": {
    // eBay shares one campid across all marketplaces, but we still key
    // per-host so the consolidated shape is uniform and the cleaner's
    // injection lookup is a single `pattern.ourTag[hostname]` regardless
    // of program.
    "ebay.com":   "5339147108",
    "ebay.es":    "5339147108",
    "ebay.de":    "5339147108",
    "ebay.co.uk": "5339147108",
    "ebay.fr":    "5339147108",
    "ebay.it":    "5339147108",
  },
  "vercel":        {}, // pending Vercel referral username
  "digitalocean":  {}, // pending DigitalOcean referral code
  "lemon-squeezy": {}, // pending Lemon Squeezy affiliate id
};
// booking and humble-bundle were removed when caps-spec deprecated those
// programs upstream (Booking terminated direct affiliate partnerships May
// 2025 → migrated to Awin; Humble Bundle migrated to Impact). The sync
// script filters out programType=deprecated, so an entry here would be
// dead code — coverage continues via network-redirect (awin / impact-radius).
//
// apple-phg is intentionally NOT in OUR_TAGS: Apple Performance Partners is
// a curated program closed to small publishers (volume + quality gate). We
// preserve third-party at= tags via caps-spec (moat-aligned) but skip
// injection. Fallback `OUR_TAGS[prog.id] || {}` keeps preservation working
// without a placeholder entry.

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
 * Built once at module load by joining caps-spec direct-injection
 * programs with the hand-maintained OUR_TAGS map.
 *
 * Entry shape:
 *   { id, name, group, domains, param, type, ourTag, references }
 * where `ourTag` is a `{ hostname → tag }` map (NOT a flat string).
 * Programs MUGA has no account on carry an empty `ourTag: {}` —
 * preservation still works (caps-spec declares them preservable);
 * only injection is skipped on those.
 */
export const AFFILIATE_PATTERNS = CAPS_DIRECT_INJECTION_PROGRAMS.map((prog) => ({
  id: prog.id,
  name: prog.name,
  group: _deriveGroup(prog),
  domains: prog.domains.slice(),
  param: prog.param,
  type: "affiliate",
  ourTag: OUR_TAGS[prog.id] || {},
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

/**
 * Resolves MUGA's own affiliate tag for a given pattern + hostname.
 *
 * `pattern.ourTag` is a `{ host -> tag }` map (#523 phase 3), NOT a flat
 * string. Callers MUST look it up by hostname; passing the map object
 * straight to `URLSearchParams.set()` serializes it to "[object Object]"
 * (the bug fixed in #904). This is the single source of truth for that
 * lookup: the service worker imports it, and the content script mirrors it
 * inline because MV3 content scripts cannot import ES modules.
 *
 * @param {{ourTag?: Object}|null|undefined} pattern  affiliate pattern (from AFFILIATE_PATTERNS)
 * @param {string} hostname  the marketplace hostname (e.g. "amazon.de" or "www.amazon.de")
 * @returns {string} the tag configured for this host, or "" when none exists
 */
export function resolveOurTag(pattern, hostname) {
  if (!pattern || !pattern.ourTag || !hostname) return "";
  const host = hostname.replace(/^www\./, "");
  return pattern.ourTag[host] || pattern.ourTag[hostname] || "";
}
