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
 * from its 20-calls/10-min quota. It does not return the matched URL, only
 * `{ ruleId, rulesetId, tabId, timeStamp }` per match — Firefox's MV2 build
 * has no declarativeNetRequest matching API at all, so this module is
 * Chrome-only; the popup shell feature-detects before ever calling it.
 *
 * Not every MUGA rule that can match is a "MUGA cleaned this" signal.
 * Several exist to ALLOW or SUPPRESS rather than clean a URL: the signed-URL
 * allow guard (#1200), per-domain allowlist rules, and the Referer/beacon
 * privacy rules. Counting those would silently overcount — the same class
 * of honesty bug the vacuous `>=` stats assertion this issue also fixes let
 * through (see tests/e2e/url-cleaning.spec.mjs). This module classifies
 * each match against the authoritative ID/ruleset registry in
 * src/lib/dnr-ids.js so only genuine cleaning matches are counted.
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
 * (which lives in the DNR rule, unaffected by this module) — so mirrored
 * ids are treated as cleaning matches, accepting a rare off-by-one
 * overcount in that one intersection rather than a second async call on
 * every popup open.
 */

import {
  DNR_SIGNED_URL_ALLOW_RULE_ID,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
} from "./dnr-ids.js";

// Static rulesets (src/manifest.json declarative_net_request.rule_resources)
// whose ids are ENTIRELY cleaning rules (redirect/unwrap/canonicalize) —
// unlike "tracking_params", none of these carry an allow-only rule.
const CLEANING_ONLY_STATIC_RULESETS = new Set([
  "amp_redirect",
  "wrapper_unwrap",
  "amazon_path_canonical",
]);

// Dynamic ("_dynamic") ruleset id ranges that ALLOW or SUPPRESS rather than
// clean a request — excluded from the cleaning count. See dnr-ids.js.
/** @type {Array<[number, number]>} */
const DYNAMIC_NON_CLEANING_RANGES = [
  [DNR_ALLOWLIST_RULE_ID_BASE, DNR_ALLOWLIST_RULE_ID_BASE + DNR_ALLOWLIST_MAX_RULES - 1],
  [DNR_SUPPRESS_REFERER_RULE_ID, DNR_SUPPRESS_REFERER_RULE_ID],
  [DNR_BLOCK_BEACONS_RULE_ID, DNR_BLOCK_BEACONS_RULE_ID],
  [DNR_BLOCKLIST_REFERER_RULE_ID_BASE, DNR_BLOCKLIST_REFERER_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1],
  [DNR_BLOCKLIST_BEACON_RULE_ID_BASE, DNR_BLOCKLIST_BEACON_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1],
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
    return !DYNAMIC_NON_CLEANING_RANGES.some((range) => inRange(ruleId, range));
  }
  // Unrecognized ruleset id (future rule family this module hasn't been
  // taught about yet) — fail closed rather than silently over-counting.
  return false;
}

/**
 * Reduces a `chrome.declarativeNetRequest.getMatchedRules()` response into
 * the popup's DNR-visibility view model.
 *
 * @param {Array<{ruleId: number, rulesetId: string}>|null|undefined} matchedRulesList
 *   The `matchedRules` array from getMatchedRules(). Defensively tolerant of
 *   a missing/malformed array so a popup-side call site can pass the raw
 *   API response straight through.
 * @returns {{cleaned: boolean, count: number}}
 */
export function planDnrVisibilityView(matchedRulesList) {
  const list = Array.isArray(matchedRulesList) ? matchedRulesList : [];
  const count = list.filter(isCleaningMatch).length;
  return { cleaned: count > 0, count };
}
