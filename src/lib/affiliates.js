/**
 * MUGA — Affiliate and tracking parameter database
 *
 * Each entry defines:
 *   - id:      unique identifier
 *   - name:    human-readable store name
 *   - domains: domains where the pattern applies
 *   - param:   the URL parameter name
 *   - type:    'affiliate' | 'tracking'
 *   - ourTag:  our affiliate value (empty until affiliate account is registered)
 *
 * To add a new program:
 * 1. Add an entry to AFFILIATE_PATTERNS
 * 2. Register an account with the corresponding program
 * 3. Fill in ourTag with your affiliate ID
 */

export const TRACKING_PARAMS = [
  // Google / Meta / Microsoft
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  "msclkid", "tclid", "twclid",

  // Email marketing
  "mc_cid", "mc_eid", "mailingid", "hqemail",

  // Social
  "igshid", "igsh", "s_cid",

  // YouTube share tracking
  "si",

  // TikTok
  "_r",

  // Generic
  "ref", "source", "campaign", "cid", "clickid",
  "_hsenc", "_hsmi", "hsctatracking",
  "mkt_tok", "trk", "trkcampaign",

  // Affiliate networks — click identifiers (not the affiliate tag itself, just the click ID)
  "irgwc",    // Impact Radius
  "cjevent",  // CJ Affiliate
  "tduid",    // Tradedoubler

  // Microsoft / Windows
  "ocid",

  // Amazon — internal / referral noise (not the affiliate tag)
  "psc", "spLa",
  "pd_rd_r", "pd_rd_w", "pd_rd_wg",
  "pf_rd_p", "pf_rd_r",
  "linkcode", "linkid",
  "ascsubtag", "asc_contentid", "asc_contenttype", "asc_campaign",
  "th",

  // eBay
  "mkevt", "mkcid", "mkrid", "campid", "toolid", "customid",

  // AliExpress
  "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test",
];

export const AFFILIATE_PATTERNS = [
  {
    id: "amazon_es",
    name: "Amazon España",
    domains: ["amazon.es", "www.amazon.es"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.es)
  },
  {
    id: "amazon_de",
    name: "Amazon Deutschland",
    domains: ["amazon.de", "www.amazon.de"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.de)
  },
  {
    id: "amazon_fr",
    name: "Amazon France",
    domains: ["amazon.fr", "www.amazon.fr"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.fr)
  },
  {
    id: "amazon_it",
    name: "Amazon Italia",
    domains: ["amazon.it", "www.amazon.it"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.it)
  },
  {
    id: "amazon_co_uk",
    name: "Amazon UK",
    domains: ["amazon.co.uk", "www.amazon.co.uk"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.co.uk)
  },
  {
    id: "amazon_com",
    name: "Amazon US",
    domains: ["amazon.com", "www.amazon.com"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Amazon Associates tag (amazon.com)
  },
  {
    id: "booking",
    name: "Booking.com",
    domains: ["booking.com", "www.booking.com"],
    param: "aid",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Booking Partner ID
  },
  {
    id: "aliexpress",
    name: "AliExpress",
    domains: ["aliexpress.com", "es.aliexpress.com", "www.aliexpress.com"],
    param: "aff_fcid",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your AliExpress Portal affiliate ID
  },
  {
    id: "pccomponentes",
    name: "PcComponentes",
    domains: ["pccomponentes.com", "www.pccomponentes.com"],
    param: "ref",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your PcComponentes affiliate ref
  },
  {
    id: "el_corte_ingles",
    name: "El Corte Inglés",
    domains: ["elcorteingles.es", "www.elcorteingles.es"],
    param: "affiliateId",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your El Corte Inglés affiliate ID
  },
  {
    id: "ebay",
    name: "eBay",
    domains: ["ebay.com", "www.ebay.com", "ebay.es", "www.ebay.es",
              "ebay.de", "www.ebay.de", "ebay.co.uk", "www.ebay.co.uk",
              "ebay.fr", "www.ebay.fr", "ebay.it", "www.ebay.it"],
    param: "campid",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your eBay Partner Network campaign ID
  },
  {
    id: "awin",
    name: "AWIN (network)",
    domains: [],  // AWIN links use domain-specific redirects — tracked via irgwc / awc params
    param: "awc",
    type: "affiliate",
    ourTag: "",
  },
];

/**
 * Returns all affiliate patterns that match the given hostname.
 * @param {string} hostname
 * @returns {Array}
 */
export function getPatternsForHost(hostname) {
  const host = hostname.replace(/^www\./, "");
  return AFFILIATE_PATTERNS.filter(p =>
    p.domains.some(d => d.replace(/^www\./, "") === host)
  );
}

/**
 * Returns true if the parameter is a pure tracking param (not an affiliate tag).
 * @param {string} param
 * @returns {boolean}
 */
export function isTrackingParam(param) {
  return TRACKING_PARAMS.includes(param.toLowerCase());
}

/**
 * Returns the list of stores with active affiliate support for display in the UI.
 * Only includes entries with known domains.
 */
export function getSupportedStores() {
  return AFFILIATE_PATTERNS.filter(p => p.domains.length > 0 && p.id !== "awin");
}
