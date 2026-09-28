/**
 * MUGA — DNR-match visibility view-model (#1496)
 *
 * On Chrome, MUGA's declarativeNetRequest rules strip tracking params and
 * unwrap redirect wrappers at the NETWORK layer, before any JS (including
 * the content-script cleaner and this popup's own `cleanForPreview` check)
 * ever sees the original URL. A tab that was cleaned this way looks
 * IDENTICAL, from the popup's point of view, to a tab that was never dirty
 * — `result.action` reports "untouched" either way (#1062, 2026-07-12: the
 * maintainer decided against webRequest/webNavigation/
 * declarativeNetRequestFeedback, since all three add the "Read your
 * browsing history" permission warning, and a NEW warning on update
 * disables the extension until the user re-approves it).
 *
 * `chrome.declarativeNetRequest.getMatchedRules({ tabId })` closes part of
 * that gap with NO new permission: it is available to any extension holding
 * `activeTab` for the queried tab (granted for free the moment the user
 * opens the popup — see
 * https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-getMatchedRules),
 * and calls made from a user gesture (opening the popup is one) are exempt
 * from its 20-calls/10-min quota. Each match is only
 * `{ ruleId, rulesetId, tabId, timeStamp }` — no matched URL, no resource
 * type — Firefox's MV2 build has no declarativeNetRequest matching API at
 * all, so this module is Chrome-only; the popup shell feature-detects
 * before ever calling it.
 *
 * ── Two distinct claims, two distinct bars of proof ─────────────────────
 *
 * `getMatchedRules` returns EVERY match still on record for the tab: matches
 * from an EARLIER navigation in the same tab (retained up to 5 minutes, or
 * until the document that made them is gone), and matches from SUBRESOURCE
 * or IFRAME requests on the CURRENT page, not just its own top-level
 * navigation. Two popup-visible claims need two different levels of
 * confidence against that noise:
 *
 *   - "N cleaned in this tab" (the per-tab chip) only needs to know a clean
 *     genuinely happened somewhere in this tab recently — `count`/`cleaned`
 *     below.
 *   - "MUGA cleaned THIS LINK before it loaded" (the popup's headline
 *     message) is a claim about the CURRENT top-level navigation
 *     specifically, and must not fire on a stale match from a previous page
 *     or on a subresource/iframe of the current one — `linkCleaned` below.
 *
 * Two independent filters combine to make `linkCleaned` safe:
 *
 *   1. TIME: the caller passes `minTimeStamp` — the current document's
 *      `performance.timeOrigin` (an epoch-ms timestamp, the same unit
 *      `getMatchedRules`' own `timeStamp` field uses), sourced from the
 *      content script via the existing GET_REFERRER message channel (see
 *      popup.js's getDnrVisibilityView). Passed straight through to Chrome
 *      as part of the `getMatchedRules` filter (so the browser does the
 *      bulk of the filtering, and the quota/data transferred stays small),
 *      and re-applied here defensively (so it is unit-testable independent
 *      of Chrome's own behavior, and so a match with a missing/malformed
 *      timestamp fails closed instead of silently passing through).
 *   2. RESOURCE TYPE: `getMatchedRules` does not report which resource type
 *      a match was for, so this module cannot ask directly. Instead it
 *      knows, from the DNR rule JSON MUGA ships, which cleaning rulesets are
 *      STRUCTURALLY incapable of matching anything but a top-level
 *      navigation. Verified against the actual shipped rule files: every
 *      cleaning ruleset targets `resourceTypes: ["main_frame"]` ONLY except
 *      `wrapper_unwrap` (src/rules/wrapper-dnr-rules.json, ids 1-2), whose
 *      condition is `["main_frame", "sub_frame"]` — a match there could be
 *      an IFRAME's wrapper being unwrapped, not the tab's own link. A match
 *      in that ruleset still counts toward `count`/`cleaned` (something in
 *      this tab genuinely got cleaned) but is EXCLUDED from `linkCleaned`.
 *      `tests/unit/dnr-visibility-view.test.mjs` pins this against the real
 *      rule files so a future rule change that widens resourceTypes on a
 *      ruleset this module trusts gets caught.
 *
 * ── Fail-closed classification ──────────────────────────────────────────
 *
 * Not every MUGA rule that can match is a "MUGA cleaned this" signal.
 * Several exist to ALLOW or SUPPRESS rather than clean a URL: the signed-URL
 * allow guard (#1200), per-domain allowlist rules, and the Referer/beacon
 * privacy rules. Counting those would silently overcount — the same class
 * of honesty bug the vacuous `>=` stats assertion this issue also fixes let
 * through (see tests/e2e/url-cleaning.spec.mjs). This module classifies
 * each match against the authoritative ID/ruleset registry in
 * src/lib/dnr-ids.js, and — for the dynamic ("_dynamic") ruleset — does so
 * by ALLOWLISTING the known cleaning id ranges rather than denylisting the
 * known non-cleaning ones: a future dynamic rule family this module has not
 * been taught about yet is NOT counted, rather than silently counted by
 * default. The static rulesets are allowlisted by name for the same reason
 * (an unrecognized rulesetId already falls through to `false`).
 *
 * KNOWN LIMITATION: the category-filtered mirror range (5100-5399,
 * DNR_CATEGORY_FILTER_RULE_ID_BASE in dnr-ids.js) re-registers the WHOLE
 * static tracking-params ruleset — including its signed-URL allow guard —
 * as dynamic rules whose ids are assigned by POSITION in that ruleset (see
 * buildCategoryFilteredRules in src/lib/dnr-category-filter.js), not by a
 * fixed offset. getMatchedRules never returns the matched rule's body, only
 * its id, so this module cannot tell a mirrored strip rule from the
 * mirrored allow guard without a second network round trip
 * (getDynamicRules) on every popup open. That intersection is narrow
 * (prefs.disabledCategories non-empty AND the current tab is a signed URL)
 * and this is a popup visibility nicety, not the #1200 protection itself
 * (which lives in the DNR rule, unaffected by this module) — so the whole
 * mirror range is allowlisted as a known-cleaning range, accepting a rare
 * off-by-one overcount in that one intersection rather than a second async
 * call on every popup open.
 */

import {
  DNR_SIGNED_URL_ALLOW_RULE_ID,
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  DNR_SCOPED_PARAMS_RULE_ID_BASE,
  DNR_SCOPED_PARAMS_MAX_RULES,
  DNR_CATEGORY_FILTER_RULE_ID_BASE,
  DNR_CATEGORY_FILTER_MAX_RULES,
} from "./dnr-ids.js";

// Static rulesets (src/manifest.json declarative_net_request.rule_resources)
// whose ids are ENTIRELY cleaning rules (redirect/unwrap/canonicalize) —
// unlike "tracking_params", none of these carry an allow-only rule.
const CLEANING_ONLY_STATIC_RULESETS = new Set([
  "amp_redirect",
  "wrapper_unwrap",
  "amazon_path_canonical",
]);

// Static/dynamic rulesets whose condition targets more than just
// `main_frame` (see module doc, filter 2) — a match here is cleaning, but
// MUST NOT be attributed to "this link" specifically. Verified against the
// shipped rule JSON by tests/unit/dnr-visibility-view.test.mjs; every other
// ruleset this module treats as cleaning is main_frame-only.
const AMBIGUOUS_RESOURCE_TYPE_RULESETS = new Set([
  "wrapper_unwrap", // src/rules/wrapper-dnr-rules.json: ["main_frame", "sub_frame"]
]);

// Dynamic ("_dynamic") ruleset id ranges that ARE cleaning rules — every
// other id (including any future non-cleaning family, and any id in a gap
// between these ranges) is NOT counted. Allowlist, not a denylist: see
// module doc's "Fail-closed classification" section. All of these are
// main_frame-only (dnr-sync.js, remote-rules.js, and
// dnr-category-filter.js's structuredClone of the equally main_frame-only
// static rules it mirrors), so none needs an AMBIGUOUS_RESOURCE_TYPE entry.
/** @type {Array<[number, number]>} */
const DYNAMIC_CLEANING_RANGES = [
  [DNR_CUSTOM_PARAMS_RULE_ID, DNR_CUSTOM_PARAMS_RULE_ID],
  [DNR_REMOTE_PARAMS_RULE_ID, DNR_REMOTE_PARAMS_RULE_ID],
  [DNR_SCOPED_PARAMS_RULE_ID_BASE, DNR_SCOPED_PARAMS_RULE_ID_BASE + DNR_SCOPED_PARAMS_MAX_RULES - 1],
  [DNR_CATEGORY_FILTER_RULE_ID_BASE, DNR_CATEGORY_FILTER_RULE_ID_BASE + DNR_CATEGORY_FILTER_MAX_RULES - 1],
];

/**
 * @param {number} n
 * @param {[number, number]} range
 * @returns {boolean}
 */
function inRange(n, [lo, hi]) {
  return n >= lo && n <= hi;
}

/**
 * True when one `getMatchedRules()` entry represents MUGA actively cleaning
 * the request (stripping a tracking param, unwrapping a redirect, or
 * canonicalizing a path) rather than allowing, suppressing, or blocking it.
 *
 * @param {{ruleId?: unknown, rulesetId?: unknown}} match
 * @returns {boolean}
 */
export function isCleaningMatch(match) {
  if (!match || typeof match.ruleId !== "number" || typeof match.rulesetId !== "string") return false;
  const { ruleId, rulesetId } = match;

  if (rulesetId === "tracking_params") return ruleId !== DNR_SIGNED_URL_ALLOW_RULE_ID;
  if (CLEANING_ONLY_STATIC_RULESETS.has(rulesetId)) return true;
  if (rulesetId === "_dynamic") {
    return DYNAMIC_CLEANING_RANGES.some((range) => inRange(ruleId, range));
  }
  // Unrecognized ruleset id (future rule family this module hasn't been
  // taught about yet) — fail closed rather than silently over-counting.
  return false;
}

/**
 * True when a cleaning match can be safely attributed to the tab's OWN
 * top-level navigation — i.e. its ruleset cannot also match a subresource
 * or iframe request. See module doc, filter 2.
 *
 * @param {{ruleId?: unknown, rulesetId?: unknown}} match
 * @returns {boolean}
 */
export function isMainFrameSafeCleaningMatch(match) {
  return isCleaningMatch(match) && !AMBIGUOUS_RESOURCE_TYPE_RULESETS.has(/** @type {string} */ (match.rulesetId));
}

/**
 * Slack applied to `minTimeStamp` before scoping matches (#1496 review).
 * performance.timeOrigin comes from the renderer clock and getMatchedRules
 * timestamps from the browser process; a main_frame redirect can land within
 * a millisecond of navigation start, so a strict `>=` across two clocks could
 * drop the very match that proves this navigation was cleaned. 250 ms absorbs
 * that skew while staying far below the gap between two real navigations.
 */
export const DNR_CLOCK_SKEW_MS = 250;

/**
 * Reduces a `chrome.declarativeNetRequest.getMatchedRules()` response into
 * the popup's DNR-visibility view model.
 *
 * @param {Array<{ruleId: number, rulesetId: string, timeStamp?: number}>|null|undefined} matchedRulesList
 *   The `matchedRules` array from getMatchedRules(). Defensively tolerant of
 *   a missing/malformed array so a popup-side call site can pass the raw
 *   API response straight through.
 * @param {{minTimeStamp?: number}} [opts] - `minTimeStamp`: the current
 *   document's navigation-start epoch-ms timestamp (performance.timeOrigin).
 *   When given, a match is only considered when its own `timeStamp` is a
 *   number `>= minTimeStamp` — a match with a missing/non-numeric timestamp
 *   is EXCLUDED (fails closed) rather than assumed current. Omit only when
 *   the caller could not source a navigation-start timestamp at all; the
 *   popup falls back to not calling this module in that case (see
 *   popup.js's getDnrVisibilityView) rather than passing an untemporally-
 *   scoped result off as current.
 * @returns {{cleaned: boolean, count: number, linkCleaned: boolean}}
 */
export function planDnrVisibilityView(matchedRulesList, { minTimeStamp } = {}) {
  const list = Array.isArray(matchedRulesList) ? matchedRulesList : [];
  const scoped = typeof minTimeStamp === "number"
    ? list.filter((m) => typeof m?.timeStamp === "number" && m.timeStamp >= minTimeStamp)
    : list;
  const cleaningMatches = scoped.filter(isCleaningMatch);
  const count = cleaningMatches.length;
  const linkCleaned = cleaningMatches.some(isMainFrameSafeCleaningMatch);
  return { cleaned: count > 0, count, linkCleaned };
}

/**
 * Decides which source feeds the popup's per-tab "N cleaned/stripped in
 * this tab" chip (#89, extended #1496). The JS-driven session count
 * (`tab_${tabId}` in chrome.storage.session, content-script-reported) is
 * the more precise, already-shipped signal, so it wins whenever it is
 * positive. The DNR-derived count only fills the chip in when NOTHING
 * JS-driven happened in this tab — it never adds to or overrides a real
 * JS count, both to avoid double-counting the same clean twice (a
 * same-document reclean can be JS-driven even on Chrome, see
 * cleaning-context.js) and because the JS count's label ("stripped") makes
 * a more specific claim than the DNR count's ("cleaned") can back up.
 *
 * @param {number|null|undefined} jsCount - the tab's `tab_${tabId}` session count.
 * @param {{count: number}|null|undefined} dnrView - planDnrVisibilityView() result, or null
 *   (Firefox, or the Chrome check was inconclusive).
 * @returns {{count: number, source: "js"|"dnr"}|null} null hides the chip.
 */
export function planTabBadgeView(jsCount, dnrView) {
  const js = Number(jsCount) || 0;
  if (js > 0) return { count: js, source: "js" };
  const dnr = dnrView && typeof dnrView.count === "number" ? dnrView.count : 0;
  if (dnr > 0) return { count: dnr, source: "dnr" };
  return null;
}

/**
 * Decides whether the popup's stats-block caveat ("these counters may not
 * include every clean made at the network level") should be shown. Chrome
 * only (Firefox's blocking webRequest stripper sees every clean, so the
 * counters are accurate there), and never during the #1260 fresh-install
 * zero state, which already explains "nothing counted yet" on its own —
 * showing both at once would read as noise, not honesty.
 *
 * @param {{hasDnrMatching: boolean, isFresh: boolean}} args
 * @returns {boolean}
 */
export function shouldShowStatsDnrNote({ hasDnrMatching, isFresh }) {
  return !!hasDnrMatching && !isFresh;
}
