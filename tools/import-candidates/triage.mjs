/**
 * MUGA import-candidates triage (#998, Phase 0, v2.1).
 *
 * A weekly auto-import bot flattens AdGuard Filter 17's $removeparam rules
 * into a flat candidate list (tools/import-candidates/report-*.json). Many
 * of those names are short or generic and are functional on some sites
 * (search query, pagination, sort order, and similar), so they must never be
 * bulk-added to the universal strip list (TRACKING_PARAMS /
 * src/rules/tracking-params.json). Doing that caused a real false-positive
 * regression previously (issue #1006).
 *
 * v1 additionally had three safety defects: it could promote an affiliate
 * click-ID that a redirect network reads at landing (irclickid, cjevent,
 * awc) into a strippable bucket, which would silently destroy creator
 * commission on first-touch landings (test guard #815). v2 fixed this by
 * checking an affiliate-preserve exclusion FIRST, before any other signal,
 * and added a hard danger list for load-bearing functional names plus a
 * broadened vendor-signal set for corroborating single-source global
 * attribution.
 *
 * v2.1 fixes a defect in that broadened vendor-signal set: it conflated pure
 * tracking/ad-platform vendors (safe to strip on every site) with
 * affiliate-NETWORK vendors (whose params can carry creator/publisher
 * commission attribution the same way the FIX 1 preserve set does).
 * Confirmed regression: cj_aid, cj_pid, awinaffid, af_id, af_channel,
 * adj_adgroup, adj_deeplink, impact_click_id, and impact_ad_id were all
 * reaching universal_high_confidence under v2. impact_click_id is
 * particularly dangerous: it belongs to Impact Radius, the exact same
 * network whose irclickid/irgwc/iclid landing params are already preserved
 * (test guard #815). v2.1 splits the single vendor-signal list into
 * TRACKING_VENDOR_PATTERNS (pure tracking/analytics/ad-platform/storefront,
 * safe to promote to universal) and AFFILIATE_NETWORK_PATTERNS
 * (creator/affiliate attribution risk, routed to human review instead), and
 * adds a new affiliate_network_review bucket that is checked before the
 * universal path.
 *
 * The distinction: ad-PLATFORM click IDs (gclid, fbclid, msclkid, ttclid,
 * ...) are the advertiser's own tracking and are safe to strip universally,
 * because no creator commission is at stake. Affiliate-NETWORK params
 * (cj_ prefix, awin, impact_ prefix, af_ prefix AppsFlyer, adj_ prefix
 * Adjust, rakuten, admitad, partnerize, tradedoubler, airbridge, branch,
 * generic aff/affid/affiliate markers) route commission to a content
 * creator/publisher, so stripping
 * them can rob attribution; these always go to human review, never
 * straight to universal.
 *
 * This script re-derives per-candidate evidence from two independent signal
 * sources (AdGuard Filter 17 raw text, ClearURLs rules database), cross
 * references MUGA's two strip mechanisms for dedup, and buckets every
 * surviving candidate into one of six reviewer queues:
 *
 *   - excluded_affiliate_preserve: never touch, this is a redirect-network
 *     landing param required for creator/affiliate attribution.
 *   - affiliate_network_review: matches a known affiliate-network vendor
 *     (v2.1, NEW). Never universal; a human must decide preserve vs strip
 *     vs domain-scope per network.
 *   - universal_high_confidence: safe for TRACKING_PARAMS (every site).
 *   - domain_scoped: safe for domain-rules.json (named domains only).
 *   - needs_human: signals conflict or are too weak to auto-decide.
 *   - likely_reject: no real tracking evidence, probably a functional param
 *     (or a load-bearing functional name with only global/no attribution).
 *
 * MUGA has two strip mechanisms (see CONTEXT.md):
 *   - Universal: src/lib/affiliates-data.js (TRACKING_PARAMS) and
 *     src/rules/tracking-params.json (DNR). Stripped on every site. Reserve
 *     for unambiguous cross-site tracking params only.
 *   - Domain-scoped: src/rules/domain-rules.json. Stripped only on named
 *     domains. The safe home for a param that is tracking on specific sites
 *     but risky/functional elsewhere.
 *
 * This module is READ-ONLY with respect to the live rule files: it never
 * writes to src/lib/affiliates-data.js, src/lib/affiliates.js,
 * src/rules/domain-rules.json, or src/rules/tracking-params.json. It only
 * reads them (and src/lib/redirect-networks.js, via affiliates.js) for
 * dedup and affiliate-preserve lookups.
 *
 * Network fetches (AdGuard raw, ClearURLs raw) are best-effort: any failure
 * (timeout, DNS, non-2xx) is caught, a warning is logged, and the affected
 * signal degrades to "no data" (null) rather than crashing the run. Cached
 * raw files from tools/rule-ingestion/quarantine/ are used as a fallback.
 * This fallback behavior is unchanged from v1/v2.
 *
 * Public API (named exports, no default):
 *   Pure classification (no I/O, unit-testable without network):
 *     matchTrackingPrefixFamily(name)       legacy/informational only
 *     isKnownFunctionalRisk(name)            legacy/informational only
 *     genericnessScore(name)                 legacy/informational only
 *     isAffiliatePreserveParam(name)          FIX 1 (v2)
 *     isDangerName(name)                      FIX 2 (v2)
 *     matchAffiliateNetwork(name)              v2.1 NEW, checked before FIX 3
 *     matchTrackingVendor(name)                FIX 3 (v2, split in v2.1)
 *     classifyCandidate(signals)              v2.1 bucket precedence
 *     annotateCandidate(name, externalSignals)
 *   Parsing (pure, given raw text):
 *     parseAdguardRemoveparamWithDomains(rawText)
 *     lookupAdguard(index, name)
 *     buildClearUrlsIndex(rawText)
 *     lookupClearUrls(index, name)
 *   I/O (impure, hits disk/network):
 *     loadCandidateReport(path)
 *     loadMugaDedupSets()
 *     fetchAdguardRaw(), fetchClearUrlsRaw()
 *     runTriage(opts), orchestrates everything and writes the two report files.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { adguardTp } from "../rule-ingestion/adapters/adguard-tp.mjs";
import { clearurls } from "../rule-ingestion/adapters/clearurls.mjs";
import { REDIRECT_NETWORK_PATTERNS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Curated triage signal lists (documented, not the live strip rules) ──────

// tracking_prefix_family: known prefixes/patterns for well-established
// tracking systems. Kept from v1 as an informational/legacy signal only:
// v2 bucket gating no longer reads this field (see FIX 3's dedicated
// VENDOR_SIGNAL_PATTERNS below, which supersedes it for bucket decisions).
/** @type {Array<[string, RegExp]>} */
const TRACKING_PREFIX_FAMILIES = [
  ["utm", /^utm_/], // Google/GA campaign parameters (utm_source, utm_medium, ...)
  ["mailchimp", /^mc_/], // Mailchimp campaign/email tracking (mc_cid, mc_eid)
  ["piwik-pro", /^pk_/], // Piwik PRO / legacy Piwik campaign tracking (pk_campaign, pk_kwd, pk_source)
  ["matomo-mtm", /^mtm_/], // Matomo tag-manager campaign tracking
  ["hubspot", /^hsa_|^_hs/], // HubSpot ad tracking (hsa_*) and email/session tracking (_hsenc, _hsmi, _hstc)
  ["ga-linker", /^ga_|^_ga$|^_ga_|^_gl$/], // GA4/gtag cross-domain linker params and ga_* variants
  ["clickid", /(?:^|_)(g|dc|wb|gb|ms|tt|tw|sc|ob)?clid$|clickid$/i], // ad-network click ids: gclid, dclid, wbraid/gbraid, msclkid, ttclid, twclid, fbclid, clickid, and lookalikes
  ["fbclid-family", /^fb(clid|_action_|_source|_ref)/i], // Meta/Facebook click and campaign attribution
  ["aliexpress-oak", /(^|_)oak(_|$)/i], // AliExpress oak_ / _oak_ affiliate-adjacent tracking token family
  ["alibaba-spm-scm", /^(spm|scm)([0-9_].*)?$/i], // Alibaba/AliExpress "super position model" (spm) and scm tracking tokens
  ["marketo-mkt", /^mkt_|^mkwid$|^mkevt$/i], // Marketo campaign tracking; eBay mkevt/mkwid affiliate-adjacent tracking
  ["cmpid", /^cmpid$|_cmpid$/i], // generic "campaign id" token used across many ad platforms
  ["generic-trk", /^trk[a-z_]*$|_trk$/i], // generic "track" token prefix/suffix used across many trackers
  ["adobe-efid", /^ef_id$/i], // Adobe / Efficient Frontier ad click id
  ["s-kwcid", /^s_kwcid$/i], // Adobe Analytics paid-search keyword click id
];

// known_functional_risk: names that are frequently legitimate site
// functionality (search query, pagination, sort order, language selection,
// view/tab state, generic ids) on at least some sites. Kept from v1 as an
// informational/legacy signal only: v2 bucket gating uses the dedicated,
// broader DANGER_NAMES list (FIX 2) instead of this narrower set.
//
// Single- and double-character names (p, q, s, l, t, v, f, d, i, n, m, o, r,
// k, and so on) are handled generically by the length check below instead of
// being enumerated one by one: any name that short is too generic to trust
// blindly regardless of what letter it happens to be.
const SHORT_GENERIC_LEN_THRESHOLD = 2;
const KNOWN_FUNCTIONAL_RISK_NAMES = new Set([
  "id", "page", "sort", "lang", "type", "tab", "view", "from", "ref",
]);

// genericness score: auxiliary signal only (not a bucket gate in v1 or v2).
// Higher means "looks more like a coined English/functional word than a
// tracking token". Simple heuristic: very short names score higher, and
// membership in a small common-token list adds more. Documented, not
// exhaustive.
const COMMON_ENGLISH_TOKENS = new Set([
  "page", "view", "tab", "type", "sort", "list", "item", "user", "name",
  "date", "time", "home", "info", "help", "more", "next", "back", "open",
  "edit", "save", "show", "hide", "from", "search", "query", "ref",
]);

/**
 * @param {string} name Candidate param name.
 * @returns {{ matched: boolean, family: string|null }}
 */
export function matchTrackingPrefixFamily(name) {
  const lower = String(name).toLowerCase();
  for (const [family, regex] of TRACKING_PREFIX_FAMILIES) {
    if (regex.test(lower)) return { matched: true, family };
  }
  return { matched: false, family: null };
}

/**
 * @param {string} name Candidate param name.
 * @returns {boolean}
 */
export function isKnownFunctionalRisk(name) {
  const lower = String(name).toLowerCase();
  if (lower.length <= SHORT_GENERIC_LEN_THRESHOLD) return true;
  return KNOWN_FUNCTIONAL_RISK_NAMES.has(lower);
}

/**
 * Auxiliary informational signal, not used to gate buckets.
 * @param {string} name Candidate param name.
 * @returns {number}
 */
export function genericnessScore(name) {
  const lower = String(name).toLowerCase();
  let score = 0;
  if (lower.length <= 2) score += 2;
  else if (lower.length <= 4) score += 1;
  if (COMMON_ENGLISH_TOKENS.has(lower)) score += 2;
  return score;
}

// ── v2 FIX 1: affiliate-preserve exclusion set ───────────────────────────────
//
// Built dynamically from REDIRECT_NETWORK_PATTERNS in src/lib/affiliates.js
// (re-exported from src/lib/redirect-networks.js), collecting every
// `landingParams` entry across every redirect network. These are params a
// redirect network (Awin, CJ Affiliate, Impact Radius, and so on) reads at
// the FIRST landing after a click to populate the merchant's first-party
// attribution cookie. Stripping them universally would destroy creator
// commission (test guard #815, tests/unit/strip-table-parity.test.mjs).
//
// This is dynamic (not hardcoded) so it always tracks the live
// REDIRECT_NETWORK_PATTERNS table without needing a manual update here.
//
// A distinct "honor creator referral" param set (beyond landingParams) was
// searched for in src/lib/cleaner.js and src/lib/affiliates*.js (shouldHonor,
// honor, creator, landingParams). The only match is src/lib/honor-creator.js,
// which decides whether to pass through a *wrapper URL* unmodified
// (`shouldHonor()`, gated on prefs.honorCreatorMode + detectWrapper() +
// prefs.creatorAllowlist) -- it is about wrapper redirects (social redirects,
// link shorteners), not about a param-name preserve list. It does not define
// any param names distinct from landingParams. So the affiliate-preserve set
// below is built from landingParams only.
function buildAffiliatePreserveSet() {
  const set = new Set();
  for (const network of REDIRECT_NETWORK_PATTERNS) {
    for (const p of network.landingParams ?? []) {
      set.add(String(p).toLowerCase());
    }
  }
  return set;
}

const AFFILIATE_PRESERVE_SET = buildAffiliatePreserveSet();

/**
 * @param {string} name Candidate param name.
 * @returns {boolean} true if this exact name is a redirect-network landing
 *   param (must never be promoted to any strippable bucket).
 */
export function isAffiliatePreserveParam(name) {
  return AFFILIATE_PRESERVE_SET.has(String(name).toLowerCase());
}

// ── v2 FIX 2: hard danger list of load-bearing functional param names ───────
//
// These names are frequently load-bearing site functionality (search query,
// pagination, auth/session state, generic identifiers, locale/version
// selection) on at least some sites. A match here can NEVER reach
// universal_high_confidence. If the candidate also carries scoped-domain
// attribution, the domain scope limits the blast radius (domain_scoped,
// flagged with caution: "functional-name"); with only global or no
// attribution, it is unsafe to strip anywhere without a human decision
// (likely_reject).
//
// Base list as specified for this triage pass. Checked against the actual
// 2026-07-05 candidate batch for present near-duplicates (simple plurals
// such as "ids"/"urls"/"tokens"/"sessions"/"keys"/"codes"/etc.): none were
// found in that batch, so the list below is used exactly as given, with no
// extensions.
const DANGER_NAMES = new Set([
  "q", "query", "s", "url", "uri", "token", "nonce", "sig", "signature",
  "state", "code", "login", "id", "key", "session", "sessionid", "sid",
  "user", "userid", "email", "page", "path", "lang", "locale", "country",
  "region", "version", "ver", "variant", "type", "sort", "view", "os",
  "host", "ip", "date", "time", "method", "action", "format", "callback",
  "redirect", "redirect_uri", "return", "next",
]);

/**
 * @param {string} name Candidate param name.
 * @returns {boolean}
 */
export function isDangerName(name) {
  return DANGER_NAMES.has(String(name).toLowerCase());
}

// ── v2.1: vendor-signal set split in two ─────────────────────────────────────
//
// v2 had a single VENDOR_SIGNAL_PATTERNS list that conflated pure tracking
// vendors with affiliate-NETWORK vendors, so it promoted affiliate-network
// attribution params straight to universal_high_confidence (cj_aid, cj_pid,
// awinaffid, af_id, af_channel, adj_adgroup, adj_deeplink, impact_click_id,
// impact_ad_id were all confirmed in universal_high_confidence under v2).
// v2.1 fixes this by splitting the list:
//
//   - TRACKING_VENDOR_PATTERNS: pure tracking/analytics/ad-platform/
//     storefront vendors. No creator commission is at stake, so these are
//     SAFE to combine with an AdGuard global claim to reach
//     universal_high_confidence. This includes ad-PLATFORM click ids
//     (gclid, fbclid-family via generic-clickid/clid, msclkid, ttclid, ...):
//     the advertiser's own tracking, distinct from affiliate-NETWORK ids.
//
//   - AFFILIATE_NETWORK_PATTERNS: vendors that route commission to a
//     content creator/publisher (CJ, Awin, Impact Radius, Rakuten, Admitad,
//     Partnerize, Tradedoubler, AppsFlyer, Adjust, Airbridge, Branch, and
//     generic affiliate markers). A match here can NEVER reach
//     universal_high_confidence: it is routed to the new
//     affiliate_network_review bucket for a human preserve-vs-strip-vs-scope
//     decision per network, the same risk class FIX 1's exact-name preserve
//     set protects against for redirect-network landing params.
//
// Both lists are checked with the same "first match wins, lowercased,
// substring/prefix regex" convention as v2's single list. A name matching
// BOTH lists is treated as an affiliate-network match (see classifyCandidate
// precedence below): the affiliate-network gate is checked before the
// universal path, so overlap can never leak an affiliate-network name into
// universal_high_confidence.

/**
 * Pure tracking/analytics/ad-platform/storefront vendor signal. Positive
 * corroborating signal for candidates that survive FIX 1, FIX 2, and the
 * affiliate-network gate. Used only to combine with an AdGuard global claim
 * to reach universal_high_confidence (see classifyCandidate below) -- never
 * sufficient by itself.
 * @type {Array<[string, RegExp]>}
 */
const TRACKING_VENDOR_PATTERNS = [
  ["utm", /^utm_/], // Google/GA campaign parameters
  ["mtm", /^mtm_/], // Matomo tag-manager campaign tracking
  ["piwik-pro-pk", /^pk_/], // Piwik PRO / legacy Piwik campaign tracking
  ["mailchimp-mc", /^mc_/], // Mailchimp campaign/email tracking
  ["hubspot", /^hsa_|^_hs/], // HubSpot ad tracking and email/session tracking
  ["ga-linker", /^ga_|^_ga$|^_ga_|^_gl$/], // GA4/gtag cross-domain linker params
  ["gclid", /^gclid$/], // Google Ads click id, advertiser's own tracking
  ["dclid", /^dclid$/], // Google Display/DoubleClick click id
  ["gbraid", /^gbraid$/], // Google Ads iOS-privacy click id
  ["wbraid", /^wbraid$/], // Google Ads web-to-app click id
  ["msclkid", /^msclkid$/], // Microsoft/Bing Ads click id
  ["ttclid", /^ttclid$/], // TikTok Ads click id
  ["twclid", /^twclid$/], // Twitter/X Ads click id
  ["yclid", /^yclid$/], // Yandex Direct click id
  ["igshid", /igshid/], // Instagram share id
  ["generic-clid", /clid$/], // generic ad-platform click id family (fbclid and lookalikes)
  ["generic-clickid", /clickid$/], // generic ad-platform click id family
  ["generic-click_id", /click_id$/], // generic ad-platform click id family
  ["taboola", /taboola/], // Taboola native-ad platform
  ["outbrain", /outbrain/], // Outbrain native-ad platform
  ["dicbo", /dicbo/], // ad-platform click id family
  ["criteo", /criteo/], // Criteo retargeting/ad platform
  ["reddit-rdt", /^rdt_/], // Reddit Ads click tracking
  ["salesforce-sfmc", /^sfmc_/], // Salesforce Marketing Cloud email/campaign tracking
  ["webtrekk-wt", /^wt_/], // Webtrekk analytics
  ["etracker-etcc", /etcc/], // etracker analytics
  ["matomo", /matomo/], // Matomo analytics
  ["piwik", /piwik/], // Piwik analytics
  ["gemius", /gemius/], // Gemius analytics
  ["aliexpress-oak", /_oak/], // AliExpress storefront tracking token, not a redirect-network landing param
  ["alibaba-spm", /^spm/], // Alibaba/AliExpress "super position model" storefront tracking
  ["alibaba-scm", /^scm/], // Alibaba/AliExpress storefront tracking
  ["marketo-mkt", /^mkt_/], // Marketo campaign tracking
  ["ebay-mkwid", /mkwid/], // eBay marketing/campaign tracking
  ["ebay-mkevt", /mkevt/], // eBay marketing/campaign tracking
  ["adobe-efid", /^ef_id$/], // Adobe / Efficient Frontier ad click id
  ["adobe-s-kwcid", /^s_kwcid$/], // Adobe Analytics paid-search keyword click id
  ["cmpid", /cmpid/], // generic "campaign id" token used across many ad platforms
  ["ncid", /ncid/], // generic ad-network campaign id token
];

/**
 * Affiliate-NETWORK vendor signal (v2.1 NEW). These vendors pay commission
 * to a content creator/publisher based on the attribution param surviving
 * to landing/checkout, the same risk class as FIX 1's exact-name preserve
 * set. A match here NEVER reaches universal_high_confidence; it always
 * routes to affiliate_network_review for a human decision. Each entry
 * documents the network it belongs to (surfaced in the JSON/markdown
 * report) and a one-line rationale.
 * @type {Array<[string, RegExp, string]>} [label, regex, networkDisplayName]
 */
const AFFILIATE_NETWORK_PATTERNS = [
  // CJ Affiliate (Commission Junction): cj_-prefixed params carry the CJ
  // publisher/click attribution chain, same network guarded by the
  // preserved cjevent/cjdata landing params.
  ["cj-prefix", /^cj_/, "CJ Affiliate (Commission Junction)"],
  ["cj-commission", /commission/i, "CJ Affiliate (Commission Junction)"],
  // Awin: awinaffid is Awin's own affiliate-id attribution param, same
  // network already preserved via the awc/wt_mc landing params.
  ["awin", /awin/i, "Awin"],
  // Impact Radius: impact_-prefixed params belong to the exact same network
  // whose irclickid/irgwc/iclid landing params are already preserved (test
  // guard #815); an unenumerated impact_ param is very likely a sibling
  // attribution token from that network.
  ["impact-prefix", /^impact_/, "Impact Radius"],
  // Rakuten Advertising (LinkShare): ranmid/ransiteid/raneaid are already
  // preserved landing params; the broader "rakuten" token catches sibling
  // Rakuten attribution params not yet enumerated there.
  ["rakuten", /rakuten|^ranmid$|^ransiteid$|^raneaid$/i, "Rakuten Advertising (LinkShare)"],
  // Admitad: network-specific affiliate/publisher attribution.
  ["admitad", /admitad/i, "Admitad"],
  // Partnerize (Performance Horizon): clickref/pubref/adref are already
  // preserved; the broader partnerize/partnerid naming family catches
  // sibling attribution tokens.
  ["partnerize", /partnerize|partnerid/i, "Partnerize (Performance Horizon)"],
  // Tradedoubler: tduid is already preserved (moved out of TRACKING_PARAMS
  // in #695); the broader "tradedoubler" token catches sibling params.
  ["tradedoubler", /tradedoubler|^tduid$/i, "Tradedoubler"],
  // AppsFlyer: af_-prefixed params are mobile app-install attribution
  // (distinct from ad-platform click ids); stripping can break mobile
  // affiliate/app-install payouts.
  ["appsflyer-af", /^af_/, "AppsFlyer"],
  // Adjust: adj_-prefixed params / bare "adjust" are mobile attribution,
  // same risk class as AppsFlyer.
  ["adjust", /^adj_|adjust/i, "Adjust"],
  ["airbridge", /airbridge/i, "Airbridge"],
  ["branch", /branch/i, "Branch"],
  // Generic affiliate markers: not tied to one named network, but the token
  // itself declares affiliate intent, so route to review instead of
  // assuming it is safe to strip.
  ["generic-affiliate", /^aff$|^affid$|^affiliate$|^aff_/i, "Generic affiliate marker"],
];

/**
 * @param {string} name Candidate param name.
 * @returns {{ matched: boolean, pattern: string|null }}
 */
export function matchTrackingVendor(name) {
  const lower = String(name).toLowerCase();
  for (const [label, regex] of TRACKING_VENDOR_PATTERNS) {
    if (regex.test(lower)) return { matched: true, pattern: label };
  }
  return { matched: false, pattern: null };
}

/**
 * @param {string} name Candidate param name.
 * @returns {{ matched: boolean, pattern: string|null, network: string|null }}
 */
export function matchAffiliateNetwork(name) {
  const lower = String(name).toLowerCase();
  for (const [label, regex, network] of AFFILIATE_NETWORK_PATTERNS) {
    if (regex.test(lower)) return { matched: true, pattern: label, network };
  }
  return { matched: false, pattern: null, network: null };
}

// ── Bucketing (pure, deterministic, precedence-ordered) ──────────────────────

/**
 * Assigns exactly one bucket per candidate, checked in this precedence
 * order (documented again in the .md report for reviewers). FIX 1, FIX 2,
 * and the v2.1 affiliate-network gate run before any other check, in this
 * exact order, and stop processing for that candidate as soon as they
 * match.
 *
 *   FIX 1. excluded_affiliate_preserve: signals.is_affiliate_preserve is
 *      true. Processing stops here; this candidate can never reach any
 *      other bucket. Catches irclickid, cjevent, awc, and every other
 *      redirect-network landing param (test guard #815).
 *
 *   FIX 2. Danger-list gate, only for candidates not caught by FIX 1:
 *      signals.is_danger_name is true. Can never reach
 *      universal_high_confidence.
 *        - if scoped attribution exists -> domain_scoped, caution:
 *          "functional-name".
 *        - else -> likely_reject (reason: load-bearing functional name,
 *          unsafe to strip universally, no domain scope).
 *
 *   v2.1 NEW GATE. Affiliate-network gate, only for candidates not caught
 *      by FIX 1 or FIX 2: signals.affiliate_network_match.matched is true.
 *      Always -> affiliate_network_review, tagged with the matched network.
 *      Can never reach universal_high_confidence: fixes the v2 regression
 *      where cj_aid, awinaffid, impact_click_id, af_id, adj_adgroup, and
 *      siblings were promoted straight to universal_high_confidence.
 *
 *   FIX 3. For candidates not caught by FIX 1, FIX 2, or the affiliate-
 *      network gate:
 *      - universal_high_confidence if: (adguard_global AND clearurls_global)
 *        OR (adguard_global AND tracking_vendor_match.matched).
 *      - else if scoped attribution exists -> domain_scoped.
 *      - else if any global attribution exists (adguard_global OR
 *        clearurls_global) -> needs_human.
 *      - else -> likely_reject (reason: no corroborating tracking evidence
 *        in either source).
 *
 * @param {object} signals
 * @param {boolean|null} signals.clearurls_global
 * @param {string[]} signals.clearurls_scoped_domains
 * @param {boolean|null} signals.adguard_global
 * @param {string[]} signals.adguard_scoped_domains
 * @param {boolean} signals.is_affiliate_preserve
 * @param {boolean} signals.is_danger_name
 * @param {{matched: boolean, pattern: string|null, network: string|null}} signals.affiliate_network_match
 * @param {{matched: boolean, pattern: string|null}} signals.tracking_vendor_match
 * @returns {{ bucket: "excluded_affiliate_preserve"|"affiliate_network_review"|"universal_high_confidence"|"domain_scoped"|"needs_human"|"likely_reject", caution?: string, reason?: string, network?: string }}
 */
export function classifyCandidate(signals) {
  const anyGlobal = Boolean(signals.clearurls_global) || Boolean(signals.adguard_global);
  const anyScoped =
    (signals.clearurls_scoped_domains?.length ?? 0) > 0 ||
    (signals.adguard_scoped_domains?.length ?? 0) > 0;

  // FIX 1 (must run first, before any other check).
  if (signals.is_affiliate_preserve) {
    return { bucket: "excluded_affiliate_preserve" };
  }

  // FIX 2 (runs second, only for candidates not caught by FIX 1).
  if (signals.is_danger_name) {
    if (anyScoped) {
      return { bucket: "domain_scoped", caution: "functional-name" };
    }
    return {
      bucket: "likely_reject",
      reason: "load-bearing functional name, unsafe to strip universally, no domain scope",
    };
  }

  // v2.1 NEW GATE (runs third, only for candidates not caught by FIX 1 or
  // FIX 2, and before FIX 3's universal path).
  if (signals.affiliate_network_match?.matched) {
    return { bucket: "affiliate_network_review", network: signals.affiliate_network_match.network };
  }

  // FIX 3 (runs fourth, only for candidates not caught by FIX 1, FIX 2, or
  // the affiliate-network gate).
  const vendorMatched = Boolean(signals.tracking_vendor_match?.matched);
  const adguardGlobal = Boolean(signals.adguard_global);
  const clearurlsGlobal = Boolean(signals.clearurls_global);
  if ((adguardGlobal && clearurlsGlobal) || (adguardGlobal && vendorMatched)) {
    return { bucket: "universal_high_confidence" };
  }
  if (anyScoped) {
    return { bucket: "domain_scoped" };
  }
  if (anyGlobal) {
    return { bucket: "needs_human" };
  }
  return { bucket: "likely_reject", reason: "no corroborating tracking evidence in either source" };
}

/**
 * Combines name-derived signals (affiliate-preserve match, danger-list
 * match, vendor-signal match, plus the legacy/informational prefix-family,
 * functional-risk, and genericness signals) with externally supplied
 * evidence (AdGuard / ClearURLs lookups) into one fully annotated, bucketed
 * record. Pure: no I/O.
 *
 * @param {string} name
 * @param {object} external
 * @param {boolean|null} [external.clearurls_global]
 * @param {string[]} [external.clearurls_scoped_domains]
 * @param {boolean|null} [external.adguard_global]
 * @param {string[]} [external.adguard_scoped_domains]
 * @param {string[]} [external.muga_preserve_conflict_domains] Domains where this
 *   name is already an explicit preserveParams entry in domain-rules.json
 *   (informational only, surfaces likely functional-risk elsewhere; not a
 *   bucket gate).
 * @returns {object} Fully annotated candidate record including `bucket` and,
 *   when applicable, `caution`, `reason`, and/or `network`.
 */
export function annotateCandidate(name, external = {}) {
  // Legacy/informational signals, kept for reviewer context (not used to
  // gate v2.1 buckets; see classifyCandidate above for the current rules).
  const tracking_prefix_family = matchTrackingPrefixFamily(name);
  const known_functional_risk = isKnownFunctionalRisk(name);
  const genericness_score = genericnessScore(name);

  // Bucket-gating signals.
  const is_affiliate_preserve = isAffiliatePreserveParam(name);
  const is_danger_name = isDangerName(name);
  const affiliate_network_match = matchAffiliateNetwork(name); // v2.1 NEW
  const tracking_vendor_match = matchTrackingVendor(name);

  const signals = {
    name,
    clearurls_global: external.clearurls_global ?? null,
    clearurls_scoped_domains: external.clearurls_scoped_domains ?? [],
    adguard_global: external.adguard_global ?? null,
    adguard_scoped_domains: external.adguard_scoped_domains ?? [],
    is_affiliate_preserve,
    is_danger_name,
    affiliate_network_match,
    tracking_vendor_match,
    tracking_prefix_family,
    known_functional_risk,
    genericness_score,
    muga_preserve_conflict_domains: external.muga_preserve_conflict_domains ?? [],
  };

  const classification = classifyCandidate(signals);
  signals.bucket = classification.bucket;
  if (classification.caution) signals.caution = classification.caution;
  if (classification.reason) signals.reason = classification.reason;
  if (classification.network) signals.network = classification.network;
  return signals;
}

// ── AdGuard Filter 17 parsing (domain-aware) ─────────────────────────────────
//
// tools/rule-ingestion/adapters/adguard-tp.mjs and its underlying
// parseRemoveparamRules() (tools/import-upstream.mjs) already extract a flat
// Set of param names, but that flattening loses the `,domain=` modifier that
// tells us a rule is scoped to specific sites rather than global. This
// parser mirrors the same line-matching and validation conventions but keeps
// the domain scope alongside each name.

// Mirrors the param-name validation in tools/import-upstream.mjs's
// parseRemoveparamRules: alphanumeric, underscore, hyphen, dot only.
const ADGUARD_PARAM_NAME_RE = /^[a-z0-9_\-.]{1,64}$/;

/**
 * @param {string} rawText Raw AdGuard Filter 17 text.
 * @returns {{ index: Map<string, {global: boolean, domains: Set<string>}>, skipped: number }}
 */
export function parseAdguardRemoveparamWithDomains(rawText) {
  const index = new Map();
  let skipped = 0;

  const ensure = (name) => {
    if (!index.has(name)) index.set(name, { global: false, domains: new Set() });
    return index.get(name);
  };

  for (const rawLine of String(rawText).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    const paramMatch = /\$.*?removeparam=([^,$]+)/i.exec(line);
    if (!paramMatch) continue;

    const spec = paramMatch[1].trim();
    if (!spec) { skipped++; continue; }
    // Regex specs (/.../ ) and bare negations (~...) need manual review;
    // not handled by this literal-name parser (same skip convention as
    // parseRemoveparamRules).
    if (spec.startsWith("/") || spec.startsWith("~")) { skipped++; continue; }

    const names = [];
    for (const piece of spec.split("|")) {
      const name = piece.trim().toLowerCase();
      if (!name) { skipped++; continue; }
      if (!ADGUARD_PARAM_NAME_RE.test(name)) { skipped++; continue; }
      names.push(name);
    }
    if (names.length === 0) continue;

    const domainMatch = /domain=([^,$]+)/i.exec(line);
    let scopedDomains = [];
    let isGlobal = true;
    if (domainMatch) {
      const parts = domainMatch[1]
        .trim()
        .split("|")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const positive = parts.filter((d) => !d.startsWith("~"));
      if (positive.length > 0) {
        // Positive domain list: the rule applies ONLY on these domains.
        scopedDomains = positive;
        isGlobal = false;
      }
      // else: only negated domains (domain=~a.com|~b.com), meaning "applies
      // everywhere except these few sites". Treated as global here: no
      // scoped domains are captured for a rule that is broader than the
      // exceptions it lists.
    }

    for (const name of names) {
      const entry = ensure(name);
      if (isGlobal) entry.global = true;
      for (const d of scopedDomains) entry.domains.add(d);
    }
  }

  return { index, skipped };
}

/**
 * @param {Map<string, {global: boolean, domains: Set<string>}>|null} index
 * @param {string} name
 * @returns {{ global: boolean|null, domains: string[] }}
 */
export function lookupAdguard(index, name) {
  if (!index) return { global: null, domains: [] }; // no data at all: unknown, not a negative match
  const entry = index.get(String(name).toLowerCase());
  if (!entry) return { global: false, domains: [] };
  return { global: entry.global, domains: Array.from(entry.domains).sort() };
}

// ── ClearURLs parsing (domain-aware) ─────────────────────────────────────────
//
// tools/rule-ingestion/adapters/clearurls.mjs and tools/moat-expansion/adapters/
// clearurls-moat.mjs already parse this JSON for other purposes (safe-literal
// extraction and referralMarketing extraction respectively). Neither answers
// "is this literal name matched by ANY provider's rule, and is that provider
// global or domain-scoped", so this builds a small regex index for that
// specific lookup instead of duplicating either adapter's extraction logic.
//
// ClearURLs' own "globalRules" provider (urlPattern ".*") holds the rules
// applied on every site; every other provider key is treated as a
// domain-scoped signal, using the provider key itself as the domain
// identifier (provider keys are usually recognizable site/brand names but
// are not always a literal registrable domain string, e.g. "amazon" rather
// than "amazon.com" -- a human reviewer should confirm the exact domain
// before adding a domain-rules.json entry).
//
// Provider rules are regex fragments (not always simple literals), so
// candidate names are tested with a full-string anchor
// (^(?:pattern)$) rather than substring search. This can occasionally
// over-match on short/generic fragments for a given provider; that risk is
// acceptable here because it only ever routes a candidate into the safer
// domain_scoped bucket, never universal_high_confidence.

/**
 * @param {string} rawText Raw ClearURLs rules.json text.
 * @returns {{ globalPatterns: RegExp[], scopedPatterns: {provider: string, regex: RegExp}[] } | null}
 */
export function buildClearUrlsIndex(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return null;
  }

  const providers =
    data?.providers && typeof data.providers === "object" && !Array.isArray(data.providers)
      ? data.providers
      : {};

  const globalPatterns = [];
  const scopedPatterns = [];

  for (const [providerKey, provider] of Object.entries(providers)) {
    const isGlobalProvider = providerKey === "globalRules" || provider?.urlPattern === ".*";
    const rules = Array.isArray(provider?.rules) ? provider.rules : [];

    for (const rawPattern of rules) {
      let regex;
      try {
        regex = new RegExp(`^(?:${rawPattern})$`, "i");
      } catch {
        continue; // invalid regex fragment in upstream data: skip defensively
      }
      if (isGlobalProvider) globalPatterns.push(regex);
      else scopedPatterns.push({ provider: providerKey, regex });
    }
  }

  return { globalPatterns, scopedPatterns };
}

/**
 * @param {{globalPatterns: RegExp[], scopedPatterns: {provider: string, regex: RegExp}[]}|null} index
 * @param {string} name
 * @returns {{ global: boolean|null, domains: string[] }}
 */
export function lookupClearUrls(index, name) {
  if (!index) return { global: null, domains: [] }; // no data at all: unknown
  const global = index.globalPatterns.some((re) => re.test(name));
  const domainSet = new Set();
  for (const { provider, regex } of index.scopedPatterns) {
    if (regex.test(name)) domainSet.add(provider);
  }
  return { global, domains: Array.from(domainSet).sort() };
}

// ── MUGA dedup sets (read-only lookups against the live rule files) ─────────

/**
 * Strips `//` line comments before extracting quoted string literals from a
 * source block. WITHOUT this, comment text such as:
 *   // "ref" removed: it's the affiliate param for PcComponentes ...
 * would be misread as "ref" being present in TRACKING_PARAMS, when the
 * comment is documenting exactly the opposite (a deliberate exclusion for
 * affiliate-attribution safety). Getting this wrong would make the triage
 * silently drop an affiliate-sensitive name as "already handled".
 * @param {string} text
 * @returns {string}
 */
function stripLineComments(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Reads TRACKING_PARAMS, TRACKING_PREFIXES, domain-rules.json stripParams,
 * domain-rules.json preserveParams, and tracking-params.json removeParams
 * for dedup lookups. Read-only: never writes to any of these files.
 *
 * @param {object} [paths]
 * @returns {{
 *   universalNames: Set<string>,
 *   universalPrefixes: string[],
 *   domainStripMap: Map<string, string[]>,
 *   domainPreserveMap: Map<string, string[]>,
 * }}
 */
export function loadMugaDedupSets(paths = {}) {
  const affiliatesDataPath = paths.affiliatesDataPath ?? resolve(__dirname, "../../src/lib/affiliates-data.js");
  const domainRulesPath = paths.domainRulesPath ?? resolve(__dirname, "../../src/rules/domain-rules.json");
  const trackingParamsJsonPath = paths.trackingParamsJsonPath ?? resolve(__dirname, "../../src/rules/tracking-params.json");

  const universalNames = new Set();
  const universalPrefixes = [];
  const domainStripMap = new Map();
  const domainPreserveMap = new Map();

  try {
    const src = readFileSync(affiliatesDataPath, "utf8");
    const cleaned = stripLineComments(src);

    const paramsBlockMatch = /export const TRACKING_PARAMS\s*=\s*\[([\s\S]*?)\n\];/.exec(cleaned);
    if (paramsBlockMatch) {
      for (const m of paramsBlockMatch[1].matchAll(/"([a-zA-Z0-9_.\-]+)"/g)) {
        universalNames.add(m[1].toLowerCase());
      }
    }

    const prefixesBlockMatch = /export const TRACKING_PREFIXES\s*=\s*\[([\s\S]*?)\n\];/.exec(cleaned);
    if (prefixesBlockMatch) {
      for (const m of prefixesBlockMatch[1].matchAll(/"([a-zA-Z0-9_.\-]+)"/g)) {
        universalPrefixes.push(m[1].toLowerCase());
      }
    }
  } catch (err) {
    console.warn(`[triage] could not read ${affiliatesDataPath}: ${err.message}`);
  }

  try {
    const rules = JSON.parse(readFileSync(trackingParamsJsonPath, "utf8"));
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        const removeParams = rule?.action?.redirect?.transform?.queryTransform?.removeParams;
        if (Array.isArray(removeParams)) {
          for (const p of removeParams) universalNames.add(String(p).toLowerCase());
        }
      }
    }
  } catch (err) {
    console.warn(`[triage] could not read ${trackingParamsJsonPath}: ${err.message}`);
  }

  try {
    const domainRules = JSON.parse(readFileSync(domainRulesPath, "utf8"));
    if (Array.isArray(domainRules)) {
      for (const entry of domainRules) {
        const domain = entry?.domain;
        if (!domain) continue;
        for (const p of entry.stripParams ?? []) {
          const key = String(p).toLowerCase();
          if (!domainStripMap.has(key)) domainStripMap.set(key, []);
          domainStripMap.get(key).push(domain);
        }
        for (const p of entry.preserveParams ?? []) {
          const key = String(p).toLowerCase();
          if (!domainPreserveMap.has(key)) domainPreserveMap.set(key, []);
          domainPreserveMap.get(key).push(domain);
        }
      }
    }
  } catch (err) {
    console.warn(`[triage] could not read ${domainRulesPath}: ${err.message}`);
  }

  return { universalNames, universalPrefixes, domainStripMap, domainPreserveMap };
}

/**
 * @param {{universalNames: Set<string>, universalPrefixes: string[], domainStripMap: Map<string,string[]>}} dedup
 * @param {string} name
 * @returns {boolean}
 */
export function isAlreadyInMuga(dedup, name) {
  const lower = String(name).toLowerCase();
  if (dedup.universalNames.has(lower)) return true;
  if (dedup.domainStripMap.has(lower)) return true;
  for (const prefix of dedup.universalPrefixes) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

// ── Candidate report loading ─────────────────────────────────────────────────

/**
 * @param {string} reportPath
 * @returns {{ candidates: string[], meta: object }}
 */
export function loadCandidateReport(reportPath) {
  const raw = readFileSync(reportPath, "utf8");
  const data = JSON.parse(raw);
  const candidates = Array.isArray(data?.new_candidates) ? data.new_candidates : [];
  return { candidates, meta: data ?? {} };
}

const DEFAULT_REPO_REPORT_PATH = resolve(__dirname, "report-2026-07-05.json");
const DEFAULT_SCRATCHPAD_REPORT_PATH =
  "C:/Users/parada/AppData/Local/Temp/claude/C--Users-parada-Desktop-test-muga/248c41ba-c18f-422a-bf19-11daaec03817/scratchpad/adguard-candidates-2026-07-05.json";

/**
 * Resolves the candidate report path: an explicit CLI argument wins;
 * otherwise prefer the in-repo path for this batch, falling back to the
 * scratchpad copy. Future weekly batches should pass an explicit path.
 * @param {string|undefined} cliArg
 * @returns {string}
 */
export function resolveCandidateReportPath(cliArg) {
  if (cliArg) return cliArg;
  if (existsSync(DEFAULT_REPO_REPORT_PATH)) return DEFAULT_REPO_REPORT_PATH;
  return DEFAULT_SCRATCHPAD_REPORT_PATH;
}

/**
 * @param {object|null} meta Candidate report top-level object.
 * @param {string} reportPath
 * @returns {string} YYYY-MM-DD
 */
export function deriveDateSuffix(meta, reportPath) {
  if (meta?.fetched_at) {
    const d = new Date(meta.fetched_at);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const m = /(\d{4}-\d{2}-\d{2})/.exec(reportPath ?? "");
  if (m) return m[1];
  return new Date().toISOString().slice(0, 10);
}

// ── Network fetch with cache fallback (never throws) ─────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.label For log messages.
 * @param {() => Promise<string>} opts.fetchFn Adapter fetchRaw call, pre-bound.
 * @param {string[]} opts.cachePaths Candidate cache file paths, checked in order.
 * @param {string[]} opts.warnings Mutable array; failures/fallbacks are pushed here.
 * @returns {Promise<{ text: string|null, source: "live"|"cache"|"none" }>}
 */
async function fetchRawWithFallback({ label, fetchFn, cachePaths, warnings }) {
  try {
    const text = await fetchFn();
    return { text, source: "live" };
  } catch (err) {
    warnings.push(`[triage] live fetch failed for ${label}: ${err?.message ?? err}`);
  }

  for (const cachePath of cachePaths) {
    try {
      const text = readFileSync(cachePath, "utf8");
      warnings.push(`[triage] using cached raw for ${label}: ${cachePath}`);
      return { text, source: "cache" };
    } catch {
      // try next candidate cache path
    }
  }

  warnings.push(`[triage] no cached raw available for ${label}; signal degraded to unknown/no-data`);
  return { text: null, source: "none" };
}

/** @param {string[]} warnings @returns {Promise<{text: string|null, source: string}>} */
export function fetchAdguardRaw(warnings) {
  return fetchRawWithFallback({
    label: "adguard-tp",
    fetchFn: () => adguardTp.fetchRaw(),
    cachePaths: [
      resolve(__dirname, "../rule-ingestion/quarantine/adguard-tp.raw"),
      resolve(__dirname, "../rule-ingestion/adapters/adguard-tp.raw"),
    ],
    warnings,
  });
}

/** @param {string[]} warnings @returns {Promise<{text: string|null, source: string}>} */
export function fetchClearUrlsRaw(warnings) {
  return fetchRawWithFallback({
    label: "clearurls",
    fetchFn: () => clearurls.fetchRaw(),
    cachePaths: [
      resolve(__dirname, "../moat-expansion/quarantine/clearurls.raw"),
      resolve(__dirname, "../rule-ingestion/quarantine/clearurls.raw"),
    ],
    warnings,
  });
}

// ── Report rendering ─────────────────────────────────────────────────────────

const BUCKET_ORDER = [
  "excluded_affiliate_preserve",
  "affiliate_network_review",
  "universal_high_confidence",
  "domain_scoped",
  "needs_human",
  "likely_reject",
];

/** @param {object[]} records @param {object} meta @returns {string} */
function renderMarkdownReport(records, meta) {
  const lines = [];
  lines.push(`# Import-candidate triage (${meta.dateSuffix}), v2.1`);
  lines.push("");
  lines.push(
    `Source: ${meta.sourceLabel ?? "AdGuard Filter 17"} (${meta.sourceUrl ?? "unknown URL"}), report fetched at ${meta.fetchedAt ?? "unknown time"}.`,
  );
  lines.push(`Candidate report file: ${meta.reportPath}`);
  lines.push("");
  lines.push("## Data source availability");
  lines.push("");
  lines.push(`- AdGuard raw: ${meta.adguardSource} (${meta.adguardSource === "none" ? "signals unknown/no-data" : "signals available"})`);
  lines.push(`- ClearURLs raw: ${meta.clearurlsSource} (${meta.clearurlsSource === "none" ? "signals unknown/no-data" : "signals available"})`);
  if (meta.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings during this run:");
    for (const w of meta.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(`- Total candidates in input report: ${meta.totalCandidates}`);
  lines.push(`- Already in MUGA (dropped from triage, counted only): ${meta.alreadyInMugaDropped}`);
  for (const bucket of BUCKET_ORDER) {
    lines.push(`- ${bucket}: ${meta.bucketCounts[bucket] ?? 0}`);
  }
  lines.push("");
  lines.push("## Methodology (v2.1)");
  lines.push("");
  lines.push("MUGA has two strip mechanisms: universal (TRACKING_PARAMS / tracking-params.json DNR,");
  lines.push("stripped on every site) and domain-scoped (domain-rules.json, stripped only on named");
  lines.push("domains). Universal strip is reserved for unambiguous cross-site tracking params, since a");
  lines.push("bulk-add of short/generic names to the universal list previously caused a real");
  lines.push("false-positive regression (issue #1006).");
  lines.push("");
  lines.push("v1 additionally had a safety defect: it could promote an affiliate-redirect-network landing");
  lines.push("param (irclickid, cjevent, awc) into a strippable bucket, which would destroy creator");
  lines.push("commission on first-touch landings (test guard #815). v2 fixed this and added a hard danger");
  lines.push("list for load-bearing functional names, plus a single broadened vendor-signal list.");
  lines.push("");
  lines.push("v2.1 fixes a defect in that vendor-signal list: it conflated pure tracking/ad-platform");
  lines.push("vendors with affiliate-NETWORK vendors, so it promoted affiliate-network attribution params");
  lines.push("straight to universal_high_confidence. Confirmed regression under v2: cj_aid, cj_pid,");
  lines.push("awinaffid, af_id, af_channel, adj_adgroup, adj_deeplink, impact_click_id, and impact_ad_id");
  lines.push("were all in universal_high_confidence. impact_click_id is especially dangerous: it belongs");
  lines.push("to Impact Radius, the exact same network whose irclickid/irgwc/iclid landing params are");
  lines.push("already preserved by FIX 1 (test guard #815). v2.1 splits the vendor-signal list in two");
  lines.push("(TRACKING_VENDOR_PATTERNS, safe for universal; AFFILIATE_NETWORK_PATTERNS, routed to human");
  lines.push("review) and adds a new `affiliate_network_review` bucket, checked before the universal path.");
  lines.push("");
  lines.push("Distinction rule: ad-PLATFORM click ids (gclid, fbclid-family, msclkid, ttclid, twclid, ...)");
  lines.push("are the advertiser's own tracking, so they are SAFE to strip universally: no creator");
  lines.push("commission is at stake. Affiliate-NETWORK params (CJ, Awin, Impact Radius, Rakuten, Admitad,");
  lines.push("Partnerize, Tradedoubler, AppsFlyer, Adjust, Airbridge, Branch, generic affiliate markers)");
  lines.push("route commission to a content creator/publisher, so stripping them can rob attribution --");
  lines.push("these always go to human review, never straight to universal.");
  lines.push("");
  lines.push("Every surviving candidate (not already covered by MUGA) is classified with this exact");
  lines.push("precedence, checked IN THIS ORDER:");
  lines.push("");
  lines.push("### FIX 1 (runs first, before any other check)");
  lines.push("");
  lines.push("Any candidate whose lowercased name exactly matches an entry in the affiliate-preserve set");
  lines.push("is routed to `excluded_affiliate_preserve` and processing STOPS for that candidate: it can");
  lines.push("never reach universal_high_confidence, domain_scoped, needs_human, or likely_reject. This");
  lines.push("catches every param a redirect network (Awin, CJ Affiliate, Impact Radius, and so on) reads");
  lines.push("at landing to populate the merchant's first-party attribution cookie.");
  lines.push("");
  lines.push("The affiliate-preserve set is built dynamically from every `landingParams` entry across all");
  lines.push("`REDIRECT_NETWORK_PATTERNS` entries in src/lib/affiliates.js (re-exported from");
  lines.push("src/lib/redirect-networks.js). No distinct \"honor creator referral\" param set was found");
  lines.push("beyond landingParams (src/lib/honor-creator.js's shouldHonor() is about wrapper-URL");
  lines.push("pass-through, not a param-name preserve list), so the set below is landingParams only.");
  lines.push("");
  lines.push(`Affiliate-preserve set used this run (${meta.affiliatePreserveList.length} params):`);
  lines.push("");
  lines.push(meta.affiliatePreserveList.map((p) => `\`${p}\``).join(", "));
  lines.push("");
  lines.push("### FIX 2 (runs second, only for candidates not caught by FIX 1)");
  lines.push("");
  lines.push("Hard danger list of load-bearing functional param names. A match here can NEVER reach");
  lines.push("universal_high_confidence:");
  lines.push("");
  lines.push("- if scoped attribution exists (adguard_scoped_domains or clearurls_scoped_domains");
  lines.push("  non-empty) -> `domain_scoped`, with `caution: \"functional-name\"`.");
  lines.push("- else -> `likely_reject` (reason: load-bearing functional name, unsafe to strip");
  lines.push("  universally, no domain scope).");
  lines.push("");
  lines.push(`Danger list used this run (${meta.dangerList.length} names, exactly as specified, no`);
  lines.push("extensions -- the actual 2026-07-05 candidate batch was checked for present near-duplicates");
  lines.push("such as simple plurals and none were found):");
  lines.push("");
  lines.push(meta.dangerList.map((p) => `\`${p}\``).join(", "));
  lines.push("");
  lines.push("### v2.1 NEW GATE (runs third, only for candidates not caught by FIX 1 or FIX 2)");
  lines.push("");
  lines.push("Affiliate-network gate. A match against `AFFILIATE_NETWORK_PATTERNS` always routes to");
  lines.push("`affiliate_network_review`, tagged with the matched network, and can NEVER reach");
  lines.push("`universal_high_confidence`. This runs BEFORE FIX 3's universal path, so an affiliate-network");
  lines.push("name that also happens to match a tracking-vendor pattern (for example impact_click_id also");
  lines.push("matching the generic click_id family) is still routed here, never to universal.");
  lines.push("");
  lines.push(`AFFILIATE_NETWORK_PATTERNS used this run (${meta.affiliateNetworkEntries.length} entries,`);
  lines.push("grouped by network; see the script for the one-line rationale documented per entry):");
  lines.push("");
  {
    const byNetwork = new Map();
    for (const entry of meta.affiliateNetworkEntries) {
      if (!byNetwork.has(entry.network)) byNetwork.set(entry.network, []);
      byNetwork.get(entry.network).push(entry.label);
    }
    for (const [network, labels] of byNetwork) {
      lines.push(`- **${network}**: ${labels.map((l) => `\`${l}\``).join(", ")}`);
    }
  }
  lines.push("");
  lines.push("### FIX 3 (runs fourth, only for candidates not caught by FIX 1, FIX 2, or the");
  lines.push("affiliate-network gate)");
  lines.push("");
  lines.push("- `universal_high_confidence` if: (adguard_global AND clearurls_global) OR (adguard_global");
  lines.push("  AND tracking_vendor_match.matched).");
  lines.push("- else if scoped attribution exists -> `domain_scoped`.");
  lines.push("- else if any global attribution exists (adguard_global OR clearurls_global) ->");
  lines.push("  `needs_human`.");
  lines.push("- else -> `likely_reject` (reason: no corroborating tracking evidence in either source).");
  lines.push("");
  lines.push("The tracking-vendor set is pure tracking/analytics/ad-platform/storefront vendors only (no");
  lines.push("affiliate-network vendors, split out in v2.1; see the gate above), used as a positive");
  lines.push("corroborating signal alongside an AdGuard global claim:");
  lines.push("");
  lines.push(meta.trackingVendorLabels.map((p) => `\`${p}\``).join(", "));
  lines.push("");
  lines.push("Each surviving candidate is also annotated with legacy/informational fields carried over");
  lines.push("from v1 (not used to gate buckets): `tracking_prefix_family`, `known_functional_risk`,");
  lines.push("`genericness_score`. These remain for reviewer context only.");
  lines.push("");

  for (const bucket of BUCKET_ORDER) {
    const bucketRecords = records.filter((r) => r.bucket === bucket);
    lines.push(`## ${bucket} (${bucketRecords.length})`);
    lines.push("");
    if (bucketRecords.length === 0) {
      lines.push("(none)");
      lines.push("");
      continue;
    }
    if (bucket === "affiliate_network_review") {
      for (const r of bucketRecords) {
        lines.push(`- \`${r.name}\` (network: ${r.network ?? "unknown"})`);
      }
    } else if (bucket === "domain_scoped") {
      for (const r of bucketRecords) {
        const domains = Array.from(new Set([...r.clearurls_scoped_domains, ...r.adguard_scoped_domains])).sort();
        const cautionSuffix = r.caution ? ` [caution: ${r.caution}]` : "";
        lines.push(`- \`${r.name}\` (domains: ${domains.length > 0 ? domains.join(", ") : "none captured"})${cautionSuffix}`);
      }
    } else if (bucket === "likely_reject") {
      for (const r of bucketRecords) {
        const reasonSuffix = r.reason ? ` -- ${r.reason}` : "";
        lines.push(`- \`${r.name}\`${reasonSuffix}`);
      }
    } else {
      for (const r of bucketRecords) {
        lines.push(`- \`${r.name}\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Runs the full triage pipeline: loads candidates, fetches/parses signal
 * sources (best-effort), classifies every non-dropped candidate, and writes
 * the JSON + Markdown deliverables. Never throws: all failures are caught,
 * logged, and degraded.
 *
 * @param {object} [opts]
 * @param {string} [opts.reportPath] Override for the candidate report path.
 * @returns {Promise<{ bucketCounts: object, alreadyInMugaDropped: number, totalCandidates: number, outputJsonPath: string, outputMdPath: string }>}
 */
export async function runTriage(opts = {}) {
  const warnings = [];
  const reportPath = resolveCandidateReportPath(opts.reportPath);

  let candidates = [];
  let meta = {};
  try {
    const loaded = loadCandidateReport(reportPath);
    candidates = loaded.candidates;
    meta = loaded.meta;
  } catch (err) {
    console.error(`[triage] could not load candidate report at ${reportPath}: ${err.message}`);
    return {
      bucketCounts: Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])),
      alreadyInMugaDropped: 0,
      totalCandidates: 0,
      outputJsonPath: null,
      outputMdPath: null,
    };
  }

  const dedup = loadMugaDedupSets();

  const [adguardRaw, clearurlsRaw] = await Promise.all([
    fetchAdguardRaw(warnings),
    fetchClearUrlsRaw(warnings),
  ]);

  const adguardIndex = adguardRaw.text ? parseAdguardRemoveparamWithDomains(adguardRaw.text).index : null;
  const clearurlsIndex = clearurlsRaw.text ? buildClearUrlsIndex(clearurlsRaw.text) : null;

  let alreadyInMugaDropped = 0;
  const records = [];

  for (const rawName of candidates) {
    const name = String(rawName).trim();
    if (!name) continue;

    if (isAlreadyInMuga(dedup, name)) {
      alreadyInMugaDropped++;
      continue;
    }

    const adguardInfo = lookupAdguard(adguardIndex, name);
    const clearurlsInfo = lookupClearUrls(clearurlsIndex, name);
    const preserveDomains = dedup.domainPreserveMap.get(name.toLowerCase()) ?? [];

    const record = annotateCandidate(name, {
      clearurls_global: clearurlsInfo.global,
      clearurls_scoped_domains: clearurlsInfo.domains,
      adguard_global: adguardInfo.global,
      adguard_scoped_domains: adguardInfo.domains,
      muga_preserve_conflict_domains: preserveDomains,
    });

    records.push(record);
  }

  const bucketCounts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
  for (const r of records) bucketCounts[r.bucket] = (bucketCounts[r.bucket] ?? 0) + 1;

  const dateSuffix = deriveDateSuffix(meta, reportPath);
  const outputJsonPath = resolve(__dirname, `triage-${dateSuffix}.json`);
  const outputMdPath = resolve(__dirname, `triage-${dateSuffix}.md`);

  const jsonOutput = {
    generated_at: new Date().toISOString(),
    schema_version: "2.1",
    source_report_path: reportPath,
    source_label: meta.source ?? null,
    source_url: meta.source_url ?? null,
    fetched_at: meta.fetched_at ?? null,
    total_candidates: candidates.length,
    already_in_muga_dropped: alreadyInMugaDropped,
    bucket_counts: bucketCounts,
    affiliate_preserve_set: Array.from(AFFILIATE_PRESERVE_SET).sort(),
    danger_names: Array.from(DANGER_NAMES).sort(),
    tracking_vendor_labels: TRACKING_VENDOR_PATTERNS.map(([label]) => label),
    affiliate_network_labels: AFFILIATE_NETWORK_PATTERNS.map(([label, , network]) => ({ label, network })),
    adguard_data_source: adguardRaw.source,
    clearurls_data_source: clearurlsRaw.source,
    warnings,
    candidates: records,
  };

  try {
    writeFileSync(outputJsonPath, JSON.stringify(jsonOutput, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[triage] could not write ${outputJsonPath}: ${err.message}`);
  }

  try {
    const md = renderMarkdownReport(records, {
      dateSuffix,
      sourceLabel: meta.source,
      sourceUrl: meta.source_url,
      fetchedAt: meta.fetched_at,
      reportPath,
      adguardSource: adguardRaw.source,
      clearurlsSource: clearurlsRaw.source,
      totalCandidates: candidates.length,
      alreadyInMugaDropped,
      bucketCounts,
      warnings,
      affiliatePreserveList: Array.from(AFFILIATE_PRESERVE_SET).sort(),
      dangerList: Array.from(DANGER_NAMES).sort(),
      trackingVendorLabels: TRACKING_VENDOR_PATTERNS.map(([label]) => label),
      affiliateNetworkEntries: AFFILIATE_NETWORK_PATTERNS.map(([label, , network]) => ({ label, network })),
    });
    writeFileSync(outputMdPath, md + "\n", "utf8");
  } catch (err) {
    console.error(`[triage] could not write ${outputMdPath}: ${err.message}`);
  }

  console.log("[triage] done (v2.1).");
  console.log(`[triage] total candidates: ${candidates.length}`);
  console.log(`[triage] already_in_muga_dropped: ${alreadyInMugaDropped}`);
  for (const bucket of BUCKET_ORDER) {
    console.log(`[triage] ${bucket}: ${bucketCounts[bucket] ?? 0}`);
  }
  console.log(`[triage] adguard data source: ${adguardRaw.source}`);
  console.log(`[triage] clearurls data source: ${clearurlsRaw.source}`);
  for (const w of warnings) console.warn(w);

  return { bucketCounts, alreadyInMugaDropped, totalCandidates: candidates.length, outputJsonPath, outputMdPath };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runTriage({ reportPath: process.argv[2] }).catch((err) => {
    // runTriage is written to never throw; this is a last-resort net so an
    // unexpected error still exits non-zero instead of crashing the process
    // with an unhandled rejection.
    console.error(`[triage] unexpected error: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
