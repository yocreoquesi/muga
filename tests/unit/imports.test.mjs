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

// ---------------------------------------------------------------------------
// Affiliate / tracking param integrity — build-time collision detection
// (issue #159)
//
// Test 9 will FAIL with current code — that is intentional. It documents a
// known bug: 'campid' and 'ref' appear in both TRACKING_PARAMS and
// AFFILIATE_PATTERNS, meaning the cleaner would strip them before the
// affiliate injector has a chance to preserve them. Zara is fixing this in a
// parallel branch. Once that fix lands, all three tests below must pass.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test 9 — No collision between TRACKING_PARAMS and affiliate params
// ---------------------------------------------------------------------------
test("No param appears in both TRACKING_PARAMS and AFFILIATE_PATTERNS (collision = bug)", async () => {
  const { TRACKING_PARAMS, AFFILIATE_PATTERNS } = await import("../../src/lib/affiliates.js");

  const trackingSet = new Set(TRACKING_PARAMS);
  const collisions = [...new Set(AFFILIATE_PATTERNS.map(e => e.param))].filter(p => trackingSet.has(p));

  assert.equal(
    collisions.length,
    0,
    `Collision detected: params ${JSON.stringify(collisions)} appear in both TRACKING_PARAMS and AFFILIATE_PATTERNS`
  );
});

// ---------------------------------------------------------------------------
// Test 12 — All TRACKING_PARAMS entries are lowercase (prevents #182 regression)
// ---------------------------------------------------------------------------
test("All entries in TRACKING_PARAMS are lowercase (mixed-case breaks cleaner.js match)", async () => {
  const { TRACKING_PARAMS } = await import("../../src/lib/affiliates.js");
  const mixedCase = TRACKING_PARAMS.filter(p => p !== p.toLowerCase());
  assert.equal(
    mixedCase.length,
    0,
    `Mixed-case TRACKING_PARAMS entries found (will never match param.toLowerCase()): ${JSON.stringify(mixedCase)}`
  );
});

// ---------------------------------------------------------------------------
// Test 10 — Every AFFILIATE_PATTERNS entry has param (non-empty string) and domains (array)
// ---------------------------------------------------------------------------
test("Every AFFILIATE_PATTERNS entry has a non-empty param and a domains array", async () => {
  const { AFFILIATE_PATTERNS } = await import("../../src/lib/affiliates.js");

  const invalid = AFFILIATE_PATTERNS.filter(
    e => typeof e.param !== "string" || e.param.trim() === "" || !Array.isArray(e.domains)
  );

  assert.equal(
    invalid.length,
    0,
    `AFFILIATE_PATTERNS entries missing param or domains: ${JSON.stringify(invalid.map(e => e.id))}`
  );
});

// ---------------------------------------------------------------------------
// Test 11 — No duplicate domain+param combinations within AFFILIATE_PATTERNS
// ---------------------------------------------------------------------------
test("No domain appears in more than one AFFILIATE_PATTERNS entry with the same param (ambiguous config)", async () => {
  const { AFFILIATE_PATTERNS } = await import("../../src/lib/affiliates.js");

  const seen = new Map(); // key: "domain:param" → first entry id
  const duplicates = [];

  for (const entry of AFFILIATE_PATTERNS) {
    for (const domain of entry.domains) {
      const key = `${domain}:${entry.param}`;
      if (seen.has(key)) {
        duplicates.push({ key, first: seen.get(key), second: entry.id });
      } else {
        seen.set(key, entry.id);
      }
    }
  }

  assert.equal(
    duplicates.length,
    0,
    `Duplicate domain+param combinations found: ${JSON.stringify(duplicates)}`
  );
});
