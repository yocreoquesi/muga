/**
 * MUGA — Unit tests for src/background/session-log.js (#1266 item 5, slice 5)
 *
 * `appendSessionLog`/`logAction` and the `console.error`/`console.warn`
 * overrides used to live in service-worker.js, which cannot be imported in
 * Node because it makes `chrome.*` calls at module scope. The ring buffer
 * bound and the object-vs-string serialization `logAction` claims to do were
 * only ever reachable through `swSource`-style source-text assertions
 * (`service-worker-patterns.test.mjs`'s "Security: debug log payload
 * privacy" block, which still covers the payload SHAPE `logAction` builds
 * for specific call sites and is unaffected by this move). This file proves
 * the ring buffer and the console overrides actually run, not just that a
 * call site's text is present:
 *
 *   - SESSION_LOG_MAX (2000) actually bounds the stored log, dropping the
 *     oldest entries rather than growing without limit;
 *   - logAction serializes an object detail (JSON.stringify) and passes a
 *     string detail through unchanged;
 *   - the import-once guard: a second import of this module (simulated via
 *     a cache-busted re-import, the same technique a test harness that
 *     resets its module cache between files — the risk the module's
 *     docblock names — would trigger) does not replace the installed
 *     console.error/console.warn wrapper, and a single console.error() call
 *     still produces exactly one debug-log entry, not two.
 *
 * `sessionStorage` (src/lib/storage.js) already falls back to an in-memory
 * Map when `chrome.storage.session` is unavailable, which is the case in
 * this Node test run — no chrome stub is needed for appendSessionLog/
 * logAction themselves.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appendSessionLog, logAction } from "../../src/background/session-log.js";
import { sessionStorage } from "../../src/lib/storage.js";

/** Waits long enough for appendSessionLog's get().then(set()) chain to settle. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readDebugLog() {
  const { debugLog } = await sessionStorage.get({ debugLog: [] });
  return debugLog;
}

beforeEach(async () => {
  await sessionStorage.set({ debugLog: [] });
});

describe("appendSessionLog — ring buffer bound (SESSION_LOG_MAX = 2000)", () => {
  test("stays within the cap and newest entries survive", async () => {
    // Pre-seed 2000 entries directly rather than making 2000 real async
    // appends — the bound is enforced by the slice(0, SESSION_LOG_MAX) in
    // appendSessionLog itself, so seeding the precondition is enough to
    // prove the NEXT append respects it.
    const seeded = Array.from({ length: 2000 }, (_, i) => ({ ts: i, level: "action", msg: `seed-${i}` }));
    await sessionStorage.set({ debugLog: seeded });

    appendSessionLog("action", ["one-more"]);
    await flush();
    await flush();

    const log = await readDebugLog();
    assert.strictEqual(log.length, 2000, "the log must not grow past SESSION_LOG_MAX");
    assert.ok(log[0].msg.includes("one-more"), "the newest entry is unshifted to the front");
    assert.strictEqual(
      log[log.length - 1].msg,
      "seed-1998",
      "the oldest seeded entry (seed-1999, now 2001st) is dropped to make room",
    );
  });

  test("an empty log accepts a first entry without special-casing", async () => {
    appendSessionLog("error", ["boom"]);
    await flush();
    await flush();
    const log = await readDebugLog();
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].level, "error");
    assert.ok(log[0].msg.includes("boom"));
  });
});

describe("logAction — object vs string detail serialization", () => {
  test("an object detail is JSON.stringify'd into the log message", async () => {
    logAction("whitelist_add", { entry: "example.com" });
    await flush();
    await flush();
    const log = await readDebugLog();
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].level, "action");
    assert.ok(log[0].msg.includes("[whitelist_add]"));
    assert.ok(log[0].msg.includes(JSON.stringify({ entry: "example.com" })));
  });

  test("a string detail is passed through unchanged (not double-encoded)", async () => {
    logAction("plain_action", "just a string");
    await flush();
    await flush();
    const log = await readDebugLog();
    assert.strictEqual(log.length, 1);
    assert.ok(log[0].msg.includes("[plain_action]"));
    assert.ok(log[0].msg.includes("just a string"));
    assert.ok(!log[0].msg.includes('"just a string"'), "a string detail must not be JSON-quoted");
  });
});

describe("console.error/console.warn overrides — import-once guard", () => {
  test("a second import does not replace the installed override", async () => {
    const wrapAfterFirstImport = console.error;
    // Re-import via a cache-busted specifier — a fresh module evaluation,
    // the scenario the docblock's guard exists for.
    await import(`../../src/background/session-log.js?cb=${Math.random()}`);
    assert.strictEqual(
      console.error,
      wrapAfterFirstImport,
      "a second module evaluation must not install a new wrapper over the existing one",
    );
  });

  test("console.error still logs exactly once per call after a second import", async () => {
    await import(`../../src/background/session-log.js?cb=${Math.random()}`);
    console.error("[test] single-wrap-check", { x: 1 });
    await flush();
    await flush();
    const log = await readDebugLog();
    const matches = log.filter((e) => e.msg.includes("single-wrap-check"));
    assert.strictEqual(matches.length, 1, "double-wrapping would log this call twice");
  });

  test("console.warn still logs exactly once per call after a second import", async () => {
    await import(`../../src/background/session-log.js?cb=${Math.random()}`);
    console.warn("[test] single-wrap-check-warn");
    await flush();
    await flush();
    const log = await readDebugLog();
    const matches = log.filter((e) => e.msg.includes("single-wrap-check-warn"));
    assert.strictEqual(matches.length, 1, "double-wrapping would log this call twice");
  });
});
