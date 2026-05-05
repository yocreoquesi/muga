/**
 * MUGA — Benchmark Firefox built-in adapter (#506 phase 2e).
 *
 * Pins the strip behaviour of the Firefox URL Query Stripping
 * adapter against the vendored snapshot of Firefox's Remote
 * Settings query-stripping collection.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  firefoxAdapter,
  _stripListForTests,
  _allowListForTests,
} from "../../tests/benchmark/competitors/firefox.mjs";

describe("Firefox adapter — contract", () => {
  test("exports the documented adapter shape", () => {
    assert.equal(typeof firefoxAdapter, "object");
    assert.equal(firefoxAdapter.name, "firefox");
    assert.equal(typeof firefoxAdapter.label, "string");
    assert.match(firefoxAdapter.source, /firefox\.settings\.services\.mozilla\.com/);
    assert.equal(typeof firefoxAdapter.clean, "function");
  });

  test("snapshot loaded with a non-empty stripList", () => {
    assert.ok(_stripListForTests.size > 0,
      "expected the vendored Firefox query-stripping snapshot to load at least one param");
    // Firefox's list is intentionally conservative — anywhere from
    // ~10 to a few dozen params depending on the snapshot vintage.
    assert.ok(_stripListForTests.size > 10,
      `expected >10 strip params from data/firefox.json, got ${_stripListForTests.size}`);
  });

  test("known canonical entries are present", () => {
    // These have been on Firefox's strip list for years and are
    // very unlikely to disappear. If a refresh removes one of them,
    // we want to know.
    for (const expected of ["fbclid", "gclid", "mc_eid"]) {
      assert.ok(_stripListForTests.has(expected),
        `Firefox stripList should contain "${expected}"`);
    }
  });

  test("allowList is loaded", () => {
    // googleadservices.com has been in the allowList for a while —
    // it's the click-tracking host Firefox suppresses stripping on.
    assert.ok(_allowListForTests.size > 0, "allowList must load at least one entry");
  });
});

describe("Firefox adapter — strip behavior", () => {
  test("invalid URL passes through unchanged", () => {
    assert.equal(firefoxAdapter.clean("not a url"), "not a url");
  });

  test("non-http(s) protocol passes through unchanged", () => {
    assert.equal(
      firefoxAdapter.clean("ftp://example.com/path"),
      "ftp://example.com/path",
    );
  });

  test("strips fbclid on a generic URL", () => {
    const out = firefoxAdapter.clean("https://example.com/page?fbclid=ABC");
    assert.ok(!out.includes("fbclid"));
  });

  test("strips gclid on a generic URL", () => {
    const out = firefoxAdapter.clean("https://example.com/page?gclid=XYZ");
    assert.ok(!out.includes("gclid"));
  });

  test("does NOT strip params NOT on the Firefox list (utm_source is NOT in Firefox's list — narrower than ClearURLs/AdGuard)", () => {
    // Firefox's list does NOT include utm_source historically. This
    // test pins that conservatism; if a future refresh adds it, the
    // test loosens to assert.ok(_stripListForTests.has('utm_source'))
    // OR the URL is cleaned. Update both branches in lockstep.
    const raw = "https://example.com/page?utm_source=email";
    if (_stripListForTests.has("utm_source")) {
      assert.ok(!firefoxAdapter.clean(raw).includes("utm_source"),
        "utm_source is now in Firefox's stripList — adapter should strip it");
    } else {
      assert.equal(firefoxAdapter.clean(raw), raw,
        "Firefox's list omits utm_source; adapter should leave it alone");
    }
  });

  test("non-tracking params are preserved", () => {
    const raw = "https://example.com/page?gclid=ABC&keep=me&id=12";
    const out = firefoxAdapter.clean(raw);
    const u = new URL(out);
    assert.ok(!u.searchParams.has("gclid"), "gclid should be stripped");
    assert.equal(u.searchParams.get("keep"), "me");
    assert.equal(u.searchParams.get("id"), "12");
  });

  test("allowList suppresses stripping on a matched host", () => {
    // The allowList is verbatim host suffix-matched. googleadservices.com
    // is the canonical entry; a click on a googleadservices.com URL
    // must NOT be stripped (preserves Google Ads click-tracking that
    // would otherwise break attribution per Mozilla's design).
    const raw = "https://www.googleadservices.com/pagead/aclk?gclid=DONOTSTRIP";
    assert.equal(firefoxAdapter.clean(raw), raw,
      "URLs on the allowList must pass through unchanged");
  });

  test("clean is pure — same input produces same output", () => {
    const raw = "https://example.com/page?gclid=x&keep=me";
    assert.equal(firefoxAdapter.clean(raw), firefoxAdapter.clean(raw));
  });

  test("clean does not throw on adversarial inputs", () => {
    const inputs = [
      "https://example.com/" + "x".repeat(5000),
      "https://example.com/?" + "a=b&".repeat(500),
    ];
    for (const raw of inputs) {
      assert.doesNotThrow(() => firefoxAdapter.clean(raw));
    }
  });
});
