/**
 * Invariant test for muga's internal CAPS manifest rule artifact (#523, #715).
 *
 * Pins the shape and roster of `src/rules/manifest.data.js` (muga's internal
 * rule artifact). Filtered to `programType === "direct-injection"`.
 *
 * If a future rules update adds a new direct-injection program,
 * the EXPECTED_PROGRAM_IDS list below must be updated — this test fails
 * loudly so the change is reviewed, not silent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CAPS_DIRECT_INJECTION_PROGRAMS } from "../../src/rules/manifest.data.js";

const REQUIRED_FIELDS = [
  "id",
  "name",
  "programType",
  "domains",
  "param",
  "valueShape",
];

// Locked-in roster as of the initial sync (caps-spec v1.0.0-rc1).
// Adding programs here without a corresponding caps-spec release is a
// shape break — the sync script is the only legal source.
//
// `booking` and `humble-bundle` were removed when caps-spec deprecated
// those programs upstream (the sync filters out programType=deprecated).
// `apple-phg` was added when caps-spec#45 landed.
const EXPECTED_PROGRAM_IDS = [
  "amazon-associates",
  "ebay-partner-network",
  "vercel",
  "digitalocean",
  "lemon-squeezy",
  "apple-phg",
];

describe("vendored CAPS manifest — direct-injection programs (#523 phase 1)", () => {
  test("module exports CAPS_DIRECT_INJECTION_PROGRAMS as a non-empty array", () => {
    assert.ok(Array.isArray(CAPS_DIRECT_INJECTION_PROGRAMS), "must be an array");
    assert.ok(CAPS_DIRECT_INJECTION_PROGRAMS.length > 0, "must be non-empty");
  });

  test("every entry has the required caps-spec fields", () => {
    for (const p of CAPS_DIRECT_INJECTION_PROGRAMS) {
      for (const field of REQUIRED_FIELDS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(p, field),
          `program ${p.id || "(unknown)"} missing required field "${field}"`,
        );
      }
      assert.strictEqual(
        p.programType,
        "direct-injection",
        `program ${p.id} has unexpected programType "${p.programType}" — sync must filter to direct-injection only`,
      );
      assert.ok(
        Array.isArray(p.domains) && p.domains.length > 0,
        `program ${p.id} must have a non-empty domains array`,
      );
      assert.ok(
        typeof p.param === "string" && p.param.length > 0,
        `program ${p.id} must have a non-empty param`,
      );
    }
  });

  test("program ids match the expected roster (locked-in snapshot)", () => {
    const actual = CAPS_DIRECT_INJECTION_PROGRAMS.map((p) => p.id).sort();
    const expected = [...EXPECTED_PROGRAM_IDS].sort();
    assert.deepStrictEqual(
      actual,
      expected,
      "roster differs from expected — update EXPECTED_PROGRAM_IDS in this test when the rules pipeline produces a new roster",
    );
  });

  test("all caps-spec ids are stable kebab-case identifiers", () => {
    const idShape = /^[a-z][a-z0-9-]*$/;
    for (const p of CAPS_DIRECT_INJECTION_PROGRAMS) {
      assert.match(
        p.id,
        idShape,
        `program id "${p.id}" must be lowercase kebab-case (caps-spec convention)`,
      );
    }
  });

  test("ids are unique", () => {
    const ids = CAPS_DIRECT_INJECTION_PROGRAMS.map((p) => p.id);
    const set = new Set(ids);
    assert.strictEqual(set.size, ids.length, "duplicate program ids in vendored manifest");
  });

  test("Amazon Associates carries all 6 marketplaces (consolidation invariant)", () => {
    const amazon = CAPS_DIRECT_INJECTION_PROGRAMS.find((p) => p.id === "amazon-associates");
    assert.ok(amazon, "amazon-associates must be present");
    const expectedMarketplaces = ["amazon.com", "amazon.es", "amazon.de", "amazon.fr", "amazon.it", "amazon.co.uk"];
    for (const m of expectedMarketplaces) {
      assert.ok(
        amazon.domains.includes(m),
        `amazon-associates must include marketplace ${m} — phase 2 join layer relies on this consolidation`,
      );
    }
    assert.strictEqual(amazon.param, "tag");
  });

  test("eBay Partner Network carries all 6 marketplaces", () => {
    const ebay = CAPS_DIRECT_INJECTION_PROGRAMS.find((p) => p.id === "ebay-partner-network");
    assert.ok(ebay, "ebay-partner-network must be present");
    const expectedMarketplaces = ["ebay.com", "ebay.es", "ebay.de", "ebay.co.uk", "ebay.fr", "ebay.it"];
    for (const m of expectedMarketplaces) {
      assert.ok(
        ebay.domains.includes(m),
        `ebay-partner-network must include marketplace ${m}`,
      );
    }
    assert.strictEqual(ebay.param, "campid");
  });
});
