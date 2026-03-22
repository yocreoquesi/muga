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
  // "ref" removed — it's the affiliate param for PcComponentes and MediaMarkt ES/DE in
  // AFFILIATE_PATTERNS. Applying it globally (urlFilter: "*") would strip it on those
  // domains before the affiliate engine can act, and also break GitHub ?ref= branch refs
  // and SPA internal navigation. Context-specific removal only via AFFILIATE_PATTERNS. (#160)
  "source", "campaign", "cid", "clickid",
  "_hsenc", "_hsmi", "hsctatracking",
  "mkt_tok", "trk", "trkcampaign",

  // Affiliate networks — click identifiers (not the affiliate tag itself, just the click ID)
  "irgwc",    // Impact Radius
  "cjevent",  // CJ Affiliate
  "tduid",    // Tradedoubler

  // Microsoft / Windows
  "ocid",

  // Amazon — internal / referral noise (not the affiliate tag)
  "psc", "spla",
  "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pd_rd_i",
  "pf_rd_p", "pf_rd_r",
  "linkcode", "linkid",
  "ascsubtag", "asc_contentid", "asc_contenttype", "asc_campaign",
  "th", "_encoding", "content-id", "ref_",
  // Amazon — locale/keyboard layout selector (appears in ES, DE, FR, IT storefronts).
  // Stored lowercase — cleaner.js compares param.toLowerCase() against this list.
  "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
  // Amazon — legacy encoding indicator (ie=UTF8 on browse/search pages)
  "ie",

  // eBay — tracking/click params (not the affiliate param itself)
  // "campid" removed from here — it is the eBay Partner Network affiliate param in
  // AFFILIATE_PATTERNS. Stripping it globally would break affiliate attribution. (#160)
  "mkevt", "mkcid", "mkrid", "toolid", "customid",

  // AliExpress
  "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test",

  // Pinterest
  "e_t", "epik",

  // Snapchat
  "sc_channel", "sc_country", "sc_funnel", "sc_segment", "sc_icid",

  // Reddit
  "rdt_cid",

  // Rakuten / LinkShare
  "ranmid", "raneaid", "ransiteid",

  // TradeTracker
  "ttaid", "ttrk", "ttcid",

  // General / Miscellaneous
  "srsltid",    // Google Shopping source tracking
  "wickedid",   // Wicked Reports click ID

  // LinkedIn Ads
  "li_fat_id",  // LinkedIn first-party ad tracking
  "li_extra",   // LinkedIn extra tracking
  "li_source",  // LinkedIn source

  // Adobe Analytics / Experience Cloud
  "s_kwcid",    // Adobe Search Keyword Click ID
  "ef_id",      // Adobe EF ID (Advertising Cloud)

  // TikTok Ads
  "ttclid",     // TikTok Click ID

  // Microsoft Advertising (Bing Ads)
  "mscid",      // Microsoft Campaign ID

  // Iterable (email marketing)
  "itm_campaign", "itm_content", "itm_medium", "itm_source", "itm_term",

  // Klaviyo (email)
  "_kx",          // Klaviyo tracking
  "klaviyo_id",   // Klaviyo user ID

  // ActiveCampaign
  "vgo_ee",     // ActiveCampaign tracking

  // Marketo
  "_mkto_trk",  // Marketo cookie tracking

  // Pardot / Salesforce Marketing Cloud
  "pi_ad_id",       // Pardot ad ID
  "pi_campaign_id", // Pardot campaign
  "sfdcimpactsrc",  // Salesforce Impact Source

  // Drip
  "dm_i",       // Drip campaign identifier

  // Omnisend
  "omnisendcontactid", // Omnisend contact

  // Sendinblue / Brevo
  "sib_id",     // Sendinblue contact ID

  // HubSpot (query param forms)
  "__hstc",     // HubSpot tracking cookie
  "__hsfp",     // HubSpot fingerprint
  "__hssc",     // HubSpot session

  // Outbrain
  "oborigurl",       // Outbrain original URL param
  "outbrainclickid", // Outbrain click ID

  // Taboola
  "taboola_campaign_id", // Taboola campaign
  "tblci",               // Taboola click ID

  // Criteo
  "criteo_id",  // Criteo user ID

  // Google Ads (additional)
  "gad_source", // Google Ads source

  // Facebook / Meta (additional)
  "fbc",        // Facebook Click (cookie param form)
  "fbp",        // Facebook Pixel

  // Snapchat (additional)
  "sccid",      // Snapchat Click ID

  // Pinterest (additional)
  "pin_unauth", // Pinterest unauthenticated tracking

  // Zemanta / Outbrain DSP
  "zemclick",   // Zemanta click ID

  // Generic / multi-platform
  "click_id",   // generic click ID
  "ad_id",      // generic ad ID
  "ab_channel", // A/B test channel
  "ab_version", // A/B test version
];

export const TRACKING_PARAM_CATEGORIES = {
  utm: {
    label: "UTM / Campaign",
    labelEs: "UTM / Campaña",
    description: "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
    descriptionEs: "Parámetros UTM de Google Analytics",
    params: [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
    ],
  },
  ads: {
    label: "Paid Ads Clicks",
    labelEs: "Clics de publicidad",
    description: "Click IDs from Google Ads, Facebook, TikTok, LinkedIn, Microsoft, Twitter, etc.",
    descriptionEs: "IDs de clic de Google Ads, Facebook, TikTok, etc.",
    params: [
      // Google / Meta / Microsoft core
      "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
      "msclkid", "tclid", "twclid",
      // Affiliate networks
      "irgwc", "cjevent", "tduid",
      // Rakuten / LinkShare
      "ranmid", "raneaid", "ransiteid",
      // TradeTracker
      "ttaid", "ttrk", "ttcid",
      // Google Shopping
      "srsltid",
      // LinkedIn Ads
      "li_fat_id", "li_extra", "li_source",
      // Adobe Analytics
      "s_kwcid", "ef_id",
      // TikTok Ads
      "ttclid",
      // Microsoft Advertising
      "mscid",
      // Outbrain
      "oborigurl", "outbrainclickid",
      // Taboola
      "taboola_campaign_id", "tblci",
      // Criteo
      "criteo_id",
      // Google Ads additional
      "gad_source",
      // Facebook / Meta additional
      "fbc", "fbp",
      // Snapchat
      "sccid",
      // Reddit
      "rdt_cid",
      // Zemanta / Outbrain DSP
      "zemclick",
      // Generic click / ad IDs
      "click_id", "ad_id",
    ],
  },
  email: {
    label: "Email Marketing",
    labelEs: "Email marketing",
    description: "Tracking from Klaviyo, HubSpot, Iterable, Marketo, Pardot, ActiveCampaign, etc.",
    descriptionEs: "Rastreo de Klaviyo, HubSpot, Iterable, Marketo, etc.",
    params: [
      // Mailchimp
      "mc_cid", "mc_eid", "mailingid", "hqemail",
      // HubSpot
      "_hsenc", "_hsmi", "hsctatracking", "__hstc", "__hsfp", "__hssc",
      // Marketo
      "mkt_tok", "_mkto_trk",
      // Generic email
      "trk", "trkcampaign",
      // Iterable
      "itm_campaign", "itm_content", "itm_medium", "itm_source", "itm_term",
      // Klaviyo
      "_kx", "klaviyo_id",
      // ActiveCampaign
      "vgo_ee",
      // Pardot / Salesforce
      "pi_ad_id", "pi_campaign_id", "sfdcimpactsrc",
      // Drip
      "dm_i",
      // Omnisend
      "omnisendcontactid",
      // Sendinblue / Brevo
      "sib_id",
    ],
  },
  social: {
    label: "Social Media",
    labelEs: "Redes sociales",
    description: "Tracking from Instagram, Pinterest, Snapchat, TikTok shares, etc.",
    descriptionEs: "Rastreo de Instagram, Pinterest, Snapchat, etc.",
    params: [
      // Instagram
      "igshid", "igsh",
      // Pinterest
      "e_t", "epik", "pin_unauth",
      // Snapchat
      "sc_channel", "sc_country", "sc_funnel", "sc_segment", "sc_icid",
    ],
  },
  platform_noise: {
    label: "Platform Noise",
    labelEs: "Ruido de plataforma",
    description: "Session IDs, A/B test tokens, internal routing params added by CDNs and platforms.",
    descriptionEs: "IDs de sesión, tokens A/B, parámetros internos de CDNs y plataformas.",
    params: [
      // YouTube share
      "si",
      // TikTok
      "_r",
      // Generic
      "source", "campaign", "cid", "clickid",
      // Microsoft / Windows
      "ocid",
      // Amazon
      "psc", "spla",
      "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pd_rd_i",
      "pf_rd_p", "pf_rd_r",
      "linkcode", "linkid",
      "ascsubtag", "asc_contentid", "asc_contenttype", "asc_campaign",
      "th", "_encoding", "content-id", "ref_",
      "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
      "ie",
      // eBay
      "mkevt", "mkcid", "mkrid", "toolid", "customid",
      // AliExpress
      "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test",
      // A/B test
      "ab_channel", "ab_version",
    ],
  },
  generic: {
    label: "Generic Tracking",
    labelEs: "Rastreo genérico",
    description: "Common generic tracking params used across many platforms.",
    descriptionEs: "Parámetros de rastreo genéricos usados en múltiples plataformas.",
    params: [
      "s_cid",
      "wickedid",
    ],
  },
};

export const AFFILIATE_PATTERNS = [
  {
    id: "amazon_es",
    name: "Amazon España",
    domains: ["amazon.es", "www.amazon.es"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-es-21",  // TODO: fill in your Amazon Associates tag (amazon.es)
  },
  {
    id: "amazon_de",
    name: "Amazon Deutschland",
    domains: ["amazon.de", "www.amazon.de"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-de-21",  // TODO: fill in your Amazon Associates tag (amazon.de)
  },
  {
    id: "amazon_fr",
    name: "Amazon France",
    domains: ["amazon.fr", "www.amazon.fr"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-fr-21",  // TODO: fill in your Amazon Associates tag (amazon.fr)
  },
  {
    id: "amazon_it",
    name: "Amazon Italia",
    domains: ["amazon.it", "www.amazon.it"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-it-21",  // TODO: fill in your Amazon Associates tag (amazon.it)
  },
  {
    id: "amazon_co_uk",
    name: "Amazon UK",
    domains: ["amazon.co.uk", "www.amazon.co.uk"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-uk-21",  // TODO: fill in your Amazon Associates tag (amazon.co.uk)
  },
  {
    id: "amazon_com",
    name: "Amazon US",
    domains: ["amazon.com", "www.amazon.com"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga-us-21",  // TODO: fill in your Amazon Associates tag (amazon.com)
  },
  {
    id: "booking",
    name: "Booking.com",
    domains: ["booking.com", "www.booking.com"],
    param: "aid",
    type: "affiliate",
    ourTag: "muga-booking",  // TODO: fill in your Booking Partner ID
  },
  {
    id: "aliexpress",
    name: "AliExpress",
    domains: ["aliexpress.com", "es.aliexpress.com", "www.aliexpress.com"],
    param: "aff_fcid",
    type: "affiliate",
    ourTag: "muga-aex",  // TODO: fill in your AliExpress Portal affiliate ID
  },
  {
    id: "pccomponentes",
    name: "PcComponentes",
    domains: ["pccomponentes.com", "www.pccomponentes.com"],
    param: "ref",
    type: "affiliate",
    ourTag: "muga-pcc",  // TODO: fill in your PcComponentes affiliate ref
  },
  {
    id: "el_corte_ingles",
    name: "El Corte Inglés",
    domains: ["elcorteingles.es", "www.elcorteingles.es"],
    param: "affiliateId",
    type: "affiliate",
    ourTag: "muga-eci",  // TODO: fill in your El Corte Inglés affiliate ID
  },
  {
    id: "ebay",
    name: "eBay",
    domains: ["ebay.com", "www.ebay.com", "ebay.es", "www.ebay.es",
              "ebay.de", "www.ebay.de", "ebay.co.uk", "www.ebay.co.uk",
              "ebay.fr", "www.ebay.fr", "ebay.it", "www.ebay.it"],
    param: "campid",
    type: "affiliate",
    ourTag: "muga-ebay",  // TODO: fill in your eBay Partner Network campaign ID
  },
  {
    id: "awin",
    name: "AWIN (network)",
    domains: [],  // AWIN links use domain-specific redirects — tracked via irgwc / awc params
    param: "awc",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "temu",
    name: "Temu",
    domains: ["temu.com", "www.temu.com"],
    param: "aff_id",
    type: "affiliate",
    ourTag: "muga-temu",  // TODO: fill in your Temu affiliate ID
  },
  {
    id: "zalando_es",
    name: "Zalando ES",
    domains: ["zalando.es", "www.zalando.es"],
    param: "wt_mc",
    type: "affiliate",
    ourTag: "muga-zal-es",  // TODO: fill in your Zalando affiliate marketing code
  },
  {
    id: "zalando_de",
    name: "Zalando DE",
    domains: ["zalando.de", "www.zalando.de"],
    param: "wt_mc",
    type: "affiliate",
    ourTag: "muga-zal-de",  // TODO: fill in your Zalando DE affiliate marketing code
  },
  {
    id: "shein",
    name: "SHEIN",
    domains: ["shein.com", "www.shein.com", "es.shein.com", "fr.shein.com", "de.shein.com"],
    param: "url_from",
    type: "affiliate",
    ourTag: "muga-shein",  // TODO: fill in your SHEIN affiliate ID
  },
  {
    id: "fnac_es",
    name: "Fnac ES",
    domains: ["fnac.es", "www.fnac.es"],
    param: "oref",
    type: "affiliate",
    ourTag: "muga-fnac-es",  // TODO: fill in your Fnac affiliate origin ref
  },
  {
    id: "fnac_fr",
    name: "Fnac FR",
    domains: ["fnac.com", "www.fnac.com"],
    param: "oref",
    type: "affiliate",
    ourTag: "muga-fnac-fr",  // TODO: fill in your Fnac FR affiliate origin ref
  },
  {
    id: "mediamarkt_es",
    name: "MediaMarkt ES",
    domains: ["mediamarkt.es", "www.mediamarkt.es"],
    param: "ref",
    type: "affiliate",
    ourTag: "muga-mm-es",  // TODO: fill in your MediaMarkt affiliate ref (Impact Radius)
  },
  {
    id: "mediamarkt_de",
    name: "MediaMarkt DE",
    domains: ["mediamarkt.de", "www.mediamarkt.de"],
    param: "ref",
    type: "affiliate",
    ourTag: "muga-mm-de",  // TODO: fill in your MediaMarkt DE affiliate ref
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
    p.domains.some(d => {
      const domain = d.replace(/^www\./, "");
      return host === domain || host.endsWith("." + domain);
    })
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
