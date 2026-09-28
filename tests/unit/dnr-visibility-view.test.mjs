/**
 * MUGA — Unit tests for planDnrVisibilityView / isCleaningMatch
 * (src/lib/dnr-visibility-view.js) (#1496)
 *
 * Run with: npm test
 *
 * Pure classifier for chrome.declarativeNetRequest.getMatchedRules()
 * results, used by the popup to tell "this tab was cleaned at the network
 * layer" apart from "this tab was never dirty" on Chrome — both look
 * identical to result.action ("untouched") since DNR redirects before any
 * JS sees the original URL. popup.js is browser-only and cannot be
 * exercised under node:test, so this classification logic is extracted here
 * (mirrors the precedent set by domain-stats-view.js and
 * remote-rules-changelog-view.js).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isCleaningMatch, planDnrVisibilityView } from "../../src/lib/dnr-visibility-view.js";
import {
  DNR_STATIC_RULE_ID,
  DNR_SIGNED_URL_ALLOW_RULE_ID,
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_PATH_SCOPED_RULE_ID_BASE,
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_SCOPED_PARAMS_RULE_ID_BASE,
  DNR_CATEGORY_FILTER_RULE_ID_BASE,
} from "../../src/lib/dnr-ids.js";

describe("isCleaningMatch — classifies one getMatchedRules() entry (#1496)", () => {
  test("global tracking-params strip rule counts as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params" }), true);
  });

  test("per-domain-profile and path-scoped strip rules count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_DOMAIN_PRESERVE_RULE_ID_BASE + 3, rulesetId: "tracking_params" }), true);
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_PATH_SCOPED_RULE_ID_BASE + 1, rulesetId: "tracking_params" }), true);
  });

  test("signed-URL allow guard (#1200) does NOT count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params" }), false);
  });

  test("AMP unwrap, wrapper unwrap, and Amazon path-canonical rules count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: 100, rulesetId: "amp_redirect" }), true);
    assert.strictEqual(isCleaningMatch({ ruleId: 1, rulesetId: "wrapper_unwrap" }), true);
    assert.strictEqual(isCleaningMatch({ ruleId: 200, rulesetId: "amazon_path_canonical" }), true);
  });

  test("dynamic custom-params and remote-params strip rules count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_CUSTOM_PARAMS_RULE_ID, rulesetId: "_dynamic" }), true);
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_REMOTE_PARAMS_RULE_ID, rulesetId: "_dynamic" }), true);
  });

  test("dynamic host-scoped remote strip rules count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_SCOPED_PARAMS_RULE_ID_BASE + 5, rulesetId: "_dynamic" }), true);
  });

  test("dynamic allowlist allow rules do NOT count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_ALLOWLIST_RULE_ID_BASE, rulesetId: "_dynamic" }), false);
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_ALLOWLIST_RULE_ID_BASE + 42, rulesetId: "_dynamic" }), false);
  });

  test("global Referer-suppress and beacon-block rules do NOT count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_SUPPRESS_REFERER_RULE_ID, rulesetId: "_dynamic" }), false);
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_BLOCK_BEACONS_RULE_ID, rulesetId: "_dynamic" }), false);
  });

  test("blocklist Referer-force and beacon-block ranges do NOT count as cleaning", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_BLOCKLIST_REFERER_RULE_ID_BASE + 1, rulesetId: "_dynamic" }), false);
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_BLOCKLIST_BEACON_RULE_ID_BASE + 1, rulesetId: "_dynamic" }), false);
  });

  test("category-filtered mirror range counts as cleaning (documented limitation)", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: DNR_CATEGORY_FILTER_RULE_ID_BASE, rulesetId: "_dynamic" }), true);
  });

  test("unrecognized ruleset id fails closed (does not count)", () => {
    assert.strictEqual(isCleaningMatch({ ruleId: 1, rulesetId: "some_future_ruleset" }), false);
  });

  test("malformed/missing fields never throw and fail closed", () => {
    assert.strictEqual(isCleaningMatch(null), false);
    assert.strictEqual(isCleaningMatch(undefined), false);
    assert.strictEqual(isCleaningMatch({}), false);
    assert.strictEqual(isCleaningMatch({ ruleId: "1", rulesetId: "tracking_params" }), false);
    assert.strictEqual(isCleaningMatch({ ruleId: 1, rulesetId: 42 }), false);
  });
});

describe("planDnrVisibilityView — reduces a matchedRules array into the popup view model (#1496)", () => {
  test("no matches → not cleaned, zero count", () => {
    assert.deepStrictEqual(planDnrVisibilityView([]), { cleaned: false, count: 0 });
  });

  test("null/undefined input → not cleaned, never throws", () => {
    assert.deepStrictEqual(planDnrVisibilityView(null), { cleaned: false, count: 0 });
    assert.deepStrictEqual(planDnrVisibilityView(undefined), { cleaned: false, count: 0 });
  });

  test("only allow/suppress matches → not cleaned", () => {
    const matches = [
      { ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params" },
      { ruleId: DNR_ALLOWLIST_RULE_ID_BASE, rulesetId: "_dynamic" },
      { ruleId: DNR_SUPPRESS_REFERER_RULE_ID, rulesetId: "_dynamic" },
    ];
    assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: false, count: 0 });
  });

  test("mixed cleaning + non-cleaning matches → counts only the cleaning ones", () => {
    const matches = [
      { ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params" },
      { ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params" },
      { ruleId: 100, rulesetId: "amp_redirect" },
      { ruleId: DNR_ALLOWLIST_RULE_ID_BASE, rulesetId: "_dynamic" },
      { ruleId: DNR_CUSTOM_PARAMS_RULE_ID, rulesetId: "_dynamic" },
    ];
    assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: true, count: 3 });
  });
});
