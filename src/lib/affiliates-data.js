/**
 * MUGA: Static tracking-parameter dataset (#826 module split)
 *
 * This module owns domain (a) of the former affiliates.js monolith:
 *   - TRACKING_PARAMS   — universal strip list
 *   - TRACKING_PREFIXES — prefix-based detection for runtime use
 *   - TRACKING_PARAM_CATEGORIES — taxonomy for the popup / options UI
 *
 * No imports from affiliates.js (acyclic). Redirect-network data lives in
 * redirect-networks.js. Affiliate-program registry lives in affiliates.js.
 */

// Click IDs declared as required-at-landing in REDIRECT_NETWORK_PATTERNS.landingParams
// (redirect-networks.js) are intentionally EXCLUDED from TRACKING_PARAMS per matrix v1.0
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
  "s_cid",

  // YouTube share tracking
  "si",

  // TikTok


  // Generic
  // "ref" removed: it's the affiliate param for PcComponentes and MediaMarkt ES/DE in
  // AFFILIATE_PATTERNS. Applying it globally (urlFilter: "*") would strip it on those
  // domains before the affiliate engine can act, and also break GitHub ?ref= branch refs
  // and SPA internal navigation. Context-specific removal only via AFFILIATE_PATTERNS. (#160)
  "source", "clickid",
  "_hsenc", "_hsmi", "hsctatracking",
  "mkt_tok", "trkcampaign",

  // Affiliate networks: click identifiers not covered by matrix v1.0.
  // Network click IDs in matrix v1.0 are declared in REDIRECT_NETWORK_PATTERNS.landingParams.
  // (`tduid` was here — moved to REDIRECT_NETWORK_PATTERNS in #695 as part of
  // the Tradedoubler matrix entry; required-at-landing means it MUST NOT be in
  // the universal strip.)

  // Amazon: internal / referral noise (not the affiliate tag)
  // psc / spla removed (#1338): host-anchored only (neither AdGuard nor
  // ClearURLs anchors them anywhere else); already in every amazon.*
  // profile's stripParams.

  "linkcode", "creativeasin",
  // ascsubtag removed: Amazon Associates SubTag — invite-only sub-publisher
  // attribution ID; stripping it kills creator attribution (#794).
  // asc_contentid / asc_contenttype removed (#1338): host-anchored only;
  // added to every amazon.* profile's stripParams.
  // spia / _encoding / content-id / social_share / skiptwisterog / starsleft
  // removed (#1228): host-anchored only (ClearURLs "amazon"/"amazon search"
  // providers; AdGuard has retracted its own content-id line). All six are
  // already in every amazon.* profile's stripParams.
  // Amazon: store page / brand referral noise
  // bl_grd_status removed (#1338): host-anchored only; added to every
  // amazon.* profile's stripParams.
  // lp_asin / store_ref: #1338's decision named these for amazon.*
  // anchoring, but the existing PATH_ANCHORED_STAY_GLOBAL test (#1229 /
  // ADR-0008) already established upstream anchors both to a PATH, not a
  // host — domain-rules.json can only express host scope, so anchoring them
  // there would claim more than the evidence supports. Left global pending
  // a maintainer decision on this conflict.
  "lp_asin", "store_ref", "ingress",
  // Amazon: search/browse noise
  // sbo removed (#1338): host-anchored only; added to every amazon.*
  // profile's stripParams.
  "sprefix", "cv_ct_cx",
  // Amazon: locale/keyboard layout selector (appears in ES, DE, FR, IT, US, UK, BR, JP storefronts).
  // Stored lowercase. cleaner.js compares param.toLowerCase() against this list.
  "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
  "__mk_en_us", "__mk_en_gb", "__mk_pt_br", "__mk_ja_jp",
  // "ie" (Amazon's legacy encoding indicator, ie=UTF8) is NOT here on purpose.
  //
  // It is two characters long and it means "input encoding" on a large part of
  // the web — baidu.com and naver.com already had to be given preserveParams
  // entries to stop MUGA stripping it there, which is the symptom of a global
  // entry that was never global. It stays in Amazon's own stripParams, where
  // the claim is true and scoped (#1228).

  // eBay: tracking/click params (not the affiliate param itself)
  // "campid" removed from here: it is the eBay Partner Network affiliate param in
  // AFFILIATE_PATTERNS. Stripping it globally would break affiliate attribution. (#160)
  // #1338 decision named mkevt/mkcid/mkrid/toolid/customid for eBay-host
  // anchoring, but all five are AFFILIATE_PARAM_GUARD members: generate-rules.mjs
  // filters guard members out of a host's extraStrips (the same reason #1228
  // excluded linkcode/creativeasin/click_id), so a stripParams-only anchor
  // would never reach the compiled DNR ruleset — the params would silently
  // downgrade from pre-request network stripping to post-load runtime
  // stripping. Left global pending a maintainer decision on this conflict
  // (reported, not resolved unilaterally).
  "mkevt", "mkcid", "mkrid", "toolid", "customid",

  // AliExpress: non-attribution noise only. The aff_trace_key / algo_* / btsid /
  // ws_ab_test / aff_request_id family is required-at-landing per matrix v1.0 and
  // declared in REDIRECT_NETWORK_PATTERNS.landingParams.
  // mall_affr removed (#1228): host-anchored only (ClearURLs "aliexpress"
  // provider); already in aliexpress.com's stripParams.
  // afsmartredirect / gatewayadapt removed (#1338): host-anchored only;
  // already in aliexpress.com's stripParams.

  // Pinterest
  // e_t removed (#1338): generic, collision-prone name, no vendor evidence.
  "epik",

  // Snapchat
  "sc_channel", "sc_country", "sc_funnel", "sc_segment", "sc_icid",

  // Reddit
  "rdt_cid",

  // Rakuten / LinkShare and TradeTracker click IDs are declared in
  // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.

  // Naver (Korean search/ads)
  // n_ad / n_query / n_rank / n_match removed (#1338): generic, collision-
  // prone names, no vendor evidence (the #1212/#1217 class).
  "n_media", "n_ad_group",
  "n_keyword", "n_keyword_id", "n_campaign_type",
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

  // Dotdigital
  "dm_i",       // Dotdigital link/open tracking (maintainer decision 2026-09-24, #1338)
                // https://support.dotdigital.com/hc/en-gb/articles/360006551019-Understanding-open-tracking-and-link-tracking

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

  // Criteo
  "criteo_id",  // Criteo user ID

  // Google Ads (additional)
  "gad_source", // Google Ads source

  // Facebook / Meta (additional)
  // fbc/fbp: Meta Pixel / Conversions API values (`fb.1.` prefix) copied into
  // bare URL keys by widely used cross-domain GTM recipes; indirect evidence,
  // medium confidence (maintainer decision 2026-09-24, #1338).
  // https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
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
         // Meta mobile app share tracking

  // TikTok (additional)
  "tt_medium",       // TikTok campaign medium
  "tt_content",      // TikTok campaign content
  // sender_web_id / is_copy_url removed (#1338): host-anchored only;
  // already in tiktok.com's stripParams.

  // Google search tracking
  // ved / sca_esv / gs_lcp moved to a path-scoped strip on google.com
  // (/search, /webhp) — #1326 slice 2. Upstream anchors them to a path, not
  // the whole host, and domain-rules.json can now express that; see
  // docs/adr/0010-path-scoped-param-rules.md.
  // sxsrf removed (#1228): host-anchored only (ClearURLs "google" provider,
  // whole-host pattern, no path restriction); already in google.com's
  // stripParams.

  // Branch.io (deep link attribution)
  "_branch_match_id",  // Branch match ID
  "_branch_referrer",  // Branch referrer

  // Braze
  "_bta_tid",   // Braze tracking ID
  "_bta_c",     // Braze campaign

  // Salesforce Marketing Cloud
  "sfmc_id",         // SFMC contact ID

  // Shopify. #1338's decision named _pos/_fid, and the 2026-09-24 follow-up
  // named _psq, for removal ("no vendor evidence"), but strip-table-parity.
  // test.mjs's HOT_PATH_REQUIRED pins all three as part of the exact Shopify
  // storefront family re-injected client-side via history.replaceState — the
  // guard added after a real Shopify field report. Left global: the pin
  // wins over the "no vendor evidence" call.
  "_pos",   // Product position in collection
  "_ss",    // Shopify search session
  "_psq",   // Shopify predictive search query
  "_sid",   // Shopify session ID
  "_fid",   // Shopify filter ID

  // AppsFlyer (mobile attribution)
  "af_dp",     // AppsFlyer deep link
  "af_web_dp", // AppsFlyer web deep link fallback
  "af_sub2", "af_sub3", "af_sub4", "af_sub5",

  // Adjust (mobile attribution)
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

  // Listrak (Registry)
  // trk_contact / trk_msg / trk_module removed (#1338): generic,
  // collision-prone names, no vendor evidence (the #1212/#1217 class).
  "trk_sid",

  // MailerLite (Brave + AdGuard)
  "ml_subscriber", "ml_subscriber_hash",

  // Drip / Klaviyo / ExactTarget / Brevo extended (Firefox + Brave + Registry)
  "__s",         // Drip email tracking
  "_ke",         // Klaviyo legacy email-to-site tracking (carries a base64 email;
                 // superseded by `_kx`); maintainer decision 2026-09-24, #1338.
                 // https://community.klaviyo.com/developer-group-64/understanding-the-ke-parameter-and-server-side-events-using-the-track-api-1546
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
  "tw_source",

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
  // ab_channel / ab_version removed (#1338): no vendor evidence or a known
  // collision (see the #1338 decision).

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
  "mt_link_id", "mt_medium", "mt_network",
  // mnv_sid removed (maintainer decision 2026-09-24, #1338): no vendor
  // evidence after a real search.
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

  // Various ad/analytics platforms (bulk-imported v1.13.0 / PRD #529, mostly
  // without a recorded vendor). #1338 re-audited this block: named a vendor
  // where real-world evidence supports one, marked the rest "vendor
  // unverified" rather than invent one, and moved the three named UNSURE
  // candidates in this block to their own marker per the #1338 decision.
  // sb_referer_host removed (#1338): generic name, no vendor evidence,
  // collision-prone (the #1212/#1217 class).
  "__io_lv",                    // vendor unverified (#1338)
  "_bdadid",                    // vendor unverified (#1338)
  "_bhlid",                     // vendor unverified (#1338)
  "_clde",                      // vendor unverified (#1338)
  "_cldee",                     // vendor unverified (#1338)
  "_io_session_id",             // vendor unverified (#1338)
  "_ly_c",                      // vendor unverified (#1338)
  "_ly_r",                      // vendor unverified (#1338)
  "_ope",                       // vendor unverified (#1338)
  "_sgm_action",                // Segmentify (on-site personalization/recommendation)
  "_sgm_campaign",               // Segmentify (on-site personalization/recommendation)
  "_sgm_pinned",                 // Segmentify (on-site personalization/recommendation)
  "_sgm_source",                 // Segmentify (on-site personalization/recommendation)
  "_sgm_term",                   // Segmentify (on-site personalization/recommendation)
  // A8.net `a8` is declared in REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
  "_zucks_suid",                 // Zucks (Japanese mobile ad network)
  "analytics_context",           // vendor unverified (#1338)
  "analytics_trace_id",          // vendor unverified (#1338)
  // axr_tref removed (maintainer decision 2026-09-24, #1338): no vendor
  // evidence after a real search.
  "asgtbndr",                    // vendor unverified (#1338)
  "bance_xuid",                  // vendor unverified (#1338)
  "bemobdata",                   // BeMob (ad-tracking/redirect platform)
  "beyond_uzcvid",                // vendor unverified (#1338)
  "beyond_uzmcvid",               // vendor unverified (#1338)
  // ucx_ref removed (maintainer decision 2026-09-24, #1338): no vendor
  // evidence after a real search.
  "btag",                         // vendor unverified (#1338)
  "cm_cr",                        // vendor unverified (#1338)
  "cm_me",                        // vendor unverified (#1338)
  "cmpid",                        // vendor unverified (#1338)
  "cstrackid",                    // vendor unverified (#1338)
  "cuid",                         // vendor unverified (#1338)
  "emcs_t",                       // vendor unverified (#1338)
  "ems_dl",                       // vendor unverified (#1338)
  "erid",                         // Russian online-advertising legal labeling ID (ERIR/erid mandate)
  "external_click_id",            // vendor unverified (#1338)
  "famad_xuid",                   // famAD (Japanese affiliate ASP, operated by Ordia)
  "ftag",                         // vendor unverified (#1338)
  "janet",                        // vendor unverified (#1338)
  "jmtyclid",                     // Jmty (Japanese classifieds platform)
  "ldtag_cl",                     // vendor unverified (#1338)
  "loclid",                       // vendor unverified (#1338)
  "lt_r",                         // vendor unverified (#1338)
  "maf",                          // vendor unverified (#1338)
  "nb_expid_meta",                // vendor unverified (#1338)
  "nb_placement",                 // vendor unverified (#1338)
  "nx_source",                    // vendor unverified (#1338)
  "oprtrack",                     // vendor unverified (#1338)
  "personaclick_input_query",     // PersonaClick (e-commerce personalization platform)
  "personaclick_search_query",    // PersonaClick (e-commerce personalization platform)
  "recommended_by",               // vendor unverified (#1338)
  "recommended_code",             // vendor unverified (#1338)
  "rtkcid",                       // vendor unverified (#1338)
  "spot_im_redirect_source",      // Spot.IM (commenting/engagement widget)
  // sprtype removed (maintainer decision 2026-09-24, #1338): no vendor
  // evidence after a real search.
  "srclt",                        // vendor unverified (#1338)
  // sscid removed (maintainer decision 2026-09-24, #1443): ShareASale click ID,
  // now declared in REDIRECT_NETWORK_PATTERNS.shareasale.landingParams like
  // awc/irclickid/cjevent — preserved unconditionally, universal-strip would
  // kill creator attribution.
  "tcsack",                       // vendor unverified (#1338)
  "user_email_address",           // vendor unverified (#1338)
  "uzcid",                        // vendor unverified (#1338)
  "vc_lpp",                       // vendor unverified (#1338)
  "vero_conv",                    // Vero (email marketing; see vero_id above)
  "vs_campaign_id",               // vendor unverified (#1338)
  "vsm_cid",                      // vendor unverified (#1338)
  "vsm_pid",                      // vendor unverified (#1338)
  "vsm_type",                     // vendor unverified (#1338)
  "winflncrtag",                  // vendor unverified (#1338)
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
  // "asc_" prefix removed (#794): caught ascsubtag (Amazon Associates SubTag —
  // affiliate attribution). Individual asc_campaign/asc_contentid/asc_contenttype
  // remain in TRACKING_PARAMS above (Amazon Attribution ad-measurement noise).
  "cv_ct_",     // Amazon: conversion tracking
  "scm_",       // AliExpress / Alibaba: SCM tracking variants
  "sb-ci-",     // Amazon: search bar click ID
];

export const TRACKING_PARAM_CATEGORIES = {
  utm: {
    label: "UTM / Campaign",
    labelKey: "category_utm_label",
    description: "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
    descriptionKey: "category_utm_desc",
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
    labelKey: "category_ads_label",
    description: "Click IDs from Google Ads, Facebook, TikTok, LinkedIn, Microsoft, Twitter, etc.",
    descriptionKey: "category_ads_desc",
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
      "taboola_campaign_id",
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
      "click_id",
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
      "tw_source",
      // Marin Software
      "mkwid", "pcrid",
      // GoDataFeed
      "gdfms", "gdftrk", "gdffi",
      // Adobe extended
      "adobe_mc_ref", "adobe_mc_sdid",
      // AppsFlyer extended
      "af_xp", "af_ad", "af_adset",
      // Naver Ads (Korean)
      // n_ad / n_query / n_rank / n_match removed (#1338): generic,
      // collision-prone names, no vendor evidence.
      "n_media", "n_ad_group",
      "n_keyword", "n_keyword_id", "n_campaign_type",
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
      // sscid excluded per REDIRECT_NETWORK_PATTERNS.shareasale (#1443).
      "jmtyclid", "maf", "rtkcid",
      "usqp", "vs_campaign_id",
      "link_source",
      "tgclid",
    ],
  },
  email: {
    label: "Email Marketing",
    labelKey: "category_email_label",
    description: "Tracking from Klaviyo, HubSpot, Iterable, Marketo, Pardot, ActiveCampaign, etc.",
    descriptionKey: "category_email_desc",
    params: [
      // Mailchimp
      "mc_cid", "mc_eid", "mailingid", "hqemail",
      // HubSpot
      "_hsenc", "_hsmi", "hsctatracking", "__hstc", "__hsfp", "__hssc",
      // Marketo
      "mkt_tok", "_mkto_trk",
      // Generic email
      "trkcampaign",
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
      // Listrak (Registry)
      // trk_contact / trk_msg / trk_module removed (#1338): generic,
      // collision-prone names, no vendor evidence.
      "trk_sid",
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
    labelKey: "category_social_label",
    description: "Tracking from Instagram, Pinterest, Snapchat, TikTok shares, etc.",
    descriptionKey: "category_social_desc",
    params: [
      // Pinterest
      // e_t removed (#1338): generic, collision-prone name, no vendor evidence.
      "epik", "pin_unauth",
      // Snapchat
      "sc_channel", "sc_country", "sc_funnel", "sc_segment", "sc_icid",
    ],
  },
  platform_noise: {
    label: "Platform Noise",
    labelKey: "category_platform_noise_label",
    description: "Session IDs, A/B test tokens, internal routing params added by CDNs and platforms.",
    descriptionKey: "category_platform_noise_desc",
    params: [
      // YouTube share
      "si",
      // TikTok

      // Generic
      "source", "clickid",
      // Amazon
      // psc / spla / asc_contentid / asc_contenttype / bl_grd_status / sbo
      // removed (#1338): host-anchored only, already in every amazon.*
      // profile's stripParams. lp_asin / store_ref stay global: the existing
      // PATH_ANCHORED_STAY_GLOBAL test (#1229 / ADR-0008) established
      // upstream anchors both to a path, not a host.

      "linkcode", "creativeasin",
      // ascsubtag removed: affiliate attribution (#794)
      // spia / _encoding / content-id / social_share / skiptwisterog /
      // starsleft removed (#1228): host-anchored only, already in every
      // amazon.* profile's stripParams.
      "lp_asin", "store_ref", "ingress",
      "sprefix", "cv_ct_cx",
      "__mk_es_es", "__mk_de_de", "__mk_fr_fr", "__mk_it_it",
      "__mk_en_us", "__mk_en_gb", "__mk_pt_br", "__mk_ja_jp",
      // eBay. #1338 named these five for eBay-host anchoring, but all five
      // are AFFILIATE_PARAM_GUARD members — generate-rules.mjs filters guard
      // members out of a host's extraStrips, so anchoring would never reach
      // the compiled DNR rule. Left global pending a maintainer decision.
      "mkevt", "mkcid", "mkrid", "toolid", "customid",
      // AliExpress: non-attribution noise only. The aff_trace_key / algo_* /
      // btsid / ws_ab_test / aff_request_id family is declared in
      // REDIRECT_NETWORK_PATTERNS.landingParams per matrix v1.0.
      // afsmartredirect / gatewayadapt removed (#1338): host-anchored only,
      // already in aliexpress.com's stripParams.
      // Google search tracking (ved/sca_esv/gs_lcp are now path-scoped on
      // google.com /search, /webhp — #1326 slice 2 — not global; sxsrf
      // removed #1228, host-anchored only, already in google.com's
      // stripParams)
      // GA4 cross-domain
      "_gl", "_ga", "_gac",
      // TikTok share tracking. sender_web_id / is_copy_url removed (#1338):
      // host-anchored only, already in tiktok.com's stripParams.
      "tt_medium", "tt_content",
      // Meta mobile
      "fb_action_ids", "fb_action_types", "fb_ref", "fb_source",
      // Branch.io
      "_branch_match_id", "_branch_referrer",
      // Braze
      "_bta_tid", "_bta_c",
      // Salesforce MC
      "sfmc_id",
      // Shopify. _pos/_fid stay global: strip-table-parity.test.mjs pins
      // both as the Shopify storefront family re-injected client-side (see
      // main TRACKING_PARAMS comment for the #1338 conflict).
      "_pos", "_ss", "_psq", "_sid", "_fid",
      // AppsFlyer
      "af_dp", "af_web_dp", "af_sub2", "af_sub3", "af_sub4", "af_sub5",
      // Adjust
      "adjust_campaign", "adjust_adgroup", "adjust_creative",
      // A/B test. ab_channel / ab_version removed (#1338): no vendor
      // evidence or a known collision.

    ],
  },
  generic: {
    label: "Generic Tracking",
    labelKey: "category_generic_label",
    description: "Common generic tracking params used across many platforms.",
    descriptionKey: "category_generic_desc",
    params: [
      "s_cid",
      "wickedid",
      // AdGuard filter 17 import: analytics/session/misc
      "__io_lv", "_bdadid", "_bhlid", "_clde", "_cldee", "_io_session_id",
      "_ly_c", "_ly_r", "_ope",
      "_sgm_action", "_sgm_campaign", "_sgm_pinned", "_sgm_source", "_sgm_term",
      "_zucks_suid",
      "analytics_context", "analytics_trace_id", "asgtbndr",
      "bance_xuid", "bemobdata", "beyond_uzcvid", "beyond_uzmcvid",
      "cm_cr", "cm_me", "cmpid", "cstrackid", "cuid",
      "ebisadid", "ebisother1", "ebisother2", "ebisother3", "ebisother4", "ebisother5",
      "famad_xuid", "gfr_xid", "guccounter", "guce_referrer", "guce_referrer_sig",
      "janet", "line_uid", "loclid",
      "mt_adset", "mt_campaign", "mt_click_id", "mt_creative",
      "mt_link_id", "mt_medium", "mt_network",
      "mt_sub1", "mt_sub2", "mt_sub3", "mt_sub4", "mt_sub5",
      "nb_expid_meta", "nb_placement", "nx_source", "oprtrack",
      // sb_referer_host removed (#1338): generic name, no vendor evidence,
      // collision-prone. axr_tref / ucx_ref / sprtype removed (maintainer
      // decision 2026-09-24, #1338): no vendor evidence after a real search.
      "pk_vid", "spot_im_redirect_source", "tcsack",
      "uzcid", "vc_lpp", "vero_conv",
      "vsm_cid", "vsm_pid", "vsm_type",
      "winflncrtag", "yj_r", "ymid",
    ],
  },
};

/**
 * TRACKING_PARAMS entries that upstream (AdGuard Filter 17 / ClearURLs)
 * anchors to a PATH or QUERY, never to a whole host — so a
 * `domain-rules.json` `stripParams` entry, which can only express host
 * scope (#1229 / ADR-0008 "import at the anchor, never widen"), would claim
 * MORE than upstream's own evidence supports. These deliberately STAY
 * global rather than being host-anchored.
 *
 * Promoted (#1228 anchored-only-globals) from a test-local array in
 * `tests/unit/removed-global-params-network-coverage.test.mjs` (originally
 * pinned by #1324) to a single exported source of truth: the network-
 * coverage test imports this constant instead of re-declaring the list, and
 * `tools/anchored-only-globals.mjs`'s monthly detection excludes every
 * member here from its candidate report — reporting one of these again
 * would just be re-discovering a decision this repo already made, not new
 * signal.
 *
 * Widening this list requires a fresh measurement per param (a real host
 * profile or path-scoping mechanism landing for it, per #1326); do not add
 * to it from a shallow re-read of an upstream line.
 */
export const PATH_ANCHORED_STAY_GLOBAL = [
  "linkcode", "creativeasin", "lp_asin", "store_ref", "sprefix",
  "mkevt", "mkcid", "mkrid", "toolid", "customid", "ingress",
];

/**
 * TRACKING_PARAMS entries with anchored-only upstream evidence that a human
 * already triaged and decided to KEEP global, for a reason `#1228`'s
 * mechanical detection cannot express on its own (self-hosted/SaaS-platform
 * risk, or an anchor that contradicts MUGA's own attribution model).
 *
 * `tools/anchored-only-globals.mjs`'s monthly report excludes every key
 * here from its candidate list — without this, the SAME already-rejected
 * names would reappear in the report every month. Each value is the
 * human-readable reason, citing the triage that decided it, so the
 * exclusion itself is auditable rather than a bare name list.
 *
 * Every key here MUST also be in TRACKING_PARAMS — pinned by
 * tests/unit/adjudicated-keep-global.test.mjs so a stale entry (the param
 * later removed from TRACKING_PARAMS by an unrelated change) fails loudly
 * instead of silently becoming a no-op exclusion forever.
 *
 * Adding a new entry: after triaging a candidate from the monthly report
 * and deciding it must stay global, add `param: "reason (#issue/PR)"` here.
 * Do NOT add an entry just to silence the report without triage — the
 * report is the point.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ADJUDICATED_KEEP_GLOBAL = Object.freeze({
  // Piwik/Matomo is self-hosted analytics software running on thousands of
  // independent sites under this same param family; MUGA's own
  // pk_campaign/pk_source/pk_medium/pk_cid siblings stay global for the same
  // reason. ClearURLs' only anchor for pk_kwd is one example deployment
  // (vivaldi.com) — one sample host does not establish host-exclusivity for
  // a self-hosted platform's own param name (#1228 step 4 / #1374).
  pk_kwd: "Piwik/Matomo self-hosted analytics family — ClearURLs anchors it to one example deployment (vivaldi.com), which does not establish host-exclusivity for a self-hosted platform (#1228 step 4 / #1374)",
  // IBM Acoustic / Silverpop is a SaaS ESP many independent brands embed
  // under their own domains. ClearURLs anchors this whole family to one
  // example brand (moosejaw.com) alone (#1228 step 4 / #1374).
  spjobid: "IBM Acoustic / Silverpop ESP family — ClearURLs anchors it to one example brand (moosejaw.com), which does not establish host-exclusivity for a SaaS platform (#1228 step 4 / #1374)",
  spmailingid: "IBM Acoustic / Silverpop ESP family — same reasoning as spjobid (#1228 step 4 / #1374)",
  spreportid: "IBM Acoustic / Silverpop ESP family — same reasoning as spjobid (#1228 step 4 / #1374)",
  spuserid: "IBM Acoustic / Silverpop ESP family — same reasoning as spjobid (#1228 step 4 / #1374)",
  // tt_content/tt_medium are MUGA's own TikTok campaign-content/medium
  // attribution params (see the "tt_" family comment above). ClearURLs'
  // ONLY anchor for either name is twitch.com — that anchor contradicts
  // MUGA's own attribution rather than confirming a narrower host scope, so
  // host-scoping to twitch.com would be wrong, not merely unproven.
  tt_content: "MUGA's own TikTok campaign-content attribution param; ClearURLs' only anchor for this name (twitch.com) contradicts that attribution rather than confirming a narrower host scope (#1228 triage, 2026-09-24)",
  tt_medium: "MUGA's own TikTok campaign-medium attribution param; ClearURLs' only anchor for this name (twitch.com) contradicts that attribution rather than confirming a narrower host scope (#1228 triage, 2026-09-24)",
});
