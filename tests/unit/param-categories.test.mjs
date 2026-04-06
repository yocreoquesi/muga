/**
 * MUGA — Param-categories integrity tests
 *
 * Validates the TRACKING_PARAM_CATEGORIES export from affiliates.js:
 *   - Shape: every category has label, labelEs, and params
 *   - Cross-reference: params in categories cover at least 80% of DNR removeParams
 *   - i18n: all new impact-dashboard keys exist in both EN and ES
 *
 * Run with: node --test tests/unit/param-categories.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── T1-2: Cross-reference with DNR tracking-params.json ──────────────────────

describe("TRACKING_PARAM_CATEGORIES — DNR cross-reference", () => {
  test("at least 80% of DNR removeParams are covered by some category", () => {
    const trackingParamsJson = JSON.parse(
      readFileSync(join(__dirname, "../../src/rules/tracking-params.json"), "utf8")
    );

    // Collect all removeParams from all DNR rules
    const dnrParams = new Set();
    for (const rule of trackingParamsJson) {
      const removeParams = rule.action?.redirect?.transform?.queryTransform?.removeParams
        ?? rule.action?.requestHeaders // guard for non-removeParams rules
        ?? [];
      if (Array.isArray(rule.action?.redirect?.transform?.queryTransform?.removeParams)) {
        for (const p of rule.action.redirect.transform.queryTransform.removeParams) {
          dnrParams.add(p.toLowerCase());
        }
      }
    }

    // Build the full set of categorised params (lowercase)
    const categorisedParams = new Set();
    for (const catData of Object.values(TRACKING_PARAM_CATEGORIES)) {
      for (const param of catData.params) {
        categorisedParams.add(param.toLowerCase());
      }
    }

    // Count coverage
    let covered = 0;
    const uncovered = [];
    for (const param of dnrParams) {
      if (categorisedParams.has(param)) {
        covered++;
      } else {
        uncovered.push(param);
      }
    }

    const total = dnrParams.size;
    const coveragePct = total > 0 ? (covered / total) * 100 : 100;

    assert.ok(
      total > 0,
      "tracking-params.json must have at least one removeParams rule"
    );
    assert.ok(
      coveragePct >= 80,
      `Coverage is ${coveragePct.toFixed(1)}% (${covered}/${total}). Uncovered: ${uncovered.join(", ")}`
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
