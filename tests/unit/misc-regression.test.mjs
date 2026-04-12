/**
 * MUGA — Miscellaneous Regression Tests
 *
 * Smaller regression/smoke checks that don't fit a dedicated area:
 * storage flush behavior and TRACKING_PARAM_CATEGORIES shape.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";

describe("Regression: storage.js uses setTimeout for MV3-safe flush", () => {
  const _dir = dirname(fileURLToPath(import.meta.url));
  const storageSource = readFileSync(join(_dir, "../../src/lib/storage.js"), "utf8");
  test("flushStats uses setTimeout, not microtask", () => {
    assert.ok(storageSource.includes("setTimeout(_flushStats"), "Must use setTimeout for flush");
    assert.ok(!storageSource.includes("Promise.resolve().then(_flushStats"), "Must not use microtask flush");
  });
});

// ---------------------------------------------------------------------------
// TRACKING_PARAM_CATEGORIES smoke test (Task 3.2)
// ---------------------------------------------------------------------------
describe("TRACKING_PARAM_CATEGORIES — smoke test", () => {
  test("is a non-empty object and every category has a non-empty params array", () => {
    assert.ok(
      typeof TRACKING_PARAM_CATEGORIES === "object" && TRACKING_PARAM_CATEGORIES !== null,
      "TRACKING_PARAM_CATEGORIES must be an object"
    );
    assert.ok(
      Object.keys(TRACKING_PARAM_CATEGORIES).length > 0,
      "TRACKING_PARAM_CATEGORIES must have at least one category"
    );
    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      assert.ok(
        Array.isArray(catData.params) && catData.params.length > 0,
        `Category "${catKey}" must have a non-empty params array`
      );
    }
  });
});
