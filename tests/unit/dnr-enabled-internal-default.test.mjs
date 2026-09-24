/**
 * MUGA — dnrEnabled is a real internal default, not a value a stale stored
 * key can override (#1355 review finding R3-001).
 *
 * Removing dnrEnabled's Settings control (#1355) left a gap: a user who had
 * explicitly stored `dnrEnabled: false` before the control was removed
 * stayed stranded on the DNR-off path forever, with no way back — the
 * control that could have flipped it back no longer exists, and getPrefs()
 * was still honouring the stale stored value.
 *
 * Maintainer decision: the internal default governs. getPrefs() must yield
 * `dnrEnabled: true` regardless of what (if anything) is stored, AND the
 * stale stored key must be removed so it stops taking up space and cannot
 * confuse a future reader of raw storage.
 *
 * The removal is a one-time migration, `migrateDropDnrEnabledPref()`,
 * modelled on the existing read-first/remove-if-present pattern
 * (migrateDropCookieConsent) rather than the read-modify-write pattern
 * (migrateFollowShortenersSplit) — there is no value to preserve, only a key
 * to delete, so there is no intermediate state where the key holds a
 * partially-migrated value. It is wired into the single
 * `runOneTimeMigrations()` call site in service-worker.js (#1257), so it
 * inherits that mechanism's per-worker-lifetime in-flight guard: concurrent
 * calls from module scope / onInstalled / onStartup collapse onto the same
 * promise rather than racing independent read-then-remove sequences.
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

function installChromeStub(initialSync = {}) {
  const syncStore = new Map(Object.entries(initialSync));
  globalThis.chrome = {
    storage: { sync: makeArea(syncStore), local: makeArea(new Map()) },
    runtime: { lastError: null },
  };
  return { syncStore };
}

async function loadMigrations() {
  return import("../../src/lib/storage-migrations.js?cb=" + Math.random());
}

async function loadPrefs() {
  return import("../../src/lib/prefs.js?cb=" + Math.random());
}

describe("migrateDropDnrEnabledPref (#1355 R3-001)", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("removes dnrEnabled when present, regardless of its stored value", async () => {
    stores.syncStore.set("dnrEnabled", false);
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await migrateDropDnrEnabledPref();
    assert.equal(stores.syncStore.has("dnrEnabled"), false);
  });

  test("removes dnrEnabled: true too — no value is worth preserving, the internal default governs", async () => {
    stores.syncStore.set("dnrEnabled", true);
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await migrateDropDnrEnabledPref();
    assert.equal(stores.syncStore.has("dnrEnabled"), false);
  });

  test("is a no-op when the key is already absent", async () => {
    stores.syncStore.set("enabled", true); // unrelated key present
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await assert.doesNotReject(() => migrateDropDnrEnabledPref());
    assert.equal(stores.syncStore.has("dnrEnabled"), false);
    assert.equal(stores.syncStore.get("enabled"), true);
  });

  test("leaves unrelated keys untouched", async () => {
    stores.syncStore.set("dnrEnabled", false);
    stores.syncStore.set("language", "es");
    stores.syncStore.set("remoteRulesEnabled", true);
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await migrateDropDnrEnabledPref();
    assert.equal(stores.syncStore.get("language"), "es");
    assert.equal(stores.syncStore.get("remoteRulesEnabled"), true);
  });

  test("idempotent: a second call after the key is gone is a safe no-op", async () => {
    stores.syncStore.set("dnrEnabled", false);
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await migrateDropDnrEnabledPref();
    await assert.doesNotReject(() => migrateDropDnrEnabledPref());
    assert.equal(stores.syncStore.has("dnrEnabled"), false);
  });

  test("concurrent calls (simulating module-scope + handler races) never throw and converge on absent", async () => {
    stores.syncStore.set("dnrEnabled", false);
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await assert.doesNotReject(() =>
      Promise.all([migrateDropDnrEnabledPref(), migrateDropDnrEnabledPref(), migrateDropDnrEnabledPref()])
    );
    assert.equal(stores.syncStore.has("dnrEnabled"), false);
  });

  test("never throws on a storage failure (best-effort, must not break startup)", async () => {
    stores.syncStore.set("dnrEnabled", false);
    const originalGet = globalThis.chrome.storage.sync.get;
    globalThis.chrome.storage.sync.get = (defaults, cb) => {
      globalThis.chrome.runtime.lastError = { message: "simulated failure" };
      originalGet(defaults, cb);
      globalThis.chrome.runtime.lastError = null;
    };
    const { migrateDropDnrEnabledPref } = await loadMigrations();
    await assert.doesNotReject(() => migrateDropDnrEnabledPref());
  });

  test("service-worker.js wires migrateDropDnrEnabledPref into the single runOneTimeMigrations call site (#1257)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const SW_SOURCE = readFileSync(join(__dir, "../../src/background/service-worker.js"), "utf8");
    assert.ok(
      SW_SOURCE.includes("migrateDropDnrEnabledPref"),
      "service-worker.js must import and register migrateDropDnrEnabledPref in the runOneTimeMigrations map — a second, independent call site would reintroduce the exact race #1257 removed",
    );
    const callSiteBlock = SW_SOURCE.slice(
      SW_SOURCE.indexOf("runOneTimeMigrations({"),
      SW_SOURCE.indexOf("});", SW_SOURCE.indexOf("runOneTimeMigrations({")),
    );
    assert.ok(
      callSiteBlock.includes("migrateDropDnrEnabledPref"),
      "migrateDropDnrEnabledPref must be registered inside the ONE runOneTimeMigrations({...}) call, not a separate call site",
    );
  });
});

describe("getPrefs() — dnrEnabled: internal default governs, stored value is never honoured (#1355 R3-001)", () => {
  test("a stored dnrEnabled: false is ignored — getPrefs() still returns true", async () => {
    installChromeStub({ dnrEnabled: false, enabled: true });
    const { getPrefs } = await loadPrefs();
    const prefs = await getPrefs();
    assert.strictEqual(
      prefs.dnrEnabled, true,
      "a pre-#1355 stored dnrEnabled=false must no longer strand the user off the DNR path — the internal default governs",
    );
    assert.strictEqual(prefs.enabled, true, "unrelated prefs must still read through normally");
  });

  test("a stored dnrEnabled: true is also ignored (not merely 'false is special-cased') — always the constant", async () => {
    installChromeStub({ dnrEnabled: true });
    const { getPrefs } = await loadPrefs();
    const prefs = await getPrefs();
    assert.strictEqual(prefs.dnrEnabled, true);
  });

  test("no stored value at all still yields the default", async () => {
    installChromeStub({});
    const { getPrefs } = await loadPrefs();
    const prefs = await getPrefs();
    assert.strictEqual(prefs.dnrEnabled, true);
  });
});
