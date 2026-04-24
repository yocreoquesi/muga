/**
 * MUGA — Unit tests for sessionStorage ponyfill (src/lib/storage.js)
 *
 * Verifies that the in-memory fallback works correctly when
 * chrome.storage.session is unavailable (Firefox MV2 — #184).
 *
 * Run with: npm test
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Simulate Firefox MV2: chrome.storage.session is undefined
// ---------------------------------------------------------------------------
import { makeChromeMock } from "./helpers/chrome-stub.mjs";
// callback shape, no session — simulates Firefox MV2 (chrome.storage.session absent)
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: false });

// ---------------------------------------------------------------------------
// Import after mock so the module sees our chrome stub
// ---------------------------------------------------------------------------
const { sessionStorage } = await import("../../src/lib/storage.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sessionStorage ponyfill — in-memory fallback (chrome.storage.session undefined)", () => {

  test("set and get a single key", async () => {
    await sessionStorage.set({ foo: "bar" });
    const result = await sessionStorage.get("foo");
    assert.equal(result.foo, "bar");
  });

  test("get with object form returns default when key is absent", async () => {
    const result = await sessionStorage.get({ missingKey: 42 });
    assert.equal(result.missingKey, 42);
  });

  test("get with object form returns stored value over default", async () => {
    await sessionStorage.set({ counter: 7 });
    const result = await sessionStorage.get({ counter: 0 });
    assert.equal(result.counter, 7);
  });

  test("remove deletes a key", async () => {
    await sessionStorage.set({ toRemove: "yes" });
    await sessionStorage.remove("toRemove");
    const result = await sessionStorage.get({ toRemove: "default" });
    assert.equal(result.toRemove, "default");
  });

  test("remove accepts an array of keys", async () => {
    await sessionStorage.set({ a: 1, b: 2 });
    await sessionStorage.remove(["a", "b"]);
    const result = await sessionStorage.get({ a: 0, b: 0 });
    assert.equal(result.a, 0);
    assert.equal(result.b, 0);
  });

  test("set multiple keys at once", async () => {
    await sessionStorage.set({ x: 10, y: 20 });
    const result = await sessionStorage.get({ x: 0, y: 0 });
    assert.equal(result.x, 10);
    assert.equal(result.y, 20);
  });

  test("returns a Promise from get/set/remove", async () => {
    assert.ok(sessionStorage.set({ p: 1 }) instanceof Promise);
    assert.ok(sessionStorage.get("p") instanceof Promise);
    assert.ok(sessionStorage.remove("p") instanceof Promise);
  });
});
