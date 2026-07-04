/**
 * MUGA — Unit tests for the per-domain pause helper (#980).
 *
 * setPerDomainDisabled adds/removes a `<host>::disabled` blacklist entry so the
 * popup "Pause cleaning on this site" toggle can flip URL cleaning off/on for
 * the current site without opening Settings. Pure: returns a new array, never
 * mutates the input. domainMatches is the shared host-vs-entry matcher (also
 * used by the cleaner and the popup's isPerDomainDisabled read path).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setPerDomainDisabled, domainMatches } from "../../src/lib/cleaner.js";

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

describe("setPerDomainDisabled — pause (add)", () => {
  test("appends `<host>::disabled` when the site is not disabled", () => {
    assert.deepEqual(setPerDomainDisabled([], "example.com", true), ["example.com::disabled"]);
  });
  test("normalizes www + case in the stored entry", () => {
    assert.deepEqual(setPerDomainDisabled([], "www.Example.COM", true), ["example.com::disabled"]);
  });
  test("no-op when the exact host is already disabled", () => {
    const bl = ["example.com::disabled"];
    assert.deepEqual(setPerDomainDisabled(bl, "example.com", true), bl);
  });
  test("no-op when a parent domain already disables the host", () => {
    const bl = ["example.com::disabled"];
    assert.deepEqual(setPerDomainDisabled(bl, "shop.example.com", true), bl);
  });
  test("keeps existing unrelated entries when adding", () => {
    const bl = ["other.com", "amazon.com::tag::x-21"];
    assert.deepEqual(setPerDomainDisabled(bl, "example.com", true), [...bl, "example.com::disabled"]);
  });
  test("empty/blank host returns the list unchanged", () => {
    const bl = ["a.com"];
    assert.deepEqual(setPerDomainDisabled(bl, "", true), bl);
    assert.deepEqual(setPerDomainDisabled(bl, "   ", true), bl);
  });
});

describe("setPerDomainDisabled — resume (remove)", () => {
  test("removes the exact `<host>::disabled` entry", () => {
    assert.deepEqual(setPerDomainDisabled(["example.com::disabled"], "example.com", false), []);
  });
  test("removes a parent-domain entry that pauses the host", () => {
    assert.deepEqual(setPerDomainDisabled(["example.com::disabled"], "shop.example.com", false), []);
  });
  test("leaves plain blacklist domains and param rules untouched", () => {
    const bl = ["example.com", "example.com::utm_source::*", "example.com::disabled"];
    assert.deepEqual(
      setPerDomainDisabled(bl, "example.com", false),
      ["example.com", "example.com::utm_source::*"],
    );
  });
  test("a `disabled`-valued entry (domain::disabled::x) is not a pause and survives resume", () => {
    const bl = ["example.com::disabled::keep"];
    assert.deepEqual(setPerDomainDisabled(bl, "example.com", false), bl);
  });
  test("resume when nothing matches returns an equal (but new) list", () => {
    const bl = ["other.com::disabled"];
    const out = setPerDomainDisabled(bl, "example.com", false);
    assert.deepEqual(out, bl);
    assert.notStrictEqual(out, bl);
  });
  test("resume with an empty host leaves the list unchanged", () => {
    const bl = ["a.com::disabled"];
    assert.deepEqual(setPerDomainDisabled(bl, "", false), bl);
  });
});

describe("setPerDomainDisabled — purity", () => {
  test("does not mutate the input array", () => {
    const bl = ["example.com::disabled"];
    const copy = [...bl];
    setPerDomainDisabled(bl, "example.com", false);
    setPerDomainDisabled(bl, "other.com", true);
    assert.deepEqual(bl, copy);
  });
  test("a non-array blacklist is treated as empty (add path)", () => {
    assert.deepEqual(setPerDomainDisabled(undefined, "example.com", true), ["example.com::disabled"]);
  });
});
