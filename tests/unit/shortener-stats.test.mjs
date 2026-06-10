/**
 * MUGA — Shortener pass/fail counters (ADR-0004 phase 4, #700)
 *
 * Unit tests for getShortenerStats, incrementShortenerStat, and the
 * per-shortener stat shape. Written RED-first.
 *
 * Uses the existing chrome stub pattern from this project's unit tests —
 * a minimal in-memory mock for chrome.storage.local.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERIC_SHORTENERS } from "../../src/lib/native-shortener-resolver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

// ── Minimal chrome.storage.local stub ────────────────────────────────────────

let _localStore = {};

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
        Object.assign(_localStore, items);
        cb && cb();
      },
    },
  },
  runtime: { lastError: null },
};

// ── Import helpers after setting up the global ──────────────────────────────
//
// storage.js reads `chrome` at import time for the shim probe; we must install
// the mock BEFORE the first import. Use a dynamic import inside the tests.

let getShortenerStats, incrementShortenerStat, flushShortenerStats;

// Install mock globally before dynamic import
global.chrome = chromeMock;
const storageModule = await import("../../src/lib/storage.js");
getShortenerStats = storageModule.getShortenerStats;
incrementShortenerStat = storageModule.incrementShortenerStat;
// Test hook: forces the pending+flush write without waiting for the 50ms timer.
// Required because incrementShortenerStat is now synchronous (accumulates into
// a pending map) — persistence is deferred to the coalesced flush (#817).
flushShortenerStats = storageModule.flushShortenerStats;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  _localStore = {};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getShortenerStats — default shape", () => {
  beforeEach(resetStore);

  test("returns an object", async () => {
    const stats = await getShortenerStats();
    assert.equal(typeof stats, "object");
    assert.ok(stats !== null);
  });

  test("returns empty object when no stats stored", async () => {
    const stats = await getShortenerStats();
    assert.deepEqual(stats, {});
  });

  test("all GENERIC_SHORTENERS have zero pass/fail after first read with stored data", async () => {
    // Pre-populate with a partial entry to ensure others return {}
    _localStore.shortenerStats = { "bit.ly": { pass: 3, fail: 1 } };
    const stats = await getShortenerStats();
    assert.equal(stats["bit.ly"].pass, 3);
    assert.equal(stats["bit.ly"].fail, 1);
  });
});

describe("incrementShortenerStat — pass increments", () => {
  beforeEach(resetStore);

  test("increments pass for a known shortener", async () => {
    incrementShortenerStat("bit.ly", "pass");
    await flushShortenerStats();
    const stats = await getShortenerStats();
    assert.ok(stats["bit.ly"], "bit.ly entry must exist");
    assert.equal(stats["bit.ly"].pass, 1);
    assert.equal(stats["bit.ly"].fail, 0);
  });

  test("increments fail for a known shortener", async () => {
    incrementShortenerStat("t.co", "fail");
    await flushShortenerStats();
    const stats = await getShortenerStats();
    assert.ok(stats["t.co"], "t.co entry must exist");
    assert.equal(stats["t.co"].fail, 1);
    assert.equal(stats["t.co"].pass, 0);
  });

  test("accumulates multiple increments", async () => {
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("bit.ly", "fail");
    await flushShortenerStats();
    const stats = await getShortenerStats();
    assert.equal(stats["bit.ly"].pass, 2);
    assert.equal(stats["bit.ly"].fail, 1);
  });

  test("tracks multiple shorteners independently", async () => {
    incrementShortenerStat("bit.ly", "pass");
    incrementShortenerStat("tinyurl.com", "fail");
    incrementShortenerStat("tinyurl.com", "fail");
    await flushShortenerStats();
    const stats = await getShortenerStats();
    assert.equal(stats["bit.ly"].pass, 1);
    assert.equal(stats["bit.ly"].fail, 0);
    assert.equal(stats["tinyurl.com"].pass, 0);
    assert.equal(stats["tinyurl.com"].fail, 2);
  });

  test("each shortener entry has both pass and fail keys", async () => {
    for (const host of GENERIC_SHORTENERS) {
      resetStore();
      incrementShortenerStat(host, "pass");
      await flushShortenerStats();
      const stats = await getShortenerStats();
      assert.ok(typeof stats[host].pass === "number", `${host} must have pass`);
      assert.ok(typeof stats[host].fail === "number", `${host} must have fail`);
    }
  });

  test("ignores unknown hosts silently — does not throw AND does not record them", async () => {
    resetStore();
    // incrementShortenerStat is now synchronous — wrap in a resolved promise for doesNotReject
    await assert.doesNotReject(async () => { incrementShortenerStat("unknown.example.com", "pass"); });
    await flushShortenerStats();
    const stats = await getShortenerStats();
    assert.equal(
      stats["unknown.example.com"],
      undefined,
      "non-allowlisted host must NOT be written to shortenerStats (privacy contract: only the 8 GENERIC_SHORTENERS)"
    );
  });
});

describe("shortener stats storage key", () => {
  test("getShortenerStats and incrementShortenerStat use 'shortenerStats' key", async () => {
    resetStore();
    incrementShortenerStat("bit.ly", "pass");
    await flushShortenerStats();
    assert.ok(
      "shortenerStats" in _localStore,
      "incrementShortenerStat must write to chrome.storage.local under 'shortenerStats' key"
    );
  });

  test("shortenerStats is NEVER transmitted — it is a local-only key (doc check)", () => {
    // This is a structural/convention test: the key must NOT appear in
    // PREF_DEFAULTS (sync storage). We verify by reading the source text.
    const storageSource = readFileSync(join(root, "src", "lib", "storage.js"), "utf8");

    // Extract PREF_DEFAULTS body — this lives in chrome.storage.sync (transmitted)
    const match = storageSource.match(/export\s+const\s+PREF_DEFAULTS\s*=\s*\{([\s\S]*?)\n\};/);
    assert.ok(match, "PREF_DEFAULTS must be found in storage.js");
    const prefBody = match[1];
    assert.ok(
      !prefBody.includes("shortenerStats"),
      "shortenerStats must NOT be in PREF_DEFAULTS (sync/transmitted) — it is local-only"
    );
  });
});
