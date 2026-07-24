/**
 * MUGA — migrateCookieConsentMode (cookie-consent 2-state mode)
 *
 * Converts the legacy `cookieConsentMinimizerEnabled` boolean into the new
 * `cookieConsentMode` enum ("off" | "reject-only"). Idempotent, safe every
 * startup, keyed off the onboarding-completed signal
 * (chrome.storage.local["mugaConsent"].onboardingDone via consent-storage.js)
 * to distinguish existing users from fresh installs.
 *
 * Also runs a defensive cleanup, unconditionally, on every call: a
 * persisted `cookieConsentMode === "accept-when-necessary"` (the removed
 * accept-click mode, which never shipped enabled to real users but may
 * exist in a pre-release/dev profile) collapses to `"reject-only"`, and a
 * stale `cookieConsentAcceptConsented` key (the retired accept-gesture
 * flag) is dropped.
 *
 * Uses a stateful in-memory chrome.storage stub (mirrors the pattern in
 * tests/unit/per-site-disable-migration.test.mjs) covering BOTH sync
 * (the migrated pref) and local (the onboarding-completed signal) — and
 * re-imports the module fresh per test to bypass module caching of the
 * chrome ref.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

function installChromeStub({ sync = {}, local = {} } = {}) {
  const syncStore = new Map(Object.entries(sync));
  const localStore = new Map(Object.entries(local));

  const makeArea = (store) => ({
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
      } else if (Array.isArray(defaults)) {
        for (const k of defaults) result[k] = store.has(k) ? store.get(k) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = store.has(k) ? store.get(k) : v;
        }
      }
      cb && cb(result);
    },
    set: (data, cb) => {
      for (const [k, v] of Object.entries(data)) store.set(k, v);
      cb && cb();
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
      cb && cb();
    },
  });

  globalThis.chrome = {
    storage: { sync: makeArea(syncStore), local: makeArea(localStore) },
    runtime: { lastError: null },
  };

  return { syncStore, localStore };
}

async function loadMigration() {
  // Re-import to bypass module caching of the chrome ref across tests.
  return import("../../src/lib/storage-migrations.js?cb=" + Math.random());
}

describe("migrateCookieConsentMode", () => {
  let stores;

  test("legacy true -> reject-only, legacy key removed", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMinimizerEnabled: true },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
    assert.equal(stores.syncStore.has("cookieConsentMinimizerEnabled"), false);
  });

  test("legacy false + existing user (onboardingDone true) -> off, legacy key removed", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMinimizerEnabled: false },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
    assert.equal(stores.syncStore.has("cookieConsentMinimizerEnabled"), false);
  });

  test("update path: legacy absent + existing user -> off, legacy key removed", async () => {
    // Existing-user upgrade is discriminated by onInstalled reason === "update",
    // NOT by onboardingDone. A legacy-absent existing user maps to off.
    stores = installChromeStub({
      sync: {},
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.1", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "update" });

    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
  });

  test("update path: legacy true -> reject-only, legacy key removed", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMinimizerEnabled: true },
      local: {},
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "update" });

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
    assert.equal(stores.syncStore.has("cookieConsentMinimizerEnabled"), false);
  });

  test("update path: idempotent second run is a no-op once mode is present", async () => {
    stores = installChromeStub({
      sync: {},
      local: { mugaConsent: { onboardingDone: true } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "update" });
    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
    // Second run: mode already present -> no-op, value unchanged.
    await migrateCookieConsentMode({ reason: "update" });
    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
  });

  test("install seed: reason install -> reject-only", async () => {
    stores = installChromeStub({ sync: {}, local: {} });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "install" });

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
  });

  test("REGRESSION: fresh-install lifecycle never silently flips to off after onboarding", async () => {
    // 1. Genuine fresh install seeds the disclosed default.
    stores = installChromeStub({ sync: {}, local: {} });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "install" });
    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");

    // 2. Onboarding completes (persists onboardingDone). A later service-worker
    //    wake / onStartup runs the safe idempotent pass (no reason). It MUST
    //    leave the seeded mode untouched and MUST NEVER write "off".
    stores.localStore.set("mugaConsent", { onboardingDone: true, consentVersion: "1.2", consentDate: 1 });
    await migrateCookieConsentMode();
    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
    assert.notEqual(stores.syncStore.get("cookieConsentMode"), "off");
  });

  test("safe pass: pre-onboarding, no install seed -> writes nothing; later install seed -> reject-only", async () => {
    // Top-level module load / onStartup before onInstalled fires: the safe pass
    // must not infer anything from an absent mode. Mode stays absent so the
    // PREF_DEFAULTS "reject-only" overlay applies.
    stores = installChromeStub({ sync: {}, local: {} });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();
    assert.equal(stores.syncStore.has("cookieConsentMode"), false);

    // Then the genuine install seed lands.
    await migrateCookieConsentMode({ reason: "install" });
    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
  });

  test("safe pass: legacy absent + onboardingDone true -> writes NOTHING (mode stays absent)", async () => {
    // This is the core of the bug: the old code inferred "off" here from
    // onboardingDone. The safe pass must leave the mode absent.
    stores = installChromeStub({
      sync: {},
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.has("cookieConsentMode"), false);
  });

  test("cookieConsentMode already present -> no-op, idempotent", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMode: "off", cookieConsentMinimizerEnabled: true },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    // Untouched — the stale legacy key is left exactly as it was (already migrated).
    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
    assert.equal(stores.syncStore.get("cookieConsentMinimizerEnabled"), true);
  });

  test("never writes accept-when-necessary from any legacy value", async () => {
    for (const legacy of [true, false, null]) {
      const s = installChromeStub({
        sync: legacy === null ? {} : { cookieConsentMinimizerEnabled: legacy },
        local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
      });
      const { migrateCookieConsentMode } = await loadMigration();
      await migrateCookieConsentMode();
      assert.notEqual(s.syncStore.get("cookieConsentMode"), "accept-when-necessary");
    }
  });

  test("DEFENSIVE CLEANUP: a persisted accept-when-necessary mode is collapsed to reject-only", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMode: "accept-when-necessary" },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
  });

  test("DEFENSIVE CLEANUP: a stale cookieConsentAcceptConsented key is dropped, regardless of its value", async () => {
    for (const staleValue of [true, false]) {
      const s = installChromeStub({
        sync: { cookieConsentMode: "reject-only", cookieConsentAcceptConsented: staleValue },
        local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
      });
      const { migrateCookieConsentMode } = await loadMigration();
      await migrateCookieConsentMode();

      assert.equal(s.syncStore.has("cookieConsentAcceptConsented"), false);
      // Cleanup must not disturb an already-valid mode.
      assert.equal(s.syncStore.get("cookieConsentMode"), "reject-only");
    }
  });

  test("DEFENSIVE CLEANUP: runs even when cookieConsentMode is absent (legacy-key path)", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMinimizerEnabled: true, cookieConsentAcceptConsented: true },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode({ reason: "update" });

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
    assert.equal(stores.syncStore.has("cookieConsentAcceptConsented"), false);
  });

  test("a storage error never throws out to the caller (best-effort)", async () => {
    stores = installChromeStub({ sync: {}, local: {} });
    // Force a read failure.
    globalThis.chrome.storage.sync.get = (defaults, cb) => {
      globalThis.chrome.runtime.lastError = { message: "boom" };
      cb({});
      globalThis.chrome.runtime.lastError = null;
    };
    const { migrateCookieConsentMode } = await loadMigration();
    await assert.doesNotReject(() => migrateCookieConsentMode());
  });
});
