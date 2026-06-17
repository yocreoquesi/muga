/**
 * MUGA: Redirect-network table + landing-param lookup (#826 module split)
 *
 * This module owns domain (c) of the former affiliates.js monolith:
 *   - REDIRECT_NETWORK_PATTERNS — deep-frozen table of redirect networks
 *   - getRedirectNetworkPatterns()
 *   - getRedirectNetworkForRedirectHost()
 *   - getLandingParamsForReferrer()
 *
 * No imports from affiliates.js (acyclic). Static tracking-param data lives
 * in affiliates-data.js. Affiliate-program registry lives in affiliates.js.
 */

// ────────────────────────────────────────────────────────────────────────
// REDIRECT_NETWORK_PATTERNS — preservable-but-not-injectable entries for
// the affiliate networks whose attribution model is "the click IS the
// conversion event". 2.1 denoise pivot (#654).
// ────────────────────────────────────────────────────────────────────────
//
// These networks are categorically distinct from AFFILIATE_PATTERNS
// (which holds caps-spec direct-injection programs like Amazon Associates
// where MUGA can generate a tag URL on its own). Redirect networks
// require a publisher account in the network itself; MUGA never inject
// these tags (`ourTag` is always {}). What MUGA MUST do is preserve the
// `landingParams` on the FIRST landing after a redirect-network click,
// because the merchant's first-party tag reads those params from the URL
// on landing to populate its cookie. Stripping them at `document_start`
// kills the creator's commission.
//
// Source of truth for each entry: docs/affiliate-networks-matrix.md v1.0
// (per-network "Recommended cleaner policy" and "Param table" sections).
//
// Consumer contract (used by #656 getLandingPolicy):
//   - `redirectHosts[]` — hostnames that, when seen as document.referrer,
//     identify the current landing as a first-touch from this network.
//     Entries prefixed with `*.` are wildcard SUFFIX matches (subdomains
//     only, NOT the bare apex). Currently only Impact uses wildcards.
//   - `landingParams[]` — URL params the merchant tag reads on landing.
//     Must be preserved on the first-touch document; subsequent same-site
//     navigations may strip them (cookie already populated).
//   - `ourTag` — always {}. These entries are NOT injectable.
//   - `type` — `"redirect-network"`, distinguishing from caps-spec
//     `"affiliate"` entries in AFFILIATE_PATTERNS.
//
// Scope note: The issue lists 6 networks (AliExpress, CJ, Awin, Impact,
// Partnerize, Admitad). Matrix v1.0 documents 9 (those + A8.net, Rakuten,
// TradeTracker). All 9 are included here for consistency with the matrix
// and to give #656 a complete dataset; the pattern is identical across all.

/**
 * Affiliate redirect networks: preservation on, injection off.
 * @see docs/affiliate-networks-matrix.md
 */
// #709 item 9: deep-freeze applies Object.freeze recursively so consumers can't
// .push() into inner arrays (redirectHosts, landingParams, references) and
// silently corrupt the source-of-truth. The outer Object.freeze alone left
// those inner arrays mutable.
function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  }
  return obj;
}

export const REDIRECT_NETWORK_PATTERNS = deepFreeze([
  {
    id: "awin",
    name: "Awin",
    group: "Awin",
    redirectHosts: ["awin1.com"],
    landingParams: ["awc", "wt_mc"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#awin"],
    notes:
      "awin1.com/cread.php?awinaffid=X&p=URL → merchant landing. " +
      "Merchant MasterTag reads `awc` (and Webtrekk's `wt_mc` for MediaMarkt et al.) " +
      "from the URL on landing to populate the first-party cookie.",
  },
  {
    id: "cj-affiliate",
    name: "CJ Affiliate (Commission Junction)",
    group: "CJ Affiliate",
    redirectHosts: [
      "anrdoezrs.net",
      "dpbolvw.net",
      "jdoqocy.com",
      "kqzyfj.com",
      "tkqlhce.com",
      "emjcd.com",
      "qksrv.net",
      "cj.dotomi.com",
    ],
    landingParams: ["cjevent", "cjdata"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#cj-affiliate-commission-junction"],
    notes:
      "Eight redirect domains all funnel to the merchant landing carrying " +
      "`cjevent` (CJ Event ID) and `cjdata` (encoded extras). Merchant tag " +
      "reads these on landing to populate the first-party cookie.",
  },
  {
    id: "aliexpress-affiliate",
    name: "AliExpress Affiliate",
    group: "AliExpress",
    redirectHosts: ["s.click.aliexpress.com"],
    landingParams: [
      "aff_trace_key",
      "aff_request_id",
      "algo_pvid",
      "algo_expid",
      "btsid",
      "ws_ab_test",
    ],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#aliexpress-portals--multi-network"],
    notes:
      "AliExpress runs frequent A/B tests on its attribution stack. The aff_* " +
      "family plus algo_* / btsid / ws_ab_test are conservatively preserved on " +
      "landing pending partner-account verification of strict requirement.",
  },
  {
    id: "impact-radius",
    name: "Impact Radius",
    group: "Impact",
    // Wildcard: matches ANY subdomain of pxf.io (target.pxf.io, walmart.pxf.io, …).
    // The bare apex pxf.io is excluded — Impact only uses subdomains.
    redirectHosts: ["*.pxf.io"],
    landingParams: ["irclickid", "irgwc", "iclid"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#impact-radius-impactcom"],
    notes:
      "Impact assigns each advertiser a *.pxf.io subdomain. The primary click " +
      "ID is `irclickid`; `irgwc` and `iclid` are older / variant forms still " +
      "in use. Wildcard host is the only `*.` entry in this table today.",
  },
  {
    id: "partnerize",
    name: "Partnerize (Performance Horizon)",
    group: "Partnerize",
    redirectHosts: ["prf.hn"],
    landingParams: ["clickref", "pubref", "adref"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#partnerize-performance-horizon"],
    notes:
      "Strongest documented attribution verdict in the matrix — Partnerize's " +
      "own docs state: 'If the clickref isn't stored, then in most cases, " +
      "Partnerize is unable to attribute the conversion to a click and the " +
      "sale won't be attributed.' pubref/adref are conservative preserves.",
  },
  {
    id: "admitad",
    name: "Admitad",
    group: "Admitad",
    redirectHosts: ["ad.admitad.com", "alitems.com"],
    landingParams: ["admitad_uid", "tagtag_uid"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#admitad"],
    notes:
      "Two redirect hosts: ad.admitad.com (global) and alitems.com (deep-link " +
      "wrapper). admitad_uid is the primary click ID; tagtag_uid appears in " +
      "CIS-region integrations.",
  },
  {
    id: "a8net",
    name: "A8.net",
    group: "A8.net",
    redirectHosts: ["px.a8.net"],
    landingParams: ["a8"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#a8net-japan"],
    notes:
      "Japanese affiliate network. Param `a8` already lives in TRACKING_PARAMS " +
      "under 'various ad/analytics platforms'; under 2.1 it joins the preserve " +
      "set on first-touch from px.a8.net.",
  },
  {
    id: "rakuten-linkshare",
    name: "Rakuten Advertising (LinkShare)",
    group: "Rakuten",
    redirectHosts: ["click.linksynergy.com"],
    // Case sensitivity: Rakuten docs show camelCase (ranMID/ranSiteID/ranEAID)
    // but real-world traffic mixes cases. Stored lowercase; lookup should be
    // case-insensitive on the param name when consumed by getLandingPolicy.
    landingParams: ["ranmid", "ransiteid", "raneaid"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#rakuten-advertising-linkshare"],
    notes:
      "click.linksynergy.com is the redirect host (today also handled as a " +
      "wrapper via murl= in src/lib/wrapper-engine.js — surface inversion " +
      "for a follow-up issue). Three required-at-landing params, all forming " +
      "the merchant tag's lookup tuple.",
  },
  {
    id: "tradetracker",
    name: "TradeTracker",
    group: "TradeTracker",
    redirectHosts: ["tc.tradetracker.net"],
    landingParams: ["ttaid", "ttrk", "ttcid"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#tradetracker"],
    notes:
      "Same surface-inversion category as Rakuten. Real Attribution alternative " +
      "model noted in matrix but does not affect landing-param mechanics.",
  },
  {
    id: "tradedoubler",
    name: "Tradedoubler",
    group: "Tradedoubler",
    redirectHosts: ["clk.tradedoubler.com"],
    // tduid is the canonical Tradedoubler click identifier. The advertiser
    // tag (Tradedoubler "Conversion Tracking Script") reads tduid from the
    // landing URL and stores it in a first-party cookie — universal-strip
    // before the tag fires kills attribution. Moved out of TRACKING_PARAMS in #695.
    landingParams: ["tduid"],
    type: "redirect-network",
    ourTag: {},
    references: ["docs/affiliate-networks-matrix.md#tradedoubler"],
    notes:
      "Promoted from matrix-v1.0 known-unknowns in #695 alongside the content-" +
      "script legacy-unwrap retirement. Same surface-inversion category as " +
      "Rakuten / TradeTracker; tduid required-at-landing per public Tradedoubler " +
      "tag integration docs.",
  },
]);

/**
 * Returns the immutable list of redirect-network entries. Mirrors the
 * shape of `AFFILIATE_PATTERNS` but for networks where MUGA preserves
 * (doesn't inject).
 */
export function getRedirectNetworkPatterns() {
  return REDIRECT_NETWORK_PATTERNS;
}

function _matchRedirectHost(entryHost, candidate) {
  if (entryHost.startsWith("*.")) {
    // Wildcard suffix match: `*.pxf.io` matches `target.pxf.io` but NOT `pxf.io`.
    return candidate.endsWith(entryHost.slice(1));
  }
  return candidate === entryHost;
}

/**
 * Look up the redirect-network entry that owns the given hostname.
 * Used by getLandingPolicy (#656) to decide which params to preserve
 * when document.referrer matches a redirect-network host.
 *
 * Wildcard primitive: entries with redirectHosts prefixed with `*.` are
 * suffix-matched against subdomains only (the bare apex does NOT match).
 *
 * @param {string|null|undefined} hostname
 * @returns {object|null}
 */
export function getRedirectNetworkForRedirectHost(hostname) {
  if (!hostname) return null;
  const h = hostname.replace(/^www\./, "").toLowerCase();
  for (const network of REDIRECT_NETWORK_PATTERNS) {
    for (const entryHost of network.redirectHosts) {
      if (_matchRedirectHost(entryHost, h)) return network;
    }
  }
  return null;
}

/**
 * Convenience: returns the Set of landingParams to preserve when the
 * given referrer hostname identifies a known redirect network. Returns
 * an empty Set when the referrer is unknown or null. Consumed by
 * getLandingPolicy (#656).
 *
 * @param {string|null|undefined} referrerHostname
 * @returns {Set<string>}
 */
export function getLandingParamsForReferrer(referrerHostname) {
  const network = getRedirectNetworkForRedirectHost(referrerHostname);
  return network ? new Set(network.landingParams) : new Set();
}

/**
 * Returns the union of landingParams for all redirect-network entries that
 * target the given landing hostname, identified by matching the second-level
 * domain of the hostname against each entry's `id`.
 *
 * This is used by the AliExpress item-page wholesale-strip branch (#885) to
 * exempt the affiliate landing family UNCONDITIONALLY — regardless of whether
 * document.referrer is present. getLandingPolicy() already handles the
 * referrer-gated case; this function covers the no-referrer hole (strict
 * referrer-policy, meta-refresh chains, cross-origin downgrade, DOM-less
 * workers) where getLandingPolicy returns EMPTY_LANDING_POLICY and the family
 * would otherwise be silently stripped.
 *
 * Matching logic: extract the second-level domain from `hostname` (e.g.
 * "aliexpress" from "aliexpress.com" or "www.aliexpress.com"), then include
 * any REDIRECT_NETWORK_PATTERNS entry whose `id` contains that SLD. This is
 * intentionally conservative: most networks land on arbitrary merchant domains
 * and have no fixed landing hostname, so only entries whose program name is
 * embedded in the host (like aliexpress-affiliate → aliexpress.com) match.
 *
 * @param {string|null|undefined} hostname  Landing URL hostname
 * @returns {Set<string>}  Lowercased param names; empty Set when none match
 */
export function getLandingParamsForHost(hostname) {
  if (!hostname) return new Set();
  // Extract SLD: strip www., split on ".", take the second-to-last segment.
  const h = hostname.replace(/^www\./, "").toLowerCase();
  const parts = h.split(".");
  const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (!sld) return new Set();

  const result = new Set();
  for (const network of REDIRECT_NETWORK_PATTERNS) {
    if (network.id.includes(sld)) {
      for (const p of network.landingParams) result.add(p.toLowerCase());
    }
  }
  return result;
}
