/**
 * MUGA — Benchmark AdGuard adapter (#506 phase 2c).
 *
 * Pins the parsing + strip behaviour of the AdGuard URL Tracking
 * Protection adapter against the vendored snapshot of filter #17.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  adguardAdapter,
  _parseStats,
  _rulesForTests,
  _parseRuleForTests,
} from "../../tests/benchmark/competitors/adguard.mjs";

describe("AdGuard adapter — contract", () => {
  test("exports the documented adapter shape", () => {
    assert.equal(typeof adguardAdapter, "object");
    assert.equal(adguardAdapter.name, "adguard");
    assert.equal(typeof adguardAdapter.label, "string");
    assert.match(adguardAdapter.source, /filters\.adtidy\.org/);
    assert.equal(typeof adguardAdapter.clean, "function");
  });

  test("snapshot parses a substantial number of rules (sanity)", () => {
    // Filter 17 has ~2500 removeparam rules. We tolerate a wide range
    // here so a refresh that gains/loses a few hundred rules doesn't
    // fail the test, but a wholesale parse breakage (only generic
    // rules surviving) does.
    assert.ok(_parseStats.parsed > 1500,
      `expected >1500 parsed rules, got ${_parseStats.parsed} of ${_parseStats.total}`);
    // Skip rate should be moderate — most filter rules are in scope.
    const skipRate = _parseStats.skipped / _parseStats.total;
    assert.ok(skipRate < 0.4,
      `expected <40% skip rate, got ${(skipRate * 100).toFixed(1)}% (skipped ${_parseStats.skipped})`);
  });
});

describe("AdGuard adapter — parser shape", () => {
  test("generic plain rule: $removeparam=NAME", () => {
    const r = _parseRuleForTests("$removeparam=utm_source");
    assert.ok(r);
    assert.deepStrictEqual(r.domains, []);
    assert.deepStrictEqual(r.invertDomains, []);
    assert.equal(r.paramSpec.type, "name");
    assert.equal(r.paramSpec.name, "utm_source");
  });

  test("domain-scoped plain rule: ||example.com^$removeparam=NAME", () => {
    const r = _parseRuleForTests("||example.com^$removeparam=foo");
    assert.ok(r);
    assert.deepStrictEqual(r.domains, ["example.com"]);
    assert.equal(r.paramSpec.name, "foo");
  });

  test("strip-all on domain: ||example.com^$removeparam", () => {
    const r = _parseRuleForTests("||example.com^$removeparam");
    assert.ok(r);
    assert.deepStrictEqual(r.domains, ["example.com"]);
    assert.equal(r.paramSpec.type, "all");
  });

  test("regex param spec: $removeparam=/^utm_/", () => {
    const r = _parseRuleForTests("$removeparam=/^utm_/");
    assert.ok(r);
    assert.equal(r.paramSpec.type, "regex");
    assert.match("utm_source", r.paramSpec.regex);
    assert.doesNotMatch("source", r.paramSpec.regex);
  });

  test("domain= modifier: $removeparam=NAME,domain=foo.com|bar.com", () => {
    const r = _parseRuleForTests("$removeparam=tag,domain=foo.com|bar.com");
    assert.ok(r);
    assert.deepStrictEqual(r.domains.sort(), ["bar.com", "foo.com"]);
  });

  test("inverted domain: domain=~excluded.com|target.com", () => {
    const r = _parseRuleForTests("$removeparam=x,domain=~excluded.com|target.com");
    assert.ok(r);
    assert.deepStrictEqual(r.domains, ["target.com"]);
    assert.deepStrictEqual(r.invertDomains, ["excluded.com"]);
  });

  test("comments + cosmetic rules are skipped", () => {
    assert.equal(_parseRuleForTests("! a comment"), null);
    assert.equal(_parseRuleForTests("  ! also a comment"), null);
    assert.equal(_parseRuleForTests("example.com##.ad-class"), null);
    assert.equal(_parseRuleForTests("example.com#?#.ad-class"), null);
  });

  test("resource-type modifiers are skipped (out of scope)", () => {
    // These rules apply to specific request types (XHR, etc.), not to
    // URL navigation. The adapter must not include them.
    assert.equal(_parseRuleForTests("||example.com/api/$removeparam=t,xmlhttprequest"), null);
    assert.equal(_parseRuleForTests("||example.com^$removeparam=t,script"), null);
  });

  test("path-scoped patterns are skipped (out of scope)", () => {
    assert.equal(_parseRuleForTests("||example.com/specific/path/$removeparam=foo"), null);
  });

  test("invert param syntax (~name) is skipped", () => {
    assert.equal(_parseRuleForTests("$removeparam=~allowed"), null);
  });
});

describe("AdGuard adapter — strip behavior", () => {
  test("invalid URL passes through unchanged", () => {
    assert.equal(adguardAdapter.clean("not a url"), "not a url");
  });

  test("non-http(s) protocol passes through unchanged", () => {
    assert.equal(
      adguardAdapter.clean("ftp://example.com/path"),
      "ftp://example.com/path",
    );
  });

  test("strips utm_source on a generic URL via filter #17", () => {
    // Filter 17 has generic removeparam rules for the utm_* family.
    const raw = "https://example.com/page?utm_source=email&utm_medium=link&keep=me";
    const out = adguardAdapter.clean(raw);
    const u = new URL(out);
    assert.ok(!u.searchParams.has("utm_source"), "utm_source should be stripped");
    assert.ok(!u.searchParams.has("utm_medium"), "utm_medium should be stripped");
    assert.equal(u.searchParams.get("keep"), "me");
  });

  test("strips fbclid", () => {
    const raw = "https://example.com/page?fbclid=ABC123";
    const out = adguardAdapter.clean(raw);
    assert.ok(!out.includes("fbclid"), `fbclid should be stripped from ${out}`);
  });

  test("clean is pure — same input produces same output", () => {
    const raw = "https://example.com/page?utm_source=x&keep=me";
    assert.equal(adguardAdapter.clean(raw), adguardAdapter.clean(raw));
  });

  test("clean does not throw on adversarial inputs", () => {
    const inputs = [
      "https://example.com/" + "x".repeat(5000),
      "https://example.com/?" + "a=b&".repeat(500),
      "https://example.com/?x=" + "%00".repeat(100),
    ];
    for (const raw of inputs) {
      assert.doesNotThrow(() => adguardAdapter.clean(raw));
    }
  });
});
