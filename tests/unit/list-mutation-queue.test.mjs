/**
 * MUGA — list mutations are serialised, including the migration (#1257)
 *
 * The whitelist and blacklist are whole arrays, so every change is a
 * read-modify-write and `chrome.storage.sync.set` REPLACES the key. Two writers
 * that read the same array both write back what they read, and whichever lands
 * second destroys the other's entry with no error.
 *
 * `service-worker.js` serialised its own two message handlers against each
 * other. `migratePerSiteDisableToAllowlist` did not join them -- it could not,
 * because the chain was a module-local promise in a file nothing can import --
 * so it read the lists, did its work, and wrote both arrays raw. A user adding
 * a site to their allowlist during that window watched the entry disappear.
 *
 * The last describe is the one that matters: it reproduces that loss against
 * the real migration, and it fails without the fix.
 *
 * Run with: npm test
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  enqueueListMutation,
  resetListMutationQueueForTest,
} from "../../src/lib/list-mutation-queue.js";

beforeEach(() => {
  resetListMutationQueueForTest();
});

const tick = () => new Promise((r) => setImmediate(r));

describe("enqueueListMutation", () => {
  test("tasks run one at a time, in order", async () => {
    const events = [];
    const task = (name) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
    };

    await Promise.all([
      enqueueListMutation(task("a")),
      enqueueListMutation(task("b")),
      enqueueListMutation(task("c")),
    ]);

    assert.deepStrictEqual(events, [
      "a:start", "a:end",
      "b:start", "b:end",
      "c:start", "c:end",
    ], "no task may start before the previous one has finished");
  });

  test("a read-modify-write cannot be interleaved", async () => {
    // The shape of the bug, in miniature: read, yield, write back what you
    // read. Unserialised, the second writer's entry is destroyed.
    let list = [];
    const append = (entry) => async () => {
      const snapshot = [...list];
      await tick();
      list = [...snapshot, entry];
    };

    await Promise.all([
      enqueueListMutation(append("first")),
      enqueueListMutation(append("second")),
    ]);

    assert.deepStrictEqual(list, ["first", "second"], "neither entry may be lost");
  });

  test("the same interleaving DOES lose an entry without the queue", async () => {
    // Keeps the test above from being vacuous: it must be the queue doing the
    // work, not the scheduler happening to be kind.
    let list = [];
    const append = async (entry) => {
      const snapshot = [...list];
      await tick();
      list = [...snapshot, entry];
    };

    await Promise.all([append("first"), append("second")]);

    assert.deepStrictEqual(list, ["second"], "unqueued, the first entry is destroyed");
  });

  test("the caller sees its own task's result", async () => {
    const value = await enqueueListMutation(async () => "done");
    assert.strictEqual(value, "done");
  });

  test("the caller sees its own task's rejection", async () => {
    await assert.rejects(
      enqueueListMutation(async () => { throw new Error("nope"); }),
      /nope/
    );
  });

  test("a failing task does not poison the chain", async () => {
    // A migration that fails must not silently stop every later allowlist edit
    // for the life of the worker.
    await enqueueListMutation(async () => { throw new Error("boom"); }).catch(() => {});

    const after = await enqueueListMutation(async () => "still working");
    assert.strictEqual(after, "still working");
  });

  test("a task enqueued while another runs still waits its turn", async () => {
    const events = [];
    const slow = enqueueListMutation(async () => {
      events.push("slow:start");
      await tick();
      await tick();
      events.push("slow:end");
    });

    const late = enqueueListMutation(async () => { events.push("late"); });

    await Promise.all([slow, late]);
    assert.deepStrictEqual(events, ["slow:start", "slow:end", "late"]);
  });
});

// ── Against the real migration ───────────────────────────────────────────────

describe("migratePerSiteDisableToAllowlist does not destroy a concurrent add", () => {
  function makeArea(store) {
    return {
      get: (defaults, cb) => {
        const out = {};
        for (const [k, fallback] of Object.entries(defaults)) {
          out[k] = store.has(k) ? store.get(k) : fallback;
        }
        // Async, like the real API: a synchronous callback would hide the
        // window this test exists to exercise.
        setImmediate(() => cb(out));
      },
      set: (items, cb) => {
        setImmediate(() => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
          cb && cb();
        });
      },
      remove: (keys, cb) => {
        setImmediate(() => {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
          cb && cb();
        });
      },
    };
  }

  test("an allowlist entry added mid-migration survives", async () => {
    const syncStore = new Map([
      ["whitelist", []],
      // A legacy per-site-disable entry, which is what makes the migration act.
      ["blacklist", ["legacy.example::disabled"]],
    ]);
    globalThis.chrome = {
      storage: { sync: makeArea(syncStore), local: makeArea(new Map()) },
      runtime: { lastError: null },
    };

    resetListMutationQueueForTest();
    const { migratePerSiteDisableToAllowlist } = await import(
      "../../src/lib/storage-migrations.js?cb=" + Math.random()
    );
    const { enqueueListMutation: enqueue } = await import(
      "../../src/lib/list-mutation-queue.js"
    );

    // The user adding a site, exactly as the ADD_TO_WHITELIST handler does:
    // read the current list, then write it back with one more entry.
    const userAdd = enqueue(async () => {
      const current = await new Promise((resolve) =>
        chrome.storage.sync.get({ whitelist: [] }, (r) => resolve(r.whitelist))
      );
      await new Promise((resolve) =>
        chrome.storage.sync.set({ whitelist: [...current, "user-added.example"] }, resolve)
      );
    });

    await Promise.all([migratePerSiteDisableToAllowlist(), userAdd]);

    const finalWhitelist = syncStore.get("whitelist");
    assert.ok(
      finalWhitelist.includes("user-added.example"),
      `the user's entry was destroyed by the migration: ${JSON.stringify(finalWhitelist)}`
    );
    assert.ok(
      finalWhitelist.includes("legacy.example"),
      "and the migration's own conversion must still land"
    );
  });
});
