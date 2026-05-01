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
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRemoveparamRules } from "../../tools/import-upstream.mjs";

describe("parseRemoveparamRules", () => {
  test("extracts a simple removeparam rule", () => {
    const text = "*$removeparam=fbclid";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result], ["fbclid"]);
  });

  test("splits pipe-separated multi-param rules", () => {
    const text = "*$removeparam=fbclid|gclid|msclkid";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result].sort(), ["fbclid", "gclid", "msclkid"]);
  });

  test("handles host-scoped rules (||example.com^)", () => {
    const text = "||example.com^$removeparam=utm_source";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result], ["utm_source"]);
  });

  test("skips regex specs that start with /", () => {
    const text = "*$removeparam=/^utm_/";
    const result = parseRemoveparamRules(text);
    assert.equal(result.size, 0);
  });

  test("skips negation specs that start with ~", () => {
    const text = "*$removeparam=~tag";
    const result = parseRemoveparamRules(text);
    assert.equal(result.size, 0);
  });

  test("ignores comment lines starting with !", () => {
    const text = "! this is a comment\n*$removeparam=fbclid";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result], ["fbclid"]);
  });

  test("ignores section header lines starting with [", () => {
    const text = "[Adblock Plus 2.0]\n*$removeparam=fbclid";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result], ["fbclid"]);
  });

  test("lowercases all param names", () => {
    const text = "*$removeparam=FBclid|GCLID";
    const result = parseRemoveparamRules(text);
    assert.deepEqual([...result].sort(), ["fbclid", "gclid"]);
  });

  test("returns an empty set for empty input", () => {
    assert.equal(parseRemoveparamRules("").size, 0);
    assert.equal(parseRemoveparamRules("\n\n").size, 0);
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
    const result = parseRemoveparamRules(text);
    assert.deepEqual(
      [...result].sort(),
      ["dclid", "fbclid", "gclid", "gclsrc", "utm_medium", "utm_source"]
    );
  });

  test("rejects malformed param names containing illegal characters", () => {
    const text = "*$removeparam=foo bar|baz<script>";
    const result = parseRemoveparamRules(text);
    // Neither matches the conservative validator regex; both are rejected.
    assert.equal(result.size, 0);
  });

  test("ignores lines with no $removeparam modifier", () => {
    const text = "||tracker.example.com^\n*$third-party";
    const result = parseRemoveparamRules(text);
    assert.equal(result.size, 0);
  });
});
