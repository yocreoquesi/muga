/**
 * MUGA — migrateCookieConsentMode (cookie-consent 3-state modes, Slice 1)
 *
 * Converts the legacy `cookieConsentMinimizerEnabled` boolean into the new
 * `cookieConsentMode` enum ("off" | "reject-only" | "accept-when-necessary")
 * + the separate `cookieConsentAcceptConsented` hard-gate flag. Idempotent,
 * safe every startup, keyed off the onboarding-completed signal
 * (chrome.storage.local["mugaConsent"].onboardingDone via consent-storage.js)
 * to distinguish existing users from fresh installs.
 *
 * Uses a stateful in-memory chrome.storage stub (mirrors the pattern in
 * tests/unit/per-site-disable-migration.test.mjs) covering BOTH sync
 * (the migrated pref) and local (the onboarding-completed signal) — and
 * re-imports the module fresh per test to bypass module caching of the
 * chrome ref.
 */
import { test, describe, beforeEach } from "node:test";
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

  test("legacy true -> reject-only, acceptConsented false, legacy key removed", async () => {
    stores = installChromeStub({
      sync: { cookieConsentMinimizerEnabled: true },
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.get("cookieConsentMode"), "reject-only");
    assert.equal(stores.syncStore.get("cookieConsentAcceptConsented"), false);
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

  test("legacy absent + existing user (onboardingDone true) -> off", async () => {
    stores = installChromeStub({
      sync: {},
      local: { mugaConsent: { onboardingDone: true, consentVersion: "1.1", consentDate: 1 } },
    });
    const { migrateCookieConsentMode } = await loadMigration();
    await migrateCookieConsentMode();

    assert.equal(stores.syncStore.get("cookieConsentMode"), "off");
  });

  test("fresh install (onboardingDone not true) -> does NOT write cookieConsentMode; PREF_DEFAULTS default stands", async () => {
    stores = installChromeStub({
      sync: {},
      local: {},
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
