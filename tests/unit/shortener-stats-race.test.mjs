/**
 * MUGA — Regression tests for the incrementShortenerStat race condition (#817)
 *
 * Covers the lost-update bug where two concurrent RESOLVE_SHORTENER handlers
 * both called the old read-modify-write implementation before either write
 * completed, causing one increment to be silently dropped.
 *
 * The fix converts incrementShortenerStat to the same pending+flush batching
 * pattern used by incrementStat and incrementDomainStat, eliminating the race.
 *
 * Test approach:
 *   - Uses the chrome.storage.local stub from shortener-stats.test.mjs.
 *   - Calls flushShortenerStats (test hook exported by storage.js) to force
 *     immediate flush without waiting for the 50ms timer.
 *   - All three new tests MUST fail against the old implementation
 *     (concurrent calls race → one count is lost).
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Minimal chrome.storage.local stub ────────────────────────────────────────

let _localStore = {};
let _writeCount = 0; // counts chrome.storage.local.set calls

const chromeMock = {
  storage: {
    local: {
      get(defaults, cb) {
        const result = {};
        for (const [k, defaultVal] of Object.entries(
          typeof defaults === "string" ? { [defaults]: undefined } : defaults
        )) {
          result[k] = _localStore[k] !== undefined ? _localStore[k] : defaultVal;
        }
        cb(result);
      },
      set(items, cb) {
        _writeCount++;
        Object.assign(_localStore, items);
        cb && cb();
      },
    },
  },
  runtime: { lastError: null },
};

// Install mock BEFORE first import (storage.js reads `chrome` at module level)
global.chrome = chromeMock;

const storageModule = await import("../../src/lib/storage.js");
const { getShortenerStats, incrementShortenerStat, flushShortenerStats } = storageModule;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  _localStore = {};
  _writeCount = 0;
}

// ── Race-condition regression tests ──────────────────────────────────────────

describe("incrementShortenerStat — race condition (#817)", () => {
  beforeEach(resetStore);

  test("two concurrent increments for the same host both land after flush — lost-update repro", async () => {
    // Both calls fire synchronously (before either flush runs).
    // Old implementation: both awaited getShortenerStats() before either write
    // completed → second write overwrote first → only one increment persisted.
    // New implementation: both accumulate into _pendingShortenerStats synchronously
    // → a single flush reads once, applies both deltas, writes once → both counted.
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("bit.ly", "pass");

    await flushShortenerStats();

    const stats = await getShortenerStats();
    assert.equal(
      stats["bit.ly"]?.pass,
      2,
      "both concurrent pass increments must survive — old read-modify-write dropped one"
    );
  });

  test("increments for different hosts coalesce into one storage write per flush", async () => {
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("tinyurl.com", "fail");
    incrementShortenerStat("t.co", "pass");

    const writesBeforeFlush = _writeCount;
    await flushShortenerStats();
    const writesAfterFlush = _writeCount;

    const stats = await getShortenerStats();
    assert.equal(stats["bit.ly"]?.pass, 1, "bit.ly pass must be 1");
    assert.equal(stats["tinyurl.com"]?.fail, 1, "tinyurl.com fail must be 1");
    assert.equal(stats["t.co"]?.pass, 1, "t.co pass must be 1");

    assert.equal(
      writesAfterFlush - writesBeforeFlush,
      1,
      "all three host increments must coalesce into exactly one chrome.storage.local.set call"
    );
  });

  test("pass and fail outcomes accumulate correctly across concurrent calls", async () => {
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("bit.ly", "fail");
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("t.co", "fail");
    incrementShortenerStat("t.co", "fail");

    await flushShortenerStats();

    const stats = await getShortenerStats();
    assert.equal(stats["bit.ly"]?.pass, 2, "bit.ly pass must accumulate to 2");
    assert.equal(stats["bit.ly"]?.fail, 1, "bit.ly fail must accumulate to 1");
    assert.equal(stats["t.co"]?.pass, 0, "t.co pass must be 0");
    assert.equal(stats["t.co"]?.fail, 2, "t.co fail must accumulate to 2");
  });
});

// ── Caller-contract guard ─────────────────────────────────────────────────────
//
// incrementShortenerStat / incrementStat / incrementDomainStat are SYNCHRONOUS
// accumulate-and-flush counters (return undefined). Chaining `.catch(...)` on
// any of them throws TypeError at runtime — and the service worker has no
// behavioral unit harness, so only this structural guard catches it. Found the
// hard way in #817 review: `incrementShortenerStat(...).catch(() => {})`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

describe("sync counters — no promise chaining in service-worker callers", () => {
  const swSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/background/service-worker.js"),
    "utf8"
  );

  for (const fn of ["incrementShortenerStat", "incrementStat", "incrementDomainStat"]) {
    test(`${fn}(...) is never chained with .then/.catch/await`, () => {
      const re = new RegExp(
        "(?:await\\s+" + fn + "\\s*\\(|" + fn + "\\s*\\([^;]*\\)\\s*\\.(?:then|catch)\\b)"
      );
      const match = swSource.match(re);
      assert.equal(
        match,
        null,
        `${fn} is synchronous (returns undefined) — found promise-style usage: ${match?.[0] ?? ""}`
      );
    });
  }
});
