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

// Bookshop.org affiliate attribution is path-based, not query-string-based.
// Two entry paths set the `override_affiliate` session cookie:
//   /a/{id}/...   creator referral (requires trailing slash to be valid)
//   /shop/{slug}  storefront (with or without trailing slash; terminal)
// Both flow through to product pages via the cookie. The cleaner detects
// either entry so it does NOT touch the path AND so the existing creator-
// referral wedge cue fires for users.
//
// Out-of-band escape hatch authorised by caps-spec#46 (deferred). The narrow
// shape is intentional: when a second path-based program lands as a real
// request, generalise this and reopen the RFC with N>1 data.
function isBookshopPathReferral(url) {
  if (url.hostname.replace(/^www\./, "") !== "bookshop.org") return false;
  return /^(?:\/a\/[^/]+\/|\/shop\/[^/]+\/?$)/.test(url.pathname);
}

// MUGA's Bookshop.org affiliate ID for injection on unattributed product
// pages. Lives next to the path-referral detector because both pieces share
// the same caps-spec#46 escape-hatch rationale. TODO: move into OUR_TAGS in
// affiliates.js once caps-spec adopts Bookshop as a direct-injection program.
const MUGA_BOOKSHOP_AFFILIATE_ID = "124046";

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
  // Step 1 — Unwrap + Honor + Canonical (steps 0a, 0, 0b)
  const unwrapStep = unwrapAndExtract(rawUrl, prefs, referrer, canonicalBundle);
  if (unwrapStep.kind === "done") return unwrapStep.payload;
  const { rawUrl: unwrappedRawUrl, url, creatorReferralPreserved } = unwrapStep;
  rawUrl = unwrappedRawUrl;

  const hostname = url.hostname;
  // Use pre-parsed lists from the caller (service worker cache) when available
  const parsedBlacklist = prefs._parsedBlacklist || (prefs.blacklist || []).map(parseListEntry);
  const parsedWhitelist = prefs._parsedWhitelist || (prefs.whitelist || []).map(parseListEntry);

  // OAuth / auth / payment flow exemption: never touch params on these paths.
  const AUTH_PATH_RE = /\/(oauth|oauth2|authorize|callback|auth|signin|login|sso|saml|checkout|payment|pay)(\/|$)/;
  if (AUTH_PATH_RE.test(url.pathname.toLowerCase())) {
    return buildReturnPayload("untouched", rawUrl, [], null, { creatorReferralPreserved });
  }

  // Per-domain disable: user wants MUGA to do nothing on this domain
  if (parsedBlacklist.some(e => e.param === "disabled" && !e.value && domainMatches(hostname, e.domain))) {
    return buildReturnPayload("untouched", rawUrl, [], null, { creatorReferralPreserved });
  }

  const originalPathname = url.pathname;
  url.pathname = cleanAmazonPath(hostname, url.pathname);
  const pathCleaned = url.pathname !== originalPathname;

  // Scenario D: domain is fully blacklisted — strip everything, no injection
  if (parsedBlacklist.some(e => !e.param && domainMatches(hostname, e.domain))) {
    const blacklistedParamCount = [...url.searchParams.keys()].length;  // C10: count before wipe
    url.search = "";
    return buildReturnPayload("blacklisted", url, [], null, {
      junkRemoved: blacklistedParamCount + (pathCleaned ? 1 : 0),
      creatorReferralPreserved,
    });
  }

  const patterns = getPatternsForHost(hostname);

  // 2. Whitelist domain-only check: if the domain itself is whitelisted, skip all affiliate processing
  if (parsedWhitelist.some(e => !e.param && domainMatches(hostname, e.domain))) {
    const { payload, removed, removedValues } = handleWhitelistedDomain(
      url, prefs, domainRules, patterns, hostname, pathCleaned, creatorReferralPreserved,
    );
    recordFrequency(frequencyTracker, prefs, hostname, removed, removedValues);
    return payload;
  }

  // Step 5 — Tracking strip (Scenario A core)
  const { removed: removedTracking, removedValues: removedTrackingValues } =
    classifyAndStripTracking(url, prefs, domainRules);

  // Step 6 — Affiliate pipeline (Scenarios B + C + blacklist-value strip)
  const { action: pipeAction, detectedAffiliate, blacklistStripped } =
    handleAffiliatePipeline(url, prefs, patterns, parsedBlacklist, parsedWhitelist, hostname);

  // Step 7 — Action resolution + Bookshop injection + recordFrequency + final payload
  let action = pipeAction;
  if (action === "untouched" && (pathCleaned || removedTracking.length > 0)) action = "cleaned";

  // 6b. Bookshop.org MUGA-affiliate injection. Bookshop is not in
  // AFFILIATE_PATTERNS (caps-spec#46 deferred), so the pipeline above never
  // fires for it. Needs creatorReferralPreserved from unwrapAndExtract.
  if (
    prefs.injectOwnAffiliate &&
    !prefs.stripAllAffiliates &&
    action !== "detected_foreign" &&
    hostname.replace(/^www\./, "") === "bookshop.org" &&
    !creatorReferralPreserved &&
    url.pathname.startsWith("/p/") &&
    !url.searchParams.has("affiliate")
  ) {
    url.searchParams.set("affiliate", MUGA_BOOKSHOP_AFFILIATE_ID);
    action = "injected";
  }

  recordFrequency(frequencyTracker, prefs, hostname, removedTracking, removedTrackingValues);

  return buildReturnPayload(action, url, removedTracking, detectedAffiliate, {
    junkRemoved: removedTracking.length + blacklistStripped + (pathCleaned ? 1 : 0),
    preservedAffiliate: detectPreservedAffiliate(url, patterns),
    creatorReferralPreserved,
  });
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

// ── unwrapAndExtract ──────────────────────────────────────────────────────────

/**
 * Steps 0a + 0 + 0b: Honor Creator check, then unwrap, then canonical
 * fallback for opaque wrappers. Returns a discriminated union.
 *
 * Malformed-input contract: if `prefs` is undefined, this function MUST
 * crash at `prefs.canonicalExtractorEnabled` access. DO NOT add prefs ?? {}
 * defaulting. The 1-arg dom-link-rewriter*.js callers depend on the throw
 * to fall back to inlineCleanUrl.
 *
 * @param {string} rawUrl
 * @param {object} prefs
 * @param {string|null|undefined} referrer
 * @param {{linkCanonical?: string|null, jsonLdId?: string|null}|undefined} canonicalBundle
 * @returns {
 *     { kind: "continue", rawUrl: string, url: URL, creatorReferralPreserved: boolean }
 *   | { kind: "done", payload: object }
 * }
 */
function unwrapAndExtract(rawUrl, prefs, referrer, canonicalBundle) {
  // Step 1: parse initial URL
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "done", payload: buildReturnPayload("untouched", rawUrl, [], null, {}) };
  }

  // Step 2: protocol guard
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "done", payload: buildReturnPayload("untouched", rawUrl, [], null, {}) };
  }

  // Step 3: Honor Creator Mode (#452, B14)
  const honor = shouldHonor({ url: rawUrl, referrer, prefs });
  if (honor.honor) {
    return {
      kind: "done",
      payload: buildReturnPayload("honored-creator", rawUrl, [], null, {
        network: honor.network,
        creator: honor.creator,
      }),
    };
  }

  // Step 4: unwrap recognized redirect wrappers (Awin etc.)
  const unwrapResult = unwrap(rawUrl);
  if (unwrapResult) {
    rawUrl = unwrapResult.unwrapped;
    try {
      url = new URL(rawUrl);
    } catch {
      return { kind: "done", payload: buildReturnPayload("untouched", rawUrl, [], null, {}) };
    }
  } else if (
    // Step 5: Canonical Extractor tier (#442, B7) — gated on prefs access.
    // NOTE: prefs.canonicalExtractorEnabled is the FIRST prefs access here,
    // matching the malformed-input crash boundary for 1-arg callers (FR-7).
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
        return { kind: "done", payload: buildReturnPayload("untouched", rawUrl, [], null, {}) };
      }
    }
  }

  // Step 6: Bookshop.org path-based creator-referral detection. Computed once
  // post-unwrap so wrapper redirects that land on bookshop are covered.
  const creatorReferralPreserved = isBookshopPathReferral(url);

  return { kind: "continue", rawUrl, url, creatorReferralPreserved };
}

// ── handleAffiliatePipeline ───────────────────────────────────────────────────

/**
 * Steps 3 + 4b + 5 + 6 + 6b: foreign-affiliate detection, stripAllAffiliates,
 * blacklist-value strip, own-affiliate injection (incl. Bookshop).
 *
 * Mutates url.searchParams in place. Does NOT call recordFrequency.
 * The frequencyTracker is intentionally excluded — orchestrator owns both
 * recordFrequency call sites (design §6 Risk #1 mitigation).
 *
 * @param {URL} url
 * @param {object} prefs
 * @param {Array} patterns        Affiliate patterns for this hostname
 * @param {Array} parsedBlacklist
 * @param {Array} parsedWhitelist
 * @param {string} hostname
 * @returns {{ action: string, detectedAffiliate: object|null, blacklistStripped: number }}
 */
function handleAffiliatePipeline(url, prefs, patterns, parsedBlacklist, parsedWhitelist, hostname) {
  // Build isWhitelisted closure for this host
  const whitelistedValues = new Set();
  const whitelistedParams = new Set();
  for (const e of parsedWhitelist) {
    if (!domainMatches(hostname, e.domain) || !e.param || !e.value) continue;
    if (e.value === "*") whitelistedParams.add(e.param);
    else whitelistedValues.add(`${e.param}::${e.value}`);
  }
  const isWhitelisted = (param, value) =>
    whitelistedParams.has(param) || whitelistedValues.has(`${param}::${value}`);

  let detectedAffiliate = null;
  let action = "untouched";

  // Step 3: Detect a foreign affiliate tag (skipped when stripAllAffiliates is on)
  // #523 phase 3: detection no longer gates on ourTag.
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

  // Step 4b: Strip third-party affiliate params (stripAllAffiliates path)
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

  // Step 5: Strip specific blacklisted affiliate values
  let blacklistStripped = 0;
  // Track whether a blacklist rule removed an affiliate param (injection suppression, #183).
  // INTERNAL — does NOT cross the function boundary.
  let blacklistRemovedAffiliate = false;
  const affiliateParamSet = new Set(patterns.map(p => p.param.toLowerCase()));
  for (const entry of parsedBlacklist) {
    if (entry.param && entry.value && domainMatches(hostname, entry.domain)) {
      const current = url.searchParams.get(entry.param);
      if (current === null) continue;
      const isWildcard = entry.value === "*";
      const matches = isWildcard || current === entry.value;
      if (!matches) continue;
      // Whitelist always wins over blacklist (#301).
      if (isWhitelisted(entry.param, current)) continue;
      url.searchParams.delete(entry.param);
      blacklistStripped++;
      if (affiliateParamSet.has(entry.param.toLowerCase())) {
        blacklistRemovedAffiliate = true;
      }
      // If this was the detected foreign affiliate, clear it.
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

  // Step 6: Inject own affiliate tag (generic — AFFILIATE_PATTERNS)
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

  // Step 6b: Bookshop.org MUGA-affiliate injection (#caps-spec#46).
  // Bookshop is not in AFFILIATE_PATTERNS so step 6 above never fires for it.
  // NOTE: creatorReferralPreserved is NOT a parameter here — the orchestrator
  // has it from unwrapAndExtract and passes it to buildReturnPayload directly.
  // We access it via closure: it's NOT available here. This means the Bookshop
  // injection must stay in the ORCHESTRATOR (after pipeline returns), not here.
  // Design §3 skeleton shows Bookshop injection AFTER handleAffiliatePipeline call.

  return { action, detectedAffiliate, blacklistStripped };
}

// ── handleWhitelistedDomain ───────────────────────────────────────────────────

/**
 * Whitelist-domain early-return path: strip tracking params while leaving
 * all affiliate params untouched and skipping injection (FR-3).
 *
 * Does NOT call recordFrequency — orchestrator fires Site A after this returns.
 *
 * @param {URL} url           Mutable URL object
 * @param {object} prefs
 * @param {Array} domainRules
 * @param {Array} patterns    Affiliate patterns for this hostname
 * @param {string} hostname
 * @param {boolean} pathCleaned  Whether Amazon path cleaning fired
 * @param {boolean} creatorReferralPreserved
 * @returns {{ payload: object, removed: string[], removedValues: string[] }}
 */
function handleWhitelistedDomain(url, prefs, domainRules, patterns, hostname, pathCleaned, creatorReferralPreserved) {
  const disabledCategoriesForSkip = new Set(prefs.disabledCategories || []);
  // Bounded-scope classifier (#530): even on whitelisted domains, ambiguous
  // params co-occurring with anchor trackers should be stripped. Affiliate
  // params are independently protected by affiliateParamSet inside stripTrackingParams.
  const wlAffiliateParamSet = new Set(patterns.map(p => p.param.toLowerCase()));
  const wlClassification = classifyParams(url.toString(), {
    ...prefs,
    _affiliateParamSet: wlAffiliateParamSet,
  });
  const {
    removed,
    removedValues,
  } = stripTrackingParams(url, prefs, domainRules, disabledCategoriesForSkip, new Set(wlClassification.stripParams));
  const actionForSkip = (removed.length > 0 || pathCleaned) ? "cleaned" : "untouched";
  const payload = buildReturnPayload(actionForSkip, url, removed, null, {
    junkRemoved: removed.length + (pathCleaned ? 1 : 0),
    preservedAffiliate: detectPreservedAffiliate(url, patterns),
    creatorReferralPreserved,
  });
  return { payload, removed, removedValues };
}

// ── classifyAndStripTracking ──────────────────────────────────────────────────

/**
 * Step 4: bounded-scope classifier + stripTrackingParams (with AliExpress
 * special path for item pages where ALL non-preserved params are stripped).
 *
 * Mutates url.searchParams in place. Does NOT call recordFrequency.
 *
 * @param {URL} url
 * @param {object} prefs
 * @param {Array} domainRules
 * @returns {{ removed: string[], removedValues: string[] }}
 */
function classifyAndStripTracking(url, prefs, domainRules) {
  const hostname = url.hostname;
  const removed = [];
  const removedValues = [];

  if (isAliExpressItemPage(hostname, url.pathname)) {
    // AliExpress item pages: strip ALL params except domain-rules preserveParams.
    const { preserved } = getDomainParamSets(hostname, domainRules);
    for (const param of [...url.searchParams.keys()]) {
      if (preserved.has(param.toLowerCase())) continue;
      removedValues.push(url.searchParams.get(param) ?? "");
      url.searchParams.delete(param);
      removed.push(param);
    }
  } else {
    // Standard path: bounded-scope classifier (#530) + stripTrackingParams.
    const patterns = getPatternsForHost(hostname);
    const affiliateParamSet = new Set(patterns.map(p => p.param.toLowerCase()));
    const disabledCategories = new Set(prefs.disabledCategories || []);
    // CAPS-Contextual short-circuit (#543): skip bounded-scope rule when URL
    // is still a known wrapper host (destination was unextractable).
    const isNetworkRedirect = !!detectWrapper(url.toString());
    const classification = classifyParams(url.toString(), {
      ...prefs,
      _affiliateParamSet: affiliateParamSet,
      _skipBoundedScope: isNetworkRedirect,
    });
    const { removed: r, removedValues: rv } = stripTrackingParams(
      url,
      prefs,
      domainRules,
      disabledCategories,
      new Set(classification.stripParams),
    );
    removed.push(...r);
    removedValues.push(...rv);
  }

  return { removed, removedValues };
}

// ── buildReturnPayload ────────────────────────────────────────────────────────

/**
 * Factory for all 6 processUrl return shapes (S1–S6, spec §3).
 *
 * Accepts an `extras` bag for fields that differ across shapes:
 *   junkRemoved             — defaults to 0
 *   creatorReferralPreserved — defaults to false
 *   preservedAffiliate      — defaults to null
 *   network                 — included ONLY when present in extras (S3 only)
 *   creator                 — included ONLY when present in extras (S3 only)
 *
 * @param {"untouched"|"cleaned"|"injected"|"detected_foreign"|"blacklisted"|"honored-creator"} action
 * @param {string|URL} rawUrlOrUrl  String → used as cleanUrl directly; URL → .toString()
 * @param {string[]} removedTracking
 * @param {object|null} detectedAffiliate
 * @param {{ junkRemoved?: number, creatorReferralPreserved?: boolean, preservedAffiliate?: object|null, network?: string, creator?: string }} [extras]
 * @returns {object}
 */
function buildReturnPayload(action, rawUrlOrUrl, removedTracking, detectedAffiliate, extras = {}) {
  const cleanUrl = (rawUrlOrUrl instanceof URL) ? rawUrlOrUrl.toString() : rawUrlOrUrl;
  const payload = {
    cleanUrl,
    action,
    removedTracking,
    junkRemoved: extras.junkRemoved ?? 0,
    detectedAffiliate,
    preservedAffiliate: extras.preservedAffiliate ?? null,
    creatorReferralPreserved: extras.creatorReferralPreserved ?? false,
  };
  // network and creator are present ONLY on the honored-creator shape (S3).
  // Omitting them entirely (not undefined-keyed) matches today's literal returns.
  if ("network" in extras) payload.network = extras.network;
  if ("creator" in extras) payload.creator = extras.creator;
  return payload;
}

// ── Test-only namespace export ────────────────────────────────────────────────
// Private helpers are not part of the public cleaner API. They are exposed
// here under a single namespace so unit tests can import them directly for
// strict TDD (RED → GREEN → REFACTOR) without polluting the module's public
// surface. Bundle-sync tests must allowlist this key.

export const __test__ = { buildReturnPayload, classifyAndStripTracking, unwrapAndExtract, handleWhitelistedDomain, handleAffiliatePipeline };
