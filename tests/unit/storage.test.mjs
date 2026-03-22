/**
 * MUGA — Unit tests for src/lib/storage.js
 *
 * Run with: npm test
 *
 * Coverage:
 *   - PREF_DEFAULTS shape and default values
 *   - devMode default (sprint feature)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PREF_DEFAULTS } from "../../src/lib/storage.js";

// ---------------------------------------------------------------------------
// PREF_DEFAULTS shape
// ---------------------------------------------------------------------------
describe("PREF_DEFAULTS — shape and default values", () => {
  test("devMode defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.devMode, false);
  });

  test("enabled defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.enabled, true);
  });

  test("injectOwnAffiliate defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.injectOwnAffiliate, false);
  });

  test("notifyForeignAffiliate defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.notifyForeignAffiliate, false);
  });

  test("blacklist defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.blacklist, []);
  });

  test("whitelist defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.whitelist, []);
  });

  test("customParams defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.customParams, []);
  });

  test("devMode is a boolean (not undefined or null)", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.devMode, "boolean");
  });
});
