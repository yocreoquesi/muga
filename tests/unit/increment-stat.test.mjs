/**
 * MUGA — Unit tests for the batch-write incrementStat pattern (src/lib/storage.js)
 *
 * storage.js cannot be imported directly in Node — it calls chrome.* APIs.
 * The batch-write logic is replicated here as a standalone factory so each
 * test gets fully isolated state.
 *
 * Coverage:
 *   - Concurrent calls accumulate in the pending map and flush as one write
 *   - No increments are lost when N calls fire before the timer fires
 *   - Multiple keys are coalesced into a single flush
 *   - After a flush, pending state is cleared and a new timer can be set
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Standalone replica of the batch-write pattern from storage.js
// Returns { incrementStat, flush, getWriteCount, getLastWrite }
// ---------------------------------------------------------------------------

function makeIncrementStat(initialStats = {}) {
  let pendingStats = {};
  let flushTimer = null;
  let writeCount = 0;
  let lastWrite = null;
  // In-memory "storage"
  let storedStats = { ...initialStats };

  async function flushStats() {
    flushTimer = null;
    if (Object.keys(pendingStats).length === 0) return;
    const toFlush = pendingStats;
    pendingStats = {};

    // Single read-modify-write
    const current = { ...storedStats };
    const updated = {};
    for (const [key, delta] of Object.entries(toFlush)) {
      updated[key] = (current[key] || 0) + delta;
    }
    storedStats = { ...storedStats, ...updated };
    writeCount++;
    lastWrite = { ...updated };
  }

  function incrementStat(key, amount = 1) {
    pendingStats[key] = (pendingStats[key] || 0) + amount;
    if (!flushTimer) {
      flushTimer = setTimeout(flushStats, 100);
    }
  }

  // Manual flush for testing (bypasses timer)
  async function flush() {
    clearTimeout(flushTimer);
    await flushStats();
  }

  return {
    incrementStat,
    flush,
    getWriteCount: () => writeCount,
    getLastWrite: () => lastWrite,
    getStoredStats: () => ({ ...storedStats }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("incrementStat — batch-write pattern", () => {
  test("single call increments correctly after flush", async () => {
    const { incrementStat, flush, getStoredStats } = makeIncrementStat();
    incrementStat("urlsCleaned");
    await flush();
    assert.equal(getStoredStats().urlsCleaned, 1);
  });

  test("N concurrent calls are coalesced into one write — no count loss", async () => {
    const N = 50;
    const { incrementStat, flush, getWriteCount, getStoredStats } = makeIncrementStat();

    // Simulate N concurrent increments before the timer fires
    for (let i = 0; i < N; i++) {
      incrementStat("urlsCleaned");
    }
    await flush();

    assert.equal(getStoredStats().urlsCleaned, N, `expected ${N} but got ${getStoredStats().urlsCleaned}`);
    assert.equal(getWriteCount(), 1, "all increments must be coalesced into a single storage write");
  });

  test("concurrent increments on multiple keys are all preserved", async () => {
    const { incrementStat, flush, getStoredStats } = makeIncrementStat();

    incrementStat("urlsCleaned", 3);
    incrementStat("junkRemoved", 10);
    incrementStat("referralsSpotted", 2);
    incrementStat("urlsCleaned", 2); // additional increment on same key

    await flush();

    assert.equal(getStoredStats().urlsCleaned, 5);
    assert.equal(getStoredStats().junkRemoved, 10);
    assert.equal(getStoredStats().referralsSpotted, 2);
  });

  test("flush on top of existing stored values accumulates correctly", async () => {
    const { incrementStat, flush, getStoredStats } = makeIncrementStat({ urlsCleaned: 100 });
    incrementStat("urlsCleaned", 5);
    await flush();
    assert.equal(getStoredStats().urlsCleaned, 105);
  });

  test("after flush, pending state is cleared — second flush is a no-op", async () => {
    const { incrementStat, flush, getWriteCount } = makeIncrementStat();
    incrementStat("urlsCleaned");
    await flush();
    await flush(); // second flush — nothing pending
    assert.equal(getWriteCount(), 1, "second flush must not produce a write");
  });

  test("amount parameter is respected", async () => {
    const { incrementStat, flush, getStoredStats } = makeIncrementStat();
    incrementStat("junkRemoved", 7);
    await flush();
    assert.equal(getStoredStats().junkRemoved, 7);
  });
});
