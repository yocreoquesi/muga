/**
 * MUGA — migration storage (#363)
 *
 * Round-trip tests for migration response persistence. Uses a stateful
 * in-memory chrome.storage.local stub so reads return what was written.
 * Asserts that responses go to local — never sync.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Stateful in-memory chrome.storage stub. Installed before each test.
function installChromeStub() {
  const localStore = new Map();
  const syncStore  = new Map();

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
    storage: {
      local: makeArea(localStore),
      sync:  makeArea(syncStore),
    },
    runtime: { lastError: null },
  };

  return { localStore, syncStore };
}

describe("migration-storage — round-trip", () => {
  let stores;
  let migrationStorage;

  beforeEach(async () => {
    stores = installChromeStub();
    // Re-import each test to bypass module caching of chrome refs.
    migrationStorage = await import("../../src/lib/migration-storage.js?cb=" + Math.random());
  });

  test("getResponse returns null when nothing stored", async () => {
    const r = await migrationStorage.getResponse("any-id");
    assert.equal(r, null);
  });

  test("recordResponse + getResponse round-trips", async () => {
    await migrationStorage.recordResponse("mig-1", "accept");
    const r = await migrationStorage.getResponse("mig-1");
    assert.equal(r, "accept");
  });

  test("recordResponse stores in local, never in sync", async () => {
    await migrationStorage.recordResponse("mig-2", "decline");
    assert.ok(stores.localStore.has("migrationResponses"), "local must have the key");
    assert.equal(stores.syncStore.has("migrationResponses"), false, "sync must NOT have the key");
  });

  test("multiple responses coexist", async () => {
    await migrationStorage.recordResponse("mig-a", "accept");
    await migrationStorage.recordResponse("mig-b", "decline");
    await migrationStorage.recordResponse("mig-c", "dismiss");
    const all = await migrationStorage.getAllResponses();
    assert.deepEqual(all, { "mig-a": "accept", "mig-b": "decline", "mig-c": "dismiss" });
  });

  test("recordResponse overwrites a prior response for the same id", async () => {
    await migrationStorage.recordResponse("mig-x", "dismiss");
    await migrationStorage.recordResponse("mig-x", "accept");
    const r = await migrationStorage.getResponse("mig-x");
    assert.equal(r, "accept");
  });

  test("clearAll removes all responses", async () => {
    await migrationStorage.recordResponse("mig-y", "accept");
    await migrationStorage.clearAll();
    const all = await migrationStorage.getAllResponses();
    assert.deepEqual(all, {});
  });

  test("recordResponse rejects invalid response value", async () => {
    await assert.rejects(
      () => migrationStorage.recordResponse("mig-z", "ignore"),
      /invalid response/
    );
  });

  test("recordResponse rejects empty migrationId", async () => {
    await assert.rejects(
      () => migrationStorage.recordResponse("", "accept"),
      /invalid response/
    );
  });
});
