/**
 * MUGA — Unit tests for buildTrackerFlagDeepLinkUrl
 * (src/lib/tracker-flag-deeplink.js) (#1351 R3-tautological-deeplink-tests)
 *
 * Run with: npm test
 *
 * The "Report upstream" deep-link URL construction used to live inline in
 * options.js's buildReportUpstreamButton, and the old test suite rebuilt
 * the SAME logic independently instead of calling the real code — a
 * tautological test that could not catch a regression in the actual
 * implementation. Extracted into a pure, exported helper so the test
 * exercises the real code, mirroring the precedent set by
 * domain-stats-view.js / suspicious-params-view.js.
 *
 * Privacy contract pinned here: the deep-link carries ONLY the flagged
 * param name and first-party-domain-derived counts. Raw values (only
 * hashes are ever stored), value hashes, and timestamps (firstSeen/
 * lastSeen) must never appear in the URL.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildTrackerFlagDeepLinkUrl } from "../../src/lib/tracker-flag-deeplink.js";

describe("buildTrackerFlagDeepLinkUrl — pure deep-link builder for #1351's Report-upstream action", () => {
  test("null/missing trackerState -> URL carries only template + paramName", () => {
    const url = buildTrackerFlagDeepLinkUrl("uid", null);
    assert.match(url, /^https:\/\/github\.com\/yocreoquesi\/muga\/issues\/new\?/);
    assert.match(url, /template=tracker-flag\.yml/);
    assert.match(url, /paramName=uid/);
    assert.doesNotMatch(url, /domains=/);
    assert.doesNotMatch(url, /entropy_score=/);
    assert.doesNotMatch(url, /frequency_distinct_domains=/);
    assert.doesNotMatch(url, /frequency_distinct_values=/);
  });

  test("carries the documented prefill fields when a tracker entry exists", () => {
    const trackerState = {
      params: {
        uid: {
          domains: ["news.example.com", "shop.example.org"],
          values: ["hash1", "hash2", "hash3"],
          entropyAvg: 4.85,
        },
      },
    };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.match(url, /template=tracker-flag\.yml/);
    assert.match(url, /paramName=uid/);
    assert.ok(url.includes(encodeURIComponent("news.example.com")));
    assert.ok(url.includes(encodeURIComponent("shop.example.org")));
    assert.match(url, /entropy_score=4\.85/);
    assert.match(url, /frequency_distinct_domains=2/);
    assert.match(url, /frequency_distinct_values=3/);
  });

  test("accepts the raw (unwrapped) tracker entry shape too", () => {
    const trackerState = { uid: { domains: ["a.example.com"], values: ["h1"], entropyAvg: 1 } };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.match(url, /frequency_distinct_domains=1/);
  });

  test("caps the domains list at 50 entries to stay under GitHub's URL ceiling", () => {
    const domains = [];
    for (let i = 0; i < 60; i++) domains.push(`d${i}.example.test`);
    const trackerState = { params: { uid: { domains, values: [], entropyAvg: null } } };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.ok(url.includes(encodeURIComponent("d0.example.test")));
    assert.ok(url.includes(encodeURIComponent("d49.example.test")));
    assert.ok(!url.includes(encodeURIComponent("d50.example.test")));
    // frequency_distinct_domains reports the TRUE total, not the capped prefill count.
    assert.match(url, /frequency_distinct_domains=60/);
  });

  test("never leaks raw value hashes or timestamps into the URL", () => {
    const SECRET_HASH_A = "deadbeef".repeat(8);
    const SECRET_HASH_B = "feedface".repeat(8);
    const FIRST_SEEN_TS = 1717181718;
    const LAST_SEEN_TS  = 1717181819;
    const trackerState = {
      params: {
        uid: {
          domains: ["news.example.com"],
          values: [SECRET_HASH_A, SECRET_HASH_B],
          firstSeen: FIRST_SEEN_TS,
          lastSeen: LAST_SEEN_TS,
          count: 7,
          entropyAvg: 2.5,
        },
      },
    };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    for (const leak of [SECRET_HASH_A, SECRET_HASH_B, String(FIRST_SEEN_TS), String(LAST_SEEN_TS)]) {
      assert.ok(!url.includes(leak), `deep-link URL must not contain "${leak}"`);
      assert.ok(!url.includes(encodeURIComponent(leak)), `deep-link URL must not contain encoded form of "${leak}"`);
    }
  });

  test("omits entropy_score when entropyAvg is not a number", () => {
    const trackerState = { params: { uid: { domains: ["a.example.com"], values: [], entropyAvg: null } } };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.doesNotMatch(url, /entropy_score=/);
  });

  test("omits frequency_distinct_values when there are no values", () => {
    const trackerState = { params: { uid: { domains: ["a.example.com"], values: [], entropyAvg: 1 } } };
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.doesNotMatch(url, /frequency_distinct_values=/);
  });

  test("tolerates a malformed entry (non-array domains/values) without throwing", () => {
    const trackerState = { params: { uid: { domains: "not-an-array", values: null, entropyAvg: "not-a-number" } } };
    assert.doesNotThrow(() => buildTrackerFlagDeepLinkUrl("uid", trackerState));
    const url = buildTrackerFlagDeepLinkUrl("uid", trackerState);
    assert.doesNotMatch(url, /domains=/);
    assert.doesNotMatch(url, /entropy_score=/);
  });
});
