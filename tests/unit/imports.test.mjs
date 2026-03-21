/**
 * MUGA — Integration tests for UI-layer ES module imports
 *
 * Verifies that named exports from src/lib/ resolve correctly at the Node.js
 * level, catching typos like the PREF_PREF_DEFAULTS regression.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Chrome mock — storage.js uses chrome.storage.* inside function bodies.
// The mock must exist before the module is imported so Node.js does not throw
// a ReferenceError if the engine evaluates any top-level expressions.
// ---------------------------------------------------------------------------
globalThis.chrome = {
  storage: {
    sync: {
      get: (defaults, cb) => cb && cb({}),
      set: (_data, cb) => cb && cb(),
      remove: (_keys, cb) => cb && cb(),
    },
    local: {
      get: (defaults, cb) => cb && cb({}),
      set: (_data, cb) => cb && cb(),
    },
  },
};

// ---------------------------------------------------------------------------
// Test 1 — PREF_DEFAULTS is exported from storage.js and is an object
// ---------------------------------------------------------------------------
test("PREF_DEFAULTS is exported from storage.js and is an object with key 'enabled'", async () => {
  const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
  assert.notEqual(PREF_DEFAULTS, undefined, "PREF_DEFAULTS must not be undefined");
  assert.equal(typeof PREF_DEFAULTS, "object", "PREF_DEFAULTS must be an object");
  assert.ok("enabled" in PREF_DEFAULTS, "PREF_DEFAULTS must have key 'enabled'");
});

// ---------------------------------------------------------------------------
// Test 2 — getPrefs is exported from storage.js and is a function
// ---------------------------------------------------------------------------
test("getPrefs is exported from storage.js and is a function", async () => {
  const { getPrefs } = await import("../../src/lib/storage.js");
  assert.equal(typeof getPrefs, "function", "getPrefs must be a function");
});

// ---------------------------------------------------------------------------
// Test 3 — getSupportedStores is exported from affiliates.js and returns an array
// ---------------------------------------------------------------------------
test("getSupportedStores is exported from affiliates.js and returns an array", async () => {
  const { getSupportedStores } = await import("../../src/lib/affiliates.js");
  assert.equal(typeof getSupportedStores, "function", "getSupportedStores must be a function");
  assert.ok(Array.isArray(getSupportedStores()), "getSupportedStores() must return an array");
});

// ---------------------------------------------------------------------------
// Test 4 — processUrl is exported from lib/cleaner.js and is a function
// ---------------------------------------------------------------------------
test("processUrl is exported from lib/cleaner.js and is a function", async () => {
  const { processUrl } = await import("../../src/lib/cleaner.js");
  assert.equal(typeof processUrl, "function", "processUrl must be a function");
});

// ---------------------------------------------------------------------------
// Test 5 — PREF_DEFAULTS contains all v1.3 pref keys with correct defaults
// ---------------------------------------------------------------------------
test("PREF_DEFAULTS contains dnrEnabled: true (v1.3 pre-navigation DNR)", async () => {
  const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
  assert.equal(PREF_DEFAULTS.dnrEnabled, true);
});

test("PREF_DEFAULTS contains blockPings: true (v1.3 ping beacon blocking)", async () => {
  const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
  assert.equal(PREF_DEFAULTS.blockPings, true);
});

test("PREF_DEFAULTS contains ampRedirect: true (v1.3 AMP redirect)", async () => {
  const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
  assert.equal(PREF_DEFAULTS.ampRedirect, true);
});

test("PREF_DEFAULTS contains unwrapRedirects: true (v1.3 redirect unwrapping)", async () => {
  const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
  assert.equal(PREF_DEFAULTS.unwrapRedirects, true);
});
