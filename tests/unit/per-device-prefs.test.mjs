/**
 * MUGA — per-device-prefs (#364)
 *
 * Round-trip tests for the per-device override map. Asserts overrides
 * go to chrome.storage.local, never to sync.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function installChromeStub() {
  const localStore = new Map();
  const syncStore  = new Map();

  const makeArea = (store) => ({
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
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

describe("per-device-prefs", () => {
  let stores;
  let mod;

  beforeEach(async () => {
    stores = installChromeStub();
    mod = await import("../../src/lib/per-device-prefs.js?cb=" + Math.random());
  });

  test("getOverrides returns empty when nothing stored", async () => {
    const o = await mod.getOverrides();
    assert.deepEqual(o, {});
  });

  test("setOverrides + getOverrides round-trips", async () => {
    await mod.setOverrides({ injectOwnAffiliate: false });
    const o = await mod.getOverrides();
    assert.deepEqual(o, { injectOwnAffiliate: false });
  });

  test("setOverrides writes to local, never to sync", async () => {
    await mod.setOverrides({ injectOwnAffiliate: false });
    assert.ok(stores.localStore.has("mugaPerDevicePrefs"));
    assert.equal(stores.syncStore.has("mugaPerDevicePrefs"), false);
  });

  test("setOverrides merges against the stored record", async () => {
    await mod.setOverrides({ injectOwnAffiliate: false });
    await mod.setOverrides({ remoteRulesEnabled: false });
    const o = await mod.getOverrides();
    assert.deepEqual(o, { injectOwnAffiliate: false, remoteRulesEnabled: false });
  });

  test("setOverrides can override a previous value for the same key", async () => {
    await mod.setOverrides({ injectOwnAffiliate: false });
    await mod.setOverrides({ injectOwnAffiliate: true });
    const o = await mod.getOverrides();
    assert.equal(o.injectOwnAffiliate, true);
  });

  test("clearOverrides removes the record", async () => {
    await mod.setOverrides({ injectOwnAffiliate: false });
    await mod.clearOverrides();
    const o = await mod.getOverrides();
    assert.deepEqual(o, {});
    assert.equal(stores.localStore.has("mugaPerDevicePrefs"), false);
  });

  test("setOverrides rejects non-object input", async () => {
    await assert.rejects(() => mod.setOverrides(null));
    await assert.rejects(() => mod.setOverrides("string"));
  });

  test("setOverrides rejects an unknown (non-guarded) override key (#728 item 24)", async () => {
    await assert.rejects(() => mod.setOverrides({ enabled: false }));
    await assert.rejects(() => mod.setOverrides({ notAPref: true }));
  });

  test("setOverrides rejects a non-boolean value for a guarded key (#728 item 24)", async () => {
    await assert.rejects(() => mod.setOverrides({ injectOwnAffiliate: "false" }));
    await assert.rejects(() => mod.setOverrides({ remoteRulesEnabled: 0 }));
  });

  test("a rejected setOverrides writes nothing (validation runs before the store write) (#728 item 24)", async () => {
    await assert.rejects(() => mod.setOverrides({ injectOwnAffiliate: "nope" }));
    const o = await mod.getOverrides();
    assert.deepEqual(o, {}, "a rejected setOverrides must not persist a partial record");
  });
});
