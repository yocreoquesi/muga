/**
 * MUGA: Affiliate and tracking parameter database
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
  // "ref" removed: it's the affiliate param for PcComponentes and MediaMarkt ES/DE in
  // AFFILIATE_PATTERNS. Applying it globally (urlFilter: "*") would strip it on those
  // domains before the affiliate engine can act, and also break GitHub ?ref= branch refs
  // and SPA internal navigation. Context-specific removal only via AFFILIATE_PATTERNS. (#160)
  "source", "campaign", "cid", "clickid",
  "_hsenc", "_hsmi", "hsctatracking",
  "mkt_tok", "trk", "trkcampaign",

  // Affiliate networks: click identifiers (not the affiliate tag itself, just the click ID)
  "irgwc",    // Impact Radius
  "cjevent",  // CJ Affiliate
  "tduid",    // Tradedoubler

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

  // AliExpress
  "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test",
  "afsmartredirect", "gatewayadapt", "aff_request_id", "mall_affr",

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
  "at_campaign", "at_medium", "at_recipient_id", "at_recipient_list",

  // Webtrekk (AdGuard + Neat URL)
  // "wt_mc" excluded: it is the affiliate param for MediaMarkt in AFFILIATE_PATTERNS
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

  // Ad platforms (Brave + Registry)
  "irclickid",        // Impact Radius click ID (alternate form)
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

  // Admitad / Adsterra / misc ad networks
  "admitad_uid", "adsterra_clid", "adsterra_placement_id",
  "adfrom", "adc_publisher", "adc_token", "aiad_clid",

  // AppsFlyer extended
  "af_click_lookback", "af_force_deeplink", "is_retargeting",

  // AT Internet / Piano extended
  "at_campaign_type", "at_creation", "at_emailtype",
  "at_link", "at_link_id", "at_link_origin", "at_link_type",
  "at_ptr_name", "at_send_date",

  // Blueshift extended
  "bsft_aaid", "bsft_ek",

  // CJ Affiliate
  "cjdata",
  // "awc" excluded: AWIN affiliate param in AFFILIATE_PATTERNS

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

  // Impact Radius extended
  "ir_adid", "ir_campaignid", "ir_partnerid", "iclid",

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
  "_zucks_suid", "a8",
  "analytics_context", "analytics_trace_id", "axr_tref", "asgtbndr",
  "bance_xuid", "bemobdata", "beyond_uzcvid", "beyond_uzmcvid", "ucx_ref",
  "btag", "cm_cr", "cm_me", "cmpid", "cstrackid", "cuid",
  "emcs_t", "ems_dl", "erid", "external_click_id", "famad_xuid",
  "ftag", "janet", "jmtyclid", "ldtag_cl", "loclid", "lt_r",
  "maf", "nb_expid_meta", "nb_placement", "nx_source", "oprtrack",
  "personaclick_input_query", "personaclick_search_query",
  "recommended_by", "recommended_code", "rtkcid",
  "spot_im_redirect_source", "srclt", "sscid", "tcsack",
  "user_email_address", "uzcid", "vc_lpp", "vero_conv",
  "vs_campaign_id", "vsm_cid", "vsm_pid", "vsm_type",
  "winflncrtag",
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
      // Yandex
      "yclid", "ysclid", "_openstat", "ymclid",
      // Ad platforms (Brave + Registry)
      "irclickid", "unicorn_click_id", "rb_clickid", "ndclid", "vmcid", "syclid",
      // Piwik / Matomo
      "pk_campaign", "pk_kwd", "pk_source", "pk_medium", "pk_cid",
      "mtm_campaign", "mtm_keyword", "mtm_source", "mtm_medium", "mtm_content",
      "mtm_group", "mtm_placement", "mtm_cid",
      // AT Internet / Piano Analytics
      "xtor", "at_campaign", "at_medium", "at_recipient_id", "at_recipient_list",
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
      "admitad_uid", "adsterra_clid", "adsterra_placement_id",
      "adfrom", "adc_publisher", "adc_token", "aiad_clid",
      "af_click_lookback", "af_force_deeplink", "is_retargeting",
      // "awc" excluded: AWIN affiliate param in AFFILIATE_PATTERNS
      "cjdata",
      "ir_adid", "ir_campaignid", "ir_partnerid", "iclid",
      "gad_campaignid", "gci", "gps_adid",
      "fbadid", "fb_comment_id",
      "action_object_map", "action_ref_map", "action_type_map",
      "tw_medium", "tw_profile_id",
      "a8", "btag", "erid", "external_click_id", "ftag",
      "jmtyclid", "maf", "rtkcid", "sscid",
      "usqp", "vs_campaign_id",
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
      // AliExpress
      "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test",
      "afsmartredirect", "gatewayadapt", "aff_request_id", "mall_affr",
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
      // AppsFlyer
      "af_dp", "af_web_dp", "af_sub1", "af_sub2", "af_sub3", "af_sub4", "af_sub5",
      // Adjust
      "adjust_t", "adjust_campaign", "adjust_adgroup", "adjust_creative",
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
      "pk_vid", "spot_im_redirect_source", "tcsack",
      "uzcid", "vc_lpp", "vero_conv",
      "vsm_cid", "vsm_pid", "vsm_type",
      "winflncrtag", "yj_r", "ymid",
    ],
  },
};

export const AFFILIATE_PATTERNS = [
  {
    id: "amazon_es",
    name: "Amazon España",
    group: "Amazon",
    domains: ["amazon.es", "www.amazon.es"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga0b-21",
  },
  {
    id: "amazon_de",
    name: "Amazon Deutschland",
    group: "Amazon",
    domains: ["amazon.de", "www.amazon.de"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga0f-21",
  },
  {
    id: "amazon_fr",
    name: "Amazon France",
    group: "Amazon",
    domains: ["amazon.fr", "www.amazon.fr"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga08a-21",
  },
  {
    id: "amazon_it",
    name: "Amazon Italia",
    group: "Amazon",
    domains: ["amazon.it", "www.amazon.it"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga04f-21",
  },
  {
    id: "amazon_co_uk",
    name: "Amazon UK",
    group: "Amazon",
    domains: ["amazon.co.uk", "www.amazon.co.uk"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga0a-21",
  },
  {
    id: "amazon_com",
    name: "Amazon US",
    group: "Amazon",
    domains: ["amazon.com", "www.amazon.com"],
    param: "tag",
    type: "affiliate",
    ourTag: "muga0b-20",
  },
  {
    id: "booking",
    name: "Booking.com",
    group: "Booking.com",
    domains: ["booking.com", "www.booking.com"],
    param: "aid",
    type: "affiliate",
    ourTag: "",  // TODO: fill in your Booking Partner ID
  },
  // AliExpress removed: uses redirect-based tracking (s.click.aliexpress.com).
  // Direct parameter injection (aff_fcid=) is not recognized for commission attribution.
  // Supporting AliExpress would require redirecting user URLs through an external server,
  // which violates our privacy policy ("MUGA never silently sends your data anywhere").
  //
  // PcComponentes, El Corte Inglés removed: both use Awin redirect-based tracking.
  // No direct URL parameter injection supported. Same privacy constraint applies.
  {
    id: "ebay",
    name: "eBay",
    group: "eBay",
    domains: ["ebay.com", "www.ebay.com", "ebay.es", "www.ebay.es",
              "ebay.de", "www.ebay.de", "ebay.co.uk", "www.ebay.co.uk",
              "ebay.fr", "www.ebay.fr", "ebay.it", "www.ebay.it"],
    param: "campid",
    type: "affiliate",
    ourTag: "5339147108",
  },
  // AWIN network removed: redirect-based tracking only (awin1.com/pclick.php).
  // Cannot inject awc parameter directly; requires redirecting through AWIN servers.
  //
  // Temu removed: proprietary affiliate program with opaque ToS; high legal risk. (#222)
  //
  // The following stores were evaluated and removed because they all use redirect-based
  // affiliate tracking through networks (Awin, ShareASale, Admitad, Skimlinks, Impact Radius).
  // None support direct URL parameter injection. Supporting them would require redirecting
  // user URLs through external servers, violating our privacy policy.
  //   - Zalando (ES, DE): Awin redirect
  //   - SHEIN: Awin/ShareASale/Admitad redirect
  //   - Fnac (ES, FR): Skimlinks/VigLink redirect
  //   - MediaMarkt (ES, DE): Awin/Sovrn redirect
  //
  // Only stores that support direct parameter injection (like Amazon tag= and eBay campid=)
  // are compatible with MUGA's privacy-first model.
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
  return AFFILIATE_PATTERNS.filter(p => p.domains.length > 0);
}
