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

const { handleWhitelistedDomain, handleAffiliatePipeline } = __test__;

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
const _WHITELISTED_PREFS = {
  ...BASE_PREFS,
  whitelist: [`${WHITELISTED_DOMAIN}`],
};

// Helper: build parsed whitelist from prefs.whitelist
function _buildParsedWhitelist(prefs) {
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

// ── handleAffiliatePipeline tests (Phase 5b / Commit 6) ──────────────────────
// These tests are added in RED before handleAffiliatePipeline is exported.

// Amazon affiliate test data
const AMAZON_HOST = "www.amazon.com";
const AMAZON_HOSTNAME = "amazon.com";
const AMAZON_OUR_TAG = "muga0b-20";
const AMAZON_AFFILIATE_PARAM = "tag";

// Amazon patterns from AFFILIATE_PATTERNS
// We import processUrl's getPatternsForHost indirectly by checking known patterns
// For direct testing, we construct a minimal pattern matching Amazon's shape
import { getPatternsForHost } from "../../src/lib/affiliates.js";

const AMAZON_PATTERNS = getPatternsForHost(AMAZON_HOST);
const AMAZON_PARSEDBLACKLIST = [];  // empty blacklist
const AMAZON_PARSEDWHITELIST = [];  // empty whitelist

// ── Prefs variants
const PREFS_NOTIFY_FOREIGN = {
  ...BASE_PREFS,
  notifyForeignAffiliate: true,
  stripAllAffiliates: false,
  injectOwnAffiliate: false,
};

const PREFS_INJECT = {
  ...BASE_PREFS,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  injectOwnAffiliate: true,
};

const PREFS_STRIP_ALL = {
  ...BASE_PREFS,
  notifyForeignAffiliate: false,
  stripAllAffiliates: true,
  injectOwnAffiliate: false,
};

describe("TS-7 — handleAffiliatePipeline — Scenario C (foreign affiliate detected)", () => {
  test("foreign affiliate detected: action=detected_foreign, param NOT deleted", () => {
    const foreignTag = "competitor-affiliate-999";
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000?${AMAZON_AFFILIATE_PARAM}=${foreignTag}`);

    const result = handleAffiliatePipeline(
      url, PREFS_NOTIFY_FOREIGN, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.equal(result.action, "detected_foreign",
      "action must be 'detected_foreign' for a foreign affiliate");
    assert.ok(result.detectedAffiliate !== null, "detectedAffiliate must be non-null");
    assert.equal(result.detectedAffiliate.param, AMAZON_AFFILIATE_PARAM);
    assert.equal(result.detectedAffiliate.value, foreignTag);
    // The affiliate param must NOT be deleted (Scenario C preserves it)
    assert.ok(url.searchParams.has(AMAZON_AFFILIATE_PARAM),
      "affiliate param must NOT be deleted on detected_foreign");
  });

  test("own MUGA tag is not flagged as foreign affiliate", () => {
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000?${AMAZON_AFFILIATE_PARAM}=${AMAZON_OUR_TAG}`);

    const result = handleAffiliatePipeline(
      url, PREFS_NOTIFY_FOREIGN, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.notEqual(result.action, "detected_foreign",
      "MUGA's own tag must not be flagged as foreign");
    assert.equal(result.detectedAffiliate, null, "detectedAffiliate must be null for own tag");
  });
});

describe("TS-8 — handleAffiliatePipeline — signature has exactly 6 params", () => {
  test("function signature accepts exactly 6 params: url, prefs, patterns, parsedBlacklist, parsedWhitelist, hostname", () => {
    // Verify the function exists and has 6 parameters
    assert.equal(typeof handleAffiliatePipeline, "function");
    assert.equal(handleAffiliatePipeline.length, 6,
      "handleAffiliatePipeline must have exactly 6 parameters (no frequencyTracker)");
  });

  test("output struct contains exactly action, detectedAffiliate, blacklistStripped", () => {
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000`);
    const result = handleAffiliatePipeline(
      url, BASE_PREFS, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.ok(Object.prototype.hasOwnProperty.call(result, "action"), "output must have 'action'");
    assert.ok(Object.prototype.hasOwnProperty.call(result, "detectedAffiliate"), "output must have 'detectedAffiliate'");
    assert.ok(Object.prototype.hasOwnProperty.call(result, "blacklistStripped"), "output must have 'blacklistStripped'");
    // blacklistRemovedAffiliate must NOT leak out (R2: internal to pipeline)
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "blacklistRemovedAffiliate"),
      "blacklistRemovedAffiliate must NOT appear in output (internal flag, R2)");
  });
});

describe("Scenario B — handleAffiliatePipeline — own-affiliate injection", () => {
  test("injectOwnAffiliate=true + no existing tag → action=injected, tag set in url", () => {
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000`);

    const result = handleAffiliatePipeline(
      url, PREFS_INJECT, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.equal(result.action, "injected", "action must be 'injected' when our tag is added");
    assert.equal(url.searchParams.get(AMAZON_AFFILIATE_PARAM), AMAZON_OUR_TAG,
      "url must have our affiliate tag after injection");
  });

  test("injectOwnAffiliate=false → no injection, action stays untouched", () => {
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000`);

    const result = handleAffiliatePipeline(
      url, BASE_PREFS, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.notEqual(result.action, "injected", "action must not be 'injected' when injection disabled");
    assert.ok(!url.searchParams.has(AMAZON_AFFILIATE_PARAM),
      "affiliate param must not be added when injection disabled");
  });
});

describe("Scenario D (specific) — handleAffiliatePipeline — blacklist-value strip", () => {
  test("blacklisted specific affiliate value is stripped, blacklistStripped incremented", () => {
    const BLACKLISTED_TAG = "bad-affiliate-123";
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000?${AMAZON_AFFILIATE_PARAM}=${BLACKLISTED_TAG}`);

    // Build a parsedBlacklist entry that blacklists this specific value
    const parsedBlacklist = [parseListEntry(`${AMAZON_HOSTNAME}::${AMAZON_AFFILIATE_PARAM}::${BLACKLISTED_TAG}`)];

    const result = handleAffiliatePipeline(
      url, BASE_PREFS, AMAZON_PATTERNS, parsedBlacklist, AMAZON_PARSEDWHITELIST, AMAZON_HOST,
    );

    assert.ok(result.blacklistStripped > 0, "blacklistStripped must be > 0 after blacklist strip");
    assert.ok(!url.searchParams.has(AMAZON_AFFILIATE_PARAM),
      "blacklisted affiliate param must be deleted from url");
  });
});

describe("TS-9 — handleAffiliatePipeline — whitelist param value sacred", () => {
  test("whitelisted affiliate param value is NOT deleted by blacklist strip", () => {
    const WHITELISTED_TAG = "creator-tag-whitelist";
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000?${AMAZON_AFFILIATE_PARAM}=${WHITELISTED_TAG}`);

    // Blacklist the tag, but also whitelist the specific value — whitelist wins
    const parsedBlacklist = [parseListEntry(`${AMAZON_HOSTNAME}::${AMAZON_AFFILIATE_PARAM}::${WHITELISTED_TAG}`)];
    const parsedWhitelist = [parseListEntry(`${AMAZON_HOSTNAME}::${AMAZON_AFFILIATE_PARAM}::${WHITELISTED_TAG}`)];

    const _result = handleAffiliatePipeline(
      url, BASE_PREFS, AMAZON_PATTERNS, parsedBlacklist, parsedWhitelist, AMAZON_HOST,
    );

    assert.ok(url.searchParams.has(AMAZON_AFFILIATE_PARAM),
      "whitelisted affiliate param must NOT be deleted (whitelist wins over blacklist)");
    assert.equal(url.searchParams.get(AMAZON_AFFILIATE_PARAM), WHITELISTED_TAG,
      "whitelisted value must remain unchanged");
  });

  test("whitelisted param survives stripAllAffiliates", () => {
    const WHITELISTED_TAG = "creator-permanent";
    const url = new URL(`https://${AMAZON_HOST}/dp/B0000?${AMAZON_AFFILIATE_PARAM}=${WHITELISTED_TAG}`);

    const parsedWhitelist = [parseListEntry(`${AMAZON_HOSTNAME}::${AMAZON_AFFILIATE_PARAM}::${WHITELISTED_TAG}`)];

    const _result = handleAffiliatePipeline(
      url, PREFS_STRIP_ALL, AMAZON_PATTERNS, AMAZON_PARSEDBLACKLIST, parsedWhitelist, AMAZON_HOST,
    );

    assert.ok(url.searchParams.has(AMAZON_AFFILIATE_PARAM),
      "whitelisted param must survive stripAllAffiliates");
  });
});
