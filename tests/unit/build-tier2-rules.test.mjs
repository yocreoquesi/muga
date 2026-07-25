/**
 * MUGA: Unit tests for the offline Tier 2 rule transform tool (#1027 Phase 4).
 *
 * `tools/build-tier2-rules.mjs` is a MAINTAINER tool, never wired into CI,
 * that turns locally vetted Consent-O-Matic-shaped rule files into MUGA's
 * Tier 2 reject-only rule shape. These tests only import the module's pure
 * reducer -- the module's `main()` (filesystem reads + stdout) is guarded so
 * importing it here never touches the filesystem or process.argv beyond the
 * test runner's own invocation (see the entry-guard at the bottom of the
 * tool, mirroring tools/probe-shortener-redirect.mjs).
 *
 * The safety-critical property under test: given a source rule object that
 * carries BOTH accept-path fields (trueAction, a DO_CONSENT toggle/consent
 * matcher, a SAVE_CONSENT method, and a top-level accept selector) AND
 * reject/present fields, the reducer's output contains ONLY the four
 * MUGA-allowlisted keys and not one token from the accept-path survives.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { reduceTier2Rule } from "../../tools/build-tier2-rules.mjs";

describe("build-tier2-rules — reduceTier2Rule pure field-allowlist reducer", () => {
  // A single fixture carrying BOTH accept-path fields (trueAction, the
  // DO_CONSENT toggle/consent matcher, SAVE_CONSENT, acceptSelector) and
  // reject/present fields (declineSelector, detectors, OPEN_OPTIONS), per
  // task 4.1.
  const sourceRuleWithBothPaths = Object.freeze({
    id: "examplecmp",
    detectors: [{ presentMatcher: { target: { selector: "#examplecmp-banner" } } }],
    methods: [
      {
        name: "DO_CONSENT",
        consents: [
          { type: "ANALYTICS", toggleAction: { slide: { selector: ".examplecmp-analytics-toggle" } } },
        ],
        trueAction: { click: { selector: ".examplecmp-accept-all" } },
      },
      { name: "SAVE_CONSENT", action: { click: { selector: ".examplecmp-save-choices" } } },
      { name: "OPEN_OPTIONS", action: { click: { selector: ".examplecmp-manage-options" } } },
    ],
    declineSelector: ".examplecmp-decline-all",
    acceptSelector: ".examplecmp-accept-all",
  });

  test("output contains ONLY the allowlisted {id, present, reject, openSettings} keys", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.deepEqual(Object.keys(out).sort(), ["id", "openSettings", "present", "reject"]);
  });

  test("reject holds only the curated decline selector, never the accept selector", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.deepEqual(out.reject, [".examplecmp-decline-all"]);
  });

  test("present is derived from the detectors' presentMatcher selectors", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.deepEqual(out.present, ["#examplecmp-banner"]);
  });

  test("openSettings is derived only from OPEN_OPTIONS, never DO_CONSENT/SAVE_CONSENT", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.deepEqual(out.openSettings, [".examplecmp-manage-options"]);
  });

  test("id is copied from the source rule id", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.equal(out.id, "examplecmp");
  });

  test("zero accept/allowall/trueAction/save token survives anywhere in the emitted object", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    const serialized = JSON.stringify(out);
    assert.doesNotMatch(serialized, /accept|allowall|trueaction|save/i);
  });

  test("missing declineSelector -> reject is empty, never falls back to the accept selector", () => {
    const noReject = { ...sourceRuleWithBothPaths, declineSelector: undefined };
    const out = reduceTier2Rule(noReject);
    assert.deepEqual(out.reject, []);
  });

  test("a source rule with ONLY accept-path fields (no declineSelector at all) never leaks one into reject", () => {
    const acceptOnly = {
      id: "acceptonlycmp",
      detectors: [{ presentMatcher: { target: { selector: "#acceptonlycmp-banner" } } }],
      methods: [
        { name: "DO_CONSENT", trueAction: { click: { selector: ".acceptonlycmp-accept-all" } } },
        { name: "SAVE_CONSENT", action: { click: { selector: ".acceptonlycmp-save" } } },
      ],
      acceptSelector: ".acceptonlycmp-accept-all",
    };
    const out = reduceTier2Rule(acceptOnly);
    assert.deepEqual(out.reject, []);
    assert.deepEqual(out.openSettings, []);
  });

  test("garbage/empty input never throws and produces the allowlisted shape with empty arrays", () => {
    assert.doesNotThrow(() => reduceTier2Rule({}));
    const out = reduceTier2Rule({});
    assert.deepEqual(Object.keys(out).sort(), ["id", "openSettings", "present", "reject"]);
    assert.deepEqual(out.present, []);
    assert.deepEqual(out.reject, []);
    assert.deepEqual(out.openSettings, []);
    assert.equal(out.id, "");
  });

  test("null/undefined input never throws", () => {
    assert.doesNotThrow(() => reduceTier2Rule(null));
    assert.doesNotThrow(() => reduceTier2Rule(undefined));
  });

  test("output arrays are frozen (defense in depth, matches cmp-tier2-rules.js's own frozen shape)", () => {
    const out = reduceTier2Rule(sourceRuleWithBothPaths);
    assert.ok(Object.isFrozen(out));
    assert.ok(Object.isFrozen(out.present));
    assert.ok(Object.isFrozen(out.reject));
    assert.ok(Object.isFrozen(out.openSettings));
  });
});
