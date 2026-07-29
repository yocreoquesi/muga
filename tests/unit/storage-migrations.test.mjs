/**
 * MUGA — migrateDropInjectOwnAffiliate (drop-affiliate-injection PR 1b)
 *
 * The own-tag affiliate injection feature was removed in PR 1a; the
 * `injectOwnAffiliate` pref itself (and its guarded per-device override
 * machinery) is retired in PR 1b. This one-time, idempotent migration
 * deletes any stored `injectOwnAffiliate` key from chrome.storage.sync so
 * no existing user is left with a dead pref lingering in storage.
 *
 * Uses a stateful in-memory chrome.storage.sync stub (mirrors the pattern
 * in tests/unit/per-site-disable-migration.test.mjs) so reads return what
 * was written, and re-imports the module fresh per test to bypass module
 * caching of the chrome ref.
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

describe("migrateDropInjectOwnAffiliate", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("deletes a stored injectOwnAffiliate key from chrome.storage.sync", async () => {
    stores.syncStore.set("injectOwnAffiliate", true);
    stores.syncStore.set("remoteRulesEnabled", true);

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await migrateDropInjectOwnAffiliate();

    assert.equal(stores.syncStore.has("injectOwnAffiliate"), false);
  });

  test("leaves unrelated sync keys untouched", async () => {
    stores.syncStore.set("injectOwnAffiliate", false);
    stores.syncStore.set("remoteRulesEnabled", true);
    stores.syncStore.set("language", "en");

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await migrateDropInjectOwnAffiliate();

    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
    assert.equal(stores.syncStore.get("language"), "en");
  });

  test("is a no-op when injectOwnAffiliate is already absent", async () => {
    stores.syncStore.set("remoteRulesEnabled", true);

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await assert.doesNotReject(() => migrateDropInjectOwnAffiliate());

    assert.equal(stores.syncStore.has("injectOwnAffiliate"), false);
    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
  });

  test("reads first and issues NO sync write when the key is already absent (write-quota hygiene)", async () => {
    // The key is absent — the migration must read-and-skip, never spending a
    // sync `remove` write op (which counts against Chrome's quota even for an
    // absent key). Guards against a regression to unconditional-write.
    stores.syncStore.set("remoteRulesEnabled", true);
    let removeCalls = 0;
    const realRemove = globalThis.chrome.storage.sync.remove;
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      removeCalls += 1;
      return realRemove(keys, cb);
    };

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await migrateDropInjectOwnAffiliate();

    assert.equal(removeCalls, 0, "remove must not be called when the key is absent");
  });

  test("is idempotent — running twice is safe and has the same effect as running once", async () => {
    stores.syncStore.set("injectOwnAffiliate", true);

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await migrateDropInjectOwnAffiliate();
    await assert.doesNotReject(() => migrateDropInjectOwnAffiliate());

    assert.equal(stores.syncStore.has("injectOwnAffiliate"), false);
  });

  test("never throws even if chrome.storage.sync.remove reports lastError", async () => {
    stores.syncStore.set("injectOwnAffiliate", true);
    globalThis.chrome.storage.sync.remove = (keys, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };

    const { migrateDropInjectOwnAffiliate } = await loadMigration();
    await assert.doesNotReject(() => migrateDropInjectOwnAffiliate());
  });
});

/**
 * migrateDropCookieConsent (drop-cookie-consent, Slice D of 6)
 *
 * Deletes every storage key left behind by the retired cookie-consent
 * subsystem: three chrome.storage.sync keys (cookieConsentMode +
 * two legacy keys) and three chrome.storage.local keys (the dead Tier2
 * remote-rules cache). Mirrors migrateDropInjectOwnAffiliate's read-first,
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
