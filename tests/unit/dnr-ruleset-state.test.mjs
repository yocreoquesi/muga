/**
 * MUGA — partitionRulesets (gate-open DNR ruleset enable/disable decision).
 *
 * The load-bearing invariant this pins: on Firefox MV2 the `tracking_params`
 * static ruleset is DISABLED, because the blocking webRequest stripper
 * (service-worker.js onBeforeNavigateStrip) is the sole network-layer strip path
 * there — it counts cleaned URLs and avoids a redundant, order-dependent
 * DNR+webRequest double-strip. On Chrome it stays enabled (no blocking
 * webRequest). Nothing else asserted this before; a regression here would
 * silently zero the Firefox counter or double-strip.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { partitionRulesets } from "../../src/lib/dnr-ruleset-state.js";

// Firefox MV2 declares exactly these two static rulesets (see manifest.v2.json).
const FIREFOX_DECLARED = ["tracking_params", "wrapper_unwrap"];
// Chrome MV3 declares more (tracking_params, wrapper_unwrap, amp_redirect,
// amazon_path_canonical); the exact set doesn't matter for these unit cases.
const CHROME_DECLARED = ["tracking_params", "wrapper_unwrap", "amp_redirect", "amazon_path_canonical"];

const allPrefsOn = { ampRedirect: true, unwrapRedirects: true };
const allPrefsOff = { ampRedirect: false, unwrapRedirects: false };

describe("partitionRulesets — tracking_params ownership by browser", () => {
  test("Firefox MV2 DISABLES tracking_params (webRequest stripper owns it)", () => {
    const { enableRulesetIds, disableRulesetIds } =
      partitionRulesets(FIREFOX_DECLARED, allPrefsOn, { isFirefoxMV2: true });
    assert.ok(disableRulesetIds.includes("tracking_params"),
      "tracking_params must be disabled on Firefox so the webRequest stripper is the sole strip path");
    assert.ok(!enableRulesetIds.includes("tracking_params"),
      "tracking_params must not also be enabled on Firefox");
  });

  test("Chrome ENABLES tracking_params (DNR is its strip path)", () => {
    const { enableRulesetIds, disableRulesetIds } =
      partitionRulesets(CHROME_DECLARED, allPrefsOn, { isFirefoxMV2: false });
    assert.ok(enableRulesetIds.includes("tracking_params"));
    assert.ok(!disableRulesetIds.includes("tracking_params"));
  });

  test("default opts (no isFirefoxMV2) treats as Chrome — enables tracking_params", () => {
    const { enableRulesetIds } = partitionRulesets(CHROME_DECLARED, allPrefsOn);
    assert.ok(enableRulesetIds.includes("tracking_params"));
  });
});

describe("partitionRulesets — feature-pref gating", () => {
  test("amp_redirect follows prefs.ampRedirect", () => {
    assert.ok(partitionRulesets(CHROME_DECLARED, allPrefsOn).enableRulesetIds.includes("amp_redirect"));
    assert.ok(partitionRulesets(CHROME_DECLARED, allPrefsOff).disableRulesetIds.includes("amp_redirect"));
  });

  test("wrapper_unwrap follows prefs.unwrapRedirects (both browsers)", () => {
    assert.ok(partitionRulesets(FIREFOX_DECLARED, allPrefsOn, { isFirefoxMV2: true }).enableRulesetIds.includes("wrapper_unwrap"));
    assert.ok(partitionRulesets(FIREFOX_DECLARED, allPrefsOff, { isFirefoxMV2: true }).disableRulesetIds.includes("wrapper_unwrap"));
  });

  test("amazon_path_canonical is always enabled when present", () => {
    assert.ok(partitionRulesets(CHROME_DECLARED, allPrefsOff).enableRulesetIds.includes("amazon_path_canonical"));
  });
});

describe("partitionRulesets — unmanaged rulesets surface, not silently dropped", () => {
  test("an unknown ruleset id is enabled (manifest default) and reported in unmanaged", () => {
    const { enableRulesetIds, unmanaged } =
      partitionRulesets([...CHROME_DECLARED, "future_ruleset"], allPrefsOn);
    assert.ok(enableRulesetIds.includes("future_ruleset"));
    assert.deepEqual(unmanaged, ["future_ruleset"]);
  });

  test("no unmanaged ids for the known Firefox/Chrome sets", () => {
    assert.deepEqual(partitionRulesets(FIREFOX_DECLARED, allPrefsOn, { isFirefoxMV2: true }).unmanaged, []);
    assert.deepEqual(partitionRulesets(CHROME_DECLARED, allPrefsOn).unmanaged, []);
  });
});
