/**
 * MUGA — Affiliate-survival canary validation (#768 / epic #785).
 *
 * Proves every fixture in tests/fixtures/affiliate-canaries.mjs holds against
 * the live cleaner. This is the safety net the rule-ingestion pipeline (GATE 3,
 * #777) will reuse via the programmatic runner (#771): if any candidate strip
 * rule ever breaks one of these, the affiliate moat is at risk.
 *
 * The scattered originals in cleaner.test.mjs / get-landing-policy.test.mjs are
 * deduped against this single source of truth in #769.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl, getLandingPolicy } from "../../src/lib/cleaner.js";
import { REDIRECT_NETWORK_PATTERNS } from "../../src/lib/affiliates.js";
import { PRESERVE_CANARIES, LANDING_CANARIES } from "../../tools/affiliate-safety/canaries.mjs";
import { runAffiliateCanaries } from "../../tools/affiliate-safety/runner.mjs";

describe("affiliate canaries — preserve (processUrl)", () => {
  for (const canary of PRESERVE_CANARIES) {
    test(canary.name, () => {
      const { cleanUrl } = processUrl(canary.url, canary.prefs);
      const params = new URL(cleanUrl).searchParams;

      for (const [param, value] of Object.entries(canary.mustSurvive)) {
        assert.equal(params.get(param), value, `${param}= must survive with its exact value`);
      }
      for (const param of canary.mustStrip) {
        assert.equal(params.has(param), false, `${param} must be stripped`);
      }
    });
  }
});

describe("affiliate canaries — landing policy (getLandingPolicy)", () => {
  for (const canary of LANDING_CANARIES) {
    test(canary.name, () => {
      const policy = getLandingPolicy(canary.landingHost, canary.referrer);
      for (const param of canary.mustPreserve) {
        assert.ok(policy.preserve.has(param), `${param} must be preserved for ${canary.network}`);
      }
      assert.equal(policy.network, canary.network, "network must match");
    });
  }
});

// Structural floor: keep the fixtures honest as the file grows.
describe("affiliate canaries — fixture shape", () => {
  test("preserve canaries are well-formed and non-empty", () => {
    assert.ok(PRESERVE_CANARIES.length >= 14, "expected the 6 Amazon + 6 eBay + collision canaries");
    for (const c of PRESERVE_CANARIES) {
      assert.equal(typeof c.url, "string");
      assert.ok(c.prefs && typeof c.prefs === "object");
      assert.ok(c.mustSurvive && typeof c.mustSurvive === "object");
      assert.ok(Array.isArray(c.mustStrip));
    }
  });

  test("landing canaries are well-formed and non-empty", () => {
    assert.ok(LANDING_CANARIES.length >= 10, "expected one canary per matrix v1.0 network");
    for (const c of LANDING_CANARIES) {
      assert.equal(typeof c.landingHost, "string");
      assert.equal(typeof c.referrer, "string");
      assert.ok(Array.isArray(c.mustPreserve) && c.mustPreserve.length > 0);
      assert.equal(typeof c.network, "string");
    }
  });
});

// #770 — drift guard: every declared redirect network must have a canary.
describe("affiliate canaries — REDIRECT_NETWORK_PATTERNS coverage", () => {
  test("every redirect network has a named LANDING canary (no silent gaps)", () => {
    const covered = new Set(LANDING_CANARIES.map((c) => c.network));
    for (const net of REDIRECT_NETWORK_PATTERNS) {
      assert.ok(covered.has(net.id), `redirect network "${net.id}" has no LANDING canary`);
    }
  });
});

// #771 — the programmatic runner the pipeline's GATE 3 will call.
describe("affiliate canaries — programmatic runner", () => {
  test("runAffiliateCanaries() passes against the current cleaner", () => {
    const result = runAffiliateCanaries();
    assert.equal(result.ok, true, `canary failures: ${JSON.stringify(result.failures, null, 2)}`);
    assert.equal(result.failures.length, 0);
    assert.equal(result.total, PRESERVE_CANARIES.length + LANDING_CANARIES.length);
  });

  test("runAffiliateCanaries() returns the structured verdict shape", () => {
    const result = runAffiliateCanaries();
    assert.equal(typeof result.ok, "boolean");
    assert.ok(Array.isArray(result.failures));
    assert.equal(typeof result.total, "number");
  });
});
