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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/storage.js"),
  "utf8"
);

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

// ---------------------------------------------------------------------------
// C11 — Sync verification: replicated incrementStat pattern matches the real source
// storage.js uses chrome.* APIs at the top level (onSuspend listener), so we
// cannot import it without a chrome mock. Instead we verify key patterns.
// ---------------------------------------------------------------------------
describe("C11 — replica sync verification (storage.js incrementStat)", () => {

  test("source exports incrementStat function", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export function incrementStat("),
      "Source must export incrementStat function"
    );
  });

  test("source uses pending stats accumulation pattern (key, amount = 1)", () => {
    assert.ok(
      STORAGE_SOURCE.includes("_pendingStats[key] = (_pendingStats[key] || 0) + amount"),
      "Source must accumulate pending stats with (key || 0) + amount pattern"
    );
  });

  test("source flushStats reads then writes all pending stats in one pass", () => {
    assert.ok(
      STORAGE_SOURCE.includes("const toFlush = _pendingStats;"),
      "Source must capture pending stats into toFlush variable"
    );
    assert.ok(
      STORAGE_SOURCE.includes("_pendingStats = {};"),
      "Source must clear pending stats after capture"
    );
  });

  test("source uses short setTimeout for MV3-safe flush scheduling", () => {
    // Changed from microtask to setTimeout(50ms) for MV3 reliability:
    // MV3 service workers can be killed mid-microtask, losing unflushed stats.
    // A short setTimeout gives the engine time to finish the current task.
    assert.ok(
      STORAGE_SOURCE.includes("setTimeout(_flushStats"),
      "Source must use setTimeout for MV3-safe flush scheduling"
    );
  });
});
