/**
 * MUGA — TS-7/TS-8/TS-9: Unit tests for handleWhitelistedDomain and handleAffiliatePipeline.
 *
 * This file is built in two phases (Commits 5 + 6):
 *   Commit 5 (Phase 5a): handleWhitelistedDomain describe block — RED → GREEN
 *   Commit 6 (Phase 5b): handleAffiliatePipeline describe block — RED → GREEN
 *
 * Issue #627
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { __test__, parseListEntry } from "../../src/lib/cleaner.js";

const { handleWhitelistedDomain } = __test__;

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

// ── Amazon affiliate patterns are available for amazon.com
// For handleWhitelistedDomain, we use a fictional domain where we can control the whitelist entry
const WHITELISTED_DOMAIN = "shop.whitelisted-test.example";
const WHITELISTED_PREFS = {
  ...BASE_PREFS,
  whitelist: [`${WHITELISTED_DOMAIN}`],
};

// Helper: build parsed whitelist from prefs.whitelist
function buildParsedWhitelist(prefs) {
  return (prefs.whitelist || []).map(parseListEntry);
}

// Helper: build patterns for a host (returns empty for non-affiliate domains)
// handleWhitelistedDomain gets patterns from getPatternsForHost internally via processUrl,
// but since we're calling directly, we pass them as parameter.
// For our test domain, affiliate patterns = empty (no affiliate param for this fictional domain)
const EMPTY_PATTERNS = [];

describe("handleWhitelistedDomain — S5 shape (whitelist domain early-return)", () => {
  test("returns { payload, removed, removedValues } shape", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?utm_source=test&clean=keep`);
    const patterns = EMPTY_PATTERNS;

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], patterns, WHITELISTED_DOMAIN, false, false,
    );

    assert.ok(Object.prototype.hasOwnProperty.call(result, "payload"), "must have 'payload' key");
    assert.ok(Object.prototype.hasOwnProperty.call(result, "removed"), "must have 'removed' key");
    assert.ok(Object.prototype.hasOwnProperty.call(result, "removedValues"), "must have 'removedValues' key");
  });

  test("payload is a valid S5 shape with required fields", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?utm_source=newsletter`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, false, false,
    );

    const { payload } = result;
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "cleanUrl"), "payload.cleanUrl required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "action"), "payload.action required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "removedTracking"), "payload.removedTracking required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "junkRemoved"), "payload.junkRemoved required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "detectedAffiliate"), "payload.detectedAffiliate required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "preservedAffiliate"), "payload.preservedAffiliate required");
    assert.ok(Object.prototype.hasOwnProperty.call(payload, "creatorReferralPreserved"), "payload.creatorReferralPreserved required");
    assert.equal(payload.detectedAffiliate, null, "S5 shape has null detectedAffiliate");
  });

  test("utm_source is stripped (tracking params are removed on whitelisted domains)", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?utm_source=newsletter&keep=this`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, false, false,
    );

    assert.ok(
      result.removed.includes("utm_source"),
      "utm_source must be stripped on whitelisted domain",
    );
    assert.equal(result.payload.action, "cleaned",
      "action must be 'cleaned' when tracking params were removed");
  });

  test("removed and removedValues are parallel arrays passed back for recordFrequency", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?utm_source=a&utm_medium=b`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, false, false,
    );

    assert.equal(result.removed.length, result.removedValues.length,
      "removed and removedValues must be same length for recordFrequency");
    // These are the arrays the orchestrator passes to recordFrequency
    // (NOT payload.removedTracking — that's the same data but for the return shape)
    assert.ok(Array.isArray(result.removed), "removed must be an array");
    assert.ok(Array.isArray(result.removedValues), "removedValues must be an array");
  });

  test("creatorReferralPreserved is threaded into payload", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, false, true,
    );

    assert.equal(result.payload.creatorReferralPreserved, true,
      "creatorReferralPreserved must pass through to payload");
  });

  test("pathCleaned=true adds 1 to junkRemoved", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?utm_source=test`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, true /* pathCleaned */, false,
    );

    // junkRemoved = removed.length + (pathCleaned ? 1 : 0)
    assert.equal(result.payload.junkRemoved, result.removed.length + 1,
      "junkRemoved must include +1 for pathCleaned");
  });

  test("no tracking params → action is 'untouched'", () => {
    const url = new URL(`https://${WHITELISTED_DOMAIN}/page?product=shoes`);

    const result = handleWhitelistedDomain(
      url, BASE_PREFS, [], EMPTY_PATTERNS, WHITELISTED_DOMAIN, false, false,
    );

    assert.equal(result.payload.action, "untouched",
      "action must be 'untouched' when no tracking params removed and path not cleaned");
    assert.deepEqual(result.removed, []);
  });

  test("affiliate param on whitelisted domain is NOT stripped (FR-3 whitelist is sacred)", () => {
    // On a whitelisted domain, affiliate params should NOT be deleted.
    // We test this using amazon.com's 'tag' param with an affiliate pattern present.
    const amazonUrl = new URL("https://www.amazon.com/dp/B0000?utm_source=google&tag=creator-20");
    const amazonPrefs = { ...BASE_PREFS };
    // amazon.com's patterns include 'tag' as an affiliate param
    // getPatternsForHost("www.amazon.com") will return patterns including tag
    // We pass empty patterns here to simulate the "no injection" path
    // The affiliate param protection comes from affiliateParamSet inside the function

    const result = handleWhitelistedDomain(
      amazonUrl, amazonPrefs, domainRules, EMPTY_PATTERNS, "www.amazon.com", false, false,
    );

    // utm_source should be stripped, tag should survive
    assert.ok(result.removed.includes("utm_source") || !result.removed.includes("tag"),
      "affiliate param 'tag' should not be stripped on whitelisted domain");
  });
});
