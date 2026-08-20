/**
 * MUGA — sync-migration (#355)
 *
 * Tests the one-shot consent migration from chrome.storage.sync to
 * chrome.storage.local. Covers: fresh install (no-op), legacy install
 * (data copied + sync cleared), already-migrated install (no-op,
 * idempotent), partial-state install (fail-safe), conflict (local wins).
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
      } else if (Array.isArray(defaults)) {
        for (const k of defaults) {
          if (store.has(k)) result[k] = store.get(k);
          // For array reads, undefined keys are simply omitted from the result.
        }
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

describe("sync-migration", () => {
  let stores;
  let mod;

  beforeEach(async () => {
    stores = installChromeStub();
    mod = await import("../../src/lib/sync-migration.js?cb=" + Math.random());
  });

  test("fresh install (no legacy keys in sync) — no-op", async () => {
    const report = await mod.migrateConsentToLocal();
    assert.deepEqual(report, { ranWork: false, copiedToLocal: false, cleanedSync: false });
    assert.equal(stores.localStore.has("mugaConsent"), false);
  });

  test("legacy install — copies sync values to local and removes them from sync", async () => {
    stores.syncStore.set("onboardingDone", true);
    stores.syncStore.set("consentVersion", "1.0");
    stores.syncStore.set("consentDate", 1700000000000);

    const report = await mod.migrateConsentToLocal();

    assert.deepEqual(report, { ranWork: true, copiedToLocal: true, cleanedSync: true });

    // Local now has the consent record
    const localConsent = stores.localStore.get("mugaConsent");
    assert.deepEqual(localConsent, {
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 1700000000000,
    });

    // Sync is cleaned
    assert.equal(stores.syncStore.has("onboardingDone"), false);
    assert.equal(stores.syncStore.has("consentVersion"), false);
    assert.equal(stores.syncStore.has("consentDate"), false);
  });

  test("already-migrated install — no legacy keys, no-op on re-run", async () => {
    // Local already has the migrated record; sync is already clean.
    stores.localStore.set("mugaConsent", {
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 100,
    });

    const report = await mod.migrateConsentToLocal();
    assert.deepEqual(report, { ranWork: false, copiedToLocal: false, cleanedSync: false });

    // Local untouched
    assert.equal(stores.localStore.get("mugaConsent").consentDate, 100);
  });

  test("idempotent — re-running migration on a partially migrated install completes cleanly", async () => {
    // Simulate a half-run: local has the data, but sync still has stale values
    // (e.g. the first run copied to local but crashed before removing from sync).
    stores.localStore.set("mugaConsent", {
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 100,
    });
    stores.syncStore.set("onboardingDone", true);
    stores.syncStore.set("consentVersion", "1.0");
    stores.syncStore.set("consentDate", 100);

    const report = await mod.migrateConsentToLocal();
    assert.equal(report.ranWork, true);
    assert.equal(report.copiedToLocal, false, "local already had data; must not overwrite");
    assert.equal(report.cleanedSync, true);

    // Local untouched
    assert.equal(stores.localStore.get("mugaConsent").consentDate, 100);
    // Sync is now clean
    assert.equal(stores.syncStore.has("onboardingDone"), false);
  });

  test("partial-state install — only some legacy keys present in sync — fail-safe", async () => {
    // Suppose only onboardingDone made it across before something interrupted.
    stores.syncStore.set("onboardingDone", true);
    // No consentVersion, no consentDate in sync.

    const report = await mod.migrateConsentToLocal();
    assert.equal(report.ranWork, true);

    const localConsent = stores.localStore.get("mugaConsent");
    assert.equal(localConsent.onboardingDone, true);
    assert.equal(localConsent.consentVersion, null, "missing field falls to default null");
    assert.equal(localConsent.consentDate, null, "missing field falls to default null");

    assert.equal(stores.syncStore.has("onboardingDone"), false);
  });

  test("conflict — local has consent AND sync has legacy data — local wins, sync cleaned", async () => {
    stores.localStore.set("mugaConsent", {
      onboardingDone: true,
      consentVersion: "1.1",  // local is newer
      consentDate: 200,
    });
    stores.syncStore.set("onboardingDone", true);
    stores.syncStore.set("consentVersion", "1.0");  // sync is older
    stores.syncStore.set("consentDate", 100);

    const report = await mod.migrateConsentToLocal();
    assert.equal(report.copiedToLocal, false, "local must win");

    // Local unchanged
    const localConsent = stores.localStore.get("mugaConsent");
    assert.equal(localConsent.consentVersion, "1.1");
    assert.equal(localConsent.consentDate, 200);

    // Sync cleaned
    assert.equal(stores.syncStore.has("consentVersion"), false);
  });

  test("running twice in a row — second call is a clean no-op", async () => {
    stores.syncStore.set("onboardingDone", true);
    stores.syncStore.set("consentVersion", "1.0");
    stores.syncStore.set("consentDate", 100);

    await mod.migrateConsentToLocal();
    const second = await mod.migrateConsentToLocal();
    assert.deepEqual(second, { ranWork: false, copiedToLocal: false, cleanedSync: false });
  });

  // ── #1216: overlapping calls are the normal case ──────────────────────────
  //
  // The service worker calls migrateConsentToLocal() from module scope AND
  // from its startup/install handlers, so two or three calls overlap on every
  // wake. The migration is idempotent in effect but was not atomic: read sync,
  // read local, write local, remove sync. A second call landing mid-sequence
  // read sync (still holding the legacy keys, because the first had not
  // reached removeLegacySync) and local (already written by the first), so it
  // reported copiedToLocal:false for a copy that did happen. The data was
  // always right; the report was not, which is how this surfaced as a flaky
  // e2e assertion instead of a user-visible bug.
  test("concurrent calls share one migration and report it identically", async () => {
    stores.syncStore.set("onboardingDone", true);
    stores.syncStore.set("consentVersion", "1.0");
    stores.syncStore.set("consentDate", 100);

    const area = globalThis.chrome.storage.local;
    const realSet = area.set.bind(area);
    let localWrites = 0;
    area.set = (data, cb) => {
      localWrites += 1;
      return realSet(data, cb);
    };

    const [a, b, c] = await Promise.all([
      mod.migrateConsentToLocal(),
      mod.migrateConsentToLocal(),
      mod.migrateConsentToLocal(),
    ]);

    const expected = { ranWork: true, copiedToLocal: true, cleanedSync: true };
    assert.deepEqual(a, expected, "the winning call must report the copy it performed");
    assert.deepEqual(b, expected, "a caller that arrived mid-migration must see the same report");
    assert.deepEqual(c, expected, "and so must a third");
    assert.equal(localWrites, 1, "one migration means one write to local, not one per caller");

    assert.equal(stores.localStore.get("mugaConsent").onboardingDone, true);
    assert.equal(stores.syncStore.has("onboardingDone"), false);
  });

  test("a later call still migrates — the in-flight guard is not a latch", async () => {
    // Clearing the shared promise once settled matters: a service worker that
    // wakes again must be able to migrate data that appeared in the meantime.
    const first = await mod.migrateConsentToLocal();
    assert.deepEqual(first, { ranWork: false, copiedToLocal: false, cleanedSync: false });

    stores.syncStore.set("onboardingDone", true);
    const second = await mod.migrateConsentToLocal();
    assert.deepEqual(second, { ranWork: true, copiedToLocal: true, cleanedSync: true });
  });
});
