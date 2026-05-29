/**
 * MUGA: Affiliate and tracking parameter database
 *
 * AFFILIATE_PATTERNS is the consolidated view of caps-spec's
 * direct-injection programs joined with MUGA's hand-maintained OUR_TAGS
 * map. The program identity (id, name, domains, param) is sourced from
 * the vendored `caps-spec/manifest.json` (#523 phase 1, run
 * `npm run sync:manifest` to refresh). The per-host affiliate tag values
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
 * OUR_TAGS only. To add a NEW program: it must first land in caps-spec,
 * then `npm run sync:manifest` updates the vendored module.
 */

import { CAPS_DIRECT_INJECTION_PROGRAMS } from "../rules/manifest.data.js";

// Click IDs declared as required-at-landing in REDIRECT_NETWORK_PATTERNS.landingParams
// (below) are intentionally EXCLUDED from TRACKING_PARAMS per matrix v1.0
// (docs/affiliate-networks-matrix.md). Stripping them universally would break creator
// attribution — getLandingPolicy (#656) preserves them on first-touch landings and
// strips on subsequent same-site navigations.
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
  // "ref" removed: it's the affiliate param for PcComponentes and MediaMarkt ES/DE in
  // AFFILIATE_PATTERNS. Applying it globally (urlFilter: "*") would strip it on those
  // domains before the affiliate engine can act, and also break GitHub ?ref= branch refs
  // and SPA internal navigation. Context-specific removal only via AFFILIATE_PATTERNS. (#160)
  "source", "campaign", "cid", "clickid",
  "_hsenc", "_hsmi", "hsctatracking",
  "mkt_tok", "trk", "trkcampaign",

  // Affiliate networks: click identifiers not covered by matrix v1.0.
  // Network click IDs in matrix v1.0 are declared in REDIRECT_NETWORK_PATTERNS.landingParams.
  // (`tduid` was here — moved to REDIRECT_NETWORK_PATTERNS in #695 as part of
  // the Tradedoubler matrix entry; required-at-landing means it MUST NOT be in
  // the universal strip.)

  // Microsoft / Windows
  "ocid",

  // Amazon: internal / referral noise (not the affiliate tag)
  "psc", "spla",
  "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pd_rd_i",
  "pf_rd_p", "pf_rd_r", "pf_rd_s",
  "linkcode", "linkid", "creativeasin", "smid", "spia",
  "ascsubtag", "asc_contentid", "asc_contenttype", "asc_campaign",
  "_encoding", "content-id", "ref_", "social_share", "skiptwisterog", "starsleft",
  // Amazon: store page / brand referral noise
  "lp_asin", "store_ref", "bl_grd_status", "ingress", "visitid",
  // Amazon: search/browse noise
  "dib", "dib_tag", "sprefix", "crid", "dchild", "qid", "sbo", "cv_ct_cx",
  // Amazon: locale/keyboard layout selector (appears in ES, DE, FR, IT, US, UK, BR, JP storefronts).
  // Stored lowercase. cleaner.js compares param.toLowerCase() against this list.
  "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
  "__mk_en_us", "__mk_en_gb", "__mk_pt_br", "__mk_ja_jp",
  // Amazon: legacy encoding indicator (ie=UTF8 on browse/search pages)
  "ie",

  // eBay: tracking/click params (not the affiliate param itself)
  // "campid" removed from here: it is the eBay Partner Network affiliate param in
  // AFFILIATE_PATTERNS. Stripping it globally would break affiliate attribution. (#160)
  "mkevt", "mkcid", "mkrid", "toolid", "customid",

  // AliExpress: non-attribution noise only. The aff_trace_key / algo_* / btsid /
  // ws_ab_test / aff_request_id family is required-at-landing per matrix v1.0 and
  // declared in REDIRECT_NETWORK_PATTERNS.landingParams.
  "afsmartredirect", "gatewayadapt", "mall_affr",

  // Pinterest
  "e_t", "epik",

  // Snapchat
  "sc_channel", "sc_country", "sc_funnel", "sc_segment", "sc_icid",

  // Reddit
  "rdt_cid",

  // Rakuten / LinkShare and TradeTracker click IDs are declared in
  // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.

  // Naver (Korean search/ads)
  "nclid", "napm", "n_media", "n_query", "n_rank", "n_ad_group", "n_ad",
  "n_keyword", "n_keyword_id", "n_campaign_type", "n_cid", "n_match",
  "ssc_referrer",

  // Kakao (Korean messaging/ads)
  "kclid", "kakao_agent", "kakaotrack",

  // LinkPrice (Korean affiliate network)
  "lpinfo",

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

  // Google Analytics 4 (GA4) cross-domain
  "_gl",        // GA4 cross-domain linker
  "_ga",        // GA4 client ID in URL
  "_gac",       // Google Ads conversion linker

  // Facebook / Meta (additional)
  "fb_action_ids",   // Facebook action tracking
  "fb_action_types", // Facebook action types
  "fb_ref",          // Facebook referral
  "fb_source",       // Facebook source
  "mibextid",        // Meta mobile app share tracking

  // TikTok (additional)
  "tt_medium",       // TikTok campaign medium
  "tt_content",      // TikTok campaign content
  "is_from_webapp",  // TikTok referral tracking
  "sender_device",   // TikTok device tracking
  "sender_web_id",   // TikTok web ID tracking
  "is_copy_url",     // TikTok share method tracking

  // Google search tracking
  "ved",        // Google Visitor Encoding Data (click tracking)
  "ei",         // Google Event ID (session tracking)
  "sca_esv",    // Google search experiment/session value
  "sxsrf",      // Google CSRF/tracking token
  "gs_lcp",     // Google search autocomplete tracking

  // Reddit (additional)
  "share_id",   // Reddit share tracking

  // Branch.io (deep link attribution)
  "_branch_match_id",  // Branch match ID
  "_branch_referrer",  // Branch referrer

  // Braze
  "_bta_tid",   // Braze tracking ID
  "_bta_c",     // Braze campaign

  // Salesforce Marketing Cloud
  "sfmc_id",         // SFMC contact ID
  "sfmc_activityid", // SFMC activity tracking

  // Shopify
  "_pos",   // Product position in collection
  "_ss",    // Shopify search session
  "_psq",   // Shopify predictive search query
  "_sid",   // Shopify session ID
  "_fid",   // Shopify filter ID
  "pr_prod_strat",  // Shopify product recommendation strategy
  "pr_rec_id",      // Shopify recommendation ID
  "pr_ref_pid",     // Shopify referral product ID
  "pr_rec_pid",     // Shopify recommended product ID
  "pr_seq",         // Shopify recommendation sequence

  // AppsFlyer (mobile attribution)
  "af_dp",     // AppsFlyer deep link
  "af_web_dp", // AppsFlyer web deep link fallback
  "af_sub1", "af_sub2", "af_sub3", "af_sub4", "af_sub5",

  // Adjust (mobile attribution)
  "adjust_t",        // Adjust tracker
  "adjust_campaign", // Adjust campaign
  "adjust_adgroup",  // Adjust ad group
  "adjust_creative", // Adjust creative

  // ── Industry-standard params (verified in Firefox, Brave, AdGuard, Neat URL) ──

  // Yandex (Firefox + Brave built-in)
  "yclid",      // Yandex Direct click ID
  "ysclid",     // Yandex session click ID
  "_openstat",  // Russian ad analytics (Yandex)

  // Piwik / Matomo (AdGuard + Neat URL + Registry)
  "pk_campaign", "pk_kwd", "pk_source", "pk_medium", "pk_cid",
  "mtm_campaign", "mtm_keyword", "mtm_source", "mtm_medium", "mtm_content",
  "mtm_group", "mtm_placement", "mtm_cid",

  // AT Internet / Piano Analytics (AdGuard + ClearURLs)
  "xtor",       // AT Internet campaign
  "xts",        // AT Internet timestamp/session — paired with xtor
  "at_campaign", "at_medium", "at_recipient_id", "at_recipient_list",

  // Webtrekk (AdGuard + Neat URL)
  "wt_zmc",     // Zeit/Webtrekk campaign

  // HubSpot extended (AdGuard + Registry)
  "hsa_cam", "hsa_grp", "hsa_mt", "hsa_src", "hsa_ad",
  "hsa_acc", "hsa_net", "hsa_kw", "hsa_tgt", "hsa_ver",

  // Blueshift (Brave + AdGuard)
  "bsft_clkid", "bsft_uid", "bsft_eid", "bsft_mid",

  // Oracle Eloqua (AdGuard + Neat URL)
  "elqtrackid", "elqaid", "elqat", "elqcampaignid",

  // IBM Acoustic / Silverpop (Neat URL)
  "spjobid", "spmailingid", "spreportid", "spuserid",

  // Sailthru (Brave)
  "sc_customer", "sc_eh", "sc_uid",

  // Listrak (Registry)
  "trk_contact", "trk_msg", "trk_module", "trk_sid",

  // MailerLite (Brave + AdGuard)
  "ml_subscriber", "ml_subscriber_hash",

  // Drip / Klaviyo / ExactTarget / Brevo extended (Firefox + Brave + Registry)
  "__s",         // Drip email tracking
  "_ke",         // Klaviyo email
  "et_rid",      // ExactTarget recipient ID
  "ss_email_id", // SendinBlue/Brevo email ID
  "vero_id",     // Vero email tracking

  // Omeda (Firefox + Brave + AdGuard)
  "oly_anon_id", // Omeda anonymous ID
  "oly_enc_id",  // Omeda encrypted ID

  // Wunderkind SMS (Brave + AdGuard)
  "sms_click", "sms_source", "sms_uph",

  // Ad platforms (Brave + Registry).
  // Impact Radius `irclickid` is declared in REDIRECT_NETWORK_PATTERNS.landingParams.
  "unicorn_click_id", // Unicorn click tracking
  "rb_clickid",       // Russian ad click ID
  "ndclid",           // Nextdoor click ID
  "vmcid",            // Yahoo/Verizon Media click ID
  "ymclid",           // Yandex Market click ID
  "syclid",           // Snapchat click ID (alternate)

  // Triple Whale (Registry)
  "tw_source", "tw_adid",

  // Adobe extended (AdGuard)
  "adobe_mc_ref",  // Adobe MC referrer
  "adobe_mc_sdid", // Adobe MC supplemental data ID

  // AppsFlyer extended (AdGuard)
  "af_xp",     // AppsFlyer cross-promo
  "af_ad",     // AppsFlyer ad
  "af_adset",  // AppsFlyer adset

  // Marin Software (Registry)
  "mkwid",     // Marin keyword ID
  "pcrid",     // Marin creative ID

  // GoDataFeed (Registry)
  "gdfms", "gdftrk", "gdffi",

  // Generic / multi-platform
  "click_id",   // generic click ID
  "ad_id",      // generic ad ID
  "ab_channel", // A/B test channel
  "ab_version", // A/B test version

  // ── AdGuard filter 17 import (151 params, verified at scale by millions of users) ──

  // Adjust extended
  "adj_campaign", "adj_creative", "adj_label", "adj_t",
  "adjust_referrer", "adjust_tracker", "adjust_tracker_limit",

  // Adsterra / misc ad networks. Admitad's `admitad_uid` is declared in
  // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
  "adsterra_clid", "adsterra_placement_id",
  "adfrom", "adc_publisher", "adc_token", "aiad_clid",

  // AppsFlyer extended
  "af_click_lookback", "af_force_deeplink", "is_retargeting",

  // AT Internet / Piano extended
  "at_campaign_type", "at_creation", "at_emailtype",
  "at_link", "at_link_id", "at_link_origin", "at_link_type",
  "at_ptr_name", "at_send_date",

  // Blueshift extended
  "bsft_aaid", "bsft_ek",

  // CJ Affiliate `cjevent` / `cjdata` and Awin `awc` are declared in
  // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.

  // Content recommendation (Connexity, Revcontent)
  "cx_click", "cx_recsorder", "cx_recswidget",

  // DPG Media (Dutch publisher tracking)
  "dpg_campaign", "dpg_content", "dpg_medium", "dpg_source",

  // Ebis (Japanese analytics)
  "ebisadid", "ebisother1", "ebisother2", "ebisother3", "ebisother4", "ebisother5",

  // Eloqua extended
  "elq", "elqak",

  // Facebook / Meta extended
  "fb_comment_id", "fbadid",
  "action_object_map", "action_ref_map", "action_type_map",

  // Google extended
  "gad_campaignid", "gci", "gps_adid", "usqp",

  // HubSpot extended
  "hsa_la", "hsa_ol",

  // Impact Radius extended (ad-network IDs, not attribution).
  // `iclid` is declared in REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
  "ir_adid", "ir_campaignid", "ir_partnerid",

  // Internal campaign params (used by many CMSes)
  "int_campaign", "int_content", "int_medium", "int_source", "int_term",

  // LINE (Japanese messaging platform)
  "line_uid",

  // Matomo / mt_ tracking
  "mt_adset", "mt_campaign", "mt_click_id", "mt_creative",
  "mt_link_id", "mt_medium", "mt_network", "mnv_sid",
  "mt_sub1", "mt_sub2", "mt_sub3", "mt_sub4", "mt_sub5",

  // Mindbox
  "mindbox-click-id", "mindbox-message-key",

  // Piwik extended
  "pk_vid",

  // Triple Whale / Twitter extended
  "tw_medium", "tw_profile_id",

  // Yahoo / Oath / Verizon Media
  "guccounter", "guce_referrer", "guce_referrer_sig", "gfr_xid",
  "yj_r", "ymid",

  // Various ad/analytics platforms
  "__io_lv", "_bdadid", "_bhlid", "_clde", "_cldee", "_io_session_id",
  "_ly_c", "_ly_r", "_ope",
  "_sgm_action", "_sgm_campaign", "_sgm_pinned", "_sgm_source", "_sgm_term",
  // A8.net `a8` is declared in REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
  "_zucks_suid",
  "analytics_context", "analytics_trace_id", "axr_tref", "asgtbndr",
  "bance_xuid", "bemobdata", "beyond_uzcvid", "beyond_uzmcvid", "ucx_ref",
  "btag", "cm_cr", "cm_me", "cmpid", "cstrackid", "cuid",
  "emcs_t", "ems_dl", "erid", "external_click_id", "famad_xuid",
  "ftag", "janet", "jmtyclid", "ldtag_cl", "loclid", "lt_r",
  "maf", "nb_expid_meta", "nb_placement", "nx_source", "oprtrack",
  "personaclick_input_query", "personaclick_search_query",
  "recommended_by", "recommended_code", "rtkcid",
  "sb_referer_host", "spot_im_redirect_source", "spr", "sprtype",
  "srclt", "sscid", "tcsack",
  "user_email_address", "uzcid", "vc_lpp", "vero_conv",
  "vs_campaign_id", "vsm_cid", "vsm_pid", "vsm_type",
  "winflncrtag",
  // Added via npm run add-rule (#335): AdGuard filter 17 generic — Telegram Ads click tracking
  "link_source",

  // Added via npm run add-rule (#335): AdGuard filter 17 generic — Telegram Ads click ID
  "tgclid",

  // Added via npm run add-rule (#335): AdGuard filter 17 generic — typo variant of utm_campaign
  "utm_compaign",

  // Added via npm run add-rule (#335): AdGuard filter 17 generic — email-marketing UTM extension
  "utm_emailid",

  // Added via npm run add-rule (#335): AdGuard filter 17 generic — email-marketing UTM extension
  "utm_email",

  // Added via npm run add-rule (#335): AdGuard filter 17 generic — newsletter UTM extension
  "utm_newsletterid",

  // Added via npm run add-rule (#335): TikTok share token (sister to _r). Issue #508.
  "_t",

];

// Prefix-based tracking param detection: catches non-standard variants
// without listing each one. Individual params are still in TRACKING_PARAMS
// for DNR rules (which don't support prefix matching).
//
// Used by cleaner.js isTrackingParam() and exported via the manifest's
// prefix_rules[]. DNR cannot match prefixes; this list is runtime-only.
export const TRACKING_PREFIXES = [
  "utm_",       // Google Analytics: utm_source, utm_medium, utm_campaign, etc.
  "cm_sw_",     // Amazon: click/share tracking (cm_sw_r_cp_api_*, cm_sw_r_cso_*)
  "pd_rd_",     // Amazon: product display referral data
  "pf_rd_",     // Amazon: placement referral data
  "__mk_",      // Amazon: marketplace/keyboard locale selector
  "hsa_",       // HubSpot: ad tracking (hsa_acc, hsa_cam, hsa_grp, hsa_kw, etc.)
  "mt_",        // Matomo: campaign tracking (mt_campaign, mt_adset, mt_click_id, etc.)
  "int_",       // Internal campaign params (int_source, int_medium, int_campaign, etc.)
  "ir_",        // Impact Radius: affiliate tracking (ir_adid, ir_campaignid, etc.)
  "asc_",       // Amazon: affiliate sub-tag variants (asc_contentid, asc_campaign, etc.)
  "cv_ct_",     // Amazon: conversion tracking
  "scm_",       // AliExpress / Alibaba: SCM tracking variants
  "sb-ci-",     // Amazon: search bar click ID
];

export const TRACKING_PARAM_CATEGORIES = {
  utm: {
    label: "UTM / Campaign",
    labelEs: "UTM / Campaña",
    labelPt: "UTM / Campanha",
    labelDe: "UTM / Kampagne",
    description: "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
    descriptionEs: "Parámetros UTM de Google Analytics",
    descriptionPt: "Parâmetros UTM do Google Analytics",
    descriptionDe: "Google Analytics UTM-Parameter",
    params: [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
      "utm_compaign",
      "utm_emailid",
      "utm_email",
      "utm_newsletterid",
    ],
  },
  ads: {
    label: "Paid Ads Clicks",
    labelEs: "Clics de publicidad",
    labelPt: "Cliques de anúncios",
    labelDe: "Bezahlte Werbeklicks",
    description: "Click IDs from Google Ads, Facebook, TikTok, LinkedIn, Microsoft, Twitter, etc.",
    descriptionEs: "IDs de clic de Google Ads, Facebook, TikTok, etc.",
    descriptionPt: "IDs de clique do Google Ads, Facebook, TikTok, etc.",
    descriptionDe: "Klick-IDs von Google Ads, Facebook, TikTok, etc.",
    params: [
      // Google / Meta / Microsoft core
      "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
      "msclkid", "tclid", "twclid",
      // Affiliate networks (only IDs NOT required-at-landing per matrix v1.0;
      // landingParams in REDIRECT_NETWORK_PATTERNS are excluded from this category).
      // (`tduid` was here — moved to REDIRECT_NETWORK_PATTERNS.tradedoubler.landingParams
      // in #695. Required-at-landing for the Tradedoubler advertiser tag.)
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
      // Yandex
      "yclid", "ysclid", "_openstat", "ymclid",
      // Ad platforms (Brave + Registry; irclickid excluded per matrix v1.0)
      "unicorn_click_id", "rb_clickid", "ndclid", "vmcid", "syclid",
      // Piwik / Matomo
      "pk_campaign", "pk_kwd", "pk_source", "pk_medium", "pk_cid",
      "mtm_campaign", "mtm_keyword", "mtm_source", "mtm_medium", "mtm_content",
      "mtm_group", "mtm_placement", "mtm_cid",
      // AT Internet / Piano Analytics
      "xtor", "xts", "at_campaign", "at_medium", "at_recipient_id", "at_recipient_list",
      // Webtrekk
      "wt_zmc",
      // Triple Whale
      "tw_source", "tw_adid",
      // Marin Software
      "mkwid", "pcrid",
      // GoDataFeed
      "gdfms", "gdftrk", "gdffi",
      // Adobe extended
      "adobe_mc_ref", "adobe_mc_sdid",
      // AppsFlyer extended
      "af_xp", "af_ad", "af_adset",
      // Naver Ads (Korean)
      "nclid", "napm", "n_media", "n_query", "n_rank", "n_ad_group", "n_ad",
      "n_keyword", "n_keyword_id", "n_campaign_type", "n_cid", "n_match",
      "ssc_referrer",
      // Kakao Ads (Korean)
      "kclid", "kakao_agent", "kakaotrack",
      // LinkPrice (Korean affiliate network)
      "lpinfo",
      // AdGuard filter 17 import: ad networks
      "adj_campaign", "adj_creative", "adj_label", "adj_t",
      "adjust_referrer", "adjust_tracker", "adjust_tracker_limit",
      // Admitad / Adsterra; admitad_uid excluded per matrix v1.0.
      "adsterra_clid", "adsterra_placement_id",
      "adfrom", "adc_publisher", "adc_token", "aiad_clid",
      "af_click_lookback", "af_force_deeplink", "is_retargeting",
      // CJ Affiliate cjdata and Impact iclid excluded per matrix v1.0.
      "ir_adid", "ir_campaignid", "ir_partnerid",
      "gad_campaignid", "gci", "gps_adid",
      "fbadid", "fb_comment_id",
      "action_object_map", "action_ref_map", "action_type_map",
      "tw_medium", "tw_profile_id",
      // A8.net `a8` excluded per matrix v1.0.
      "btag", "erid", "external_click_id", "ftag",
      "jmtyclid", "maf", "rtkcid", "sscid",
      "usqp", "vs_campaign_id",
      "link_source",
      "tgclid",
    ],
  },
  email: {
    label: "Email Marketing",
    labelEs: "Email marketing",
    labelPt: "E-mail marketing",
    labelDe: "E-Mail-Marketing",
    description: "Tracking from Klaviyo, HubSpot, Iterable, Marketo, Pardot, ActiveCampaign, etc.",
    descriptionEs: "Rastreo de Klaviyo, HubSpot, Iterable, Marketo, etc.",
    descriptionPt: "Rastreamento de Klaviyo, HubSpot, Iterable, Marketo, etc.",
    descriptionDe: "Tracking von Klaviyo, HubSpot, Iterable, Marketo, etc.",
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
      // HubSpot extended (AdGuard + Registry)
      "hsa_cam", "hsa_grp", "hsa_mt", "hsa_src", "hsa_ad",
      "hsa_acc", "hsa_net", "hsa_kw", "hsa_tgt", "hsa_ver",
      // Blueshift (Brave + AdGuard)
      "bsft_clkid", "bsft_uid", "bsft_eid", "bsft_mid",
      // Oracle Eloqua (AdGuard + Neat URL)
      "elqtrackid", "elqaid", "elqat", "elqcampaignid",
      // IBM Acoustic / Silverpop (Neat URL)
      "spjobid", "spmailingid", "spreportid", "spuserid",
      // Sailthru (Brave)
      "sc_customer", "sc_eh", "sc_uid",
      // Listrak (Registry)
      "trk_contact", "trk_msg", "trk_module", "trk_sid",
      // MailerLite (Brave + AdGuard)
      "ml_subscriber", "ml_subscriber_hash",
      // Drip / Klaviyo / ExactTarget / Brevo extended
      "__s", "_ke", "et_rid", "ss_email_id", "vero_id",
      // Omeda (Firefox + Brave + AdGuard)
      "oly_anon_id", "oly_enc_id",
      // Wunderkind SMS (Brave + AdGuard)
      "sms_click", "sms_source", "sms_uph",
      // AdGuard filter 17 import: email/CRM
      "hsa_la", "hsa_ol",
      "bsft_aaid", "bsft_ek",
      "elq", "elqak",
      "mindbox-click-id", "mindbox-message-key",
      "at_campaign_type", "at_creation", "at_emailtype",
      "at_link", "at_link_id", "at_link_origin", "at_link_type",
      "at_ptr_name", "at_send_date",
      "int_campaign", "int_content", "int_medium", "int_source", "int_term",
      "cx_click", "cx_recsorder", "cx_recswidget",
      "dpg_campaign", "dpg_content", "dpg_medium", "dpg_source",
      "emcs_t", "ems_dl", "ldtag_cl", "lt_r", "srclt",
      "personaclick_input_query", "personaclick_search_query",
      "recommended_by", "recommended_code",
      "user_email_address",
    ],
  },
  social: {
    label: "Social Media",
    labelEs: "Redes sociales",
    labelPt: "Redes sociais",
    labelDe: "Soziale Medien",
    description: "Tracking from Instagram, Pinterest, Snapchat, TikTok shares, etc.",
    descriptionEs: "Rastreo de Instagram, Pinterest, Snapchat, etc.",
    descriptionPt: "Rastreamento de Instagram, Pinterest, Snapchat, etc.",
    descriptionDe: "Tracking von Instagram, Pinterest, Snapchat, etc.",
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
    labelPt: "Ruído de plataforma",
    labelDe: "Plattform-Rauschen",
    description: "Session IDs, A/B test tokens, internal routing params added by CDNs and platforms.",
    descriptionEs: "IDs de sesión, tokens A/B, parámetros internos de CDNs y plataformas.",
    descriptionPt: "IDs de sessão, tokens A/B, parâmetros internos de CDNs e plataformas.",
    descriptionDe: "Sitzungs-IDs, A/B-Test-Token, interne CDN- und Plattform-Parameter.",
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
      "pf_rd_p", "pf_rd_r", "pf_rd_s",
      "linkcode", "linkid", "creativeasin", "smid", "spia",
      "ascsubtag", "asc_contentid", "asc_contenttype", "asc_campaign",
      "_encoding", "content-id", "ref_", "social_share", "skiptwisterog", "starsleft",
      "lp_asin", "store_ref", "bl_grd_status", "ingress", "visitid",
      "dib", "dib_tag", "sprefix", "crid", "dchild", "qid", "sbo", "cv_ct_cx",
      "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
      "__mk_en_us", "__mk_en_gb", "__mk_pt_br", "__mk_ja_jp",
      "ie",
      // eBay
      "mkevt", "mkcid", "mkrid", "toolid", "customid",
      // AliExpress: non-attribution noise only. The aff_trace_key / algo_* /
      // btsid / ws_ab_test / aff_request_id family is declared in
      // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
      "afsmartredirect", "gatewayadapt", "mall_affr",
      // Google search tracking
      "ved", "ei", "sca_esv", "sxsrf", "gs_lcp",
      // GA4 cross-domain
      "_gl", "_ga", "_gac",
      // TikTok share tracking
      "tt_medium", "tt_content", "is_from_webapp", "sender_device", "sender_web_id", "is_copy_url",
      // Meta mobile
      "mibextid", "fb_action_ids", "fb_action_types", "fb_ref", "fb_source",
      // Reddit share
      "share_id",
      // Branch.io
      "_branch_match_id", "_branch_referrer",
      // Braze
      "_bta_tid", "_bta_c",
      // Salesforce MC
      "sfmc_id", "sfmc_activityid",
      // Shopify
      "_pos", "_ss", "_psq", "_sid", "_fid",
      "pr_prod_strat", "pr_rec_id", "pr_ref_pid", "pr_rec_pid", "pr_seq",
      // AppsFlyer
      "af_dp", "af_web_dp", "af_sub1", "af_sub2", "af_sub3", "af_sub4", "af_sub5",
      // Adjust
      "adjust_t", "adjust_campaign", "adjust_adgroup", "adjust_creative",
      // A/B test
      "ab_channel", "ab_version",
      "_t",
    ],
  },
  generic: {
    label: "Generic Tracking",
    labelEs: "Rastreo genérico",
    labelPt: "Rastreamento genérico",
    labelDe: "Allgemeines Tracking",
    description: "Common generic tracking params used across many platforms.",
    descriptionEs: "Parámetros de rastreo genéricos usados en múltiples plataformas.",
    descriptionPt: "Parâmetros de rastreamento genéricos usados em várias plataformas.",
    descriptionDe: "Allgemeine Tracking-Parameter, die auf vielen Plattformen verwendet werden.",
    params: [
      "s_cid",
      "wickedid",
      // AdGuard filter 17 import: analytics/session/misc
      "__io_lv", "_bdadid", "_bhlid", "_clde", "_cldee", "_io_session_id",
      "_ly_c", "_ly_r", "_ope",
      "_sgm_action", "_sgm_campaign", "_sgm_pinned", "_sgm_source", "_sgm_term",
      "_zucks_suid",
      "analytics_context", "analytics_trace_id", "axr_tref", "asgtbndr",
      "bance_xuid", "bemobdata", "beyond_uzcvid", "beyond_uzmcvid", "ucx_ref",
      "cm_cr", "cm_me", "cmpid", "cstrackid", "cuid",
      "ebisadid", "ebisother1", "ebisother2", "ebisother3", "ebisother4", "ebisother5",
      "famad_xuid", "gfr_xid", "guccounter", "guce_referrer", "guce_referrer_sig",
      "janet", "line_uid", "loclid",
      "mt_adset", "mt_campaign", "mt_click_id", "mt_creative",
      "mt_link_id", "mt_medium", "mt_network", "mnv_sid",
      "mt_sub1", "mt_sub2", "mt_sub3", "mt_sub4", "mt_sub5",
      "nb_expid_meta", "nb_placement", "nx_source", "oprtrack",
      "pk_vid", "sb_referer_host", "spot_im_redirect_source", "spr", "sprtype", "tcsack",
      "uzcid", "vc_lpp", "vero_conv",
      "vsm_cid", "vsm_pid", "vsm_type",
      "winflncrtag", "yj_r", "ymid",
    ],
  },
};


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
  for (const [domain, patterns] of _hostIndex) {
    if (host.endsWith("." + domain)) return patterns;
  }
  return [];
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
