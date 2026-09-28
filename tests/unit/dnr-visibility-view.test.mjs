/**
 * MUGA — Unit tests for the DNR-visibility view-model
 * (src/lib/dnr-visibility-view.js) (#1496)
 *
 * Run with: npm test
 *
 * Pure classifier for chrome.declarativeNetRequest.getMatchedRules()
 * results, used by the popup to tell "this tab was cleaned at the network
 * layer" apart from "this tab was never dirty" on Chrome — both look
 * identical to result.action ("untouched") since DNR redirects before any
 * JS sees the original URL. popup.js is browser-only and cannot be
 * exercised under node:test, so this classification and view-decision logic
 * is extracted here (mirrors the precedent set by domain-stats-view.js and
 * remote-rules-changelog-view.js).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  isCleaningMatch,
  isMainFrameSafeCleaningMatch,
  planDnrVisibilityView,
  planTabBadgeView,
  shouldShowStatsDnrNote,
} from "../../src/lib/dnr-visibility-view.js";
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
  DNR_SCOPED_PARAMS_MAX_RULES,
  DNR_CATEGORY_FILTER_RULE_ID_BASE,
  DNR_CATEGORY_FILTER_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

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

  test("an unrecognized dynamic id — in the gap between known cleaning ranges — fails closed (#1496 review)", () => {
    // Regression guard for the denylist -> allowlist fix: under the old
    // "exclude known non-cleaning ranges" scheme, an id like 1002 (between
    // DNR_REMOTE_PARAMS_RULE_ID=1001 and the allowlist range starting at
    // 2000) matched no exclusion range and was silently counted as
    // cleaning. The allowlist scheme must reject it instead.
    assert.strictEqual(isCleaningMatch({ ruleId: 1002, rulesetId: "_dynamic" }), false);
    // The scoped-params range (3100..3100+MAX-1) and the category-filter
    // range (5100..5100+MAX-1) are documented as CONTIGUOUS (no gap between
    // them), so the only other place to probe is past every known range.
    assert.strictEqual(
      DNR_SCOPED_PARAMS_RULE_ID_BASE + DNR_SCOPED_PARAMS_MAX_RULES,
      DNR_CATEGORY_FILTER_RULE_ID_BASE,
      "scoped-params and category-filter ranges are expected to be contiguous — if this fails, dnr-ids.js grew a real gap worth probing here too"
    );
    const pastEverything = DNR_CATEGORY_FILTER_RULE_ID_BASE + DNR_CATEGORY_FILTER_MAX_RULES + 1000;
    assert.strictEqual(isCleaningMatch({ ruleId: pastEverything, rulesetId: "_dynamic" }), false);
  });

  test("malformed/missing fields never throw and fail closed", () => {
    assert.strictEqual(isCleaningMatch(null), false);
    assert.strictEqual(isCleaningMatch(undefined), false);
    assert.strictEqual(isCleaningMatch({}), false);
    assert.strictEqual(isCleaningMatch({ ruleId: "1", rulesetId: "tracking_params" }), false);
    assert.strictEqual(isCleaningMatch({ ruleId: 1, rulesetId: 42 }), false);
  });
});

describe("isMainFrameSafeCleaningMatch — 'this link' attribution (#1496 review)", () => {
  test("main_frame-only cleaning rulesets are link-safe", () => {
    assert.strictEqual(isMainFrameSafeCleaningMatch({ ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params" }), true);
    assert.strictEqual(isMainFrameSafeCleaningMatch({ ruleId: 200, rulesetId: "amazon_path_canonical" }), true);
    assert.strictEqual(isMainFrameSafeCleaningMatch({ ruleId: DNR_CUSTOM_PARAMS_RULE_ID, rulesetId: "_dynamic" }), true);
  });

  test("wrapper_unwrap (main_frame + sub_frame) is cleaning but NOT link-safe", () => {
    const match = { ruleId: 1, rulesetId: "wrapper_unwrap" };
    assert.strictEqual(isCleaningMatch(match), true);
    assert.strictEqual(isMainFrameSafeCleaningMatch(match), false);
  });

  test("a non-cleaning match is never link-safe either", () => {
    assert.strictEqual(isMainFrameSafeCleaningMatch({ ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params" }), false);
  });
});

describe("resourceTypes assumption pinned against the real shipped rule JSON (#1496 review)", () => {
  // isMainFrameSafeCleaningMatch's whole safety argument rests on "every
  // cleaning ruleset this module trusts targets resourceTypes: [main_frame]
  // ONLY, except wrapper_unwrap". If a future rule change widens any other
  // cleaning ruleset to also match sub_frame/script/image/etc, that rule
  // would start being wrongly attributed to "this link" — catch it here
  // instead of relying on nobody ever re-checking the module doc comment.
  const RULE_FILES = [
    ["src/rules/tracking-params.json", "tracking_params"],
    ["src/rules/amp-redirect.json", "amp_redirect"],
    ["src/rules/amazon-path-canonical.json", "amazon_path_canonical"],
  ];

  for (const [file, rulesetId] of RULE_FILES) {
    test(`${rulesetId} (${file}): every rule is resourceTypes: ["main_frame"] only`, () => {
      const rules = JSON.parse(readFileSync(resolve(root, file), "utf8"));
      assert.ok(Array.isArray(rules) && rules.length > 0, `${file} should be a non-empty rule array`);
      for (const rule of rules) {
        const rt = rule?.condition?.resourceTypes;
        assert.deepStrictEqual(
          rt,
          ["main_frame"],
          `${file} rule id ${rule?.id} has resourceTypes ${JSON.stringify(rt)}, expected exactly ["main_frame"] — ` +
            `isMainFrameSafeCleaningMatch trusts "${rulesetId}" as link-safe; if this genuinely changed, add it to ` +
            "AMBIGUOUS_RESOURCE_TYPE_RULESETS in src/lib/dnr-visibility-view.js instead of relaxing this test."
        );
      }
    });
  }

  test("wrapper_unwrap (src/rules/wrapper-dnr-rules.json) is still main_frame + sub_frame (the documented exception)", () => {
    const rules = JSON.parse(readFileSync(resolve(root, "src/rules/wrapper-dnr-rules.json"), "utf8"));
    assert.ok(Array.isArray(rules) && rules.length > 0);
    for (const rule of rules) {
      assert.deepStrictEqual(rule?.condition?.resourceTypes, ["main_frame", "sub_frame"]);
    }
  });
});

describe("planDnrVisibilityView — reduces a matchedRules array into the popup view model (#1496)", () => {
  test("no matches → not cleaned, zero count, no link claim", () => {
    assert.deepStrictEqual(planDnrVisibilityView([]), { cleaned: false, count: 0, linkCleaned: false });
  });

  test("null/undefined input → not cleaned, never throws", () => {
    assert.deepStrictEqual(planDnrVisibilityView(null), { cleaned: false, count: 0, linkCleaned: false });
    assert.deepStrictEqual(planDnrVisibilityView(undefined), { cleaned: false, count: 0, linkCleaned: false });
  });

  test("only allow/suppress matches → not cleaned", () => {
    const matches = [
      { ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params", timeStamp: 1000 },
      { ruleId: DNR_ALLOWLIST_RULE_ID_BASE, rulesetId: "_dynamic", timeStamp: 1000 },
      { ruleId: DNR_SUPPRESS_REFERER_RULE_ID, rulesetId: "_dynamic", timeStamp: 1000 },
    ];
    assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: false, count: 0, linkCleaned: false });
  });

  test("mixed cleaning + non-cleaning matches → counts only the cleaning ones, link claim true", () => {
    const matches = [
      { ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params", timeStamp: 1000 },
      { ruleId: DNR_SIGNED_URL_ALLOW_RULE_ID, rulesetId: "tracking_params", timeStamp: 1000 },
      { ruleId: 100, rulesetId: "amp_redirect", timeStamp: 1000 },
      { ruleId: DNR_ALLOWLIST_RULE_ID_BASE, rulesetId: "_dynamic", timeStamp: 1000 },
      { ruleId: DNR_CUSTOM_PARAMS_RULE_ID, rulesetId: "_dynamic", timeStamp: 1000 },
    ];
    assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: true, count: 3, linkCleaned: true });
  });

  test("wrapper_unwrap-only match: cleaned/count true, but linkCleaned false (#1496 review)", () => {
    const matches = [{ ruleId: 1, rulesetId: "wrapper_unwrap", timeStamp: 1000 }];
    assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: true, count: 1, linkCleaned: false });
  });

  describe("minTimeStamp scoping (#1496 review)", () => {
    test("a match BEFORE minTimeStamp is ignored entirely", () => {
      const matches = [{ ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params", timeStamp: 999 }];
      assert.deepStrictEqual(
        planDnrVisibilityView(matches, { minTimeStamp: 1000 }),
        { cleaned: false, count: 0, linkCleaned: false }
      );
    });

    test("a match AT or AFTER minTimeStamp is kept", () => {
      const matches = [{ ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params", timeStamp: 1000 }];
      assert.deepStrictEqual(
        planDnrVisibilityView(matches, { minTimeStamp: 1000 }),
        { cleaned: true, count: 1, linkCleaned: true }
      );
    });

    test("a match with a missing/non-numeric timeStamp is excluded once minTimeStamp is given (fails closed)", () => {
      const matches = [
        { ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params" }, // no timeStamp
        { ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params", timeStamp: "not-a-number" },
      ];
      assert.deepStrictEqual(
        planDnrVisibilityView(matches, { minTimeStamp: 1000 }),
        { cleaned: false, count: 0, linkCleaned: false }
      );
    });

    test("without minTimeStamp, matches are not filtered by time (caller's responsibility to omit unscoped calls)", () => {
      const matches = [{ ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params" }];
      assert.deepStrictEqual(planDnrVisibilityView(matches), { cleaned: true, count: 1, linkCleaned: true });
    });

    test("a stale match from an earlier navigation does not trigger the link claim, but a fresh one does", () => {
      const matches = [
        { ruleId: DNR_STATIC_RULE_ID, rulesetId: "tracking_params", timeStamp: 500 }, // earlier nav
        { ruleId: 100, rulesetId: "amp_redirect", timeStamp: 1500 }, // current nav
      ];
      assert.deepStrictEqual(
        planDnrVisibilityView(matches, { minTimeStamp: 1000 }),
        { cleaned: true, count: 1, linkCleaned: true }
      );
    });

    test("subresource-only rule (wrapper_unwrap) within the time window still does not trigger the link claim", () => {
      const matches = [{ ruleId: 1, rulesetId: "wrapper_unwrap", timeStamp: 1500 }];
      assert.deepStrictEqual(
        planDnrVisibilityView(matches, { minTimeStamp: 1000 }),
        { cleaned: true, count: 1, linkCleaned: false }
      );
    });
  });
});

describe("planTabBadgeView — chip source priority (#1496 review)", () => {
  test("JS session count wins whenever positive, even if the DNR count is higher", () => {
    assert.deepStrictEqual(planTabBadgeView(2, { count: 9 }), { count: 2, source: "js" });
  });

  test("DNR count fills in only when the JS count is zero/missing", () => {
    assert.deepStrictEqual(planTabBadgeView(0, { count: 3 }), { count: 3, source: "dnr" });
    assert.deepStrictEqual(planTabBadgeView(null, { count: 3 }), { count: 3, source: "dnr" });
    assert.deepStrictEqual(planTabBadgeView(undefined, { count: 3 }), { count: 3, source: "dnr" });
  });

  test("both zero/absent → null (chip hidden)", () => {
    assert.strictEqual(planTabBadgeView(0, null), null);
    assert.strictEqual(planTabBadgeView(0, { count: 0 }), null);
    assert.strictEqual(planTabBadgeView(0, undefined), null);
  });

  test("negative/NaN JS count is treated as zero, never throws", () => {
    assert.deepStrictEqual(planTabBadgeView(NaN, { count: 4 }), { count: 4, source: "dnr" });
    assert.deepStrictEqual(planTabBadgeView("not-a-number", { count: 4 }), { count: 4, source: "dnr" });
  });
});

describe("shouldShowStatsDnrNote — stats-block caveat visibility (#1496 review)", () => {
  test("Chrome, not fresh install → shown", () => {
    assert.strictEqual(shouldShowStatsDnrNote({ hasDnrMatching: true, isFresh: false }), true);
  });

  test("Firefox (no DNR matching API) → hidden regardless of freshness", () => {
    assert.strictEqual(shouldShowStatsDnrNote({ hasDnrMatching: false, isFresh: false }), false);
    assert.strictEqual(shouldShowStatsDnrNote({ hasDnrMatching: false, isFresh: true }), false);
  });

  test("Chrome, fresh install → hidden (the zero-state message already covers it)", () => {
    assert.strictEqual(shouldShowStatsDnrNote({ hasDnrMatching: true, isFresh: true }), false);
  });
});
