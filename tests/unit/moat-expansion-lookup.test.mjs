/**
 * MUGA — moat-expansion lookup-table tests (#793).
 *
 * Verifies the shape and minimum seed set of KNOWN_PROGRAMS.
 * Every entry must have:
 *   - programId: non-empty string
 *   - domains: non-empty array of non-empty strings
 *   - note: non-empty string
 *
 * At minimum: amazon, ebay, aliexpress entries must exist (v1 seed).
 * No upstream content is asserted — shape and presence only.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { KNOWN_PROGRAMS } from "../../tools/moat-expansion/lookup-table.mjs";

describe("KNOWN_PROGRAMS — shape invariants", () => {
  test("exports KNOWN_PROGRAMS as a plain object", () => {
    assert.ok(
      KNOWN_PROGRAMS !== null &&
        typeof KNOWN_PROGRAMS === "object" &&
        !Array.isArray(KNOWN_PROGRAMS),
      "KNOWN_PROGRAMS must be a plain object"
    );
  });

  test("has at least the v1 minimum seed keys: amazon, ebay, aliexpress", () => {
    assert.ok("amazon" in KNOWN_PROGRAMS, "amazon key must be present");
    assert.ok("ebay" in KNOWN_PROGRAMS, "ebay key must be present");
    assert.ok("aliexpress" in KNOWN_PROGRAMS, "aliexpress key must be present");
  });

  test("every entry has a non-empty string programId", () => {
    for (const [key, entry] of Object.entries(KNOWN_PROGRAMS)) {
      assert.strictEqual(
        typeof entry.programId,
        "string",
        `entry "${key}".programId must be a string`
      );
      assert.ok(
        entry.programId.length > 0,
        `entry "${key}".programId must not be empty`
      );
    }
  });

  test("every entry has a non-empty array of non-empty string domains", () => {
    for (const [key, entry] of Object.entries(KNOWN_PROGRAMS)) {
      assert.ok(
        Array.isArray(entry.domains),
        `entry "${key}".domains must be an array`
      );
      assert.ok(
        entry.domains.length > 0,
        `entry "${key}".domains must not be empty`
      );
      for (const domain of entry.domains) {
        assert.strictEqual(
          typeof domain,
          "string",
          `entry "${key}".domains must contain strings`
        );
        assert.ok(
          domain.length > 0,
          `entry "${key}".domains must not contain empty strings`
        );
      }
    }
  });

  test("every entry has a non-empty string note", () => {
    for (const [key, entry] of Object.entries(KNOWN_PROGRAMS)) {
      assert.strictEqual(
        typeof entry.note,
        "string",
        `entry "${key}".note must be a string`
      );
      assert.ok(
        entry.note.length > 0,
        `entry "${key}".note must not be empty`
      );
    }
  });

  test("amazon entry maps to amazon-associates program", () => {
    const amazon = KNOWN_PROGRAMS["amazon"];
    assert.strictEqual(
      amazon.programId,
      "amazon-associates",
      "amazon programId must be amazon-associates"
    );
    assert.ok(
      amazon.domains.includes("amazon.com"),
      "amazon domains must include amazon.com"
    );
  });

  test("ebay entry maps to ebay-partner-network program", () => {
    const ebay = KNOWN_PROGRAMS["ebay"];
    assert.strictEqual(
      ebay.programId,
      "ebay-partner-network",
      "ebay programId must be ebay-partner-network"
    );
    assert.ok(
      ebay.domains.includes("ebay.com"),
      "ebay domains must include ebay.com"
    );
  });

  test("aliexpress entry is present with valid shape", () => {
    const ali = KNOWN_PROGRAMS["aliexpress"];
    assert.ok(typeof ali.programId === "string" && ali.programId.length > 0);
    assert.ok(Array.isArray(ali.domains) && ali.domains.length > 0);
    assert.ok(typeof ali.note === "string" && ali.note.length > 0);
  });

  test("all v1 seed entries present: awin, impact, cj", () => {
    assert.ok("awin" in KNOWN_PROGRAMS, "awin key must be present");
    assert.ok("impact" in KNOWN_PROGRAMS, "impact key must be present");
    assert.ok("cj" in KNOWN_PROGRAMS, "cj key must be present");
  });
});
