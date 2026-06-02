/**
 * MUGA — Unit tests for tools/import-upstream.mjs
 *
 * Run with: npm test
 *
 * Coverage:
 *   - parseRemoveparamRules extracts param names from removeparam rules
 *   - Pipe-separated multi-param rules split correctly
 *   - Regex specs (starting with /) are skipped
 *   - Negation specs (starting with ~) are skipped
 *   - Comments (!) and section headers ([) are ignored
 *   - Param names are lowercased and validated
 *   - Empty input returns an empty set
 *   - (#782) returns { params, skipped } object (not a bare Set)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRemoveparamRules } from "../../tools/import-upstream.mjs";

describe("parseRemoveparamRules", () => {
  test("extracts a simple removeparam rule", () => {
    const text = "*$removeparam=fbclid";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["fbclid"]);
  });

  test("splits pipe-separated multi-param rules", () => {
    const text = "*$removeparam=fbclid|gclid|msclkid";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params].sort(), ["fbclid", "gclid", "msclkid"]);
  });

  test("handles host-scoped rules (||example.com^)", () => {
    const text = "||example.com^$removeparam=utm_source";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["utm_source"]);
  });

  test("skips regex specs that start with /", () => {
    const text = "*$removeparam=/^utm_/";
    const { params, skipped } = parseRemoveparamRules(text);
    assert.equal(params.size, 0);
    assert.ok(skipped >= 1, "regex spec must be counted as skipped");
  });

  test("skips negation specs that start with ~", () => {
    const text = "*$removeparam=~tag";
    const { params, skipped } = parseRemoveparamRules(text);
    assert.equal(params.size, 0);
    assert.ok(skipped >= 1, "negation spec must be counted as skipped");
  });

  test("ignores comment lines starting with !", () => {
    const text = "! this is a comment\n*$removeparam=fbclid";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["fbclid"]);
  });

  test("ignores section header lines starting with [", () => {
    const text = "[Adblock Plus 2.0]\n*$removeparam=fbclid";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["fbclid"]);
  });

  test("lowercases all param names", () => {
    const text = "*$removeparam=FBclid|GCLID";
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual([...params].sort(), ["fbclid", "gclid"]);
  });

  test("returns an empty set for empty input", () => {
    assert.equal(parseRemoveparamRules("").params.size, 0);
    assert.equal(parseRemoveparamRules("\n\n").params.size, 0);
  });

  test("handles realistic AdGuard Filter 17 sample correctly", () => {
    const text = `[Adblock Plus 2.0]
! Title: AdGuard URL Tracking Protection
! Description: example
||example.com^$removeparam=utm_source
||example.com^$removeparam=utm_medium
*$removeparam=fbclid
*$removeparam=gclid|gclsrc|dclid
! comment
*$removeparam=/^_branch_/
*$removeparam=~important_tag`;
    const { params } = parseRemoveparamRules(text);
    assert.deepEqual(
      [...params].sort(),
      ["dclid", "fbclid", "gclid", "gclsrc", "utm_medium", "utm_source"]
    );
  });

  test("rejects malformed param names containing illegal characters", () => {
    const text = "*$removeparam=foo bar|baz<script>";
    const { params } = parseRemoveparamRules(text);
    // Neither matches the conservative validator regex; both are rejected.
    assert.equal(params.size, 0);
  });

  test("ignores lines with no $removeparam modifier", () => {
    const text = "||tracker.example.com^\n*$third-party";
    const { params } = parseRemoveparamRules(text);
    assert.equal(params.size, 0);
  });
});
