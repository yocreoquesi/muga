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

function installChromeStub(initialSync = {}) {
  const syncStore = new Map(Object.entries(initialSync));

  const area = {
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = syncStore.has(defaults) ? syncStore.get(defaults) : undefined;
      } else if (Array.isArray(defaults)) {
        for (const k of defaults) result[k] = syncStore.has(k) ? syncStore.get(k) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = syncStore.has(k) ? syncStore.get(k) : v;
        }
      }
      cb && cb(result);
    },
    set: (data, cb) => {
      for (const [k, v] of Object.entries(data)) syncStore.set(k, v);
      cb && cb();
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) syncStore.delete(k);
      cb && cb();
    },
  };

  globalThis.chrome = {
    storage: { sync: area },
    runtime: { lastError: null },
  };

  return { syncStore };
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
