/**
 * MUGA — migratePerSiteDisableToAllowlist (removal of legacy `::disabled`
 * per-site-pause blacklist syntax)
 *
 * The `domain::disabled` blacklist entry used to make MUGA fully inert on
 * that domain. That syntax has been removed entirely — a domain is
 * exempted ONLY via a domain-only whitelist (allowlist) entry now. This
 * one-time, idempotent migration converts any pre-existing `::disabled`
 * blacklist entry into a bare domain-only whitelist entry so no existing
 * user (or the maintainer's own test data) is silently left with a dead
 * entry that no longer exempts anything.
 *
 * Uses a stateful in-memory chrome.storage.sync stub (mirrors the pattern
 * in tests/unit/migration-storage.test.mjs) so reads return what was
 * written, and re-imports the module fresh per test to bypass module
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

describe("migratePerSiteDisableToAllowlist", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("converts a `domain::disabled` blacklist entry into a bare whitelist entry and clears the blacklist", async () => {
    stores.syncStore.set("blacklist", ["example.com::disabled"]);
    stores.syncStore.set("whitelist", []);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["example.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), []);
  });

  test("preserves param-scoped blacklist entries untouched", async () => {
    stores.syncStore.set("blacklist", ["example.com::disabled", "amazon.es::tag::youtuber-21"]);
    stores.syncStore.set("whitelist", []);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["example.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), ["amazon.es::tag::youtuber-21"]);
  });

  test("does not duplicate a domain already covered by an existing whitelist entry", async () => {
    stores.syncStore.set("blacklist", ["example.com::disabled"]);
    stores.syncStore.set("whitelist", ["example.com"]);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["example.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), []);
  });

  test("a subdomain::disabled entry is not duplicated when the parent domain is already whitelisted", async () => {
    stores.syncStore.set("blacklist", ["shop.example.com::disabled"]);
    stores.syncStore.set("whitelist", ["example.com"]);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["example.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), []);
  });

  test("is idempotent — a second run is a no-op", async () => {
    stores.syncStore.set("blacklist", ["example.com::disabled"]);
    stores.syncStore.set("whitelist", []);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();
    const afterFirst = {
      whitelist: [...stores.syncStore.get("whitelist")],
      blacklist: [...stores.syncStore.get("blacklist")],
    };

    await migratePerSiteDisableToAllowlist();
    assert.deepEqual(stores.syncStore.get("whitelist"), afterFirst.whitelist);
    assert.deepEqual(stores.syncStore.get("blacklist"), afterFirst.blacklist);
  });

  test("no `::disabled` entries present — nothing changes", async () => {
    stores.syncStore.set("blacklist", ["amazon.es::tag::youtuber-21", "booking.com"]);
    stores.syncStore.set("whitelist", ["shop.example.com"]);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["shop.example.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), ["amazon.es::tag::youtuber-21", "booking.com"]);
  });

  test("multiple distinct `::disabled` entries are all converted", async () => {
    stores.syncStore.set("blacklist", ["a.com::disabled", "b.com::disabled"]);
    stores.syncStore.set("whitelist", []);

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await migratePerSiteDisableToAllowlist();

    assert.deepEqual(stores.syncStore.get("whitelist"), ["a.com", "b.com"]);
    assert.deepEqual(stores.syncStore.get("blacklist"), []);
  });

  test("fail-safe: a chrome.storage.sync.get error does not throw", async () => {
    globalThis.chrome = {
      storage: {
        sync: {
          get: (_defaults, cb) => {
            globalThis.chrome.runtime.lastError = { message: "boom" };
            cb && cb({});
          },
          set: () => { throw new Error("must not be called"); },
        },
      },
      runtime: { lastError: null },
    };

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await assert.doesNotReject(() => migratePerSiteDisableToAllowlist());
  });

  test("fail-safe: a chrome.storage.sync.set error does not throw", async () => {
    stores.syncStore.set("blacklist", ["example.com::disabled"]);
    stores.syncStore.set("whitelist", []);
    globalThis.chrome.storage.sync.set = (_data, cb) => {
      globalThis.chrome.runtime.lastError = { message: "boom" };
      cb && cb();
    };

    const { migratePerSiteDisableToAllowlist } = await loadMigration();
    await assert.doesNotReject(() => migratePerSiteDisableToAllowlist());
  });
});
