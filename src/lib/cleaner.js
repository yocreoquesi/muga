/**
 * MUGA — Core URL processing logic
 * Exported as a module for use in the service worker.
 */

import { TRACKING_PARAMS, TRACKING_PARAM_CATEGORIES, getPatternsForHost } from "./affiliates.js";

// C5 — O(1) lookup instead of O(n) array scan
const TRACKING_PARAMS_SET = new Set(TRACKING_PARAMS.map(p => p.toLowerCase()));

// Prefix-based tracking param detection — catches non-standard variants
// (e.g., utm_wave, utm_emailid, utm_newsletterid) without listing each one.
const TRACKING_PREFIXES = ["utm_"];

/** Returns true if the param is a known tracking param (exact match or prefix). */
function isTrackingParam(lower, customParams, domainStrip) {
  if (TRACKING_PARAMS_SET.has(lower)) return true;
  if (customParams.includes(lower)) return true;
  if (domainStrip.has(lower)) return true;
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
    domain: parts[0]?.trim().replace(/^www\./, "") || "",
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

// Backwards-compatible alias used by external callers
export function getPreservedParams(hostname, domainRules = []) {
  return getDomainParamSets(hostname, domainRules).preserved;
}

/**
 * Strips Amazon path-based tracking segments that appear after the ASIN.
 * Amazon embeds referral tokens and session IDs directly in the path, e.g.:
 *   /dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601
 * The clean form is: /dp/B0GQ4N9N33/
 */
function cleanAmazonPath(hostname, pathname) {
  if (!/amazon\.[a-z.]+$/.test(hostname)) return pathname;
  return pathname
    // Strip product-name slug that precedes /dp/ASIN (e.g. /UGREEN-Adaptador/dp/B0B9N3QSL3/)
    .replace(/\/[^/]+\/dp\/([A-Z0-9]{10})/, "/dp/$1")
    .replace(/(\/dp\/[A-Z0-9]{10})\/.+/, "$1/")
    .replace(/(\/gp\/product\/[A-Z0-9]{10})\/.+/, "$1/")
    .replace(/\/ref=[^/?#]*/g, "") || "/";
}

/**
 * Processes a URL according to user preferences and blacklist/whitelist rules.
 *
 * Logic order:
 *   1. Blacklist check — domain-only entry → strip ALL params (Scenario D)
 *   2. Whitelist check — find protected affiliate values (never touch these)
 *   3. Foreign affiliate detection (Scenario C) — skip whitelisted values
 *   4. Strip known tracking parameters (Scenario A)
 *   5. Strip blacklisted specific affiliates
 *   6. Inject our affiliate tag (Scenario B) — skip if blacklisted domain
 *
 * @param {string} rawUrl - The original URL to process.
 * @param {object} prefs  - User preferences from chrome.storage.sync.
 * @returns {{ cleanUrl: string, action: string, removedTracking: string[], junkRemoved: number, detectedAffiliate: object|null }}
 */
export function processUrl(rawUrl, prefs, domainRules = []) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  const hostname = url.hostname;
  const blacklist = prefs.blacklist || [];
  const whitelist = prefs.whitelist || [];

  // Use pre-parsed lists from the caller (service worker cache) when available
  const parsedBlacklist = prefs._parsedBlacklist || blacklist.map(parseListEntry);
  const parsedWhitelist = prefs._parsedWhitelist || whitelist.map(parseListEntry);

  // 0. Per-domain disable — user wants MUGA to do nothing on this domain
  const domainDisabled = parsedBlacklist.some(
    e => e.param === "disabled" && !e.value && domainMatches(hostname, e.domain)
  );
  if (domainDisabled) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  const originalPathname = url.pathname;
  url.pathname = cleanAmazonPath(hostname, url.pathname);
  const pathCleaned = url.pathname !== originalPathname;

  // 1. Scenario D — domain is fully blacklisted: strip everything, no injection
  const domainBlacklisted = parsedBlacklist.some(
    e => !e.param && domainMatches(hostname, e.domain)
  );
  if (domainBlacklisted) {
    // C10 — count params removed so junkRemoved is reported correctly
    const blacklistedParamCount = [...url.searchParams.keys()].length;
    url.search = "";
    return { cleanUrl: url.toString(), action: "blacklisted", removedTracking: [], junkRemoved: blacklistedParamCount + (pathCleaned ? 1 : 0), detectedAffiliate: null };
  }

  const patterns = getPatternsForHost(hostname);
  const removedTracking = [];
  let detectedAffiliate = null;
  let action = "untouched";

  // 2. Whitelist domain-only check: if the domain itself is whitelisted, skip all affiliate processing
  const domainWhitelisted = parsedWhitelist.some(
    e => !e.param && domainMatches(hostname, e.domain)
  );
  if (domainWhitelisted) {
    // Still strip tracking params, but leave all affiliate params untouched and skip injection
    // S4 — reuse `patterns` already computed above instead of calling getPatternsForHost again
    const affiliateParamNamesForSkip = patterns.map(p => p.param.toLowerCase());
    const customParamsForSkip = (prefs.customParams || []).map(p => p.toLowerCase());
    const { preserved: preservedParamsForSkip, domainStrip: domainStripForSkip } = getDomainParamSets(hostname, domainRules);
    const disabledCategoriesForSkip = new Set(prefs.disabledCategories || []);
    const disabledParamsForSkip = new Set();
    if (disabledCategoriesForSkip.size > 0) {
      for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
        if (disabledCategoriesForSkip.has(key)) {
          cat.params.forEach(p => disabledParamsForSkip.add(p.toLowerCase()));
        }
      }
    }
    const removedTrackingForSkip = [];
    for (const param of [...url.searchParams.keys()]) {
      const lower = param.toLowerCase();
      if (affiliateParamNamesForSkip.includes(lower)) continue;
      if (preservedParamsForSkip.has(lower)) continue;
      if (disabledParamsForSkip.has(lower)) continue;
      if (isTrackingParam(lower, customParamsForSkip, domainStripForSkip)) {
        url.searchParams.delete(param);
        removedTrackingForSkip.push(param);
      }
    }
    const actionForSkip = (removedTrackingForSkip.length > 0 || pathCleaned) ? "cleaned" : "untouched";
    return {
      cleanUrl: url.toString(),
      action: actionForSkip,
      removedTracking: removedTrackingForSkip,
      junkRemoved: removedTrackingForSkip.length + (pathCleaned ? 1 : 0),
      detectedAffiliate: null,
    };
  }

  // 2b. Collect whitelisted affiliate values for this host (never touch these)
  const whitelistedValues = new Set(
    parsedWhitelist
      .filter(e => domainMatches(hostname, e.domain) && e.param && e.value)
      .map(e => `${e.param}::${e.value}`)
  );

  // 3. Detect a foreign affiliate tag (skipped when stripAllAffiliates is on)
  if (!prefs.stripAllAffiliates && prefs.notifyForeignAffiliate) {
    for (const pattern of patterns) {
      if (pattern.ourTag) {
        const value = url.searchParams.get(pattern.param);
        if (value && value !== pattern.ourTag) {
          // Skip if this affiliate is whitelisted by the user
          if (!whitelistedValues.has(`${pattern.param}::${value}`)) {
            detectedAffiliate = { param: pattern.param, value, pattern };
            action = "detected_foreign";
            break;
          }
        }
      }
    }
  }

  // 4. Strip known tracking parameters (built-in + user-defined custom params)
  // Guard: never strip a param that is the affiliate identifier for this host.
  // e.g. `ref` is in TRACKING_PARAMS generically, but is also the affiliate param
  // for pccomponentes, mediamarkt_es, mediamarkt_de; `campid` is eBay's affiliate param.
  const affiliateParamNames = patterns.map(p => p.param.toLowerCase());
  const customParams = (prefs.customParams || []).map(p => p.toLowerCase());
  const { preserved: preservedParams, domainStrip } = getDomainParamSets(hostname, domainRules);

  // Build effective tracking params list: exclude params that belong to a disabled category
  const disabledCategories = new Set(prefs.disabledCategories || []);
  const disabledParams = new Set();
  if (disabledCategories.size > 0) {
    for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      if (disabledCategories.has(key)) {
        cat.params.forEach(p => disabledParams.add(p.toLowerCase()));
      }
    }
  }

  for (const param of [...url.searchParams.keys()]) {
    const lower = param.toLowerCase();
    // Don't strip params that are affiliate identifiers for this host
    if (affiliateParamNames.includes(lower)) continue;
    // Don't strip params that are functional on this domain (domain-rules compatibility)
    if (preservedParams.has(lower)) continue;
    // Don't strip params whose category has been disabled by the user
    if (disabledParams.has(lower)) continue;
    if (isTrackingParam(lower, customParams, domainStrip)) {
      url.searchParams.delete(param);
      removedTracking.push(param);
    }
  }
  if (pathCleaned && action === "untouched") action = "cleaned";
  if (removedTracking.length > 0 && action === "untouched") action = "cleaned";

  // 4b. Strip third-party affiliate params when user opted out of all affiliates.
  // When inject is also active, our own tag is preserved — only third-party tags removed.
  // Whitelist entries are respected — specific beats general.
  if (prefs.stripAllAffiliates) {
    for (const pattern of patterns) {
      const val = url.searchParams.get(pattern.param);
      if (val) {
        // Preserve our own tag when injection is active
        if (prefs.injectOwnAffiliate && pattern.ourTag && val === pattern.ourTag) continue;
        if (!whitelistedValues.has(`${pattern.param}::${val}`)) {
          url.searchParams.delete(pattern.param);
          if (action === "untouched") action = "cleaned";
        }
      }
    }
  }

  // 5. Strip specific blacklisted affiliate values
  let blacklistStripped = 0;
  // Track whether a blacklist rule removed an affiliate param — if so, injection must be suppressed.
  // Without this guard, a blacklisted third-party tag would be silently replaced by ourTag (#183).
  let blacklistRemovedAffiliate = false;
  for (const entry of parsedBlacklist) {
    if (entry.param && entry.value && domainMatches(hostname, entry.domain)) {
      const current = url.searchParams.get(entry.param);
      if (current === entry.value) {
        url.searchParams.delete(entry.param);
        blacklistStripped++;
        // If this param is an affiliate param for this host, flag injection suppression
        if (affiliateParamNames.includes(entry.param.toLowerCase())) {
          blacklistRemovedAffiliate = true;
        }
        // If this was the detected foreign affiliate, clear it — the toast must not fire
        // for a parameter we already removed via the blacklist.
        if (
          detectedAffiliate &&
          detectedAffiliate.param === entry.param &&
          detectedAffiliate.value === entry.value
        ) {
          detectedAffiliate = null;
          action = "cleaned";
        } else if (action === "untouched") {
          action = "cleaned";
        }
      }
    }
  }

  const junkRemoved = removedTracking.length + blacklistStripped + (pathCleaned ? 1 : 0);

  // 6. Inject our affiliate tag when the link has none (skip if foreign detected, stripAllAffiliates,
  //    or if a blacklist rule already removed an affiliate for this URL — blacklist takes priority (#183))
  if (prefs.injectOwnAffiliate && !prefs.stripAllAffiliates && action !== "detected_foreign" && !blacklistRemovedAffiliate) {
    for (const pattern of patterns) {
      if (pattern.ourTag && !url.searchParams.has(pattern.param)) {
        url.searchParams.set(pattern.param, pattern.ourTag);
        action = "injected";
        break;
      }
    }
  }

  return {
    cleanUrl: url.toString(),
    action,
    removedTracking,
    junkRemoved,
    detectedAffiliate,
  };
}
