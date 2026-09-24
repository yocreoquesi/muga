/**
 * MUGA — one-time OFF migration for experimentalParamClassesEnabled
 * (#1355 review finding R3-002).
 *
 * Maintainer decision: `experimentalParamClassesEnabled` is experimental,
 * default OFF, and may break sites (shape-based heuristic false positives).
 * Its control moved to Developer tools (#1355) — a surface most users never
 * open — so a user who had it ON before the move could be stuck with a
 * site-breaking heuristic running with no visible way to find the switch
 * again. Turn it OFF once on upgrade for anyone who had it ON; they can
 * re-enable it in Developer tools if they want it back.
 *
 * Unlike migrateDropDnrEnabledPref (a pure delete, #1355 R3-001), this
 * migration WRITES a new value the user might later change back — so unlike
 * a delete-only migration it is NOT naturally idempotent from key-shape
 * alone. Re-running "if true, set false" on every worker wake would silently
 * re-flip a user's deliberate later re-enable back off forever. It needs an
 * explicit one-time-done marker. It lives in chrome.storage.sync, next to the
 * value it guards, because the value syncs: a per-device marker would let a
 * second device re-flip a re-enable made after the first device migrated
 * (#1355 review R3-per-device). The flip and the marker are one sync.set, so
 * no intermediate state separates them.
 *
 * Wired into the single runOneTimeMigrations() call site (#1257) — the same
 * mechanism migrateDropDnrEnabledPref and every sibling migration uses — so
 * it inherits the per-worker-lifetime in-flight guard against the
 * module-scope/onInstalled/onStartup race that motivated #1257.
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

async function loadMigrations() {
  return import("../../src/lib/storage-migrations.js?cb=" + Math.random());
}

describe("migrateExperimentalParamClassesOff (#1355 R3-002)", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("flips experimentalParamClassesEnabled: true to false on first run", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesEnabled"), false);
  });

  test("marks the one-time migration done after flipping", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesOffMigrated"), true);
  });

  test("leaves a user who never had it on untouched, still marks done", async () => {
    // Key absent — defaults to false, same as a fresh install.
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    assert.strictEqual(stores.syncStore.has("experimentalParamClassesEnabled"), false, "must not write a value when there was nothing to migrate");
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesOffMigrated"), true);
  });

  test("leaves a user who already had it off untouched, still marks done", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", false);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesEnabled"), false);
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesOffMigrated"), true);
  });

  test("ONE-TIME: does not re-flip a value the user deliberately re-enabled after migration ran", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff(); // first run: flips to false, marks done

    // User re-enables it in Developer tools after the migration already ran.
    stores.syncStore.set("experimentalParamClassesEnabled", true);

    // A later worker wake calls the migration again (runOneTimeMigrations is
    // memoized per lifetime, but the marker must ALSO survive a full
    // service-worker restart, i.e. a NEW lifetime — the real-world case this
    // guards).
    await migrateExperimentalParamClassesOff();

    assert.strictEqual(
      stores.syncStore.get("experimentalParamClassesEnabled"), true,
      "a done migration must never re-flip a value the user deliberately changed afterward",
    );
  });

  test("CROSS-DEVICE: a second synced device never re-flips a re-enable made after device A migrated", async () => {
    // Device A migrated, then the user deliberately re-enabled the flag. Both
    // live in sync. Device B upgrades later with an empty local area: the
    // marker must travel with the value, or B would flip the user's choice.
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    stores.syncStore.set("experimentalParamClassesOffMigrated", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesEnabled"), true);
  });

  test("is idempotent: repeated calls in the same not-yet-migrated state converge safely", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await migrateExperimentalParamClassesOff();
    await assert.doesNotReject(() => migrateExperimentalParamClassesOff());
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesEnabled"), false);
  });

  test("concurrent calls (simulating module-scope + handler races) never throw and converge on false", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await assert.doesNotReject(() =>
      Promise.all([
        migrateExperimentalParamClassesOff(),
        migrateExperimentalParamClassesOff(),
        migrateExperimentalParamClassesOff(),
      ])
    );
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesEnabled"), false);
    assert.strictEqual(stores.syncStore.get("experimentalParamClassesOffMigrated"), true);
  });

  test("never throws on a storage failure (best-effort, must not break startup)", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const originalGet = globalThis.chrome.storage.sync.get;
    globalThis.chrome.storage.sync.get = (defaults, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated failure" };
      originalGet(defaults, cb);
      globalThis.chrome.runtime.lastError = null;
    };
    const { migrateExperimentalParamClassesOff } = await loadMigrations();
    await assert.doesNotReject(() => migrateExperimentalParamClassesOff());
  });

  test("does not mark done if the sync write fails — a later retry can still complete it", async () => {
    stores.syncStore.set("experimentalParamClassesEnabled", true);
    const { migrateExperimentalParamClassesOff } = await loadMigrations();

    globalThis.chrome.storage.sync.set = (_data, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated write failure" };
      cb && cb();
      globalThis.chrome.runtime.lastError = null;
    };
    await assert.doesNotReject(() => migrateExperimentalParamClassesOff());
    assert.strictEqual(
      stores.syncStore.get("experimentalParamClassesOffMigrated"), undefined,
      "must not mark done when the actual flip failed to persist",
    );
  });

  test("service-worker.js wires migrateExperimentalParamClassesOff into the single runOneTimeMigrations call site (#1257)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const SW_SOURCE = readFileSync(join(__dir, "../../src/background/service-worker.js"), "utf8");
    const callSiteBlock = SW_SOURCE.slice(
      SW_SOURCE.indexOf("runOneTimeMigrations({"),
      SW_SOURCE.indexOf("});", SW_SOURCE.indexOf("runOneTimeMigrations({")),
    );
    assert.ok(
      callSiteBlock.includes("migrateExperimentalParamClassesOff"),
      "migrateExperimentalParamClassesOff must be registered inside the ONE runOneTimeMigrations({...}) call, not a separate call site",
    );
  });
});
