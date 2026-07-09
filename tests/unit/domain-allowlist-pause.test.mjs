/**
 * MUGA — Unit tests for the domain-allowlist pause helpers (#1053).
 *
 * The popup's per-site "Pause" control (#980/#995) used to write a
 * `<host>::disabled` blacklist entry. #1053 repoints it to a bare
 * domain-only whitelist entry - the same mechanism Settings > Allowlist
 * uses - so a paused site shows up in the allowlist and a manually
 * whitelisted site correctly reads as "paused" in the popup.
 *
 * setDomainAllowlisted adds/removes that bare domain entry. Pure: returns a
 * new array, never mutates the input. isDomainAllowlisted is the read-side
 * predicate the popup uses to compute the paused state. domainMatches is the
 * shared host-vs-entry matcher reused by both.
 *
 * The legacy `::disabled` blacklist syntax is untouched by this change -
 * see tests/unit/active-defense-exemption.test.mjs, which still exercises
 * isSiteFullyExempt's `::disabled` branch unchanged.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setDomainAllowlisted, isDomainAllowlisted, domainMatches } from "../../src/lib/cleaner.js";

describe("domainMatches", () => {
  test("exact host matches entry domain", () => {
    assert.equal(domainMatches("example.com", "example.com"), true);
  });
  test("subdomain matches parent entry domain", () => {
    assert.equal(domainMatches("shop.example.com", "example.com"), true);
  });
  test("www is stripped from the host before matching", () => {
    assert.equal(domainMatches("www.example.com", "example.com"), true);
  });
  test("unrelated host does not match", () => {
    assert.equal(domainMatches("evil.com", "example.com"), false);
  });
  test("partial-suffix trap does not match (notexample.com vs example.com)", () => {
    assert.equal(domainMatches("notexample.com", "example.com"), false);
  });
});

describe("setDomainAllowlisted — pause (add)", () => {
  test("appends the bare domain when the site is not allowlisted", () => {
    assert.deepEqual(setDomainAllowlisted([], "example.com", true), ["example.com"]);
  });
  test("normalizes www + case in the stored entry", () => {
    assert.deepEqual(setDomainAllowlisted([], "www.Example.COM", true), ["example.com"]);
  });
  test("no-op when the exact host is already allowlisted", () => {
    const wl = ["example.com"];
    assert.deepEqual(setDomainAllowlisted(wl, "example.com", true), wl);
  });
  test("no-op when a parent domain already allowlists the host", () => {
    const wl = ["example.com"];
    assert.deepEqual(setDomainAllowlisted(wl, "shop.example.com", true), wl);
  });
  test("keeps existing unrelated entries and appends when a different domain is present", () => {
    const wl = ["other.com", "amazon.com::tag::x-21"];
    assert.deepEqual(setDomainAllowlisted(wl, "example.com", true), [...wl, "example.com"]);
  });
  test("empty/blank host returns the list unchanged", () => {
    const wl = ["a.com"];
    assert.deepEqual(setDomainAllowlisted(wl, "", true), wl);
    assert.deepEqual(setDomainAllowlisted(wl, "   ", true), wl);
  });
  test("a non-array whitelist is treated as empty (add path)", () => {
    assert.deepEqual(setDomainAllowlisted(undefined, "example.com", true), ["example.com"]);
  });
});

describe("setDomainAllowlisted — resume (remove)", () => {
  test("removes the exact bare-domain entry", () => {
    assert.deepEqual(setDomainAllowlisted(["example.com"], "example.com", false), []);
  });
  test("removes a parent-domain entry that allowlists the host", () => {
    assert.deepEqual(setDomainAllowlisted(["example.com"], "shop.example.com", false), []);
  });
  test("preserves param-scoped entries for the same domain", () => {
    const wl = ["example.com", "example.com::tag::x"];
    assert.deepEqual(setDomainAllowlisted(wl, "example.com", false), ["example.com::tag::x"]);
  });
  test("leaves unrelated plain domains untouched", () => {
    const wl = ["other.com", "example.com"];
    assert.deepEqual(setDomainAllowlisted(wl, "example.com", false), ["other.com"]);
  });
  test("no-op when the host is not allowlisted", () => {
    const wl = ["other.com"];
    const out = setDomainAllowlisted(wl, "example.com", false);
    assert.deepEqual(out, wl);
    assert.notStrictEqual(out, wl);
  });
  test("resume with an empty host leaves the list unchanged", () => {
    const wl = ["a.com"];
    assert.deepEqual(setDomainAllowlisted(wl, "", false), wl);
  });
});

describe("setDomainAllowlisted — purity", () => {
  test("does not mutate the input array", () => {
    const wl = ["example.com"];
    const copy = [...wl];
    setDomainAllowlisted(wl, "example.com", false);
    setDomainAllowlisted(wl, "other.com", true);
    assert.deepEqual(wl, copy);
  });
});

describe("setDomainAllowlisted — defensive against malformed entries", () => {
  test("malformed (non-string) entries do not throw on the remove path", () => {
    assert.deepEqual(
      setDomainAllowlisted([null, 42, "example.com"], "example.com", false),
      [null, 42],
    );
  });
  test("malformed (non-string) entries do not throw on the add path", () => {
    assert.deepEqual(
      setDomainAllowlisted([null, 42], "example.com", true),
      [null, 42, "example.com"],
    );
  });
});

describe("isDomainAllowlisted", () => {
  test("true for an exact domain-only match", () => {
    assert.equal(isDomainAllowlisted("example.com", ["example.com"]), true);
  });
  test("true for a subdomain of a domain-only entry", () => {
    assert.equal(isDomainAllowlisted("shop.example.com", ["example.com"]), true);
  });
  test("true for a www-prefixed host against a bare entry", () => {
    assert.equal(isDomainAllowlisted("www.example.com", ["example.com"]), true);
  });
  test("false for a param-scoped-only entry", () => {
    assert.equal(isDomainAllowlisted("example.com", ["example.com::tag::x"]), false);
  });
  test("false when no entry matches", () => {
    assert.equal(isDomainAllowlisted("example.com", ["other.com"]), false);
  });
  test("false for empty/falsy hostname", () => {
    assert.equal(isDomainAllowlisted("", ["example.com"]), false);
    assert.equal(isDomainAllowlisted(null, ["example.com"]), false);
  });
  test("false for a non-array whitelist", () => {
    assert.equal(isDomainAllowlisted("example.com", undefined), false);
    assert.equal(isDomainAllowlisted("example.com", null), false);
  });
  test("false for malformed entries in the array (does not throw)", () => {
    assert.equal(isDomainAllowlisted("example.com", [null, 42, "example.com"]), true);
  });
});
