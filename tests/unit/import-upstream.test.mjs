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

// ── Slice 2 (rules-scope-normalization): host anchor extraction (additive) ────
//
// SC-3.1 (as amended by design correction C1): an anchored line yields the
// scoped pair (param, host) IN ADDITION TO the bare global param it already
// yields today. `params`/`skipped` behaviour above must stay byte-identical;
// these tests only assert on the new `scoped` field.

describe("parseRemoveparamRules — scoped extraction (Slice 2, additive)", () => {
  test("||host^$removeparam=x yields the scoped pair AND keeps the global param (C1)", () => {
    const text = "||example.com^$removeparam=utm_source";
    const { params, scoped } = parseRemoveparamRules(text);
    // Additive: global param still flows exactly as today.
    assert.deepEqual([...params], ["utm_source"]);
    assert.deepEqual(scoped, [{ param: "utm_source", scope: "example.com" }]);
  });

  test("||host^$removeparam=a|b pairs each pipe-separated param with the same host", () => {
    const text = "||example.com^$removeparam=a|b";
    const { params, scoped } = parseRemoveparamRules(text);
    assert.deepEqual([...params].sort(), ["a", "b"]);
    assert.deepEqual(scoped, [
      { param: "a", scope: "example.com" },
      { param: "b", scope: "example.com" },
    ]);
  });

  test("$removeparam=x,domain=h1|h2 yields one scoped pair per positive host", () => {
    const text = "$removeparam=x,domain=h1.example|h2.example";
    const { scoped } = parseRemoveparamRules(text);
    assert.deepEqual(scoped, [
      { param: "x", scope: "h1.example" },
      { param: "x", scope: "h2.example" },
    ]);
  });

  test("negated domain=~host drops that host; all-negated yields no pair", () => {
    const text = "$removeparam=x,domain=h1.example|~h2.example";
    const { scoped } = parseRemoveparamRules(text);
    assert.deepEqual(scoped, [{ param: "x", scope: "h1.example" }]);

    const allNegated = "$removeparam=x,domain=~h1.example|~h2.example";
    const { scoped: scopedAllNegated } = parseRemoveparamRules(allNegated);
    assert.deepEqual(scopedAllNegated, []);
  });

  test("no anchor of either form yields no scoped pair (SC-3.4, unchanged global path)", () => {
    const text = "*$removeparam=fbclid";
    const { params, scoped } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["fbclid"]);
    assert.deepEqual(scoped, []);
  });

  test("mixed-case param and host normalize identically to the global path (obs #1513 NaPm trap)", () => {
    const text = "||Example.COM^$removeparam=NaPm";
    const { params, scoped } = parseRemoveparamRules(text);
    assert.deepEqual([...params], ["napm"]);
    assert.deepEqual(scoped, [{ param: "napm", scope: "example.com" }]);
  });

  test("@@ exception line yields no scoped pair, but the leaky global path is unchanged (C2, obs #1523)", () => {
    const text = "@@||example.com^$removeparam=utm_source";
    const { params, scoped } = parseRemoveparamRules(text);
    // Pre-existing leak (out of scope for this slice): the exception line still
    // feeds the global candidate set today. We assert it stays that way.
    assert.deepEqual([...params], ["utm_source"]);
    // The scoped path MUST skip it — inverting "preserve" into "strip" at host
    // scale is the exact defect this slice must not introduce.
    assert.deepEqual(scoped, []);
  });

  test("a line carrying BOTH ||host^ and domain= is skipped from scoped and counted in scopeSkipped", () => {
    const text = "||example.com^$removeparam=x,domain=other.example";
    const { params, scoped, scopeSkipped } = parseRemoveparamRules(text);
    // Global path is unaffected by the ambiguity — x still flows globally.
    assert.deepEqual([...params], ["x"]);
    assert.deepEqual(scoped, []);
    assert.equal(scopeSkipped, 1);
  });

  test("a host anchor with no dot (not a real host) yields no scoped pair", () => {
    const text = "||localhost^$removeparam=x";
    const { scoped } = parseRemoveparamRules(text);
    assert.deepEqual(scoped, []);
  });

  test("a wildcard host anchor (path/query-style, not a whole host) yields no scoped pair", () => {
    const text = "||google.*^$removeparam=gs_l";
    const { scoped } = parseRemoveparamRules(text);
    assert.deepEqual(scoped, []);
  });

  test("realistic sample: existing global params unchanged, anchored lines additionally scoped", () => {
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
    const { params, scoped } = parseRemoveparamRules(text);
    // Byte-identical to the pre-Slice-2 assertion (SC-3.4 regression pin).
    assert.deepEqual(
      [...params].sort(),
      ["dclid", "fbclid", "gclid", "gclsrc", "utm_medium", "utm_source"]
    );
    assert.deepEqual(scoped.sort((a, b) => a.param.localeCompare(b.param)), [
      { param: "utm_medium", scope: "example.com" },
      { param: "utm_source", scope: "example.com" },
    ]);
  });
});
