/**
 * MUGA: Core URL processing logic
 * Exported as a module for use in the service worker.
 */

import {
  TRACKING_PARAMS,
  TRACKING_PARAM_CATEGORIES,
  TRACKING_PREFIXES,
  getPatternsForHost,
  getAffiliateParamSetForHost,
  getRedirectNetworkForRedirectHost,
  getLandingParamsForHost,
  detectAutoInjectedTag,
  stripAutoInjectedTag,
} from "./affiliates.js";
import { unwrap, detectWrapper } from "./wrapper-engine.js";
import { isAffiliateRedirectNetwork } from "./opaque-networks.js";
import { extractCanonical } from "./canonical-extractor.js";
import { shouldHonor } from "./honor-creator.js";
import { classify as classifyParams } from "./param-classifier.js";
import { applyPathStrip, getPathAffiliatePolicy } from "./path-rules.js";

// C5: O(1) lookup instead of O(n) array scan
const TRACKING_PARAMS_SET = new Set(TRACKING_PARAMS.map(p => p.toLowerCase()));

const EMPTY_LANDING_POLICY = Object.freeze({
  preserve: Object.freeze(new Set()),
  network: null,
});

/**
 * Per-landing param-preservation policy (#656, P3.1 of the 2.1 denoise pivot).
 *
 * When `document.referrer` matches a redirect-network host declared in
 * `REDIRECT_NETWORK_PATTERNS` (the matrix v1.0 contract — see
 * docs/affiliate-networks-matrix.md), this is a first-touch landing: the
 * merchant's tag has not yet read its attribution params from the URL.
 * The returned `preserve` Set instructs `stripTrackingParams` to skip those
 * params on this document so the merchant's first-party cookie can be
 * populated before the cleaner runs.
 *
 * For any other referrer (none, same-origin, unknown external), the policy
 * is empty — `stripTrackingParams` behaves exactly as before. Active
 * stripping of matrix-required params on subsequent same-site navigations
 * ("eligible for cleanup" per the matrix's cross-cutting policy #2) is
 * intentionally OUT of this slice. The matrix biases toward preservation
 * when in doubt, and a future issue can revisit once the synthetic harness
 * has end-to-end coverage of the first-touch → second-nav flow.
 *
 * @param {string|null|undefined} hostname
 *   Landing URL's hostname. Used to detect same-origin navigation (which
 *   returns the empty policy) so the cleaner does not double-preserve on
 *   internal navigations within the merchant.
 * @param {string|null|undefined} referrer
 *   `document.referrer` value. May be a full URL string (typical), a bare
 *   hostname, an empty string (direct nav / privacy referrer policy), or
 *   nullish (background-worker contexts without DOM access).
 * @returns {{ preserve: Set<string>, network: string|null }}
 *   `preserve` is the lowercase param Set to skip during strip; `network`
 *   is the matched network id (`"awin"`, `"cj-affiliate"`, …) or null when
 *   no first-touch context was detected.
 */
export function getLandingPolicy(hostname, referrer) {
  if (!referrer) return EMPTY_LANDING_POLICY;

  let refHost;
  try {
    refHost = new URL(referrer).hostname;
  } catch {
    refHost = String(referrer);
  }
  if (!refHost) return EMPTY_LANDING_POLICY;

  // Strip www. from both sides before comparing so that www.merchant.com ↔
  // merchant.com navigations are treated as same-origin (mirrors the
  // normalization in affiliates.js:getRedirectNetworkForRedirectHost #831).
  if (hostname &&
      refHost.toLowerCase().replace(/^www\./, "") ===
      String(hostname).toLowerCase().replace(/^www\./, "")) {
    return EMPTY_LANDING_POLICY;
  }

  const network = getRedirectNetworkForRedirectHost(refHost);
  if (!network) return EMPTY_LANDING_POLICY;

  return {
    preserve: new Set(network.landingParams.map(p => p.toLowerCase())),
    network: network.id,
  };
}


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
    // Lowercase the param KEY: tracker param names are lowercase in practice and
    // the match sites compare it directly, so a mixed-case entry (e.g. "Tag")
    // otherwise silently never matched a real "tag" query param (audit #1048).
    // The VALUE stays case-sensitive (affiliate tag values are matched verbatim).
    param:  parts[1]?.trim().toLowerCase() || null,
    value:  parts[2]?.trim() || null,
  };
}

/**
 * Strips a single trailing dot from a hostname (#1095).
 *
 * `amazon.com.` is a valid FQDN — the trailing dot denotes the DNS root —
 * and browsers/resolvers treat it as IDENTICAL to `amazon.com`. Every
 * host-matching helper in this module already strips a leading `www.`
 * before comparing; without the same treatment for a trailing dot, a page
 * on `www.amazon.com.` bypassed affiliate-pattern lookup entirely
 * (`getPatternsForHost` found zero patterns, so stripAllAffiliates left a
 * foreign tag completely untouched) and slipped past domain-only
 * whitelist/blacklist/pause-by-site entries for `amazon.com`.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function stripTrailingDot(hostname) {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/**
 * Returns true if a host matches a parsed list entry's domain.
 */
export function domainMatches(hostname, entryDomain) {
  const host = stripTrailingDot(hostname).replace(/^www\./, "");
  return host === entryDomain || host.endsWith("." + entryDomain);
}

/**
 * Returns true if a hostname is FULLY EXEMPT from MUGA - the single
 * choke-point predicate that governs every cleaning mechanism, present and
 * future (#allowlist-full-inert). Originally added as
 * isSiteExemptFromActiveDefense (#1006) to cover only the four active-defense
 * content scripts (window.name defuser, history defuser, DOM link rewriter,
 * click rewriter), all of which gate on a single muga:history-gate event.
 * Renamed and promoted to the general-purpose exemption check consulted by
 * processUrl (JS cleaning, #allowlist-full-inert) and by the service worker's
 * DNR allow-rule sync (network-layer cleaning) - so "domain is allowlisted"
 * now means MUGA has literally no effect on that domain through ANY path,
 * not a per-mechanism opt-out that has to be re-added every time a new
 * mechanism ships.
 *
 * A site counts as exempt when a DOMAIN-ONLY whitelist entry matches the
 * host (bare "example.com"). A param-scoped entry ("example.com::tag::x")
 * does NOT count - that only protects one affiliate value, it is not a
 * "leave this site alone" signal. (The legacy `example.com::disabled`
 * per-site-pause blacklist syntax was removed entirely - a domain is
 * exempted ONLY via a domain-only whitelist entry now.)
 *
 * Reuses parseListEntry/domainMatches rather than reimplementing domain
 * matching (a separate cleanup is tracked in #1005).
 *
 * Defensive: returns false for any falsy or malformed input so a missing or
 * corrupt prefs object never accidentally grants an exemption. Fail-safe
 * direction matters here: MUGA must stay ACTIVE unless we are sure the user
 * opted the site out - a bug in this predicate must never globally disable
 * cleaning.
 *
 * @param {string} hostname - the current page's hostname.
 * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
 * @returns {boolean}
 */
export function isSiteFullyExempt(hostname, prefs) {
  if (!hostname || typeof hostname !== "string" || !prefs || typeof prefs !== "object") return false;

  const whitelist = Array.isArray(prefs.whitelist) ? prefs.whitelist : [];
  for (const raw of whitelist) {
    let entry;
    try {
      entry = parseListEntry(raw);
    } catch {
      continue;
    }
    if (!entry.domain || entry.param) continue;
    if (domainMatches(hostname, entry.domain)) return true;
  }

  return false;
}

/**
 * Returns the deduped list of bare domains (www-stripped, lowercased) that
 * are fully exempt from MUGA - i.e. the same domain-only-whitelist signal
 * isSiteFullyExempt() tests against a single hostname, but exposed here as
 * the raw domain list (#allowlist-full-inert).
 *
 * Used by the service worker to build one DNR dynamic "allow" rule per
 * exempt domain (src/background/service-worker.js#syncAllowlistDNR): DNR
 * conditions match a `requestDomains` list, not a predicate function, so the
 * network-layer sync needs the domain list rather than a hostname-in/
 * boolean-out check. Reuses parseListEntry - no domain-matching logic is
 * duplicated (the DNR requestDomains match already covers subdomains on
 * Chrome's side, mirroring what domainMatches() does for the in-JS check).
 *
 * Defensive: returns [] for any falsy or malformed prefs, matching
 * isSiteFullyExempt's fail-safe direction (no domains -> no allow rules ->
 * cleaning stays active everywhere).
 *
 * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
 * @returns {string[]}
 */
export function getFullyExemptDomains(prefs) {
  if (!prefs || typeof prefs !== "object") return [];

  const domains = new Set();

  const whitelist = Array.isArray(prefs.whitelist) ? prefs.whitelist : [];
  for (const raw of whitelist) {
    let entry;
    try {
      entry = parseListEntry(raw);
    } catch {
      continue;
    }
    if (!entry.domain || entry.param) continue;
    domains.add(entry.domain);
  }

  return [...domains];
}

/**
 * Returns true if hostname matches a DOMAIN-ONLY whitelist entry (bare
 * "example.com", no ::param suffix) - i.e. the user fully allowlisted this
 * site, whether via Settings > Allowlist or the popup's per-site pause
 * control (#1053). Mirrors the domain-only-whitelist half of
 * isSiteFullyExempt() but scoped to just the whitelist array, so callers
 * that already have `prefs.whitelist` in hand don't need to build a fake
 * prefs object just to ask this one question.
 *
 * A param-scoped entry ("example.com::tag::x") does NOT count - that only
 * protects one affiliate value, it is not a "leave this site alone" signal.
 *
 * Defensive: returns false for any falsy or malformed input, matching
 * isSiteFullyExempt's fail-safe direction (missing/corrupt data must never
 * be misread as an exemption).
 *
 * @param {string} hostname
 * @param {string[]} whitelist
 * @returns {boolean}
 */
export function isDomainAllowlisted(hostname, whitelist) {
  if (!hostname || typeof hostname !== "string" || !Array.isArray(whitelist)) return false;
  for (const raw of whitelist) {
    let entry;
    try {
      entry = parseListEntry(raw);
    } catch {
      continue;
    }
    if (!entry.domain || entry.param) continue;
    if (domainMatches(hostname, entry.domain)) return true;
  }
  return false;
}

/**
 * Adds or removes a bare domain-only whitelist entry for a host, returning a
 * NEW whitelist array (pure; never mutates the input).
 *
 * This is the popup per-site "Pause" control's write path (#1053): pausing a
 * site now means fully allowlisting its domain - the same mechanism
 * Settings > Allowlist uses - instead of the separate `<host>::disabled`
 * blacklist entry it used to write. That keeps a single source of truth: a
 * paused site shows up in the Settings allowlist, and a manually-whitelisted
 * site correctly shows as paused in the popup. The legacy
 * `example.com::disabled` blacklist syntax (shipped since v1.13.0) has been
 * removed entirely - a domain is exempted ONLY via a domain-only whitelist
 * entry now (see isSiteFullyExempt).
 *
 * Adding appends `<host>` (www-stripped, lowercased) unless the host is
 * already allowlisted (exact or parent-domain match). Removing drops every
 * DOMAIN-ONLY entry that allowlists this host but PRESERVES param-scoped
 * entries (`example.com::tag::x`) - those protect a single affiliate value,
 * not a "leave this site alone" signal, so toggling pause off must not
 * silently delete them.
 *
 * @param {string[]} whitelist - current whitelist entries.
 * @param {string} hostname - the current tab hostname.
 * @param {boolean} allowed - true to allowlist (pause), false to remove (resume).
 * @returns {string[]} a new whitelist array.
 */
export function setDomainAllowlisted(whitelist, hostname, allowed) {
  const list = Array.isArray(whitelist) ? whitelist.slice() : [];
  const host = (hostname || "").trim();
  if (!host) return list;
  const isDomainOnlyMatch = (raw) => {
    let e;
    try {
      e = parseListEntry(raw);
    } catch {
      return false;
    }
    return !!e.domain && !e.param && domainMatches(host, e.domain);
  };
  if (allowed) {
    if (list.some(isDomainOnlyMatch)) return list;
    return [...list, host.replace(/^www\./, "").toLowerCase()];
  }
  return list.filter((raw) => !isDomainOnlyMatch(raw));
}

/**
 * Per-array index of `domainRules` keyed by `rule.domain`. The cleaner is
 * called once per page navigation but `domainRules` is loaded ONCE in the
 * service worker and reused across every call — so we build a `Map(domain →
 * rule)` lazily, the first time we see an array, and reuse it for every
 * subsequent call with the same array reference (#629 win 1). WeakMap so the
 * index is GC'd if the SW rebuilds the rules.
 */
const _domainRulesIndex = new WeakMap();

function _ensureDomainIndex(domainRules) {
  if (!Array.isArray(domainRules) || domainRules.length === 0) return null;
  let idx = _domainRulesIndex.get(domainRules);
  if (idx) return idx;
  idx = new Map();
  for (const rule of domainRules) {
    if (!rule || typeof rule.domain !== "string") continue;
    // Last writer wins on identical keys — matches the linear-iteration
    // semantics of the pre-#629 loop (which OR'd every match anyway).
    idx.set(rule.domain, rule);
  }
  _domainRulesIndex.set(domainRules, idx);
  return idx;
}

/**
 * Builds the set of params that must NOT be stripped and the set of
 * domain-specific params that MUST be stripped on the given hostname.
 *
 * Matching is subdomain-aware: "www.google.com" matches rule for "google.com".
 *
 * #629 win 1: lookup is O(suffix-count) — at most ~3-4 probes per call instead
 * of linear scan over the entire domainRules array (~167 entries in production).
 *
 * @param {string} hostname
 * @param {Array}  domainRules  - Array of { domain, preserveParams[], stripParams[]? } objects
 * @returns {{ preserved: Set<string>, domainStrip: Set<string> }}
 */
export function getDomainParamSets(hostname, domainRules = []) {
  const preserved = new Set();
  const domainStrip = new Set();
  const idx = _ensureDomainIndex(domainRules);
  if (!idx) return { preserved, domainStrip };

  // Generate suffix candidates: for "a.b.c.com" probe a.b.c.com, b.c.com, c.com, com.
  // Bounded by the dot count, which is small in practice (≤ 5 for real hosts).
  const candidates = [];
  candidates.push(hostname);
  let rest = hostname;
  while (true) {
    const dot = rest.indexOf(".");
    if (dot < 0) break;
    rest = rest.slice(dot + 1);
    if (!rest) break;
    candidates.push(rest);
  }
  for (const candidate of candidates) {
    const rule = idx.get(candidate);
    if (!rule) continue;
    (rule.preserveParams || []).forEach((p) => preserved.add(p.toLowerCase()));
    (rule.stripParams || []).forEach((p) => domainStrip.add(p.toLowerCase()));
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
 * Finds the actual query-string key present in `url.searchParams` that
 * matches `paramName` case-insensitively (#1093). Affiliate param names in
 * AFFILIATE_PATTERNS / blacklist / whitelist entries are always compared in
 * their canonical lowercase form (e.g. "tag"), but real-world URLs are not
 * guaranteed to use that exact casing — `?TAG=creator-21` is a valid query
 * string and browsers pass it through unchanged. Without this lookup,
 * `searchParams.get(pattern.param)` / `.has(pattern.param)` silently miss an
 * uppercase-keyed tag, which let MUGA inject its OWN tag under the canonical
 * lowercase key ALONGSIDE an existing uppercase-keyed creator tag — two
 * "tag" params stacked on the same URL, a non-superposition violation — and
 * let blacklist/whitelist entries fail to match an uppercase param name.
 *
 * Returns the FIRST matching key exactly as it appears in the URL (its
 * original casing is preserved — this function only widens the SEARCH, it
 * never rewrites the stored key), or null when no key matches.
 *
 * Firefox Xray safety (see stripTrackingParams): searchParams key iterators
 * are not iterable in content-script sandboxes; forEach is a plain callback,
 * unaffected. (#1009)
 *
 * @param {URL} url
 * @param {string} paramName
 * @returns {string|null}
 */
function findParamKeyCI(url, paramName) {
  const lower = paramName.toLowerCase();
  let found = null;
  url.searchParams.forEach((_v, k) => {
    if (found === null && k.toLowerCase() === lower) found = k;
  });
  return found;
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
 * #1093: looks up the param key case-insensitively so an uppercase-keyed tag
 * (?TAG=creator-21) is recognized the same as the canonical lowercase form.
 *
 * @param {URL}   url
 * @param {Array} patterns - Affiliate patterns scoped to the hostname.
 * @returns {{param:string,value:string,store:string,group:string}|null}
 */
function detectPreservedAffiliate(url, patterns) {
  // #1111: normalize a trailing-dot FQDN (amazon.com.) before host matching,
  // consistent with domainMatches()/processUrl — otherwise our own injected tag
  // on a trailing-dot host would not be recognized and would be mis-reported.
  const normalizedHost = stripTrailingDot(url.hostname);
  const host = normalizedHost.replace(/^www\./, "");
  for (const pattern of patterns) {
    const actualKey = findParamKeyCI(url, pattern.param);
    if (!actualKey) continue;
    const ourTagForHost = pattern.ourTag[host] || pattern.ourTag[normalizedHost] || "";
    // #1111 pt.3: scan every occurrence — a foreign creator tag hiding behind
    // our own in a duplicate (?tag=ours&tag=foreign) is still preserved in the
    // URL and must be reported (feeds the popup + attribution ledger), not
    // masked by our own tag being the FIRST occurrence get() returned.
    for (const value of url.searchParams.getAll(actualKey)) {
      if (!value) continue;
      if (ourTagForHost && value === ourTagForHost) continue; // our own injection, skip
      return {
        param: pattern.param,
        value,
        store: pattern.name,
        group: pattern.group || pattern.name,
      };
    }
  }
  return null;
}

/**
 * Returns true if this is an AliExpress product/item page where ALL query
 * params are tracking noise. Item pages load correctly with zero params.
 * Search and category pages (preserveParams in domain-rules) are excluded.
 */
function isAliExpressItemPage(hostname, pathname) {
  // Mirror domainMatches() for the host check: the previous unanchored regex
  // /aliexpress\.[a-z.]+$/ matched as a substring, so lookalikes like
  // myaliexpress.com, notaliexpress.com, and aliexpress.com.attacker.net all
  // passed — triggering the wholesale param strip on unrelated domains.
  const host = hostname.replace(/^www\./, "");
  if (host !== "aliexpress.com" && !host.endsWith(".aliexpress.com")) return false;
  return /^\/item\/\d+\.html?\/?$/i.test(pathname);
}

// Path-based affiliate attribution (e.g. Bookshop.org) is now handled
// declaratively via src/rules/path-affiliate-rules.json and
// src/lib/path-rules.js#getPathAffiliatePolicy. Path-strip rules (e.g.
// Amazon slug/ref removal) are in src/rules/path-strip-rules.json via
// src/lib/path-rules.js#applyPathStrip.

/**
 * Strips tracking params from a URL object, respecting affiliate, preserved,
 * and disabled-category params.  Returns { removed, removedValues, junkCount }
 * where `removedValues` is a parallel array carrying the original values of
 * each stripped param (captured BEFORE deletion) so callers can feed the
 * cross-site-frequency tracker the (paramName, value) tuple. (#495)
 */
function stripTrackingParams(url, prefs, domainRules, disabledCategories, classifierStripSet, landingPolicy = EMPTY_LANDING_POLICY) {
  // #1111: normalize a trailing-dot FQDN before host-scoped lookups so domain
  // preserve/strip rules and the affiliate param set match the same way they
  // do for the non-dotted host (consistent with domainMatches()/processUrl).
  const hostname = stripTrailingDot(url.hostname);
  // #629 win 2: cached Set, allocated once per host.
  const affiliateParamSet = getAffiliateParamSetForHost(hostname);
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
  // De-dup the key list: searchParams.keys() yields one entry PER occurrence of
  // a repeated key (?utm=a&utm=b → "utm" twice), but delete() removes ALL
  // occurrences on the first pass. Without the Set, the second iteration would
  // re-push the name (over-counting junkCount/badge) and record a phantom empty
  // value (get() returns null after delete). The first get() captures value "a".
  //
  // Firefox Xray: URLSearchParams key/value/entry iterators are NOT iterable in
  // the content-script sandbox (their Symbol.iterator is filtered by Firefox's
  // Xray wrappers), so `[...sp.keys()]`, `for..of`, and `new Set(sp.keys())`
  // throw "not iterable" — crashing the entire content-side processUrl on
  // Firefox while the identical code runs fine in the background (no Xray).
  // forEach is a plain callback method, unaffected, so collect via forEach into
  // a plain array first. (#1009)
  const paramKeys = [];
  url.searchParams.forEach((_v, k) => paramKeys.push(k));
  for (const param of new Set(paramKeys)) {
    const lower = param.toLowerCase();
    if (affiliateParamSet.has(lower)) continue;
    if (preserved.has(lower)) continue;
    if (landingPolicy.preserve.has(lower)) continue;
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
 *   0.  Full-site exemption (#allowlist-full-inert): a domain-only whitelist
 *       entry returns the URL completely untouched, before every other step
 *       below runs.
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
 * @param {Array} [pathStripRules=[]]
 *   Path-strip rules loaded from `src/rules/path-strip-rules.json` via
 *   `src/lib/path-rules.js`. Injected by the service worker at call time.
 *   Defaults to `[]` (no-op) so call sites that have not yet migrated
 *   (or test call sites that don't exercise path behavior) are unaffected.
 * @param {Array} [pathAffiliateRules=[]]
 *   Affiliate-injection rules loaded from `src/rules/path-affiliate-rules.json`
 *   via `src/lib/path-rules.js`. Injected by the service worker at call time.
 *   Defaults to `[]` (no-op) for the same reason as `pathStripRules`.
 * @returns {{ cleanUrl: string, action: string, removedTracking: string[], junkRemoved: number, detectedAffiliate: object|null, preservedAffiliate: object|null, creatorReferralPreserved: boolean, autoInjected?: object, network?: string, creator?: string }}
 *   `autoInjected` (affiliate-autoinject-notice): read-only side channel,
 *   `undefined` unless `detectAutoInjectedTag` matched a known platform
 *   auto-injector. Never influences `action`/`cleanUrl` — default KEEP holds
 *   regardless of this field.
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
export function processUrl(rawUrl, prefs, domainRules = [], canonicalBundle, frequencyTracker, referrer, pathStripRules = [], pathAffiliateRules = []) {
  // Step 0 — Full-site exemption choke point (#allowlist-full-inert).
  //
  // A domain-only whitelist entry means MUGA must have NO effect on this
  // hostname at all - not just "skip affiliate processing" (the old,
  // narrower behavior), but skip every cleaning mechanism this function
  // performs, current and future. This check MUST run before
  // unwrap/honor-creator/canonical extraction below, since those also
  // mutate/inspect the URL - an exempt site must never be touched by any
  // of them either.
  //
  // Fail-safe: if rawUrl fails to parse here, do NOT treat it as exempt -
  // fall through to the normal pipeline (which re-parses it via
  // unwrapAndExtract and returns the standard untouched payload on its own
  // parse failure). A malformed URL must never be interpreted as "exempt",
  // since that would be indistinguishable from "cleaning disabled".
  try {
    const earlyHostname = new URL(rawUrl).hostname;
    if (isSiteFullyExempt(earlyHostname, prefs)) {
      return buildReturnPayload("untouched", rawUrl, [], null, {});
    }
  } catch {
    // Unparseable rawUrl - fall through to normal handling below.
  }

  // Step 1 — Unwrap + Honor + Canonical (steps 0a, 0, 0b)
  const unwrapStep = unwrapAndExtract(rawUrl, prefs, referrer, canonicalBundle, pathAffiliateRules);
  if (unwrapStep.kind === "done") return unwrapStep.payload;
  const { rawUrl: unwrappedRawUrl, url, creatorReferralPreserved, pathAffiliateUnwrapped } = unwrapStep;
  rawUrl = unwrappedRawUrl;

  // #1095: strip a single trailing dot before this hostname feeds ANY
  // matching below (getPatternsForHost, domainMatches via blacklist/
  // whitelist, handleAffiliatePipeline's ourTag lookups, …). Mirrors the
  // domainMatches() trailing-dot fix so the two central lookup points agree.
  const hostname = stripTrailingDot(url.hostname);

  // #1096: honor a fully-exempt destination reached THROUGH a wrapper. The
  // entry host was already checked at earlyHostname (and returned "untouched"
  // for a direct navigation), so reaching here with an exempt host means the
  // foreign wrapper was unwrapped to an allowlisted destination. We keep the
  // unwrap (the wrapper host was NOT exempt) but stop before any strip so the
  // destination's own params stay intact — never touched by any path. Surface
  // as "cleaned", NOT "untouched": the URL changed by unwrapping, so it must be
  // APPLIED. An "untouched" result is dropped by computeNavigationStrip (below,
  // the `action === "untouched"` guard that gates the Firefox blocking-
  // webRequest redirect) AND by the SW stats/passthrough gate — so it would
  // leave the wrapper in place. Do NOT weaken this to "untouched". When unwrap
  // did NOT change the URL, both gates no-op (cleanUrl === rawUrl), so "cleaned"
  // is safe there too.
  if (isSiteFullyExempt(hostname, prefs)) {
    return buildReturnPayload("cleaned", rawUrl, [], null, { creatorReferralPreserved });
  }
  // Per-landing matrix-required preservation (#656). Computed once and
  // threaded through every strip call site below; empty when the referrer
  // is not a known redirect-network host.
  const landingPolicy = getLandingPolicy(hostname, referrer);

  // affiliate-autoinject-notice: pure, read-only side channel. Computed on
  // the incoming landing params (before any stripping below runs) so it sees
  // exactly what the browser navigated to. This value is NEVER read by the
  // strip/inject decision below — it only rides along on the final payload
  // as `result.autoInjected` for the UI layer to optionally surface. Default
  // KEEP (Scenario C) is guaranteed precisely because nothing downstream
  // branches on it.
  const autoInjected = detectAutoInjectedTag(hostname, referrer, url.searchParams) || undefined;
  // Use pre-parsed lists from the caller (service worker cache) when available
  const parsedBlacklist = prefs._parsedBlacklist || (prefs.blacklist || []).map(parseListEntry);
  const parsedWhitelist = prefs._parsedWhitelist || (prefs.whitelist || []).map(parseListEntry);

  // OAuth / auth / payment flow exemption: never touch params on these paths.
  // Precedence is DELIBERATE (audit #1048): this exemption runs BEFORE the
  // domain-only blacklist "strip everything" branch below, so it wins even on a
  // user-blacklisted domain. Reordering to let the blacklist win would let a
  // full-wipe entry strip `code`/`state`/session params on a /checkout or
  // /callback path and break the user's login or payment, which is exactly what
  // this exemption exists to prevent. A domain the user wants fully wiped is
  // still wiped on its non-auth paths.
  const AUTH_PATH_RE = /\/(oauth|oauth2|authorize|callback|auth|signin|login|sso|saml|checkout|payment|pay)(\/|$)/;
  if (AUTH_PATH_RE.test(url.pathname.toLowerCase())) {
    return buildReturnPayload("untouched", rawUrl, [], null, { creatorReferralPreserved });
  }

  const originalPathname = url.pathname;
  // Path-strip rules (e.g. Amazon slug/ref removal) loaded from
  // src/rules/path-strip-rules.json via src/lib/path-rules.js.
  url.pathname = applyPathStrip(hostname, url.pathname, pathStripRules);
  const pathCleaned = url.pathname !== originalPathname;

  // Scenario D: domain is fully blacklisted — strip everything, no injection
  if (parsedBlacklist.some(e => !e.param && domainMatches(hostname, e.domain))) {
    // Firefox Xray safety (see stripTrackingParams): count via forEach, not spread. (#1009)
    let blacklistedParamCount = 0;  // C10: count before wipe
    url.searchParams.forEach(() => { blacklistedParamCount++; });
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
      url, prefs, domainRules, patterns, hostname, pathCleaned, creatorReferralPreserved, landingPolicy,
    );
    recordFrequency(frequencyTracker, prefs, hostname, removed, removedValues);
    return payload;
  }

  // Step 5 — Tracking strip (Scenario A core)
  const { removed: removedTracking, removedValues: removedTrackingValues } =
    classifyAndStripTracking(url, prefs, domainRules, landingPolicy);

  // Step 6 — Affiliate pipeline (Scenarios B + C + blacklist-value strip)
  const { action: pipeAction, detectedAffiliate, blacklistStripped } =
    handleAffiliatePipeline(url, prefs, patterns, parsedBlacklist, parsedWhitelist, hostname, creatorReferralPreserved);

  // Step 7 — Action resolution + Bookshop injection + recordFrequency + final payload
  /** @type {"untouched"|"cleaned"|"injected"|"detected_foreign"|"blacklisted"|"honored-creator"} */
  let action = pipeAction;
  // pathAffiliateUnwrapped (#959): the /a/CREATOR/DEST wrapper was rewritten to
  // DEST inside unwrapStep (before originalPathname was captured), so pathCleaned
  // stays false even though the URL changed. Surface it as "cleaned" so the
  // service worker counts it in urlsCleaned + history — parity with how the
  // query strip-all path reports a stripped foreign affiliate (no junkRemoved bump).
  if (action === "untouched" && (pathCleaned || removedTracking.length > 0 || pathAffiliateUnwrapped))
    action = "cleaned";

  // 6b. Path-based MUGA-affiliate injection (e.g. Bookshop.org). Rules are
  // loaded from src/rules/path-affiliate-rules.json via src/lib/path-rules.js.
  // The `action !== "detected_foreign"` guard is defensive — structurally
  // unreachable today for Bookshop (no AFFILIATE_PATTERNS entry matches it),
  // but guards against overriding a foreign affiliate if a rule domain is ever
  // added to AFFILIATE_PATTERNS. pathPrefix presence + param absence are
  // checked inside getPathAffiliatePolicy (data-driven per spec REQ-3).
  const _policy = getPathAffiliatePolicy(url, pathAffiliateRules);
  // pathAffiliateUnwrapped bypasses the stripAll guard ONLY for URLs we just
  // unwrapped from an /a/ wrapper in this same pass (#959); plain non-wrapped
  // /p/ pages under stripAll still do not inject (see cleaner.test.mjs:3101).
  if (
    _policy.pendingInjection &&
    prefs.injectOwnAffiliate &&
    (!prefs.stripAllAffiliates || pathAffiliateUnwrapped) &&
    action !== "detected_foreign" &&
    !creatorReferralPreserved
  ) {
    url.searchParams.set(_policy.pendingInjection.param, _policy.pendingInjection.value);
    action = "injected";
  }

  recordFrequency(frequencyTracker, prefs, hostname, removedTracking, removedTrackingValues);

  // affiliate-autoinject-notice LOW-1: attach `removeUrl` — the cleaned URL
  // with EXACTLY the auto-injected param=value pair removed — so the notice's
  // Remove action can strip the platform tag on the CURRENT navigation, not
  // only on the next one via the scoped-blacklist write. This is still a pure
  // read-only side channel: it rides on `autoInjected` and never alters
  // `action`/`cleanUrl`/`removedTracking`. A co-present genuine creator tag on
  // the same param survives (stripAutoInjectedTag drops only the exact pair);
  // any parse failure falls back to `cleanUrl` inside the helper.
  const autoInjectedPayload = autoInjected
    ? { ...autoInjected, removeUrl: stripAutoInjectedTag(url.toString(), autoInjected.param, autoInjected.value) }
    : autoInjected;

  return buildReturnPayload(action, url, removedTracking, detectedAffiliate, {
    junkRemoved: removedTracking.length + blacklistStripped + (pathCleaned ? 1 : 0),
    preservedAffiliate: detectPreservedAffiliate(url, patterns),
    creatorReferralPreserved,
    autoInjected: autoInjectedPayload,
  });
}

/**
 * Decides how a top-level navigation should be rewritten by the Firefox blocking
 * webRequest stripper (service-worker.js onBeforeNavigateStrip). Pure (no chrome.*
 * access), so it is unit-testable in isolation and shares one code path with the
 * listener (no divergence).
 *
 * Mirrors Chrome's DNR (STRIP only): affiliate injection and the foreign-affiliate
 * toast are suppressed here so (a) network-layer behavior matches Chrome, where
 * DNR cannot inject, leaving injection to the content-script self-clean on both
 * browsers, and (b) the resulting redirect is idempotent: there is no injected
 * tag for a re-entered clean URL to loop on. All strip/preserve/allowlist/
 * affiliate guards are honored automatically because they live inside processUrl.
 *
 * @param {string} rawUrl
 * @param {object} prefs the same materialized prefs snapshot the SW caches
 * @param {Array} [domainRules=[]]
 * @param {Array} [pathStripRules=[]]
 * @param {Array} [pathAffiliateRules=[]]
 * @param {object} [frequencyTracker] cross-site-frequency singleton (optional)
 * @returns {{cleanUrl:string, result:object}|null} redirect target + full result,
 *   or null when the navigation must pass through unchanged.
 */
export function computeNavigationStrip(rawUrl, prefs, domainRules = [], pathStripRules = [], pathAffiliateRules = [], frequencyTracker) {
  if (typeof rawUrl !== "string" || (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))) {
    return null;
  }
  if (!prefs || !prefs.enabled || !prefs.onboardingDone) return null;

  const stripPrefs = (prefs.injectOwnAffiliate || prefs.notifyForeignAffiliate)
    ? { ...prefs, injectOwnAffiliate: false, notifyForeignAffiliate: false }
    : prefs;

  let result;
  try {
    result = processUrl(rawUrl, stripPrefs, domainRules, undefined, frequencyTracker, "", pathStripRules, pathAffiliateRules);
  } catch {
    return null;
  }

  if (!result || result.action === "untouched" || !result.cleanUrl || result.cleanUrl === rawUrl) {
    return null;
  }
  return { cleanUrl: result.cleanUrl, result };
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
 * @param {Array} [pathAffiliateRules=[]]
 *   Affiliate-injection rules from `src/lib/path-rules.js`. Used for
 *   Bookshop.org creator-referral detection (step 6). Defaults to `[]`
 *   (no-op) for call sites that do not exercise path-affiliate behavior.
 * @returns {{ kind: "continue", rawUrl: string, url: URL, creatorReferralPreserved: boolean, pathAffiliateUnwrapped: boolean } | { kind: "done", payload: object }}
 */
function unwrapAndExtract(rawUrl, prefs, referrer, canonicalBundle, pathAffiliateRules = []) {
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

  // Step 6: Path-based creator-referral detection. Computed once post-unwrap so
  // wrapper redirects that land on a referral path are covered. Rules come from
  // src/lib/path-rules.js (loaded from src/rules/path-affiliate-rules.json).
  //
  // #959: when stripAllAffiliates is ON and the referral path is an unwrappable
  // /a/CREATOR/DEST wrapper (unwrapTo present), rewrite the URL to DEST so the
  // foreign creator's attribution is removed and normal query cleaning plus
  // Step 6b injection (below, in processUrl) can run on the destination.
  // /shop/NAME never has unwrapTo (no unwrapReferral match) so it is
  // unaffected. On any parse failure, fall back to leaving the URL untouched
  // (today's preserve behavior).
  const pathPolicy = getPathAffiliatePolicy(url, pathAffiliateRules);
  let creatorReferralPreserved = pathPolicy.creatorReferralPreserved;
  let pathAffiliateUnwrapped = false;

  if (creatorReferralPreserved && prefs.stripAllAffiliates && pathPolicy.unwrapTo) {
    try {
      const raw = pathPolicy.unwrapTo;
      const qIdx = raw.indexOf("?");
      const destPath = qIdx === -1 ? raw : raw.slice(0, qIdx);
      const destSearch = qIdx === -1 ? null : raw.slice(qIdx); // includes leading "?"
      url.pathname = destPath;
      if (destSearch !== null) {
        url.search = destSearch;
      }
      rawUrl = url.href;
      creatorReferralPreserved = false;
      pathAffiliateUnwrapped = true;
    } catch {
      // Leave url/rawUrl untouched, fall back to preserve behavior.
    }
  }

  return { kind: "continue", rawUrl, url, creatorReferralPreserved, pathAffiliateUnwrapped };
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
 * @param {boolean} [creatorReferralPreserved=false]
 *   Defensive non-overlap guard (design D4, web-tool-naked-link-injection
 *   slice 2): when true, a creator/foreign referral was already preserved
 *   for this URL (via unwrapAndExtract's path-affiliate policy). Step 6
 *   generic injection MUST NOT co-tag over it, even if a future host gains
 *   BOTH a query-param AFFILIATE_PATTERNS entry and a path-affiliate rule.
 * @returns {{ action: "untouched"|"cleaned"|"injected"|"detected_foreign"|"blacklisted"|"honored-creator", detectedAffiliate: object|null, blacklistStripped: number }}
 */
function handleAffiliatePipeline(url, prefs, patterns, parsedBlacklist, parsedWhitelist, hostname, creatorReferralPreserved = false) {
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
  /** @type {"untouched"|"cleaned"|"injected"|"detected_foreign"|"blacklisted"|"honored-creator"} */
  let action = "untouched";

  // Step 3: Detect a foreign affiliate tag (skipped when stripAllAffiliates is on)
  // #523 phase 3: detection no longer gates on ourTag.
  // #1093: look up the key case-insensitively — an uppercase-keyed tag
  // (?TAG=creator-21) must be detected the same as the canonical lowercase form.
  if (!prefs.stripAllAffiliates && prefs.notifyForeignAffiliate) {
    const hostKey = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      const actualKey = findParamKeyCI(url, pattern.param);
      if (!actualKey) continue;
      const ourTagForHost = pattern.ourTag[hostKey] || pattern.ourTag[hostname] || "";
      // #1111 pt.3: scan every occurrence, not just get() (the FIRST). A foreign
      // creator tag hiding behind our own or a whitelisted duplicate
      // (?tag=ours&tag=foreign) must still raise the notification — get() only
      // ever saw the first value and continue'd past the foreign one.
      let foreignValue = null;
      for (const val of url.searchParams.getAll(actualKey)) {
        if (!val) continue;
        if (ourTagForHost && val === ourTagForHost) continue; // our own injection
        if (isWhitelisted(pattern.param, val)) continue;       // user-approved value
        foreignValue = val;
        break;
      }
      if (foreignValue === null) continue;
      detectedAffiliate = { param: pattern.param, value: foreignValue, pattern };
      action = "detected_foreign";
      break;
    }
  }

  // Step 4b: Strip third-party affiliate params (stripAllAffiliates path)
  if (prefs.stripAllAffiliates) {
    const hostKeyStrip = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      // #1093: case-insensitive key lookup (see findParamKeyCI doc comment).
      const actualKey = findParamKeyCI(url, pattern.param);
      if (!actualKey) continue;
      const ourTagForHost = pattern.ourTag[hostKeyStrip] || pattern.ourTag[hostname] || "";
      // #1091: decide per-OCCURRENCE, not from a single get() call. A repeated
      // param (?tag=evil-20&tag=creator-21) can carry a foreign value in one
      // occurrence and a whitelisted/creator (or our own) value in another —
      // get() only ever sees the FIRST occurrence, but delete() below would
      // remove EVERY occurrence, so a get()-decides/delete()-removes-all
      // split let a foreign duplicate mask (and destroy) the exact value the
      // whitelist/injection guard exists to protect.
      const values = url.searchParams.getAll(actualKey);
      const kept = [];
      let strippedAny = false;
      for (const val of values) {
        const isOurs = prefs.injectOwnAffiliate && ourTagForHost && val === ourTagForHost;
        if (isOurs || isWhitelisted(pattern.param, val)) {
          kept.push(val);
        } else {
          strippedAny = true;
        }
      }
      if (strippedAny) {
        // actualKey (not pattern.param) so the surviving values keep their
        // original casing in the output (#1093 — this fix widens the SEARCH,
        // it does not rewrite the stored key's casing).
        url.searchParams.delete(actualKey);
        for (const val of kept) url.searchParams.append(actualKey, val);
        if (action === "untouched") action = "cleaned";
      }
    }
  }

  // Step 5: Strip specific blacklisted affiliate values
  let blacklistStripped = 0;
  // Track whether a blacklist rule removed an affiliate param (injection suppression, #183).
  // INTERNAL — does NOT cross the function boundary.
  let blacklistRemovedAffiliate = false;
  // #629 win 2: cached Set, allocated once per host.
  const affiliateParamSet = getAffiliateParamSetForHost(hostname);
  for (const entry of parsedBlacklist) {
    if (entry.param && entry.value && domainMatches(hostname, entry.domain)) {
      // #1093: entry.param is always lowercased by parseListEntry, but the
      // URL's actual key may not be — look it up case-insensitively.
      const actualKey = findParamKeyCI(url, entry.param);
      if (!actualKey) continue;
      const values = url.searchParams.getAll(actualKey);
      if (values.length === 0) continue;
      const isWildcard = entry.value === "*";
      // #1111: decide per-occurrence, same as the #1091 affiliate-strip path.
      // get()-decides / delete()-removes-all destroyed a non-blacklisted (e.g.
      // whitelisted/creator) duplicate whenever the FIRST value matched the
      // blacklist rule (?tag=evil-20&tag=creator-21 with rule tag::evil-20).
      // Whitelist always wins over blacklist (#301) — kept per value.
      const kept = [];
      let strippedAny = false;
      for (const val of values) {
        const matches = isWildcard || val === entry.value;
        if (matches && !isWhitelisted(entry.param, val)) {
          strippedAny = true;
        } else {
          kept.push(val);
        }
      }
      if (!strippedAny) continue;
      // actualKey (not entry.param) so surviving values keep their original
      // casing (#1093 — widen the SEARCH, do not rewrite the stored key casing).
      url.searchParams.delete(actualKey);
      for (const val of kept) url.searchParams.append(actualKey, val);
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

  // Step 6: Inject own affiliate tag (generic — AFFILIATE_PATTERNS).
  // Runs even under stripAllAffiliates. That toggle removes affiliate tags
  // "from other sources" (its label); Step 4b above has already stripped any
  // foreign tag by this point, so injecting ours here operates on a
  // now-tagless URL. It is a strip-then-inject of two explicit opt-ins, not an
  // overwrite: the `!url.searchParams.has(pattern.param)` guard below still
  // holds (a preserved own tag from Step 4b short-circuits injection). When
  // stripAll is off, a foreign tag sets action="detected_foreign" and is
  // honored instead. Supersedes the earlier #353 "no injection under
  // strip-all" guard, per maintainer decision: remove theirs, then add ours.
  // !creatorReferralPreserved (design D4): defensive non-overlap guard —
  // a preserved creator/foreign referral can never be co-tagged here either,
  // mirroring the same guard Step 6b already has via the orchestrator.
  if (prefs.injectOwnAffiliate && action !== "detected_foreign" && !blacklistRemovedAffiliate && !creatorReferralPreserved) {
    const hostKeyInject = hostname.replace(/^www\./, "");
    for (const pattern of patterns) {
      const ourTagForHost = pattern.ourTag[hostKeyInject] || pattern.ourTag[hostname] || "";
      // #1093: case-insensitive presence check — without it, an existing
      // uppercase-keyed tag (?TAG=creator-21) was invisible to
      // `.has(pattern.param)` and MUGA would inject a SECOND "tag" param
      // under the canonical lowercase key alongside it (non-superposition).
      if (ourTagForHost && !findParamKeyCI(url, pattern.param)) {
        url.searchParams.set(pattern.param, ourTagForHost);
        action = "injected";
        break;
      }
    }
  }

  // Step 6b: Path-based MUGA-affiliate injection (e.g. Bookshop.org) is now
  // handled declaratively in the processUrl orchestrator via getPathAffiliatePolicy
  // (src/lib/path-rules.js, rules from src/rules/path-affiliate-rules.json).
  // creatorReferralPreserved is NOT available here — it lives in the orchestrator
  // closure from unwrapAndExtract. Bookshop injection remains in the orchestrator.

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
function handleWhitelistedDomain(url, prefs, domainRules, patterns, hostname, pathCleaned, creatorReferralPreserved, landingPolicy = EMPTY_LANDING_POLICY) {
  const disabledCategoriesForSkip = new Set(prefs.disabledCategories || []);
  // Bounded-scope classifier (#530): even on whitelisted domains, ambiguous
  // params co-occurring with anchor trackers should be stripped. Affiliate
  // params are independently protected by affiliateParamSet inside stripTrackingParams.
  // #629 win 2: cached Set, allocated once per host.
  const wlAffiliateParamSet = getAffiliateParamSetForHost(hostname);
  const wlClassification = classifyParams(url.toString(), {
    ...prefs,
    _affiliateParamSet: wlAffiliateParamSet,
  });
  const {
    removed,
    removedValues,
  } = stripTrackingParams(url, prefs, domainRules, disabledCategoriesForSkip, new Set(wlClassification.stripParams), landingPolicy);
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
function classifyAndStripTracking(url, prefs, domainRules, landingPolicy = EMPTY_LANDING_POLICY) {
  const hostname = url.hostname;
  const removed = [];
  const removedValues = [];

  if (isAliExpressItemPage(hostname, url.pathname)) {
    // AliExpress item pages: strip ALL params except domain-rules preserveParams
    // AND the matrix-required landing-policy preserve set on first-touch from
    // an affiliate redirect (e.g. s.click.aliexpress.com → aliexpress.com/item).
    // Without the policy gate, this wholesale strip kills aff_trace_key + family
    // before the AliExpress front-end tag can consume them on landing.
    const { preserved } = getDomainParamSets(hostname, domainRules);
    // #885: Also exempt the redirect-network landing family UNCONDITIONALLY,
    // independent of document.referrer. getLandingPolicy() already preserves
    // this family when referrer = s.click.aliexpress.com, but several real paths
    // (strict Referrer-Policy, meta-refresh / redirect chains, cross-origin
    // downgrade, DOM-less workers) deliver the user with no referrer, collapsing
    // getLandingPolicy to EMPTY_LANDING_POLICY and silently stripping
    // aff_trace_key + family → creator commission destroyed. Over-preserving a
    // transient tracker on an AliExpress item page is the cheap asymmetric-risk
    // direction; stripping attribution is catastrophic.
    const networkLandingParams = getLandingParamsForHost(hostname);
    // De-dup keys (see stripTrackingParams): delete() removes all occurrences,
    // so iterating raw keys() would double-count repeated keys and push a
    // phantom empty value on the second pass.
    //
    // Firefox Xray safety (see stripTrackingParams): searchParams iterators are
    // not iterable in content scripts; collect via forEach first. (#1009)
    const paramKeys = [];
    url.searchParams.forEach((_v, k) => paramKeys.push(k));
    for (const param of new Set(paramKeys)) {
      const lower = param.toLowerCase();
      if (preserved.has(lower)) continue;
      if (landingPolicy.preserve.has(lower)) continue;
      if (networkLandingParams.has(lower)) continue;
      removedValues.push(url.searchParams.get(param) ?? "");
      url.searchParams.delete(param);
      removed.push(param);
    }
  } else {
    // Standard path: bounded-scope classifier (#530) + stripTrackingParams.
    // #629 win 2: affiliateParamSet is cached per host inside affiliates.js,
    // so the Set allocation only happens on first call for each hostname.
    const affiliateParamSet = getAffiliateParamSetForHost(hostname);
    const disabledCategories = new Set(prefs.disabledCategories || []);
    // CAPS-Contextual short-circuit (#543): skip bounded-scope rule when URL
    // is on a network-redirect host. Covers both wrapper hosts (destination
    // unextractable) AND AFFILIATE_REDIRECT_NETWORKS pass-through hosts —
    // both represent the network's own redirect page, where the contextual
    // strip rule MUST NOT fire per spec §3.2 step 6.
    const isNetworkRedirect =
      !!detectWrapper(url.toString()) || isAffiliateRedirectNetwork(hostname);
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
      landingPolicy,
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
    // affiliate-autoinject-notice: side-channel signal, undefined when no
    // known auto-injector matched (or when not computed at this return site).
    autoInjected: extras.autoInjected,
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
