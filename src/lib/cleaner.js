/**
 * MUGA — Core URL processing logic
 * Exported as a module for use in the service worker.
 */

import { TRACKING_PARAMS, getPatternsForHost } from "./affiliates.js";

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
export function processUrl(rawUrl, prefs) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], detectedAffiliate: null };
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
    url.search = "";
    return { cleanUrl: url.toString(), action: "blacklisted", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  const patterns = getPatternsForHost(hostname);
  const removedTracking = [];
  let detectedAffiliate = null;
  let action = "untouched";

  // 2. Collect whitelisted affiliate values for this host (never touch these)
  const whitelistedValues = new Set(
    parsedWhitelist
      .filter(e => domainMatches(hostname, e.domain) && e.param && e.value)
      .map(e => `${e.param}::${e.value}`)
  );

  // 3. Detect a foreign affiliate tag (skipped when stripAllAffiliates is on)
  if (!prefs.stripAllAffiliates && (prefs.notifyForeignAffiliate || prefs.allowReplaceAffiliate)) {
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
  for (const param of [...url.searchParams.keys()]) {
    const lower = param.toLowerCase();
    // Don't strip params that are affiliate identifiers for this host
    if (affiliateParamNames.includes(lower)) continue;
    if (TRACKING_PARAMS.includes(lower) || customParams.includes(lower)) {
      url.searchParams.delete(param);
      removedTracking.push(param);
    }
  }
  if (pathCleaned && action === "untouched") action = "cleaned";
  if (removedTracking.length > 0 && action === "untouched") action = "cleaned";

  // 4b. Strip all affiliate params when user opted out of all affiliates
  // Whitelist entries are respected — specific beats general.
  if (prefs.stripAllAffiliates) {
    for (const pattern of patterns) {
      const val = url.searchParams.get(pattern.param);
      if (val && !whitelistedValues.has(`${pattern.param}::${val}`)) {
        url.searchParams.delete(pattern.param);
        if (action === "untouched") action = "cleaned";
      }
    }
  }

  // 5. Strip specific blacklisted affiliate values
  let blacklistStripped = 0;
  for (const entry of parsedBlacklist) {
    if (entry.param && entry.value && domainMatches(hostname, entry.domain)) {
      const current = url.searchParams.get(entry.param);
      if (current === entry.value) {
        url.searchParams.delete(entry.param);
        blacklistStripped++;
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

  // 6. Inject our affiliate tag when the link has none (skip if foreign detected or stripAllAffiliates)
  if (prefs.injectOwnAffiliate && !prefs.stripAllAffiliates && action !== "detected_foreign") {
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
