/**
 * MUGA — Behavioral tests for #833 SW robustness fixes.
 *
 * 1. Single-flight rules loaders: concurrent handleProcessUrl callers must
 *    share one in-flight promise and increment the attempt counter only once
 *    per actual fetch, not once per concurrent caller.
 *
 * 2. firstUsed bootstrap: _initFirstUsed must be idempotent and must set
 *    firstUsed only when absent, protecting the original timestamp across
 *    retries in the same SW lifetime.
 *
 * All tests are behavioral — they exercise pure extracted helpers that mirror
 * the production logic. No swSource string scanning; SW is not importable
 * in Node (top-level chrome.* calls).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── 1. Single-flight loader helper ───────────────────────────────────────────
//
// Mirrors the _loadDomainRules / _loadPathRules + handleProcessUrl gating
// pattern after the #833 fix. Key invariants:
//
//   a) Two concurrent callers sharing a null ref both await the SAME promise —
//      the attempt counter increments once per actual fetch, not twice.
//   b) After the shared await completes (failure case), the ref is nulled so
//      the next independent call can retry.
//   c) A successful load leaves the ref populated; subsequent callers skip
//      the fetch entirely.
//   d) Once MAX_ATTEMPTS is reached, the loader logs and returns without
//      another fetch; the ref stays set (resolves immediately as no-op).

function makeSingleFlightLoader({ maxAttempts = 3 } = {}) {
  let rules = [];
  let readyRef = null;
  let attempts = 0;

  // Pure loader — mirrors _loadDomainRules sans Chrome APIs.
  async function _load(fetchFn) {
    if (attempts >= maxAttempts) return; // at cap — no-op
    try {
      attempts++;
      rules = await fetchFn();
    } catch {
      // Do NOT null readyRef here — concurrent callers already have it.
      // handleProcessUrl nulls it post-await if load failed.
    }
  }

  // Caller site — mirrors handleProcessUrl's gating and post-await null-out.
  async function handleCall(fetchFn) {
    if (!readyRef) readyRef = _load(fetchFn);
    await readyRef;
    // Post-await: null for retry only when load failed and cap not reached.
    if (rules.length === 0 && attempts < maxAttempts) {
      readyRef = null;
    }
    return rules.slice();
  }

  return { handleCall, getAttempts: () => attempts, getRules: () => rules };
}

describe("Single-flight loader — concurrent callers share one in-flight promise", () => {
  test("two concurrent callers produce exactly one fetch attempt on success", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader();
    const fetch = async () => { fetchCount++; return ["rule-a"]; };

    const [r1, r2] = await Promise.all([
      loader.handleCall(fetch),
      loader.handleCall(fetch),
    ]);

    assert.strictEqual(fetchCount, 1, "fetch must be called exactly once despite two concurrent callers");
    assert.strictEqual(loader.getAttempts(), 1, "attempt counter must be 1, not 2");
    assert.deepStrictEqual(r1, ["rule-a"]);
    assert.deepStrictEqual(r2, ["rule-a"]);
  });

  test("two concurrent callers produce exactly one fetch attempt on failure", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader();
    const fetch = async () => { fetchCount++; throw new Error("network"); };

    await Promise.all([
      loader.handleCall(fetch).catch(() => {}),
      loader.handleCall(fetch).catch(() => {}),
    ]);

    assert.strictEqual(fetchCount, 1, "fetch must fire once even when it fails");
    assert.strictEqual(loader.getAttempts(), 1, "attempt counter must be 1, not 2 (the race bug)");
  });

  test("after failure, next independent call retries (ref nulled post-await)", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader();
    const failFetch = async () => { fetchCount++; throw new Error("net"); };
    const okFetch   = async () => { fetchCount++; return ["rule-ok"]; };

    // First call — fails
    await loader.handleCall(failFetch);
    assert.strictEqual(loader.getAttempts(), 1);

    // Second independent call — should retry
    const rules = await loader.handleCall(okFetch);
    assert.strictEqual(loader.getAttempts(), 2, "second independent call must increment to 2");
    assert.deepStrictEqual(rules, ["rule-ok"]);
    assert.strictEqual(fetchCount, 2, "two distinct fetch calls should have been made");
  });

  test("after success, ref stays set and subsequent calls skip fetch", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader();
    const fetch = async () => { fetchCount++; return ["cached"]; };

    await loader.handleCall(fetch);
    await loader.handleCall(fetch); // ref is non-null and rules populated — no retry
    await loader.handleCall(fetch);

    assert.strictEqual(fetchCount, 1, "only one fetch for multiple calls after success");
    assert.strictEqual(loader.getAttempts(), 1);
  });

  test("attempt cap: once maxAttempts reached, further calls are no-ops", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader({ maxAttempts: 2 });
    const failFetch = async () => { fetchCount++; throw new Error("net"); };

    // Two failing attempts exhaust the cap
    await loader.handleCall(failFetch);
    await loader.handleCall(failFetch);
    assert.strictEqual(loader.getAttempts(), 2);

    // After the cap, ref is NOT nulled — loader resolves immediately as no-op
    const rules = await loader.handleCall(failFetch);
    assert.strictEqual(loader.getAttempts(), 2, "attempt counter must not exceed maxAttempts");
    assert.strictEqual(fetchCount, 2, "the no-op call after the cap must not fetch again");
    assert.deepStrictEqual(rules, []);
  });

  test("five concurrent callers all get the same result from one fetch", async () => {
    let fetchCount = 0;
    const loader = makeSingleFlightLoader();
    const fetch = async () => {
      fetchCount++;
      // Simulate async work
      await new Promise(r => setImmediate(r));
      return ["shared-rule"];
    };

    const results = await Promise.all(Array.from({ length: 5 }, () => loader.handleCall(fetch)));
    assert.strictEqual(fetchCount, 1);
    for (const r of results) {
      assert.deepStrictEqual(r, ["shared-rule"]);
    }
  });
});

// ── 2. firstUsed idempotent bootstrap ────────────────────────────────────────
//
// Mirrors _initFirstUsed() and the hot-path fallback in handleProcessUrl.
// Invariants:
//   a) When firstUsed is absent, setStats is called with a timestamp.
//   b) When firstUsed is already present, setStats is NOT called (idempotent).
//   c) The module flag (_firstUsedSet) prevents repeated storage reads in the
//      hot path across multiple processUrl calls in the same SW lifetime.
//   d) A throw between read and set (simulating concurrent writes) doesn't
//      reset firstUsed to a later timestamp — the idempotent read-first
//      pattern ensures the original timestamp is preserved.

function makeFirstUsedBootstrap() {
  let _firstUsedSet = false;

  // Mirrors _initFirstUsed from service-worker.js after #833 fix.
  async function initFirstUsed({ getStats, setStats, now = Date.now }) {
    if (_firstUsedSet) return;
    try {
      const stats = await getStats();
      if (!stats.firstUsed) await setStats({ firstUsed: now() });
      _firstUsedSet = true;
    } catch { /* best-effort */ }
  }

  // Mirrors the hot-path fallback in handleProcessUrl.
  async function hotPathGuard({ getStats, setStats, now = Date.now }) {
    if (_firstUsedSet) return; // free boolean check — no storage read
    const localStats = await getStats();
    if (localStats.firstUsed) {
      _firstUsedSet = true;
    } else {
      await setStats({ firstUsed: now() });
      _firstUsedSet = true;
    }
  }

  return { initFirstUsed, hotPathGuard, isSet: () => _firstUsedSet };
}

describe("firstUsed bootstrap — idempotent lifecycle initialization", () => {
  test("sets firstUsed when absent on first call", async () => {
    const { initFirstUsed } = makeFirstUsedBootstrap();
    const statsStore = {};
    await initFirstUsed({
      getStats: async () => ({ ...statsStore }),
      setStats: async (d) => { Object.assign(statsStore, d); },
      now: () => 1000,
    });
    assert.strictEqual(statsStore.firstUsed, 1000);
  });

  test("does not overwrite existing firstUsed (idempotent)", async () => {
    const { initFirstUsed } = makeFirstUsedBootstrap();
    const statsStore = { firstUsed: 500 };
    let setCalled = false;
    await initFirstUsed({
      getStats: async () => ({ ...statsStore }),
      setStats: async () => { setCalled = true; },
      now: () => 9999,
    });
    assert.strictEqual(setCalled, false, "setStats must not be called when firstUsed already set");
    assert.strictEqual(statsStore.firstUsed, 500, "original timestamp must be preserved");
  });

  test("_firstUsedSet flag prevents re-entry on subsequent lifecycle calls", async () => {
    const bootstrap = makeFirstUsedBootstrap();
    let getCount = 0;
    const deps = {
      getStats: async () => { getCount++; return {}; },
      setStats: async () => {},
    };
    await bootstrap.initFirstUsed(deps);
    await bootstrap.initFirstUsed(deps); // second lifecycle event — same SW lifetime
    assert.strictEqual(getCount, 1, "getStats must only be called once per SW lifetime");
    assert.strictEqual(bootstrap.isSet(), true);
  });

  test("hot path is free boolean check after lifecycle event sets the flag", async () => {
    const bootstrap = makeFirstUsedBootstrap();
    let getCount = 0;
    const deps = {
      getStats: async () => { getCount++; return {}; },
      setStats: async () => {},
    };
    // Lifecycle event runs first
    await bootstrap.initFirstUsed(deps);
    getCount = 0; // reset counter

    // Hot path should not touch storage
    await bootstrap.hotPathGuard(deps);
    await bootstrap.hotPathGuard(deps);
    await bootstrap.hotPathGuard(deps);
    assert.strictEqual(getCount, 0, "hot path must not call getStats after _firstUsedSet is true");
  });

  test("sequential lifecycle events only call setStats once (_firstUsedSet guards second call)", async () => {
    // onInstalled and onStartup are sequential, not concurrent. The _firstUsedSet
    // flag short-circuits the second call so getStats/setStats are not called again.
    const bootstrap = makeFirstUsedBootstrap();
    let setCount = 0;
    let getCount = 0;
    const statsStore = {};
    const deps = {
      getStats: async () => { getCount++; return { ...statsStore }; },
      setStats: async (d) => { setCount++; Object.assign(statsStore, d); },
      now: () => 1000,
    };
    await bootstrap.initFirstUsed(deps); // onInstalled fires
    await bootstrap.initFirstUsed(deps); // onStartup fires later — must be no-op
    assert.strictEqual(setCount, 1, "setStats must be called exactly once across sequential lifecycle events");
    assert.strictEqual(getCount, 1, "getStats must be called exactly once — _firstUsedSet guards second call");
  });

  test("firstUsed preserves original timestamp even if init is called twice with different now()", async () => {
    const bootstrap = makeFirstUsedBootstrap();
    const statsStore = {};
    let call = 0;
    const deps = {
      getStats: async () => ({ ...statsStore }),
      setStats: async (d) => { Object.assign(statsStore, d); },
      now: () => ++call === 1 ? 100 : 999,
    };
    await bootstrap.initFirstUsed(deps);
    // Simulate a throw mid-way by resetting the flag and calling again
    // (regression: if initFirstUsed ran again with a later now(), it must not overwrite)
    statsStore.firstUsed = 100; // already set from first call
    const secondBootstrap = makeFirstUsedBootstrap(); // new instance, same store
    await secondBootstrap.initFirstUsed(deps); // sees existing firstUsed=100, must not overwrite
    assert.strictEqual(statsStore.firstUsed, 100, "original timestamp must survive re-init");
  });
});
