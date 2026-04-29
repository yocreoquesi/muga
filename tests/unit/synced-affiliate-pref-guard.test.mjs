/**
 * MUGA — synced-affiliate-pref-guard (#364)
 *
 * Pure-logic tests. Covers every branch: no prefs synced, only
 * affiliate, only remote-rules, both, already-onboarded (no prompts),
 * already-overridden (no prompts), false sync values (no prompts).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pendingConfirmations,
  GUARDED_PREFS,
} from "../../src/lib/synced-affiliate-pref-guard.js";

describe("synced-affiliate-pref-guard — GUARDED_PREFS", () => {
  test("contains injectOwnAffiliate and remoteRulesEnabled", () => {
    assert.ok(GUARDED_PREFS.includes("injectOwnAffiliate"));
    assert.ok(GUARDED_PREFS.includes("remoteRulesEnabled"));
  });

  test("is frozen — closed set", () => {
    assert.ok(Object.isFrozen(GUARDED_PREFS));
  });
});

describe("pendingConfirmations — empty / no prompts", () => {
  test("no sync prefs at all → empty", () => {
    const r = pendingConfirmations({});
    assert.deepEqual(r, []);
  });

  test("sync prefs all false → empty", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: false, remoteRulesEnabled: false },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, []);
  });

  test("onboarding already completed → empty even when sync says true", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: true },
      localConsent: { onboardingDone: true, consentVersion: "1.0" },
      overrides: {},
    });
    assert.deepEqual(r, []);
  });
});

describe("pendingConfirmations — single pref", () => {
  test("only affiliate synced as true", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: false },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, ["injectOwnAffiliate"]);
  });

  test("only remote rules synced as true", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: false, remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, ["remoteRulesEnabled"]);
  });
});

describe("pendingConfirmations — both prefs", () => {
  test("both synced as true → both pending in declared order", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, ["injectOwnAffiliate", "remoteRulesEnabled"]);
  });
});

describe("pendingConfirmations — overrides", () => {
  test("affiliate already overridden → only remote rules pending", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: { injectOwnAffiliate: false },
    });
    assert.deepEqual(r, ["remoteRulesEnabled"]);
  });

  test("override value true (user confirmed) also suppresses prompt", () => {
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: { injectOwnAffiliate: true, remoteRulesEnabled: true },
    });
    assert.deepEqual(r, []);
  });
});
