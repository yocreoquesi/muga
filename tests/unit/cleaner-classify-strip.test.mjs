/**
 * MUGA — TS-2/TS-3: Unit tests for classifyAndStripTracking.
 *
 * RED phase: imports __test__.classifyAndStripTracking which does not exist yet.
 * Must FAIL until the function is extracted and exported (issue #627).
 *
 * Covers:
 *   TS-2 — AliExpress item-page strip-all with domainRules preserveParams
 *   TS-3 — standard path: utm_source removed, affiliate param protected
 *   FR-4 — domainRules[].preserveParams entries survive intact
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { __test__ } from "../../src/lib/cleaner.js";

const { classifyAndStripTracking } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// ── Minimal prefs
const BASE_PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

describe("TS-2 — classifyAndStripTracking — AliExpress item-page strip-all", () => {
  test("strips all params except domainRules preserveParams on AliExpress item page", () => {
    // AliExpress item page URL: matches /item/\d+.html pattern
    // We craft a custom domainRules that preserves a specific param (savedParam)
    // to test that the preserveParams mechanism works on item pages.
    const customDomainRules = [{
      domain: "aliexpress.com",
      preserveParams: ["savedParam"],
      stripParams: [],
    }];
    const url = new URL(
      "https://www.aliexpress.com/item/1005001234567890.html" +
      "?pdp_npi=4%40dis%21USD%2199%21%21&aff_fcid=abc&savedParam=keep_me&scm=1001.1234",
    );

    const result = classifyAndStripTracking(url, BASE_PREFS, customDomainRules);

    // savedParam must survive (it's in our custom preserveParams)
    assert.ok(
      !result.removed.includes("savedParam"),
      "savedParam must not be in removed (it's in preserveParams)",
    );
    assert.ok(url.searchParams.has("savedParam"), "savedParam must still be in url");

    // tracking params must be removed
    assert.ok(result.removed.length > 0, "at least one param must be removed");
    assert.ok(result.removed.includes("pdp_npi") || result.removed.includes("scm") || result.removed.includes("aff_fcid"),
      "AliExpress tracking params must be removed");

    // removedValues must be parallel to removed
    assert.equal(result.removed.length, result.removedValues.length,
      "removed and removedValues must be parallel arrays");

    // url must only have preserved params remaining
    for (const param of url.searchParams.keys()) {
      assert.ok(
        !result.removed.includes(param),
        `param ${param} should not remain if it was removed`,
      );
    }
  });

  test("returns { removed, removedValues } shape (not removedTracking)", () => {
    const url = new URL("https://www.aliexpress.com/item/1005001234567890.html?utm_source=test");

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    assert.ok(Object.prototype.hasOwnProperty.call(result, "removed"), "must have 'removed' key");
    assert.ok(Object.prototype.hasOwnProperty.call(result, "removedValues"), "must have 'removedValues' key");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "removedTracking"), "must NOT have 'removedTracking' key");
  });
});

describe("TS-3 — classifyAndStripTracking — standard path", () => {
  test("removes utm_source from a standard URL", () => {
    const url = new URL("https://example.com/page?utm_source=newsletter&ref=home");

    const result = classifyAndStripTracking(url, BASE_PREFS, []);

    assert.ok(result.removed.includes("utm_source"), "utm_source must be removed");
    assert.ok(!url.searchParams.has("utm_source"), "utm_source must be deleted from url");
    assert.ok(!result.removed.includes("ref"), "ref must not be removed (not a tracking param)");
  });

  test("does not remove affiliate params protected by affiliateParamSet", () => {
    // Amazon tag= is an affiliate param for amazon.com — must not be stripped
    const url = new URL("https://www.amazon.com/dp/B0000?utm_source=google&tag=somecreator-20");

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    assert.ok(result.removed.includes("utm_source"), "utm_source must be removed");
    assert.ok(!result.removed.includes("tag"), "affiliate param tag= must NOT be removed");
    assert.ok(url.searchParams.has("tag"), "tag= must still be present in url");
  });

  test("mutates url.searchParams in place", () => {
    const url = new URL("https://example.com/page?fbclid=abc123&keep=this");

    classifyAndStripTracking(url, BASE_PREFS, []);

    assert.ok(!url.searchParams.has("fbclid"), "fbclid must be deleted from url");
    assert.ok(url.searchParams.has("keep"), "non-tracking param must remain");
  });

  test("removedValues is parallel to removed (index-aligned)", () => {
    const url = new URL("https://example.com/?utm_source=a&utm_medium=b&clean=keep");

    const result = classifyAndStripTracking(url, BASE_PREFS, []);

    assert.equal(result.removed.length, result.removedValues.length,
      "removed and removedValues must be same length");

    // Spot-check that values are captured before deletion
    assert.ok(result.removedValues.some(v => v === "a" || v === "b"),
      "removedValues must capture param values");
  });

  test("returns empty arrays for a URL with no tracking params", () => {
    const url = new URL("https://example.com/page?product=shoes&size=42");

    const result = classifyAndStripTracking(url, BASE_PREFS, []);

    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.removedValues, []);
  });
});

describe("FR-4 — classifyAndStripTracking — domainRules preserveParams respected", () => {
  test("params in domainRules preserveParams are not stripped even if tracking-like", () => {
    // Craft a fake domain rule that preserves a param that would otherwise be stripped
    const fakeDomainRules = [{
      hostname: "example.com",
      preserveParams: ["custom_tracker"],
    }];

    const url = new URL("https://example.com/page?custom_tracker=important&utm_source=strip_me");

    const result = classifyAndStripTracking(url, BASE_PREFS, fakeDomainRules);

    assert.ok(!result.removed.includes("custom_tracker"),
      "custom_tracker must not be removed (in preserveParams)");
    assert.ok(url.searchParams.has("custom_tracker"), "custom_tracker must remain in url");
    assert.ok(result.removed.includes("utm_source"), "utm_source must still be removed");
  });
});
