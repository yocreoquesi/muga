/**
 * MUGA — Param-categories integrity tests
 *
 * Validates the TRACKING_PARAM_CATEGORIES export from affiliates.js:
 *   - Shape: every category has label, labelEs, and params
 *   - Cross-reference: 100% of TRACKING_PARAMS source entries are covered by some category
 *   - i18n: all new impact-dashboard keys exist in both EN and ES
 *
 * Run with: node --test tests/unit/param-categories.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TRACKING_PARAM_CATEGORIES, TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

// ── T1-1: Category shape ─────────────────────────────────────────────────────

describe("TRACKING_PARAM_CATEGORIES — shape validation", () => {
  test("is a non-empty object", () => {
    assert.ok(
      typeof TRACKING_PARAM_CATEGORIES === "object" && TRACKING_PARAM_CATEGORIES !== null,
      "TRACKING_PARAM_CATEGORIES must be an object"
    );
    assert.ok(
      Object.keys(TRACKING_PARAM_CATEGORIES).length > 0,
      "TRACKING_PARAM_CATEGORIES must have at least one category"
    );
  });

  test("every category has label, labelEs, and params", () => {
    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      assert.ok(
        typeof catData.label === "string" && catData.label.length > 0,
        `Category "${catKey}" must have a non-empty string label`
      );
      assert.ok(
        typeof catData.labelEs === "string" && catData.labelEs.length > 0,
        `Category "${catKey}" must have a non-empty string labelEs`
      );
      assert.ok(
        Array.isArray(catData.params) && catData.params.length > 0,
        `Category "${catKey}" must have a non-empty params array`
      );
    }
  });

  test("all labels are strings of at most 80 chars", () => {
    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      assert.ok(
        catData.label.length <= 80,
        `Category "${catKey}" label is too long (${catData.label.length} chars): "${catData.label}"`
      );
      assert.ok(
        catData.labelEs.length <= 80,
        `Category "${catKey}" labelEs is too long (${catData.labelEs.length} chars): "${catData.labelEs}"`
      );
    }
  });

  test("params arrays contain only strings", () => {
    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      for (const param of catData.params) {
        assert.ok(
          typeof param === "string",
          `Category "${catKey}" has non-string param: ${JSON.stringify(param)}`
        );
      }
    }
  });
});

// ── T1-2: 100% coverage of TRACKING_PARAMS source ───────────────────────────

describe("TRACKING_PARAM_CATEGORIES — 100% source coverage", () => {
  test("100% of TRACKING_PARAMS are covered by some category", () => {
    // Build the full set of categorised params (lowercase) from the SOURCE,
    // not from the downstream DNR artifact. This is the stricter, correct anchor.
    const categorised = new Set();
    for (const catData of Object.values(TRACKING_PARAM_CATEGORIES)) {
      for (const p of catData.params) {
        categorised.add(p.toLowerCase());
      }
    }

    const uncovered = TRACKING_PARAMS.filter(p => !categorised.has(p.toLowerCase()));
    assert.equal(
      uncovered.length,
      0,
      `Uncategorized params (${uncovered.length}): ${uncovered.join(", ")}`
    );
  });
});

// ── T1-3: No param appears in more than one category ────────────────────────

describe("TRACKING_PARAM_CATEGORIES — no cross-category duplicates", () => {
  test("no param appears in more than one category's params array", () => {
    // Each param must belong to exactly one category. If a param is listed in
    // multiple categories the generator resolves it via priority order at build
    // time, but the source data itself should remain unambiguous. A duplicate
    // here means affiliates.js was edited without noticing the conflict.
    const seenInCategory = {};
    const duplicates = [];

    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      for (const param of catData.params) {
        const key = param.toLowerCase();
        if (seenInCategory[key] !== undefined) {
          duplicates.push(`"${param}" in both "${seenInCategory[key]}" and "${catKey}"`);
        } else {
          seenInCategory[key] = catKey;
        }
      }
    }

    assert.equal(
      duplicates.length,
      0,
      `Params appearing in multiple categories (${duplicates.length}):\n  ${duplicates.join("\n  ")}`
    );
  });
});

// ── T1-5: i18n keys ──────────────────────────────────────────────────────────

describe("i18n — impact-dashboard param breakdown keys", () => {
  const REQUIRED_KEYS = [
    "param_breakdown_label",
    "param_category_analytics",
    "param_category_social",
    "param_category_advertising",
    "param_category_email",
    "param_category_affiliate",
    "param_category_marketplace",
    "param_category_other",
    "param_category_ecommerce",
  ];

  for (const key of REQUIRED_KEYS) {
    test(`TRANSLATIONS has "${key}" with both en and es`, () => {
      const entry = TRANSLATIONS[key];
      assert.ok(
        entry !== undefined,
        `TRANSLATIONS is missing key "${key}"`
      );
      assert.ok(
        typeof entry.en === "string" && entry.en.length > 0,
        `TRANSLATIONS["${key}"].en must be a non-empty string`
      );
      assert.ok(
        typeof entry.es === "string" && entry.es.length > 0,
        `TRANSLATIONS["${key}"].es must be a non-empty string`
      );
    });
  }
});
