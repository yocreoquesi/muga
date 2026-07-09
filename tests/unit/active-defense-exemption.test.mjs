/**
 * MUGA — Unit tests for isSiteFullyExempt (#1006, renamed and promoted in
 * #allowlist-full-inert).
 *
 * Originally added (as isSiteExemptFromActiveDefense) so the active-defense
 * content scripts (window.name defuser, history defuser, DOM link rewriter,
 * click rewriter) - which all gate on a single muga:history-gate event -
 * would respect the per-site whitelist. Before that fix, whitelisting a
 * domain did nothing to stop them; only fully disabling MUGA worked.
 *
 * #allowlist-full-inert promotes this to the single choke-point predicate
 * consulted by every MUGA mechanism (processUrl's JS cleaning, the DNR
 * allow-rule sync, and the active-defense gate above): a domain-only
 * whitelist entry must make MUGA fully inert on that domain, present and
 * future. This file's assertions are unchanged - they were already testing
 * the exact predicate now reused everywhere.
 *
 * The legacy `domain::disabled` blacklist per-site-pause syntax has been
 * removed entirely - a domain is exempted ONLY via a domain-only whitelist
 * entry now (see also #1053, migratePerSiteDisableToAllowlist).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSiteFullyExempt } from "../../src/lib/cleaner.js";

describe("isSiteFullyExempt — whitelist", () => {
  test("a domain-only whitelist entry exempts the exact host", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), true);
  });

  test("a domain-only whitelist entry exempts a subdomain", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteFullyExempt("shop.example.com", prefs), true);
  });

  test("a domain-only whitelist entry exempts a www-prefixed host", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteFullyExempt("www.example.com", prefs), true);
  });

  test("a www-prefixed whitelist entry exempts the bare host (normalization both ways)", () => {
    const prefs = { whitelist: ["www.example.com"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), true);
  });

  test("a param-scoped whitelist entry does NOT exempt the site", () => {
    const prefs = { whitelist: ["example.com::tag::youtuber-21"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });

  test("a wildcard param-scoped whitelist entry does NOT exempt the site", () => {
    const prefs = { whitelist: ["example.com::tag::*"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });
});

describe("isSiteFullyExempt — blacklist never exempts (legacy `::disabled` removed)", () => {
  test("a `<host>::disabled` blacklist entry no longer exempts the site", () => {
    const prefs = { blacklist: ["example.com::disabled"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });

  test("a plain blacklist domain entry does not exempt", () => {
    const prefs = { blacklist: ["example.com"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });

  test("a param-scoped blacklist entry does not exempt", () => {
    const prefs = { blacklist: ["example.com::disabled::keep"] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });
});

describe("isSiteFullyExempt — no match / defensive", () => {
  test("an unrelated domain is not exempt", () => {
    const prefs = { whitelist: ["example.com"], blacklist: ["other.com"] };
    assert.equal(isSiteFullyExempt("rt.com", prefs), false);
  });

  test("empty whitelist and blacklist arrays return false", () => {
    assert.equal(isSiteFullyExempt("example.com", { whitelist: [], blacklist: [] }), false);
  });

  test("missing whitelist/blacklist keys return false", () => {
    assert.equal(isSiteFullyExempt("example.com", {}), false);
  });

  test("missing prefs object returns false", () => {
    assert.equal(isSiteFullyExempt("example.com", undefined), false);
    assert.equal(isSiteFullyExempt("example.com", null), false);
  });

  test("empty/missing hostname returns false", () => {
    assert.equal(isSiteFullyExempt("", { whitelist: ["example.com"] }), false);
    assert.equal(isSiteFullyExempt(undefined, { whitelist: ["example.com"] }), false);
  });

  test("malformed whitelist/blacklist entries (non-string) do not throw", () => {
    const prefs = { whitelist: [null, 123, undefined], blacklist: [null, 123] };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });

  test("non-array whitelist/blacklist are treated as empty", () => {
    const prefs = { whitelist: "example.com", blacklist: "example.com" };
    assert.equal(isSiteFullyExempt("example.com", prefs), false);
  });
});
