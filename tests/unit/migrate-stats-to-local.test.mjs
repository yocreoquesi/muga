/**
 * MUGA — migrateStatsToLocal keeps the newer value (#1257)
 *
 * This migration had NO test. That is how its comment and its code came to
 * disagree without anyone noticing: line 49 said "Copy to local (only if local
 * doesn't already have data)" while the code read `syncData.x ?? localData.x`,
 * so any non-null value in sync won unconditionally, including over a newer
 * local one. An `incrementStat()` batched flush (storage.js) landing between
 * the local read and the local write was silently overwritten by a value from
 * before the migration.
 *
 * ── The trap on the other side ─────────────────────────────────────────────
 *
 * Inverting it to `localData.x ?? syncData.x` is wrong too, and looks right.
 * The local read used `STAT_DEFAULTS`, so `chrome.storage.local.get` returns a
 * zeroed `stats` object and `nudgeDismissed: false` for keys that do not
 * exist. Neither is nullish, so "prefer local" would have discarded the user's
 * synced stats on the very first migration -- destroying exactly the data the
 * migration exists to rescue.
 *
 * The fix is reading with NULL defaults, which makes "local has nothing"
 * distinguishable from "local has a legitimately falsy value". Both directions
 * are pinned below, because each is a plausible-looking way to lose data.
 *
 * Run with: npm test
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Minimal chrome.storage area over a Map, matching the callback API. */
function makeArea(store) {
  return {
    get: (defaults, cb) => {
      const out = {};
      for (const [k, fallback] of Object.entries(defaults)) {
        out[k] = store.has(k) ? store.get(k) : fallback;
      }
      cb(out);
    },
    set: (items, cb) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
      cb && cb();
    },
    remove: (keys, cb) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
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
  const mod = await import("../../src/lib/storage-migrations.js?cb=" + Math.random());
  return mod.migrateStatsToLocal;
}

let stores;
beforeEach(() => {
  stores = installChromeStub();
});

describe("migrateStatsToLocal — the first migration, with nothing in local", () => {
  test("moves the synced stats into local", async () => {
    // The case "prefer local" would have broken: local is empty, so the synced
    // stats are the only copy the user has.
    stores.syncStore.set("stats", { urlsCleaned: 42, junkRemoved: 7, referralsSpotted: 3 });
    stores.syncStore.set("firstUsed", 1000);

    const migrate = await loadMigration();
    await migrate();

    assert.deepStrictEqual(
      stores.localStore.get("stats"),
      { urlsCleaned: 42, junkRemoved: 7, referralsSpotted: 3 },
      "the whole point of the migration is that this data survives"
    );
    assert.strictEqual(stores.localStore.get("firstUsed"), 1000);
  });

  test("clears the old sync keys once copied", async () => {
    stores.syncStore.set("stats", { urlsCleaned: 1, junkRemoved: 0, referralsSpotted: 0 });

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.syncStore.has("stats"), false);
    assert.strictEqual(stores.syncStore.has("firstUsed"), false);
    assert.strictEqual(stores.syncStore.has("nudgeDismissed"), false);
  });

  test("a legitimately false nudgeDismissed in sync still migrates", async () => {
    // `false` is a real value, not an absence. Nullish coalescing is what
    // distinguishes them, and getting that wrong loses a user's dismissal.
    stores.syncStore.set("nudgeDismissed", false);

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.get("nudgeDismissed"), false);
  });

  test("does nothing at all when sync holds no old data", async () => {
    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.size, 0, "a no-op migration must not write");
  });
});

describe("migrateStatsToLocal — local already has newer data", () => {
  test("local wins over a stale sync value", async () => {
    // The defect. incrementStat() flushes in batches, so a flush landing
    // between the local read and the local write used to be overwritten by a
    // value from before the migration.
    stores.syncStore.set("stats", { urlsCleaned: 5, junkRemoved: 1, referralsSpotted: 0 });
    stores.localStore.set("stats", { urlsCleaned: 500, junkRemoved: 90, referralsSpotted: 12 });

    const migrate = await loadMigration();
    await migrate();

    assert.deepStrictEqual(
      stores.localStore.get("stats"),
      { urlsCleaned: 500, junkRemoved: 90, referralsSpotted: 12 },
      "a newer local count must not be replaced by the pre-migration sync copy"
    );
  });

  test("the original firstUsed is never overwritten by a later one", async () => {
    // "when this user first used MUGA". Replacing it with a later stamp
    // destroys it with no way to notice.
    stores.syncStore.set("firstUsed", 9999);
    stores.localStore.set("firstUsed", 111);

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.get("firstUsed"), 111);
  });

  test("each key is decided on its own", async () => {
    // A per-key decision, not a per-record one: local can be ahead on stats
    // while having never seen firstUsed.
    stores.syncStore.set("stats", { urlsCleaned: 5, junkRemoved: 0, referralsSpotted: 0 });
    stores.syncStore.set("firstUsed", 1000);
    stores.localStore.set("stats", { urlsCleaned: 50, junkRemoved: 0, referralsSpotted: 0 });

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.get("stats").urlsCleaned, 50, "local is ahead here");
    assert.strictEqual(stores.localStore.get("firstUsed"), 1000, "and absent here");
  });

  test("a local `false` beats a sync `true`, because false is a value", async () => {
    stores.syncStore.set("nudgeDismissed", true);
    stores.localStore.set("nudgeDismissed", false);

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.get("nudgeDismissed"), false);
  });

  test("no key is written that neither side holds", async () => {
    // Writing an explicit null for an absent key would leave storage worse
    // than untouched: every later read would see a value that means nothing.
    stores.syncStore.set("firstUsed", 1000);

    const migrate = await loadMigration();
    await migrate();

    assert.strictEqual(stores.localStore.has("stats"), false);
    assert.strictEqual(stores.localStore.has("nudgeDismissed"), false);
    assert.strictEqual(stores.localStore.get("firstUsed"), 1000);
  });
});
