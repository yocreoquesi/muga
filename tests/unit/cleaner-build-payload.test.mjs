/**
 * MUGA — TS-1: Unit tests for buildReturnPayload factory.
 *
 * RED phase: this file imports __test__.buildReturnPayload which does not
 * exist yet. The suite must FAIL until buildReturnPayload is implemented
 * and exported via __test__ (issue #627).
 *
 * Covers all 6 return shapes (S1–S6) as defined in spec §3.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../../src/lib/cleaner.js";

const { buildReturnPayload } = __test__;

// ── Shared fixtures
const RAW_URL = "https://example.com/page?q=1";
const PARSED_URL = new URL("https://example.com/product?tag=abc");
const PARSED_URL_CLEAN = new URL("https://example.com/product");

describe("TS-1 — buildReturnPayload — S1 (early fail, creatorReferralPreserved: false)", () => {
  test("S1: URL parse fail — all required keys present, no extra keys", () => {
    const result = buildReturnPayload("untouched", RAW_URL, [], null, {
      junkRemoved: 0,
      creatorReferralPreserved: false,
    });

    assert.equal(result.cleanUrl, RAW_URL, "cleanUrl must be the raw string");
    assert.equal(result.action, "untouched");
    assert.deepEqual(result.removedTracking, []);
    assert.equal(result.junkRemoved, 0);
    assert.equal(result.detectedAffiliate, null);
    assert.equal(result.preservedAffiliate, null);
    assert.equal(result.creatorReferralPreserved, false);

    // S1 must NOT have network or creator keys
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "network"), "S1 must not have 'network' key");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "creator"), "S1 must not have 'creator' key");
  });

  test("S1: defaults — junkRemoved defaults to 0, creatorReferralPreserved defaults to false", () => {
    const result = buildReturnPayload("untouched", RAW_URL, [], null, {});

    assert.equal(result.junkRemoved, 0, "default junkRemoved must be 0");
    assert.equal(result.creatorReferralPreserved, false, "default creatorReferralPreserved must be false");
    assert.equal(result.preservedAffiliate, null, "default preservedAffiliate must be null");
  });
});

describe("TS-1 — buildReturnPayload — S2 (auth/disabled, live creatorReferralPreserved)", () => {
  test("S2: creatorReferralPreserved: true is preserved in output", () => {
    const result = buildReturnPayload("untouched", RAW_URL, [], null, {
      creatorReferralPreserved: true,
    });

    assert.equal(result.creatorReferralPreserved, true);
    assert.equal(result.cleanUrl, RAW_URL);
    assert.equal(result.action, "untouched");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "network"), "S2 must not have 'network' key");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "creator"), "S2 must not have 'creator' key");
  });
});

describe("TS-1 — buildReturnPayload — S3 (honored-creator)", () => {
  test("S3: includes network and creator keys in output", () => {
    const result = buildReturnPayload("honored-creator", RAW_URL, [], null, {
      network: "facebook-l",
      creator: "creator1",
      creatorReferralPreserved: false,
    });

    assert.equal(result.action, "honored-creator");
    assert.equal(result.cleanUrl, RAW_URL);
    assert.equal(result.network, "facebook-l", "S3 must include network");
    assert.equal(result.creator, "creator1", "S3 must include creator");
    assert.equal(result.creatorReferralPreserved, false, "S3 hardcodes false");
    assert.equal(result.preservedAffiliate, null);
    assert.deepEqual(result.removedTracking, []);
  });

  test("S3: network and creator are omitted when not in extras", () => {
    const result = buildReturnPayload("untouched", RAW_URL, [], null, {});

    assert.ok(!Object.prototype.hasOwnProperty.call(result, "network"), "must not have 'network' when not in extras");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "creator"), "must not have 'creator' when not in extras");
  });
});

describe("TS-1 — buildReturnPayload — S4 (blacklisted)", () => {
  test("S4: URL object — cleanUrl is url.toString(), junkRemoved from extras", () => {
    const result = buildReturnPayload("blacklisted", PARSED_URL_CLEAN, [], null, {
      junkRemoved: 3,
      creatorReferralPreserved: true,
    });

    assert.equal(result.cleanUrl, PARSED_URL_CLEAN.toString(), "cleanUrl must be url.toString() for URL object");
    assert.equal(result.action, "blacklisted");
    assert.equal(result.junkRemoved, 3);
    assert.equal(result.creatorReferralPreserved, true);
    assert.equal(result.detectedAffiliate, null);
    assert.equal(result.preservedAffiliate, null);
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "network"), "S4 must not have 'network' key");
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "creator"), "S4 must not have 'creator' key");
  });
});

describe("TS-1 — buildReturnPayload — S5 (whitelist domain)", () => {
  test("S5: preservedAffiliate is included from extras", () => {
    const preserved = { param: "tag", value: "xyz", store: "Amazon", group: "Amazon" };
    const result = buildReturnPayload("cleaned", PARSED_URL, ["utm_source"], null, {
      junkRemoved: 1,
      preservedAffiliate: preserved,
      creatorReferralPreserved: false,
    });

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking, ["utm_source"]);
    assert.equal(result.junkRemoved, 1);
    assert.deepEqual(result.preservedAffiliate, preserved, "S5 must include preservedAffiliate from extras");
    assert.equal(result.detectedAffiliate, null);
    assert.equal(result.creatorReferralPreserved, false);
  });
});

describe("TS-1 — buildReturnPayload — S6 (main path)", () => {
  test("S6: detectedAffiliate is non-null (Scenario C)", () => {
    const affiliate = { param: "aff", value: "foreign123", pattern: {} };
    const preserved = { param: "tag", value: "ours", store: "Amazon", group: "Amazon" };
    const result = buildReturnPayload("detected_foreign", PARSED_URL, [], affiliate, {
      junkRemoved: 0,
      preservedAffiliate: preserved,
      creatorReferralPreserved: true,
    });

    assert.equal(result.action, "detected_foreign");
    assert.deepEqual(result.detectedAffiliate, affiliate, "S6 must include detectedAffiliate");
    assert.deepEqual(result.preservedAffiliate, preserved);
    assert.equal(result.creatorReferralPreserved, true);
    assert.equal(result.cleanUrl, PARSED_URL.toString());
  });

  test("S6: action 'injected' — all fields correct", () => {
    const result = buildReturnPayload("injected", PARSED_URL, [], null, {
      junkRemoved: 0,
      preservedAffiliate: null,
      creatorReferralPreserved: false,
    });

    assert.equal(result.action, "injected");
    assert.equal(result.detectedAffiliate, null);
    assert.equal(result.preservedAffiliate, null);
    assert.equal(result.junkRemoved, 0);
  });
});

describe("TS-1 — buildReturnPayload — cleanUrl resolution", () => {
  test("string rawUrl is used directly as cleanUrl", () => {
    const result = buildReturnPayload("untouched", "https://example.com/raw", [], null, {});
    assert.equal(result.cleanUrl, "https://example.com/raw");
  });

  test("URL object is converted via .toString()", () => {
    const url = new URL("https://example.com/parsed?x=1");
    const result = buildReturnPayload("cleaned", url, ["x"], null, { junkRemoved: 1 });
    assert.equal(result.cleanUrl, url.toString());
  });
});
