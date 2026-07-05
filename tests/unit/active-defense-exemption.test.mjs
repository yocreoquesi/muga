/**
 * MUGA — Unit tests for isSiteExemptFromActiveDefense (#1006).
 *
 * The active-defense content scripts (window.name defuser, history defuser,
 * DOM link rewriter, click rewriter) all gate on a single muga:history-gate
 * event. Before this fix that gate ignored the per-site whitelist and the
 * per-site pause (#995), so whitelisting or pausing a domain did nothing to
 * stop them - only fully disabling MUGA worked. isSiteExemptFromActiveDefense
 * is the pure helper that decides whether a hostname should be exempt from
 * those scripts given the current prefs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSiteExemptFromActiveDefense } from "../../src/lib/cleaner.js";

describe("isSiteExemptFromActiveDefense — whitelist", () => {
  test("a domain-only whitelist entry exempts the exact host", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), true);
  });

  test("a domain-only whitelist entry exempts a subdomain", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteExemptFromActiveDefense("shop.example.com", prefs), true);
  });

  test("a domain-only whitelist entry exempts a www-prefixed host", () => {
    const prefs = { whitelist: ["example.com"] };
    assert.equal(isSiteExemptFromActiveDefense("www.example.com", prefs), true);
  });

  test("a www-prefixed whitelist entry exempts the bare host (normalization both ways)", () => {
    const prefs = { whitelist: ["www.example.com"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), true);
  });

  test("a param-scoped whitelist entry does NOT exempt the site", () => {
    const prefs = { whitelist: ["example.com::tag::youtuber-21"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });

  test("a wildcard param-scoped whitelist entry does NOT exempt the site", () => {
    const prefs = { whitelist: ["example.com::tag::*"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });
});

describe("isSiteExemptFromActiveDefense — per-site pause (#995)", () => {
  test("a `<host>::disabled` blacklist entry exempts the site", () => {
    const prefs = { blacklist: ["example.com::disabled"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), true);
  });

  test("a `<host>::disabled` entry exempts a subdomain of the paused host", () => {
    const prefs = { blacklist: ["example.com::disabled"] };
    assert.equal(isSiteExemptFromActiveDefense("shop.example.com", prefs), true);
  });

  test("a `disabled`-valued entry (domain::disabled::x) is not a pause and does not exempt", () => {
    const prefs = { blacklist: ["example.com::disabled::keep"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });

  test("a plain blacklist domain entry (no ::disabled) does not exempt", () => {
    const prefs = { blacklist: ["example.com"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });
});

describe("isSiteExemptFromActiveDefense — no match / defensive", () => {
  test("an unrelated domain is not exempt", () => {
    const prefs = { whitelist: ["example.com"], blacklist: ["other.com::disabled"] };
    assert.equal(isSiteExemptFromActiveDefense("rt.com", prefs), false);
  });

  test("empty whitelist and blacklist arrays return false", () => {
    assert.equal(isSiteExemptFromActiveDefense("example.com", { whitelist: [], blacklist: [] }), false);
  });

  test("missing whitelist/blacklist keys return false", () => {
    assert.equal(isSiteExemptFromActiveDefense("example.com", {}), false);
  });

  test("missing prefs object returns false", () => {
    assert.equal(isSiteExemptFromActiveDefense("example.com", undefined), false);
    assert.equal(isSiteExemptFromActiveDefense("example.com", null), false);
  });

  test("empty/missing hostname returns false", () => {
    assert.equal(isSiteExemptFromActiveDefense("", { whitelist: ["example.com"] }), false);
    assert.equal(isSiteExemptFromActiveDefense(undefined, { whitelist: ["example.com"] }), false);
  });

  test("malformed whitelist/blacklist entries (non-string) do not throw", () => {
    const prefs = { whitelist: [null, 123, undefined], blacklist: [null, 123] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });

  test("non-array whitelist/blacklist are treated as empty", () => {
    const prefs = { whitelist: "example.com", blacklist: "example.com::disabled" };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), false);
  });
});

describe("isSiteExemptFromActiveDefense — combined signals", () => {
  test("either signal alone is sufficient", () => {
    const prefs = { whitelist: [], blacklist: ["example.com::disabled"] };
    assert.equal(isSiteExemptFromActiveDefense("example.com", prefs), true);
  });

  test("whitelist and pause for different domains both work independently", () => {
    const prefs = { whitelist: ["a.com"], blacklist: ["b.com::disabled"] };
    assert.equal(isSiteExemptFromActiveDefense("a.com", prefs), true);
    assert.equal(isSiteExemptFromActiveDefense("b.com", prefs), true);
    assert.equal(isSiteExemptFromActiveDefense("c.com", prefs), false);
  });
});
