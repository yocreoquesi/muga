/**
 * MUGA: Core URL processing logic
 * Exported as a module for use in the service worker.
 */

import { TRACKING_PARAMS, TRACKING_PARAM_CATEGORIES, getPatternsForHost } from "./affiliates.js";
import { unwrap, detectWrapper } from "./wrapper-engine.js";
import { extractCanonical } from "./canonical-extractor.js";
import { shouldHonor } from "./honor-creator.js";
import { classify as classifyParams } from "./param-classifier.js";

// C5: O(1) lookup instead of O(n) array scan
const TRACKING_PARAMS_SET = new Set(TRACKING_PARAMS.map(p => p.toLowerCase()));

// Prefix-based tracking param detection: catches non-standard variants
// without listing each one. Individual params are still in TRACKING_PARAMS
// for DNR rules (which don't support prefix matching).
const TRACKING_PREFIXES = [
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

/** Returns true if the param is a known tracking param (exact match or prefix). */
function isTrackingParam(lower, customParams, domainStrip, remoteParams, userCustomRules) {
  if (TRACKING_PARAMS_SET.has(lower)) return true;
  if (customParams.has(lower)) return true;
  if (domainStrip.has(lower)) return true;
  if (remoteParams.has(lower)) return true;  // T1.5: additive remote params (ADR-D10)
  // #536: user-promoted custom strip rules. Global across hosts because
  // the user explicitly clicked "Strip locally" on a flagged param. The
  // affiliateParamSet skip in stripTrackingParams() runs BEFORE this
  // function is consulted, so a user-listed "tag" cannot wipe an
  // Amazon creator's affiliate referral.
  if (userCustomRules && userCustomRules.has(lower)) return true;
  for (const prefix of TRACKING_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Parses a blacklist/whitelist entry string into a structured object.
 * Supported formats:
 *   "amazon.es"                      → { domain: "amazon.es", param: null, value: null }
 *   "amazon.es::tag::youtuber-21"    → { domain: "amazon.es", param: "tag", value: "youtuber-21" }
 *
 * @param {string} entry
 * @returns {{ domain: string, param: string|null, value: string|null }}
 */
export function parseListEntry(entry) {
  const parts = entry.split("::");
  return {
    domain: parts[0]?.trim().replace(/^www\./, "").toLowerCase() || "",
    param:  parts[1]?.trim() || null,
    value:  parts[2]?.trim() || null,
  };
}

/**
 * Returns true if a host matches a parsed list entry's domain.
 */
function domainMatches(hostname, entryDomain) {
  const host = hostname.replace(/^www\./, "");
  return host === entryDomain || host.endsWith("." + entryDomain);
}

/**
 * Builds the set of params that must NOT be stripped and the set of
 * domain-specific params that MUST be stripped on the given hostname.
 *
 * Matching is subdomain-aware: "www.google.com" matches rule for "google.com".
 *
 * @param {string} hostname
 * @param {Array}  domainRules  - Array of { domain, preserveParams[], stripParams[]? } objects
 * @returns {{ preserved: Set<string>, domainStrip: Set<string> }}
 */
export function getDomainParamSets(hostname, domainRules = []) {
  const preserved = new Set();
  const domainStrip = new Set();
  for (const rule of domainRules) {
    if (hostname === rule.domain || hostname.endsWith("." + rule.domain)) {
      (rule.preserveParams || []).forEach(p => preserved.add(p.toLowerCase()));
      (rule.stripParams || []).forEach(p => domainStrip.add(p.toLowerCase()));
    }
  }
  return { preserved, domainStrip };
}

/**
 * Returns the set of preserved params for a hostname.
 * Backwards-compatible alias for getDomainParamSets().preserved.
 * @param {string} hostname - The hostname to look up.
 * @param {Array} domainRules - Domain rules array from domain-rules.json.
 * @returns {Set<string>} Lowercased param names that should be preserved.
 */
export function getPreservedParams(hostname, domainRules = []) {
  return getDomainParamSets(hostname, domainRules).preserved;
}

/**
 * Detects whether the FINAL URL still carries a third-party affiliate tag for
 * a known store — i.e. a tag MUGA decided to preserve. Independent of
 * notifyForeignAffiliate (read-only signal for UI feedback). Skips empty
 * #523 phase 3: preserve set is now declarative (sourced from caps-spec),
 * not gated on ourTag. A creator referral on Booking, Vercel, DigitalOcean,
 * Humble Bundle, or Lemon Squeezy is preserved even when MUGA has no
 * affiliate account on those programs. The only short-circuit is when the
 * URL's value matches MUGA's own tag for THIS hostname — that's our
 * injection, not a foreign creator.
 *
 * @param {URL}   url
 * @param {Array} patterns - Affiliate patterns scoped to the hostname.
 * @returns {{param:string,value:string,store:string,group:string}|null}
 */
function detectPreservedAffiliate(url, patterns) {
  const host = url.hostname.replace(/^www\./, "");
  for (const pattern of patterns) {
    const value = url.searchParams.get(pattern.param);
    if (!value) continue;
    const ourTagForHost = pattern.ourTag[host] || pattern.ourTag[url.hostname] || "";
    if (ourTagForHost && value === ourTagForHost) continue; // our own injection, skip
    return {
      param: pattern.param,
      value,
      store: pattern.name,
      group: pattern.group || pattern.name,
    };
  }
  return null;
}

/**
 * Strips Amazon path-based tracking segments that appear after the ASIN.
 * Amazon embeds referral tokens and session IDs directly in the path, e.g.:
 *   /dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601
 * The clean form is: /dp/B0GQ4N9N33/
 */
function cleanAmazonPath(hostname, pathname) {
  if (!/(?:^|\.)amazon\.[a-z.]+$/.test(hostname)) return pathname;
  return pathname
    // Strip product-name slug that precedes /dp/ASIN (e.g. /UGREEN-Adaptador/dp/B0B9N3QSL3/)
    .replace(/\/[^/]+\/dp\/([A-Za-z0-9]{10})/, "/dp/$1")
    .replace(/(\/dp\/[A-Za-z0-9]{10})\/.+/, "$1/")
    .replace(/(\/gp\/product\/[A-Za-z0-9]{10})\/.+/, "$1/")
    .replace(/\/ref=[^/?#]*/g, "") || "/";
}

/**
 * Returns true if this is an AliExpress product/item page where ALL query
 * params are tracking noise. Item pages load correctly with zero params.
 * Search and category pages (preserveParams in domain-rules) are excluded.
 */
function isAliExpressItemPage(hostname, pathname) {
  if (!/aliexpress\.[a-z.]+$/.test(hostname)) return false;
  return /^\/item\/\d+\.html?\/?$/i.test(pathname);
}

// Bookshop.org affiliate attribution is path-based, not query-string-based:
// `/a/{id}/...` at entry sets a session cookie that carries through subsequent
// product pages. We detect the entry path so the cleaner does NOT strip it
// and so the existing creator-referral wedge cue still fires for users.
//
// Out-of-band escape hatch authorised by caps-spec#46 (deferred). The narrow
// shape is intentional: when a second path-based program lands as a real
// request, generalise this and reopen the RFC with N>1 data.
function isBookshopPathReferral(url) {
  if (url.hostname.replace(/^www\./, "") !== "bookshop.org") return false;
  return /^\/a\/[^/]+\//.test(url.pathname);
}

/**
 * Strips tracking params from a URL object, respecting affiliate, preserved,
 * and disabled-category params.  Returns { removed, removedValues, junkCount }
 * where `removedValues` is a parallel array carrying the original values of
 * each stripped param (captured BEFORE deletion) so callers can feed the
 * cross-site-frequency tracker the (paramName, value) tuple. (#495)
 */
function stripTrackingParams(url, prefs, domainRules, disabledCategories, classifierStripSet) {
  const hostname = url.hostname;
  const patterns = getPatternsForHost(hostname);
  const affiliateParamSet = new Set(patterns.map(p => p.param.toLowerCase()));
  const customParams = new Set((prefs.customParams || []).map(p => p.toLowerCase()));
  const remoteParams = new Set((prefs.remoteParams || []).map(p => p.toLowerCase()));  // T1.5: ADR-D10
  // #536: user-promoted strip rules. Lowercased once for case-insensitive
  // membership; consulted last so built-in/affiliate paths still win.
  const userCustomRules = new Set((prefs.userCustomRules || []).map(p => p.toLowerCase()));
  const { preserved, domainStrip } = getDomainParamSets(hostname, domainRules);

  const disabledParams = new Set();
  if (disabledCategories.size > 0) {
    for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      if (disabledCategories.has(key)) {
        cat.params.forEach(p => disabledParams.add(p.toLowerCase()));
      }
    }
  }

  // Bounded-scope classifier strip set (#530). Lowercased for case-insensitive
  // membership check. Affiliate precedence is enforced here too: a param is
  // never stripped if it's in the affiliate set, regardless of classifier.
  const classifierLower = classifierStripSet
    ? new Set([...classifierStripSet].map(p => p.toLowerCase()))
    : null;

  const removed = [];
  const removedValues = [];
  for (const param of [...url.searchParams.keys()]) {
    const lower = param.toLowerCase();
    if (affiliateParamSet.has(lower)) continue;
    if (preserved.has(lower)) continue;
    if (disabledParams.has(lower)) continue;
    const isClassified = classifierLower && classifierLower.has(lower);
    if (isClassified || isTrackingParam(lower, customParams, domainStrip, remoteParams, userCustomRules)) {
      // Capture the value BEFORE delete so we can feed it to the
      // frequency tracker without re-parsing the URL. searchParams.get()
      // returns "" for empty values; that's fine — the tracker hashes
      // the empty string consistently.
      removedValues.push(url.searchParams.get(param) ?? "");
      url.searchParams.delete(param);
      removed.push(param);
    }
  }
  return { removed, removedValues, junkCount: removed.length };
}

/**
 * Processes a URL according to user preferences and blacklist/whitelist rules.
 *
 * Logic order:
 *   0a. Honor Creator Mode (#452): pass redirect-network wrapper through
 *       UNMODIFIED when user opted in AND referrer matches creatorAllowlist
 *   1. Blacklist check: domain-only entry → strip ALL params (Scenario D)
 *   2. Whitelist check: find protected affiliate values (never touch these)
 *   3. Foreign affiliate detection (Scenario C): skip whitelisted values
 *   4. Strip known tracking parameters (Scenario A)
 *   5. Strip blacklisted specific affiliates
 *   6. Inject our affiliate tag (Scenario B): skip if blacklisted domain
 *
 * @param {string} rawUrl - The original URL to process.
 * @param {object} prefs  - User preferences from chrome.storage.sync.
 * @param {Array}  [domainRules=[]] - Domain-rules array (preserveParams/stripParams).
 * @param {{linkCanonical?: string|null, jsonLdId?: string|null}|undefined} [canonicalBundle]
 *   Optional "canonical bundle" produced by the content script from the
 *   page DOM (B7, #442). Used as a SECOND-TIER destination source only
 *   when the wrapper engine detected a wrapper but extraction failed
 *   (opaque wrapper case — t.co, link.medium.com, …). Background-worker
 *   call sites that lack DOM access pass undefined and the canonical
 *   tier no-ops.
 * @param {{ observe: (domain: string, paramName: string, value: string) => Promise<void> } | null | undefined} [frequencyTracker]
 *   Optional cross-site-frequency tracker (#446 / #495). When provided AND
 *   `prefs.crossSiteFrequencyEnabled !== false`, every stripped tracking
 *   param triggers a fire-and-forget `tracker.observe(firstPartyDomain,
 *   name, value)` call. The tracker's first-party domain is the URL's
 *   hostname — i.e. the page being cleaned. Failures from the tracker are
 *   swallowed: the cleaner pipeline must never break on storage errors.
 *   Pass `undefined`/`null` (or omit) in contexts where no tracker exists.
 * @param {string|null|undefined} [referrer]
 *   Optional navigation referrer (#452, B14). When provided AND
 *   `prefs.honorCreatorMode === true` AND the URL is a recognized redirect
 *   wrapper AND the referrer matches an entry in `prefs.creatorAllowlist`,
 *   the pipeline short-circuits with `action: "honored-creator"` and
 *   leaves the wrapper URL unmodified so the creator's referral chain is
 *   preserved. Background-only contexts that lack a referrer (or that
 *   omit this argument) never enter the honor path — defaulting to
 *   pre-feature behaviour.
 * @returns {{ cleanUrl: string, action: string, removedTracking: string[], junkRemoved: number, detectedAffiliate: object|null, preservedAffiliate: object|null, creatorReferralPreserved: boolean, network?: string, creator?: string }}
 *   `action` is one of:
 *     `"untouched"`         — URL unchanged
 *     `"cleaned"`           — tracking params and/or path tokens stripped
 *     `"injected"`          — our affiliate tag was added
 *     `"detected_foreign"`  — a third-party affiliate tag was detected
 *     `"blacklisted"`       — domain-only blacklist stripped everything
 *     `"honored-creator"`   — Honor Creator Mode passed the wrapper through
 *                             unmodified; `network` (wrapper id) and
 *                             `creator` (matching allowlist entry) are set.
 */
export function processUrl(rawUrl, prefs, domainRules = [], canonicalBundle, frequencyTracker, referrer) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved: false };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved: false };
  }

  // Step 0a: Honor Creator Mode (#452, B14). When the user opted in AND the
  // navigation referrer matches an allowlisted creator AND the URL is a
  // recognized redirect wrapper, pass it through UNMODIFIED so the creator's
  // referral chain stays intact. Decision lives in src/lib/honor-creator.js
  // (pure module, reuses Wrapper Engine for network classification).
  // Background-only contexts (no referrer) never enter this branch.
  const honor = shouldHonor({ url: rawUrl, referrer, prefs });
  if (honor.honor) {
    return {
      cleanUrl: rawUrl,
      action: "honored-creator",
      removedTracking: [],
      junkRemoved: 0,
      detectedAffiliate: null,
      preservedAffiliate: null,
      creatorReferralPreserved: false,
      network: honor.network,
      creator: honor.creator,
    };
  }

  // Step 0: unwrap recognized redirect wrappers (Awin etc.). The destination
  // URL becomes the input to the rest of the pipeline so tracking strip and
  // affiliate logic operate on the merchant URL directly.
  const unwrapResult = unwrap(rawUrl);
  if (unwrapResult) {
    rawUrl = unwrapResult.unwrapped;
    try {
      url = new URL(rawUrl);
    } catch {
      return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved: false };
    }
  } else if (
    // Step 0b: Canonical Extractor tier (#442, B7). When the URL was
    // identified as a wrapper but extraction failed (opaque wrapper —
    // t.co, link.medium.com, …), give the page DOM a chance to volunteer
    // the canonical destination via a bundle prepared by the content
    // script. Default ON; bypass via prefs.canonicalExtractorEnabled=false.
    // No-op when no bundle was supplied (background-worker case).
    prefs.canonicalExtractorEnabled !== false &&
    canonicalBundle &&
    detectWrapper(rawUrl)
  ) {
    const canonical = extractCanonical(canonicalBundle);
    if (canonical) {
      rawUrl = canonical;
      try {
        url = new URL(rawUrl);
      } catch {
        return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved: false };
      }
    }
  }

  // Bookshop.org path-based creator-referral detection. Computed once
  // post-unwrap so wrapper redirects that land on bookshop are covered.
  // The flag is read by the service worker (toolbar wedge cue) and
  // surfaced as a top-level boolean for callers that care.
  const creatorReferralPreserved = isBookshopPathReferral(url);

  const hostname = url.hostname;
  const blacklist = prefs.blacklist || [];
  const whitelist = prefs.whitelist || [];

  // Use pre-parsed lists from the caller (service worker cache) when available
  const parsedBlacklist = prefs._parsedBlacklist || blacklist.map(parseListEntry);
  const parsedWhitelist = prefs._parsedWhitelist || whitelist.map(parseListEntry);

  // 0a. OAuth / auth / payment flow exemption: never touch params on these paths.
  // Each segment must appear as a full path component (bounded by / or end-of-path)
  // to avoid false positives like "/authorize-your-creativity".
  const lowerPath = url.pathname.toLowerCase();
  const AUTH_PATH_RE = /\/(oauth|oauth2|authorize|callback|auth|signin|login|sso|saml|checkout|payment|pay)(\/|$)/;
  if (AUTH_PATH_RE.test(lowerPath)) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved };
  }

  // 0b. Per-domain disable: user wants MUGA to do nothing on this domain
  const domainDisabled = parsedBlacklist.some(
    e => e.param === "disabled" && !e.value && domainMatches(hostname, e.domain)
  );
  if (domainDisabled) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved };
  }

  const originalPathname = url.pathname;
  url.pathname = cleanAmazonPath(hostname, url.pathname);
  const pathCleaned = url.pathname !== originalPathname;

  // 1. Scenario D: domain is fully blacklisted. Strip everything, no injection
  const domainBlacklisted = parsedBlacklist.some(
    e => !e.param && domainMatches(hostname, e.domain)
  );
  if (domainBlacklisted) {
    // C10: count params removed so junkRemoved is reported correctly
    const blacklistedParamCount = [...url.searchParams.keys()].length;
    url.search = "";
    return { cleanUrl: url.toString(), action: "blacklisted", removedTracking: [], junkRemoved: blacklistedParamCount + (pathCleaned ? 1 : 0), detectedAffiliate: null, preservedAffiliate: null, creatorReferralPreserved };
  }

  const patterns = getPatternsForHost(hostname);
  const removedTracking = [];
  const removedTrackingValues = [];
  let detectedAffiliate = null;
  let action = "untouched";

  // 2. Whitelist domain-only check: if the domain itself is whitelisted, skip all affiliate processing
  const domainWhitelisted = parsedWhitelist.some(
    e => !e.param && domainMatches(hostname, e.domain)
  );
  if (domainWhitelisted) {
    // Still strip tracking params, but leave all affiliate params untouched and skip injection
    const disabledCategoriesForSkip = new Set(prefs.disabledCategories || []);
    // Bounded-scope classifier (#530): even on whitelisted domains, ambiguous
    // params co-occurring with anchor trackers should be stripped — affiliate
    // params are independently protected by the affiliateParamSet check inside
    // stripTrackingParams, so passing the classifier set here is safe.
    const wlAffiliateParamSet = new Set(getPatternsForHost(hostname).map(p => p.param.toLowerCase()));
    const wlClassification = classifyParams(url.toString(), {
      ...prefs,
      _affiliateParamSet: wlAffiliateParamSet,
    });
    const {
      removed: removedTrackingForSkip,
      removedValues: removedValuesForSkip,
    } = stripTrackingParams(url, prefs, domainRules, disabledCategoriesForSkip, new Set(wlClassification.stripParams));
    const actionForSkip = (removedTrackingForSkip.length > 0 || pathCleaned) ? "cleaned" : "untouched";
    recordFrequency(frequencyTracker, prefs, hostname, removedTrackingForSkip, removedValuesForSkip);
    return {
      cleanUrl: url.toString(),
      action: actionForSkip,
      removedTracking: removedTrackingForSkip,
      junkRemoved: removedTrackingForSkip.length + (pathCleaned ? 1 : 0),
      detectedAffiliate: null,
      preservedAffiliate: detectPreservedAffiliate(url, patterns),
      creatorReferralPreserved,
    };
  }

  // 2b. Collect whitelisted affiliate values for this host (never touch these).
  // Two shapes are supported (#301):
  //   - exact:    domain::param::value  -> protects only that param/value pair
  //   - wildcard: domain::param::*      -> protects any value of that param
  const whitelistedValues = new Set();
  const whitelistedParams = new Set();
  for (const e of parsedWhitelist) {
    if (!domainMatches(hostname, e.domain) || !e.param || !e.value) continue;
    if (e.value === "*") whitelistedParams.add(e.param);
    else whitelistedValues.add(`${e.param}::${e.value}`);
  }
  const isWhitelisted = (param, value) =>
    whitelistedParams.has(param) || whitelistedValues.has(`${param}::${value}`);

  // 3. Detect a foreign affiliate tag (skipped when stripAllAffiliates is on)
  // #523 phase 3: detection no longer gates on ourTag — a creator referral
  // is preserved even on programs MUGA has no account on (Booking, Vercel,
  // DigitalOcean, Humble Bundle, Lemon Squeezy). The only short-circuit is
  // when the value matches MUGA's OWN tag for this host (we injected it).
  if (!prefs.stripAllAffiliates && prefs.notifyForeignAffiliate) {
    const hostKey = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      const value = url.searchParams.get(pattern.param);
      if (!value) continue;
      const ourTagForHost = pattern.ourTag[hostKey] || pattern.ourTag[hostname] || "";
      if (ourTagForHost && value === ourTagForHost) continue;
      if (!isWhitelisted(pattern.param, value)) {
        detectedAffiliate = { param: pattern.param, value, pattern };
        action = "detected_foreign";
        break;
      }
    }
  }

  // 4. Strip known tracking parameters (built-in + user-defined custom params)
  const affiliateParamSet = new Set(patterns.map(p => p.param.toLowerCase()));
  const disabledCategories = new Set(prefs.disabledCategories || []);

  // 4a-pre. AliExpress item pages: strip ALL params (item pages need zero params),
  // except params explicitly preserved by domain-rules.json.
  if (isAliExpressItemPage(hostname, url.pathname)) {
    const { preserved } = getDomainParamSets(hostname, domainRules);
    for (const param of [...url.searchParams.keys()]) {
      if (preserved.has(param.toLowerCase())) continue;
      // Capture original value BEFORE delete so the frequency tracker can
      // record the (paramName, value) tuple. (#495)
      removedTrackingValues.push(url.searchParams.get(param) ?? "");
      url.searchParams.delete(param);
      removedTracking.push(param);
    }
  } else {
    // Bounded-scope classifier (#530): runs between unwrap and tracking-strip.
    // Strips ambiguous params (PARAM_PAIRS) only when an anchor tracker is
    // present in the same URL. Affiliate params are protected via
    // _affiliateParamSet — they go to preserveParams instead.
    //
    // CAPS-Contextual short-circuit (#543, SPEC §3.2 step 6): if we're still
    // looking at a known wrapper host (unwrap returned null because the
    // destination was unextractable), the bounded-scope rule MUST NOT fire
    // — wrapper URLs are network-redirect categorised in the spec, and the
    // contextual algorithm short-circuits there.
    const isNetworkRedirect = !!detectWrapper(url.toString());
    const classification = classifyParams(url.toString(), {
      ...prefs,
      _affiliateParamSet: affiliateParamSet,
      _skipBoundedScope: isNetworkRedirect,
    });
    const { removed, removedValues } = stripTrackingParams(
      url,
      prefs,
      domainRules,
      disabledCategories,
      new Set(classification.stripParams),
    );
    removedTracking.push(...removed);
    removedTrackingValues.push(...removedValues);
  }
  if (pathCleaned && action === "untouched") action = "cleaned";
  if (removedTracking.length > 0 && action === "untouched") action = "cleaned";

  // 4b. Strip third-party affiliate params. Our own tag is preserved only when
  // injection is enabled -- the user opted into supporting MUGA. If injection
  // is off, "strip all" includes our own tag (covers shared-link case where a
  // URL arrives with our tag already attached) (#353).
  // Whitelist entries are also respected: specific beats general.
  if (prefs.stripAllAffiliates) {
    const hostKeyStrip = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      const val = url.searchParams.get(pattern.param);
      if (val) {
        const ourTagForHost = pattern.ourTag[hostKeyStrip] || pattern.ourTag[hostname] || "";
        if (prefs.injectOwnAffiliate && ourTagForHost && val === ourTagForHost) continue;
        if (!isWhitelisted(pattern.param, val)) {
          url.searchParams.delete(pattern.param);
          if (action === "untouched") action = "cleaned";
        }
      }
    }
  }

  // 5. Strip specific blacklisted affiliate values
  let blacklistStripped = 0;
  // Track whether a blacklist rule removed an affiliate param. If so, injection must be suppressed.
  // Without this guard, a blacklisted third-party tag would be silently replaced by ourTag (#183).
  let blacklistRemovedAffiliate = false;
  for (const entry of parsedBlacklist) {
    if (entry.param && entry.value && domainMatches(hostname, entry.domain)) {
      const current = url.searchParams.get(entry.param);
      if (current === null) continue;
      const isWildcard = entry.value === "*";
      const matches = isWildcard || current === entry.value;
      if (!matches) continue;
      // Whitelist always wins over blacklist for the same param (#301).
      // Applies to both wildcard (`domain::param::*`) and exact-match entries
      // so the user-facing priority rule stays consistent and easy to explain.
      if (isWhitelisted(entry.param, current)) continue;
      url.searchParams.delete(entry.param);
      blacklistStripped++;
      // If this param is an affiliate param for this host, flag injection suppression
      if (affiliateParamSet.has(entry.param.toLowerCase())) {
        blacklistRemovedAffiliate = true;
      }
      // If this was the detected foreign affiliate, clear it. The toast must not fire
      // for a parameter we already removed via the blacklist.
      if (
        detectedAffiliate &&
        detectedAffiliate.param === entry.param &&
        (isWildcard || detectedAffiliate.value === entry.value)
      ) {
        detectedAffiliate = null;
        action = "cleaned";
      } else if (action === "untouched") {
        action = "cleaned";
      }
    }
  }

  const junkRemoved = removedTracking.length + blacklistStripped + (pathCleaned ? 1 : 0);

  // 6. Inject our affiliate tag when the link has none (skip if foreign detected, stripAllAffiliates,
  //    or if a blacklist rule already removed an affiliate for this URL (blacklist takes priority, #183)
  if (prefs.injectOwnAffiliate && !prefs.stripAllAffiliates && action !== "detected_foreign" && !blacklistRemovedAffiliate) {
    const hostKeyInject = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      const ourTagForHost = pattern.ourTag[hostKeyInject] || pattern.ourTag[hostname] || "";
      if (ourTagForHost && !url.searchParams.has(pattern.param)) {
        url.searchParams.set(pattern.param, ourTagForHost);
        action = "injected";
        break;
      }
    }
  }

  recordFrequency(frequencyTracker, prefs, hostname, removedTracking, removedTrackingValues);

  return {
    cleanUrl: url.toString(),
    action,
    removedTracking,
    junkRemoved,
    detectedAffiliate,
    preservedAffiliate: detectPreservedAffiliate(url, patterns),
    creatorReferralPreserved,
  };
}

/**
 * Fire-and-forget bridge from the cleaner to the cross-site-frequency
 * tracker (#446 / #495). One observe() call per stripped tracking param,
 * with the URL's hostname as the first-party domain and the param's
 * ORIGINAL value (captured before deletion) as the value.
 *
 * No-op when:
 *   - no tracker was injected (bookkeeping callers / background contexts
 *     that don't have a tracker wired);
 *   - the user opted out via `prefs.crossSiteFrequencyEnabled === false`
 *     (default-on; only an explicit `false` disables);
 *   - the firstPartyDomain can't be derived (defensive).
 *
 * Failures are swallowed via `.catch(() => {})` because storage errors
 * MUST NOT break the cleaner pipeline. The cleaner's job is to clean URLs;
 * frequency tracking is an opportunistic side-channel.
 *
 * @param {{ observe: Function } | null | undefined} tracker
 * @param {object} prefs
 * @param {string} firstPartyDomain
 * @param {string[]} names
 * @param {string[]} values - parallel array; values[i] corresponds to names[i]
 */
function recordFrequency(tracker, prefs, firstPartyDomain, names, values) {
  if (!tracker || typeof tracker.observe !== "function") return;
  if (prefs?.crossSiteFrequencyEnabled === false) return;
  if (!firstPartyDomain) return;
  if (!names || names.length === 0) return;
  for (let i = 0; i < names.length; i++) {
    try {
      const ret = tracker.observe(firstPartyDomain, names[i], values[i] ?? "");
      if (ret && typeof ret.catch === "function") {
        ret.catch(() => {});
      }
    } catch {
      // Synchronous throw from observe() — swallow. Cleaner must not break.
    }
  }
}
