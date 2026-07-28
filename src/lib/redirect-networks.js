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
// require a publisher account in the network itself; MUGA never injects
// these tags. What MUGA MUST do is preserve the `landingParams` on the
// FIRST landing after a redirect-network click, because the merchant's
// first-party tag reads those params from the URL on landing to populate
// its cookie. Stripping them at `document_start` kills the creator's
// commission.
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

// ────────────────────────────────────────────────────────────────────────
// AUTOINJECTOR_PATTERNS — platform-auto-injected affiliate tags
// (affiliate-autoinject-notice). Categorically distinct from
// REDIRECT_NETWORK_PATTERNS: a redirect network's landing params carry the
// CREATOR's own commission and must be preserved. An auto-injector instead
// stamps its OWN tag onto every outbound link server-side, regardless of who
// posted it. Concrete seed: forocoches.com/link.php?url=amazon.es -> 302 ->
// amazon.es/?tag=eleinst-21.
//
// Shape deliberately isomorphic to REDIRECT_NETWORK_PATTERNS (ADR-a in
// docs/design) so a future signed-remote lift needs no predicate change:
//   - injectorHosts[] — document.referrer host(s) that identify the click as
//     coming through this platform.
//   - merchantDomain  — the landing host the tag appears on.
//   - param           — the affiliate query-param key the platform stamps.
//   - knownTags[]     — the platform's OWN auto-injected value(s). This is
//     the second key of the dual-key match (ADR-d): a genuine creator's tag
//     value is never in this list, so it is never flagged.
//   - mode            — informational only in slice 1 ("replace" | "append").
//
// Source of truth: docs/affiliate-networks-matrix.md#auto-injectors.
// ────────────────────────────────────────────────────────────────────────

export const AUTOINJECTOR_PATTERNS = deepFreeze([
  {
    id: "forocoches",
    platform: "Forocoches",
    injectorHosts: ["forocoches.com"],
    merchantDomain: "amazon.es",
    param: "tag",
    knownTags: ["eleinst-21"],
    mode: "replace",
    references: ["docs/affiliate-networks-matrix.md#auto-injectors"],
    notes:
      "forocoches.com/link.php?url=amazon.es -> 302 -> amazon.es/?tag=eleinst-21. " +
      "The platform stamps its own Amazon Associates tag on every outbound link, " +
      "regardless of which member posted it.",
  },
]);

/**
 * Look up the auto-injector entry whose injectorHosts contains the given
 * referrer hostname. Mirrors getRedirectNetworkForRedirectHost's shape (no
 * wildcard support needed yet — every seed entry uses exact hostnames).
 *
 * @param {string|null|undefined} refHost
 * @returns {object|null}
 */
export function getAutoInjectorForReferrer(refHost) {
  if (!refHost) return null;
  const h = String(refHost).replace(/^www\./, "").toLowerCase();
  for (const entry of AUTOINJECTOR_PATTERNS) {
    if (entry.injectorHosts.includes(h)) return entry;
  }
  return null;
}

/**
 * Pure dual-key predicate distinguishing a platform-auto-injected affiliate
 * tag from a genuine creator referral (affiliate-autoinject-notice, ADR-d).
 *
 * Fires ONLY when BOTH hold:
 *   1. `referrer`'s host matches a known auto-injector's `injectorHosts`, AND
 *   2. `searchParams`'s value for that entry's `param` EXACTLY equals one of
 *      its `knownTags`.
 *
 * A genuine creator's own tag on the very same referrer (e.g. `tag=youtuber-21`
 * posted through forocoches.com) is NEVER flagged — its value is not a known
 * platform tag. This is the entire point of the dual-key design: a
 * referrer-only match would flag every creator who posts an affiliate link
 * through the platform, which is the opposite of MUGA's creator-friendly
 * posture.
 *
 * Pure: no `window`/`document` access, does not mutate `searchParams`, does
 * not influence cleaning `action`/`cleanUrl` — this is a read-only side
 * channel. Fails closed (returns `null`) on any malformed/missing input;
 * never throws.
 *
 * @param {string|null|undefined} hostname - Landing URL hostname.
 * @param {string|null|undefined} referrer - `document.referrer` (full URL,
 *   bare hostname, empty string, or nullish).
 * @param {URLSearchParams|{get: Function}|null|undefined} searchParams -
 *   Landing URL's search params (or any object exposing a `.get(name)`).
 * @returns {{ platform: string, param: string, value: string, merchantDomain: string, scopedBlacklistEntry: string }|null}
 */
export function detectAutoInjectedTag(hostname, referrer, searchParams) {
  try {
    if (!hostname) return null;
    if (!referrer) return null;
    if (!searchParams || typeof searchParams.get !== "function") return null;

    let refHost;
    try {
      refHost = new URL(referrer).hostname;
    } catch {
      refHost = String(referrer);
    }
    if (!refHost) return null;

    const entry = getAutoInjectorForReferrer(refHost);
    if (!entry) return null;

    // Third guard: the landing hostname must actually be the entry's
    // merchantDomain (or a subdomain of it). Without this, a coincidental
    // match of `knownTags` on an unrelated merchant reached via the same
    // referrer would false-positive.
    const h = String(hostname).replace(/^www\./, "").toLowerCase();
    const merchant = entry.merchantDomain.toLowerCase();
    if (h !== merchant && !h.endsWith(`.${merchant}`)) return null;

    const value = searchParams.get(entry.param);
    if (!value || !entry.knownTags.includes(value)) return null;

    return {
      platform: entry.platform,
      param: entry.param,
      value,
      merchantDomain: entry.merchantDomain,
      scopedBlacklistEntry: `${entry.merchantDomain}::${entry.param}::${value}`,
    };
  } catch {
    // Fail closed: any unexpected parse error means "no match", never a throw.
    return null;
  }
}

/**
 * Returns `cleanUrl` with EXACTLY the auto-injected `param`=`value` pair
 * removed (affiliate-autoinject-notice, LOW-1). Lets the notice's Remove
 * action strip the platform tag on the CURRENT navigation instead of only on
 * the NEXT one via the scoped-blacklist write.
 *
 * PRECISION invariant (highest-stakes affiliate handling): only the exact
 * param=value pair is dropped. A genuine creator's tag that co-exists on the
 * SAME param key but a DIFFERENT value (e.g. `tag=creator-21` alongside the
 * platform's `tag=eleinst-21`) MUST survive untouched. Only the FIRST matching
 * pair is removed so a co-present creator value is never collateral.
 *
 * Read-only: computes a NEW string, never mutates its inputs, and never
 * influences the cleaner's `action`/`cleanUrl`/`removedTracking`. On any
 * malformed input or parse failure it returns the original `cleanUrl`
 * unchanged (fail-safe: a Remove that can't compute a stripped URL must fall
 * back to the KEEP url, never throw).
 *
 * Firefox Xray safe: iterates via `forEach` (URLSearchParams key/value
 * iterators are not iterable in content-script sandboxes; forEach is a plain
 * callback, unaffected — see stripTrackingParams in cleaner.js, #1009).
 *
 * @param {string} cleanUrl - The cleaned landing URL (still carrying the tag).
 * @param {string} param    - The auto-injected param key (e.g. "tag").
 * @param {string} value    - The auto-injected param value (e.g. "eleinst-21").
 * @returns {string} A new URL string with the exact pair removed, or the
 *   original `cleanUrl` on any failure / no match.
 */
export function stripAutoInjectedTag(cleanUrl, param, value) {
  if (typeof cleanUrl !== "string" || typeof param !== "string" || typeof value !== "string") {
    return typeof cleanUrl === "string" ? cleanUrl : "";
  }
  try {
    const url = new URL(cleanUrl);
    const kept = [];
    let removed = false;
    url.searchParams.forEach((v, k) => {
      if (!removed && k === param && v === value) {
        removed = true;
        return;
      }
      kept.push([k, v]);
    });
    if (!removed) return cleanUrl;
    const next = new URLSearchParams();
    for (const [k, v] of kept) next.append(k, v);
    url.search = next.toString();
    return url.toString();
  } catch {
    return cleanUrl;
  }
}

/**
 * Returns true when the auto-injected `param`=`value` pair is STILL present in
 * `cleanUrl` (affiliate-autoinject-notice, LOW-2). Gates the passive popup
 * badge so it never surfaces a stale signal: `result.autoInjected` is computed
 * on the INCOMING landing params (before stripping), so it can outlive the tag
 * when the tag was actually removed from the cleaned URL — e.g. under
 * `stripAllAffiliates` (action `"cleaned"`) or on a post-Remove re-navigation
 * where the scoped blacklist already stripped it.
 *
 * Read-only; fails closed (returns false) on any malformed input or parse
 * failure. Firefox Xray safe (forEach, see stripAutoInjectedTag).
 *
 * @param {string} cleanUrl
 * @param {string} param
 * @param {string} value
 * @returns {boolean}
 */
export function isAutoInjectedTagPresent(cleanUrl, param, value) {
  if (typeof cleanUrl !== "string" || typeof param !== "string" || typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(cleanUrl);
    let present = false;
    url.searchParams.forEach((v, k) => {
      if (!present && k === param && v === value) present = true;
    });
    return present;
  } catch {
    return false;
  }
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
