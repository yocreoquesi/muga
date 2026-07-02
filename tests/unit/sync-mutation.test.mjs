/**
 * MUGA — Unit tests for src/options/sync-mutation.js (#928)
 *
 * withSyncMutation + createMutex replace five near-identical duplicated
 * read-mutate-write blocks that used to live directly in options.js:
 *   - tracking-categories toggle (previously had NO lock at all)
 *   - blacklist/whitelist/customParams add (shared withListLock)
 *   - blacklist/whitelist/customParams remove (shared withListLock)
 *   - creator-allowlist add (previously its own local mutex)
 *   - creator-allowlist remove (previously its own local mutex)
 *
 * This module is dependency-injected (get/set default to chrome.storage.sync
 * and setPrefs, but tests always supply fakes), so it is importable and
 * testable in plain Node without a browser/extension environment or a
 * chrome.* stub — unlike options.js itself, which touches `document` at
 * module scope and cannot be imported directly (see options-patterns.test.mjs
 * for the source-guard approach used for options.js wiring instead).
 *
 * These tests exercise the extracted helper directly against a fake
 * in-memory sync-storage double to prove:
 *   1. Concurrent mutations queued through the SAME lock never drop a write
 *      — this is the categories-toggle race #928 fixes.
 *   2. Without a shared lock (the pre-#928 categories-toggle shape),
 *      concurrent mutations DO race and drop writes — a regression repro.
 *   3. Mutations queued through DIFFERENT locks are fully independent.
 *   4. Returning `undefined` from mutateFn aborts without writing.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createMutex, withSyncMutation } from "../../src/options/sync-mutation.js";

// ── Fake sync-storage double (no chrome.* dependency) ────────────────────────

function makeFakeSync() {
  const store = {};
  let writeCount = 0;
  return {
    get: async (query) => {
      const result = {};
      for (const [k, def] of Object.entries(query)) {
        result[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : def;
      }
      return result;
    },
    set: async (partial) => {
      writeCount++;
      Object.assign(store, partial);
    },
    getStore: () => store,
    getWriteCount: () => writeCount,
  };
}

describe("withSyncMutation — concurrent mutations under the SAME lock never drop a write", () => {
  test("five concurrent list-append mutations against the same key all land, in call order", async () => {
    const fake = makeFakeSync();
    const lock = createMutex();

    await Promise.all(
      ["a", "b", "c", "d", "e"].map((item) =>
        withSyncMutation(lock, "items", [], (current) => [...current, item], {
          get: fake.get,
          set: fake.set,
        })
      )
    );

    assert.deepEqual(
      fake.getStore().items,
      ["a", "b", "c", "d", "e"],
      "all five concurrent appends must survive in call order — a naive read-modify-write would drop some"
    );
  });

  test("mutateFn invocations run strictly one-at-a-time, in call order, even with variable async delays", async () => {
    const fake = makeFakeSync();
    const lock = createMutex();
    const invocationOrder = [];

    // Call 1 is the SLOWEST; if the lock did not serialize, its write could
    // land after calls 2 and 3, which are queued later but resolve faster.
    await Promise.all(
      [1, 2, 3].map((n) =>
        withSyncMutation(
          lock,
          "seq",
          [],
          async (current) => {
            invocationOrder.push(n);
            await new Promise((resolve) => setTimeout(resolve, (4 - n) * 5));
            return [...current, n];
          },
          { get: fake.get, set: fake.set }
        )
      )
    );

    assert.deepEqual(invocationOrder, [1, 2, 3], "mutateFn must be invoked in call order under one lock");
    assert.deepEqual(fake.getStore().seq, [1, 2, 3], "writes must land in call order, not completion order");
  });
});

describe("withSyncMutation — without a shared lock, concurrent mutations race and drop writes (regression repro)", () => {
  test("five concurrent mutations each using their OWN fresh mutex lose writes — the pre-#928 categories-toggle bug", async () => {
    const fake = makeFakeSync();

    await Promise.all(
      ["a", "b", "c", "d", "e"].map((item) =>
        withSyncMutation(createMutex(), "items", [], (current) => [...current, item], {
          get: fake.get,
          set: fake.set,
        })
      )
    );

    assert.ok(
      fake.getStore().items.length < 5,
      "unlocked concurrent mutations must race and drop at least one write — proves the shared lock is load-bearing"
    );
  });
});

describe("withSyncMutation — independent locks never serialize against each other", () => {
  test("two different createMutex() queues interleave freely and both land correctly", async () => {
    const fakeA = makeFakeSync();
    const fakeB = makeFakeSync();
    const lockA = createMutex();
    const lockB = createMutex();

    await Promise.all([
      withSyncMutation(lockA, "x", [], (c) => [...c, "A"], { get: fakeA.get, set: fakeA.set }),
      withSyncMutation(lockB, "x", [], (c) => [...c, "B"], { get: fakeB.get, set: fakeB.set }),
    ]);

    assert.deepEqual(fakeA.getStore().x, ["A"]);
    assert.deepEqual(fakeB.getStore().x, ["B"]);
  });
});

describe("withSyncMutation — abort semantics (mutateFn returns undefined)", () => {
  test("returning undefined skips the write entirely", async () => {
    const fake = makeFakeSync();
    const lock = createMutex();

    const result = await withSyncMutation(lock, "items", ["seed"], () => undefined, {
      get: fake.get,
      set: fake.set,
    });

    assert.equal(result, undefined);
    assert.equal(fake.getWriteCount(), 0, "no write should happen when mutateFn aborts");
    assert.equal(fake.getStore().items, undefined, "storage must remain untouched");
  });

  test("an aborted mutation does not block a later successful one under the same lock", async () => {
    const fake = makeFakeSync();
    const lock = createMutex();

    const aborted = await withSyncMutation(lock, "items", [], () => undefined, { get: fake.get, set: fake.set });
    const ok = await withSyncMutation(lock, "items", [], (c) => [...c, "ok"], { get: fake.get, set: fake.set });

    assert.equal(aborted, undefined);
    assert.deepEqual(ok, ["ok"]);
    assert.deepEqual(fake.getStore().items, ["ok"]);
  });
});

describe("withSyncMutation — error handling", () => {
  test("a failed read is caught, logged, and resolves to undefined without calling set", async () => {
    const lock = createMutex();
    let setCalled = false;

    const result = await withSyncMutation(
      lock,
      "items",
      [],
      () => ["should never run"],
      {
        get: async () => { throw new Error("boom"); },
        set: async () => { setCalled = true; },
      }
    );

    assert.equal(result, undefined);
    assert.equal(setCalled, false, "set must not be called when the read fails");
  });
});

describe("sync-mutation.js — importable without a browser/extension environment", () => {
  test("createMutex and withSyncMutation are plain exported functions", () => {
    assert.equal(typeof createMutex, "function");
    assert.equal(typeof withSyncMutation, "function");
    // Importing this module must not throw even though `chrome` and
    // `document` are undefined in this Node test environment — the default
    // get/set fall back to chrome.storage.sync / setPrefs lazily, only when
    // actually invoked without deps.
  });
});
