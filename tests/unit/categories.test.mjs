/**
 * MUGA — Unit tests for TRACKING_PARAM_CATEGORIES
 *
 * Coverage:
 *   - Every param in TRACKING_PARAMS appears in exactly one category
 *   - No param appears in more than one category
 *   - Disabling 'utm' category does not strip utm_source
 *   - Disabling 'ads' category does not strip fbclid
 *   - Enabling all categories (default) strips everything normally
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TRACKING_PARAMS, TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";
import { processUrl } from "../../src/lib/cleaner.js";

const DEFAULT_PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
  customParams: [],
  disabledCategories: [],
};

describe("TRACKING_PARAM_CATEGORIES integrity", () => {
  test("every param in TRACKING_PARAMS appears in exactly one category", () => {
    const allCategoryParams = new Map(); // param -> [categoryKeys]
    for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      for (const p of cat.params) {
        const lower = p.toLowerCase();
        if (!allCategoryParams.has(lower)) allCategoryParams.set(lower, []);
        allCategoryParams.get(lower).push(key);
      }
    }

    const missing = [];
    const duplicates = [];

    for (const param of TRACKING_PARAMS) {
      const lower = param.toLowerCase();
      const cats = allCategoryParams.get(lower);
      if (!cats) {
        missing.push(param);
      } else if (cats.length > 1) {
        duplicates.push({ param, categories: cats });
      }
    }

    assert.deepEqual(missing, [], `Params missing from any category: ${missing.join(", ")}`);
    assert.deepEqual(duplicates, [], `Params in more than one category: ${JSON.stringify(duplicates)}`);
  });

  test("no param appears in more than one category", () => {
    const seen = new Map();
    for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      for (const p of cat.params) {
        const lower = p.toLowerCase();
        if (seen.has(lower)) {
          assert.fail(`Param "${lower}" appears in both "${seen.get(lower)}" and "${key}"`);
        }
        seen.set(lower, key);
      }
    }
  });
});

describe("processUrl — disabledCategories", () => {
  test("disabling 'utm' category does not strip utm_source", () => {
    const url = "https://example.com/page?utm_source=google&other=value";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["utm"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), "google", "utm_source should be preserved when utm category is disabled");
  });

  test("disabling 'ads' category does not strip fbclid", () => {
    const url = "https://example.com/page?fbclid=abc123&other=value";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["ads"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("fbclid"), "abc123", "fbclid should be preserved when ads category is disabled");
  });

  test("disabling 'utm' does not affect non-utm params being stripped", () => {
    const url = "https://example.com/page?utm_source=google&fbclid=abc";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["utm"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), "google", "utm_source preserved");
    assert.equal(out.searchParams.get("fbclid"), null, "fbclid still stripped");
  });

  test("enabling all categories (default empty disabledCategories) strips utm_source", () => {
    const url = "https://example.com/page?utm_source=google&utm_medium=cpc";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: [] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), null, "utm_source should be stripped with default prefs");
    assert.equal(out.searchParams.get("utm_medium"), null, "utm_medium should be stripped with default prefs");
  });

  test("enabling all categories (default) strips fbclid", () => {
    const url = "https://example.com/page?fbclid=xyz789";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: [] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("fbclid"), null, "fbclid should be stripped with default prefs");
  });

  test("disabling multiple categories preserves all their params", () => {
    const url = "https://example.com/?utm_source=g&fbclid=x&igshid=y&mc_cid=z";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["utm", "ads", "social", "email"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), "g", "utm_source preserved");
    assert.equal(out.searchParams.get("fbclid"), "x", "fbclid preserved");
    assert.equal(out.searchParams.get("igshid"), "y", "igshid preserved");
    assert.equal(out.searchParams.get("mc_cid"), "z", "mc_cid preserved");
  });
});

// ---------------------------------------------------------------------------
// #196 — disabledCategories in processUrl (Sebastian review coverage gaps)
// ---------------------------------------------------------------------------
describe("disabledCategories in processUrl (#196)", () => {

  test("disabledCategories: ['utm'] — utm_source is NOT stripped", () => {
    const url = "https://example.com/?utm_source=newsletter";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["utm"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), "newsletter", "utm_source must not be removed when utm category is disabled");
  });

  test("disabledCategories: ['ads'] — fbclid is NOT stripped", () => {
    const url = "https://example.com/?fbclid=IwAR0abc";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["ads"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("fbclid"), "IwAR0abc", "fbclid must not be removed when ads category is disabled");
  });

  test("disabledCategories: ['utm', 'ads'] — neither utm_source nor fbclid are stripped", () => {
    const url = "https://example.com/?utm_source=email&fbclid=IwAR0abc";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: ["utm", "ads"] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), "email", "utm_source must not be removed");
    assert.equal(out.searchParams.get("fbclid"), "IwAR0abc", "fbclid must not be removed");
  });

  test("disabledCategories: [] (default) — both utm_source and fbclid ARE stripped", () => {
    const url = "https://example.com/?utm_source=email&fbclid=IwAR0abc";
    const prefs = { ...DEFAULT_PREFS, disabledCategories: [] };
    const result = processUrl(url, prefs);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), null, "utm_source must be stripped with empty disabledCategories");
    assert.equal(out.searchParams.get("fbclid"), null, "fbclid must be stripped with empty disabledCategories");
  });

  test("disabledCategories: undefined — behaves the same as [] (both stripped)", () => {
    const url = "https://example.com/?utm_source=email&fbclid=IwAR0abc";
    // Omit disabledCategories entirely — processUrl should default to [] behaviour
    const { disabledCategories: _removed, ...prefsWithoutCategories } = DEFAULT_PREFS;
    const result = processUrl(url, prefsWithoutCategories);
    const out = new URL(result.cleanUrl);
    assert.equal(out.searchParams.get("utm_source"), null, "utm_source must be stripped when disabledCategories is undefined");
    assert.equal(out.searchParams.get("fbclid"), null, "fbclid must be stripped when disabledCategories is undefined");
  });

});
