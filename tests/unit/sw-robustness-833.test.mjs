/**
 * MUGA — the #833 SW robustness invariants, tested against the real code (#1268)
 *
 * This file used to open with:
 *
 *   > All tests are behavioral — they exercise pure extracted helpers that
 *   > mirror the production logic. No swSource string scanning; SW is not
 *   > importable in Node (top-level chrome.* calls).
 *
 * So the #833 invariants were asserted against a reimplementation written in
 * this file. If the service worker drifted from that copy, these tests stayed
 * green while the shipped behaviour changed, and nothing proved the two still
 * matched -- unlike the five STRIP mirrors, which are checked against their
 * generator. It is also part of why the concurrency defects in #1257 could
 * ship: the real call sites were in a file no test could reach.
 *
 * The fix was not a stronger mirror. `src/lib/single-flight-loader.js`
 * now holds the logic, the service worker constructs its two loaders from it,
 * and these tests import it. The mirrors are deleted.
 *
 * ── What #833 fixed ────────────────────────────────────────────────────────
 *
 * A service worker wakes on many events and several can call into the cleaner
 * at once. Before #833 each concurrent caller started its own fetch and
 * incremented the attempt counter, so three simultaneous wakes could burn the
 * whole retry budget on one cold start.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createSingleFlightLoader,
  createFirstUsedBootstrap,
} from "../../src/lib/single-flight-loader.js";

/**
 * A loader over an in-memory rule array, wired the way the service worker
 * wires its domain-rules loader.
 */
function makeLoader({ maxAttempts = 3, readCache, writeCache } = {}) {
  let rules = [];
  let fetches = 0;
  let behaviour = async () => ["rule-a"];

  const loader = createSingleFlightLoader({
    label: "test-rules",
    maxAttempts,
    isLoaded: () => rules.length > 0,
    readCache,
    writeCache,
    fetchAll: async () => {
      fetches++;
      return behaviour();
    },
    apply: (data) => { rules = data; },
    onError: () => { /* the real loaders log; silence keeps the output readable */ },
  });

  return {
    loader,
    getRules: () => rules.slice(),
    getFetches: () => fetches,
    setBehaviour: (fn) => { behaviour = fn; },
  };
}

const FAIL = async () => { throw new Error("network"); };

// ── #1270: a fetch that SUCCEEDS but returns junk ────────────────────────────
//
// The content-script loaders added in #1270 guard `apply` on Array.isArray, so
// a truncated or malformed rules payload never becomes the cache. That turns a
// successful-but-useless fetch into a retryable failure instead of caching it
// as "successfully empty", which is exactly the silent-degradation this issue
// is about: an empty rule set is indistinguishable from "this host has no
// rules" at every call site downstream.
//
// Every existing test above has an `apply` that always succeeds, so nothing
// covered the case where the loader completes without becoming loaded.
describe("#1270 — a payload apply() rejects keeps the retry armed", () => {

  /** A loader whose apply() accepts arrays only, like the content-script pair. */
  function makeGuardedLoader() {
    let rules = null;
    let fetches = 0;
    let behaviour = async () => ["rule-a"];
    const loader = createSingleFlightLoader({
      label: "guarded-rules",
      maxAttempts: 3,
      isLoaded: () => rules !== null,
      fetchAll: async () => { fetches++; return behaviour(); },
      apply: (data) => { if (Array.isArray(data)) rules = data; },
      onError: () => { /* silence */ },
    });
    return { loader, getRules: () => rules, getFetches: () => fetches, setBehaviour: (f) => { behaviour = f; } };
  }

  test("a non-array payload does not count as loaded", async () => {
    const h = makeGuardedLoader();
    h.setBehaviour(async () => ({ oops: "not an array" }));
    await h.loader.ensure();
    assert.equal(h.getRules(), null, "junk must never become the cache");
  });

  test("and the next call retries rather than serving a cached empty set", async () => {
    const h = makeGuardedLoader();
    h.setBehaviour(async () => "truncated");
    await h.loader.ensure();
    assert.equal(h.getFetches(), 1);

    h.setBehaviour(async () => ["rule-a"]);
    await h.loader.ensure();
    assert.equal(h.getFetches(), 2, "the second call must re-fetch, not reuse the failed load");
    assert.deepEqual(h.getRules(), ["rule-a"], "and recover once the payload is valid");
  });

  test("junk still spends the budget, so it cannot retry forever", async () => {
    const h = makeGuardedLoader();
    h.setBehaviour(async () => null);
    for (let i = 0; i < 5; i++) await h.loader.ensure();
    assert.equal(h.getFetches(), 3, "capped at maxAttempts like any other failure");
    assert.equal(h.getRules(), null);
  });
});

// ── 1. Single-flight loading ─────────────────────────────────────────────────

describe("single-flight loader — concurrent callers share one in-flight load", () => {
  test("two concurrent callers produce exactly one fetch on success", async () => {
    const h = makeLoader();
    await Promise.all([h.loader.ensure(), h.loader.ensure()]);

    assert.strictEqual(h.getFetches(), 1, "one fetch despite two concurrent callers");
    assert.strictEqual(h.loader.attempts, 1, "the attempt counter must be 1, not 2");
    assert.deepStrictEqual(h.getRules(), ["rule-a"]);
  });

  test("two concurrent callers produce exactly one fetch on failure", async () => {
    // The race #833 fixed. Two callers each burning an attempt on a cold start
    // is how a transient failure used to eat the whole retry budget.
    const h = makeLoader();
    h.setBehaviour(FAIL);
    await Promise.all([h.loader.ensure(), h.loader.ensure()]);

    assert.strictEqual(h.getFetches(), 1, "one fetch even when it fails");
    assert.strictEqual(h.loader.attempts, 1, "the attempt counter must be 1, not 2");
  });

  test("five concurrent callers all wait on the same load", async () => {
    const h = makeLoader();
    h.setBehaviour(async () => {
      await new Promise((r) => setImmediate(r));
      return ["shared-rule"];
    });

    await Promise.all(Array.from({ length: 5 }, () => h.loader.ensure()));
    assert.strictEqual(h.getFetches(), 1);
    assert.deepStrictEqual(h.getRules(), ["shared-rule"]);
  });

  test("after a failure the next independent call retries", async () => {
    const h = makeLoader();
    h.setBehaviour(FAIL);
    await h.loader.ensure();
    assert.strictEqual(h.loader.attempts, 1);

    h.setBehaviour(async () => ["rule-ok"]);
    await h.loader.ensure();

    assert.strictEqual(h.loader.attempts, 2, "the second independent call must retry");
    assert.deepStrictEqual(h.getRules(), ["rule-ok"]);
    assert.strictEqual(h.getFetches(), 2);
  });

  test("after success, later calls skip the fetch entirely", async () => {
    const h = makeLoader();
    await h.loader.ensure();
    await h.loader.ensure();
    await h.loader.ensure();

    assert.strictEqual(h.getFetches(), 1, "one fetch across three calls once loaded");
    assert.strictEqual(h.loader.attempts, 1);
  });

  test("once the attempt budget is spent, further calls are no-ops", async () => {
    const h = makeLoader({ maxAttempts: 2 });
    h.setBehaviour(FAIL);

    await h.loader.ensure();
    await h.loader.ensure();
    assert.strictEqual(h.loader.attempts, 2);

    await h.loader.ensure();
    assert.strictEqual(h.loader.attempts, 2, "the counter must never exceed maxAttempts");
    assert.strictEqual(h.getFetches(), 2, "the call after the cap must not fetch again");
    assert.deepStrictEqual(h.getRules(), []);
  });
});

// ── 2. The cache path, which the mirror could not reach ──────────────────────
//
// These are the tests that could not previously be written. The mirror had no
// cache layer at all, so nothing checked that a cache hit skips the attempt
// budget -- the property that keeps a warm start from spending a retry it may
// need later in the same lifetime.

describe("single-flight loader — the session cache", () => {
  test("a cache hit costs no fetch and no attempt", async () => {
    const h = makeLoader({ readCache: async () => ["cached-rule"] });
    await h.loader.ensure();

    assert.deepStrictEqual(h.getRules(), ["cached-rule"]);
    assert.strictEqual(h.getFetches(), 0, "a cache hit must not fetch");
    assert.strictEqual(h.loader.attempts, 0,
      "a cache hit must not spend an attempt, or a warm start eats a retry it may need");
  });

  test("a cache miss falls through to the fetch", async () => {
    const h = makeLoader({ readCache: async () => null });
    await h.loader.ensure();

    assert.deepStrictEqual(h.getRules(), ["rule-a"]);
    assert.strictEqual(h.getFetches(), 1);
  });

  test("a throwing cache is treated as a miss, not as a failure", async () => {
    // A broken cache must not become an outage: it is a performance feature.
    const h = makeLoader({ readCache: async () => { throw new Error("storage gone"); } });
    await h.loader.ensure();

    assert.deepStrictEqual(h.getRules(), ["rule-a"], "the load must still succeed");
    assert.strictEqual(h.loader.attempts, 1);
  });

  test("a failing cache WRITE does not fail the load", async () => {
    // The rules are already applied by then. A failed write costs the next cold
    // start a fetch and nothing else.
    const h = makeLoader({ writeCache: async () => { throw new Error("quota"); } });
    await h.loader.ensure();

    assert.deepStrictEqual(h.getRules(), ["rule-a"]);
  });

  test("a successful fetch is written to the cache", async () => {
    let written = null;
    const h = makeLoader({ writeCache: async (data) => { written = data; } });
    await h.loader.ensure();

    assert.deepStrictEqual(written, ["rule-a"]);
  });
});

// ── 3. firstUsed bootstrap ───────────────────────────────────────────────────

describe("firstUsed bootstrap — idempotent, and never overwrites", () => {
  function makeStats(initial = {}) {
    let stats = { ...initial };
    let reads = 0;
    let writes = 0;
    return {
      getStats: async () => { reads++; return { ...stats }; },
      setStats: async (patch) => { writes++; stats = { ...stats, ...patch }; },
      current: () => ({ ...stats }),
      counts: () => ({ reads, writes }),
    };
  }

  test("sets firstUsed when it is absent", async () => {
    const s = makeStats();
    const boot = createFirstUsedBootstrap({ ...s, now: () => 1234 });
    await boot.ensure();

    assert.strictEqual(s.current().firstUsed, 1234);
    assert.strictEqual(boot.done, true);
  });

  test("never overwrites an existing firstUsed", async () => {
    // The value is "when this user first used MUGA". A retry that stamps today
    // destroys it with no way to notice, which is why this is pinned rather
    // than left to the read-then-write shape looking obviously correct.
    const s = makeStats({ firstUsed: 111 });
    const boot = createFirstUsedBootstrap({ ...s, now: () => 999 });
    await boot.ensure();

    assert.strictEqual(s.current().firstUsed, 111);
    assert.strictEqual(s.counts().writes, 0, "an existing timestamp must not be rewritten");
  });

  test("is idempotent within a worker lifetime", async () => {
    const s = makeStats();
    const boot = createFirstUsedBootstrap({ ...s, now: () => 1 });

    await boot.ensure();
    await boot.ensure();
    await boot.ensure();

    assert.strictEqual(s.counts().reads, 1, "later calls must be a boolean check, not a storage read");
    assert.strictEqual(s.counts().writes, 1);
  });

  test("a storage failure leaves it retryable rather than swallowing the stamp", async () => {
    let fail = true;
    let stats = {};
    const boot = createFirstUsedBootstrap({
      getStats: async () => { if (fail) throw new Error("storage"); return { ...stats }; },
      setStats: async (patch) => { stats = { ...stats, ...patch }; },
      now: () => 7,
    });

    await boot.ensure();
    assert.strictEqual(boot.done, false, "a failed bootstrap must not mark itself done");

    fail = false;
    await boot.ensure();
    assert.strictEqual(stats.firstUsed, 7, "the next call must complete the bootstrap");
  });

  test("concurrent callers do not double-write", async () => {
    // Not reachable through the mirror either: the service worker calls this
    // from onInstalled, onStartup and the PROCESS_URL fallback, which can
    // overlap on a cold start.
    const s = makeStats();
    const boot = createFirstUsedBootstrap({ ...s, now: () => 5 });

    await Promise.all([boot.ensure(), boot.ensure(), boot.ensure()]);
    assert.strictEqual(s.counts().writes, 1, "three overlapping callers, one write");
  });
});
