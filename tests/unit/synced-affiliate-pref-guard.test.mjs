/**
 * MUGA — synced-affiliate-pref-guard (#364)
 *
 * Pure-logic tests. Covers every branch: no prefs synced, remote-rules
 * synced, already-onboarded (no prompts), already-overridden (no
 * prompts), false sync values (no prompts).
 *
 * drop-affiliate-injection (PR 1b): injectOwnAffiliate was removed from
 * GUARDED_PREFS — the pref itself is retired, and its only consumer (the
 * onboarding guarded-pref confirmation step) was deleted entirely.
 * remoteRulesEnabled is now the sole guarded pref.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pendingConfirmations,
  GUARDED_PREFS,
} from "../../src/lib/synced-affiliate-pref-guard.js";

describe("synced-affiliate-pref-guard — GUARDED_PREFS", () => {
  test("contains only remoteRulesEnabled", () => {
    assert.deepEqual(GUARDED_PREFS, ["remoteRulesEnabled"]);
  });

  test("no longer contains the retired injectOwnAffiliate pref", () => {
    assert.ok(!GUARDED_PREFS.includes("injectOwnAffiliate"));
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
      syncPrefs: { remoteRulesEnabled: false },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, []);
  });

  test("onboarding already completed → empty even when sync says true", () => {
    const r = pendingConfirmations({
      syncPrefs: { remoteRulesEnabled: true },
      localConsent: { onboardingDone: true, consentVersion: "1.0" },
      overrides: {},
    });
    assert.deepEqual(r, []);
  });

  test("a retired non-guarded pref synced as true is never pending", () => {
    // injectOwnAffiliate is no longer a member of GUARDED_PREFS — even if a
    // stale synced value of `true` still exists from before the pref was
    // retired, pendingConfirmations must not surface it.
    const r = pendingConfirmations({
      syncPrefs: { injectOwnAffiliate: true, remoteRulesEnabled: false },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, []);
  });
});

describe("pendingConfirmations — remoteRulesEnabled", () => {
  test("remote rules synced as true → pending", () => {
    const r = pendingConfirmations({
      syncPrefs: { remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: {},
    });
    assert.deepEqual(r, ["remoteRulesEnabled"]);
  });
});

describe("pendingConfirmations — overrides", () => {
  test("remote rules already overridden → nothing pending", () => {
    const r = pendingConfirmations({
      syncPrefs: { remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: { remoteRulesEnabled: false },
    });
    assert.deepEqual(r, []);
  });

  test("override value true (user confirmed) also suppresses prompt", () => {
    const r = pendingConfirmations({
      syncPrefs: { remoteRulesEnabled: true },
      localConsent: { onboardingDone: false },
      overrides: { remoteRulesEnabled: true },
    });
    assert.deepEqual(r, []);
  });
});
