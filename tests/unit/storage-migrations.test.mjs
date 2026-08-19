/**
 * MUGA — storage migrations
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeArea(store) {
  return {
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
  };
}

function installChromeStub(initialSync = {}, initialLocal = {}) {
  const syncStore = new Map(Object.entries(initialSync));
  const localStore = new Map(Object.entries(initialLocal));

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

/**
 * migrateDropCookieConsent (drop-cookie-consent, Slice D of 6)
 *
 * Deletes every storage key left behind by the retired cookie-consent
 * subsystem: three chrome.storage.sync keys (cookieConsentMode +
 * two legacy keys) and three chrome.storage.local keys (the dead Tier2
 * remote-rules cache). Uses a read-first,
 * write-only-if-present pattern for BOTH storage areas independently.
 */
describe("migrateDropCookieConsent", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("deletes all three sync keys when present", async () => {
    stores.syncStore.set("cookieConsentMode", "reject-only");
    stores.syncStore.set("cookieConsentMinimizerEnabled", true);
    stores.syncStore.set("cookieConsentAcceptConsented", true);

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(stores.syncStore.has("cookieConsentMode"), false);
    assert.equal(stores.syncStore.has("cookieConsentMinimizerEnabled"), false);
    assert.equal(stores.syncStore.has("cookieConsentAcceptConsented"), false);
  });

  test("deletes all three local keys when present", async () => {
    stores.localStore.set("remoteTier2Rules", []);
    stores.localStore.set("remoteTier2Meta", { version: 3 });
    stores.localStore.set("remoteTier2VersionFloor", 3);

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(stores.localStore.has("remoteTier2Rules"), false);
    assert.equal(stores.localStore.has("remoteTier2Meta"), false);
    assert.equal(stores.localStore.has("remoteTier2VersionFloor"), false);
  });

  test("deletes a single present key without requiring all three to be present (sync)", async () => {
    stores.syncStore.set("cookieConsentMode", "off");
    stores.syncStore.set("remoteRulesEnabled", true); // unrelated key

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(stores.syncStore.has("cookieConsentMode"), false);
    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
  });

  test("leaves unrelated sync and local keys untouched", async () => {
    stores.syncStore.set("cookieConsentMode", "reject-only");
    stores.syncStore.set("remoteRulesEnabled", true);
    stores.syncStore.set("language", "en");
    stores.localStore.set("remoteTier2Rules", []);
    stores.localStore.set("devMode", true);

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
    assert.equal(stores.syncStore.get("language"), "en");
    assert.equal(stores.localStore.get("devMode"), true);
  });

  test("is a no-op when every key is already absent", async () => {
    stores.syncStore.set("remoteRulesEnabled", true);
    stores.localStore.set("devMode", true);

    const { migrateDropCookieConsent } = await loadMigration();
    await assert.doesNotReject(() => migrateDropCookieConsent());

    assert.equal(stores.syncStore.has("cookieConsentMode"), false);
    assert.equal(stores.localStore.has("remoteTier2Rules"), false);
    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
    assert.equal(stores.localStore.get("devMode"), true);
  });

  test("reads first and issues NO sync/local write when every key in that area is absent (write-quota hygiene)", async () => {
    stores.syncStore.set("remoteRulesEnabled", true);
    let syncRemoveCalls = 0;
    let localRemoveCalls = 0;
    const realSyncRemove = globalThis.chrome.storage.sync.remove;
    const realLocalRemove = globalThis.chrome.storage.local.remove;
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      syncRemoveCalls += 1;
      return realSyncRemove(keys, cb);
    };
    globalThis.chrome.storage.local.remove = (keys, cb) => {
      localRemoveCalls += 1;
      return realLocalRemove(keys, cb);
    };

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(syncRemoveCalls, 0, "sync remove must not be called when every sync key is absent");
    assert.equal(localRemoveCalls, 0, "local remove must not be called when every local key is absent");
  });

  test("issues a sync write when only one sync key is present, even if local is fully absent", async () => {
    stores.syncStore.set("cookieConsentAcceptConsented", true);
    let syncRemoveCalls = 0;
    let localRemoveCalls = 0;
    const realSyncRemove = globalThis.chrome.storage.sync.remove;
    const realLocalRemove = globalThis.chrome.storage.local.remove;
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      syncRemoveCalls += 1;
      return realSyncRemove(keys, cb);
    };
    globalThis.chrome.storage.local.remove = (keys, cb) => {
      localRemoveCalls += 1;
      return realLocalRemove(keys, cb);
    };

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();

    assert.equal(syncRemoveCalls, 1, "sync remove must fire when a sync key is present");
    assert.equal(localRemoveCalls, 0, "local remove must not fire when every local key is absent");
  });

  test("is idempotent — running twice is safe and has the same effect as running once", async () => {
    stores.syncStore.set("cookieConsentMode", "reject-only");
    stores.localStore.set("remoteTier2Rules", []);

    const { migrateDropCookieConsent } = await loadMigration();
    await migrateDropCookieConsent();
    await assert.doesNotReject(() => migrateDropCookieConsent());

    assert.equal(stores.syncStore.has("cookieConsentMode"), false);
    assert.equal(stores.localStore.has("remoteTier2Rules"), false);
  });

  test("never throws even if chrome.storage.sync/local.remove report lastError", async () => {
    stores.syncStore.set("cookieConsentMode", "reject-only");
    stores.localStore.set("remoteTier2Rules", []);
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated sync failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };
    globalThis.chrome.storage.local.remove = (keys, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated local failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };

    const { migrateDropCookieConsent } = await loadMigration();
    await assert.doesNotReject(() => migrateDropCookieConsent());
  });
});

/**
 * migrateFollowShortenersSplit (browsewrap Phase 2)
 *
 * Splits the single `followShortenersEnabled` pref into two independently
 * gated prefs — `resolveShortenersOnClick` (new default true) and
 * `resolveShortenersOnHover` (new default false, opt-in) — mapping the
 * user's EXPLICIT prior intent (mirrors the explicit-vs-auto-default bare
 * read prefs.js's getPrefs() used to do for the retired browser-aware
 * default):
 *
 *   - explicit `true`  → both new prefs become `true` (preserve the intent:
 *     the user opted into shortener resolution generally).
 *   - explicit `false` → both new prefs become `false` (preserve the
 *     explicit opt-out).
 *   - never stored (browser-computed auto-default only, indistinguishable
 *     from absent) → nothing to preserve; no write, the new prefs' own
 *     defaults (click true / hover false) simply apply.
 *
 * The old key is removed once present, regardless of which branch fired.
 */
describe("migrateFollowShortenersSplit", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("explicit true → both resolveShortenersOnClick and resolveShortenersOnHover become true", async () => {
    stores.syncStore.set("followShortenersEnabled", true);

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();

    assert.equal(stores.syncStore.get("resolveShortenersOnClick"), true);
    assert.equal(stores.syncStore.get("resolveShortenersOnHover"), true);
    assert.equal(stores.syncStore.has("followShortenersEnabled"), false);
  });

  test("explicit false → both resolveShortenersOnClick and resolveShortenersOnHover become false", async () => {
    stores.syncStore.set("followShortenersEnabled", false);

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();

    assert.equal(stores.syncStore.get("resolveShortenersOnClick"), false);
    assert.equal(stores.syncStore.get("resolveShortenersOnHover"), false);
    assert.equal(stores.syncStore.has("followShortenersEnabled"), false);
  });

  test("never stored (absent) → no write, old key stays absent, new prefs untouched", async () => {
    stores.syncStore.set("remoteRulesEnabled", true); // unrelated key present

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();

    assert.equal(stores.syncStore.has("resolveShortenersOnClick"), false, "must not write a value — the new pref's own default applies");
    assert.equal(stores.syncStore.has("resolveShortenersOnHover"), false, "must not write a value — the new pref's own default applies");
    assert.equal(stores.syncStore.has("followShortenersEnabled"), false);
  });

  test("leaves unrelated sync keys untouched", async () => {
    stores.syncStore.set("followShortenersEnabled", true);
    stores.syncStore.set("language", "en");
    stores.syncStore.set("remoteRulesEnabled", true);

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();

    assert.equal(stores.syncStore.get("language"), "en");
    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
  });

  test("is idempotent — running twice is safe and has the same effect as running once", async () => {
    stores.syncStore.set("followShortenersEnabled", true);

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();
    await assert.doesNotReject(() => migrateFollowShortenersSplit());

    assert.equal(stores.syncStore.get("resolveShortenersOnClick"), true);
    assert.equal(stores.syncStore.get("resolveShortenersOnHover"), true);
    assert.equal(stores.syncStore.has("followShortenersEnabled"), false);
  });

  test("reads first and issues NO writes when followShortenersEnabled is already absent (write-quota hygiene)", async () => {
    stores.syncStore.set("remoteRulesEnabled", true);
    let setCalls = 0;
    let removeCalls = 0;
    const realSet = globalThis.chrome.storage.sync.set;
    const realRemove = globalThis.chrome.storage.sync.remove;
    globalThis.chrome.storage.sync.set = (data, cb) => { setCalls += 1; return realSet(data, cb); };
    globalThis.chrome.storage.sync.remove = (keys, cb) => { removeCalls += 1; return realRemove(keys, cb); };

    const { migrateFollowShortenersSplit } = await loadMigration();
    await migrateFollowShortenersSplit();

    assert.equal(setCalls, 0, "set must not be called when followShortenersEnabled was never stored");
    assert.equal(removeCalls, 0, "remove must not be called when the key is already absent");
  });

  test("never throws even if chrome.storage.sync.set/remove report lastError", async () => {
    stores.syncStore.set("followShortenersEnabled", true);
    globalThis.chrome.storage.sync.set = (data, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated set failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated remove failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };

    const { migrateFollowShortenersSplit } = await loadMigration();
    await assert.doesNotReject(() => migrateFollowShortenersSplit());
  });
});
