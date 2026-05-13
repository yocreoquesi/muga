/**
 * MUGA — TS-10: processUrl integration test for the canonical extractor path.
 *
 * Safety-net added before refactoring processUrl (issue #627).
 * This test MUST pass on unmodified main — it fills a coverage gap.
 *
 * Scenario: a t.co opaque wrapper URL is passed to processUrl together with
 * a canonicalBundle. The bundle reports the real destination as
 * "https://example.com/product?utm_source=twitter". The extractor resolves
 * the destination, processUrl then strips the utm_source param.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

// ── Minimal prefs — canonical extractor is ON by default (canonicalExtractorEnabled !== false)
const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

// ── A t.co wrapper URL that the Wrapper Engine cannot resolve (opaque path).
// The canonical extractor is fed via canonicalBundle.
const TCO_RAW = "https://t.co/SomeOpaquePath";

// ── Simulate what the content script would produce after reading the page DOM.
// linkCanonical wins over jsonLdId per canonical-extractor precedence rules.
const CANONICAL_BUNDLE_WITH_TRACKING = {
  linkCanonical: "https://example.com/product?utm_source=twitter",
  jsonLdId: null,
};

// ── frequencyTracker spy — records calls to observe()
function makeTrackerSpy() {
  const calls = [];
  return {
    observe(domain, name, value) {
      calls.push({ domain, name, value });
      return Promise.resolve();
    },
    calls,
  };
}

describe("TS-10 — processUrl canonical extractor integration", () => {
  test("resolves opaque t.co wrapper via canonicalBundle and strips utm_source", () => {
    const tracker = makeTrackerSpy();
    const result = processUrl(TCO_RAW, PREFS, [], CANONICAL_BUNDLE_WITH_TRACKING, tracker, undefined);

    assert.equal(result.action, "cleaned", "action must be 'cleaned' after tracking strip");
    assert.ok(
      result.removedTracking.includes("utm_source"),
      "removedTracking must include utm_source",
    );
    assert.ok(
      !result.cleanUrl.includes("utm_source"),
      "cleanUrl must not contain utm_source after strip",
    );
    assert.ok(
      result.cleanUrl.startsWith("https://example.com/"),
      "cleanUrl must resolve to the canonical destination, not the t.co URL",
    );
  });

  test("skips canonical extractor when canonicalExtractorEnabled is false", () => {
    const prefsDisabled = { ...PREFS, canonicalExtractorEnabled: false };
    const result = processUrl(TCO_RAW, prefsDisabled, [], CANONICAL_BUNDLE_WITH_TRACKING, undefined, undefined);

    // Without canonical extraction the t.co URL itself goes through the pipeline.
    // t.co has no tracking params of its own so it is untouched.
    assert.equal(result.action, "untouched", "should be untouched when canonical extractor disabled");
    assert.ok(
      result.cleanUrl.startsWith("https://t.co/"),
      "cleanUrl must remain the t.co URL when extraction is disabled",
    );
  });

  test("skips canonical extractor when no canonicalBundle is supplied", () => {
    const result = processUrl(TCO_RAW, PREFS, [], undefined, undefined, undefined);

    assert.equal(result.action, "untouched", "should be untouched when no bundle supplied");
    assert.ok(
      result.cleanUrl.startsWith("https://t.co/"),
      "cleanUrl must remain the t.co URL when no bundle is supplied",
    );
  });

  test("frequencyTracker.observe is called for each stripped param", () => {
    const tracker = makeTrackerSpy();
    processUrl(TCO_RAW, PREFS, [], CANONICAL_BUNDLE_WITH_TRACKING, tracker, undefined);

    assert.ok(tracker.calls.length >= 1, "observe must be called at least once");
    const names = tracker.calls.map(c => c.name);
    assert.ok(names.includes("utm_source"), "observe must be called with 'utm_source'");
  });
});
