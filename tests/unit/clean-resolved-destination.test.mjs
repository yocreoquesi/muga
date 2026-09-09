/**
 * MUGA — Unit tests for cleanResolvedDestination (#1264)
 *
 * Run with: npm test
 *
 * The headline tests drive the REAL cleaning pipeline (processUrl with the
 * real domain and path rules), not a stub, because the whole defect was that
 * the resolved destination never reached that pipeline. A stub would assert
 * that the plumbing calls something, which is the part that was never in
 * doubt.
 *
 * The guard tests inject fakes on purpose: they describe what happens when
 * cleaning produces a value that violates a guarantee `resolveShortener` had
 * already established, and the real pipeline will not produce those on demand.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cleanResolvedDestination } from "../../src/background/clean-resolved-destination.js";
import { processUrl } from "../../src/lib/cleaner.js";
import { isPrivateHost, MAX_DESTINATION_LENGTH } from "../../src/lib/native-shortener-resolver.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");
const pathStripRules = require("../../src/rules/path-strip-rules.json");
const pathAffiliateRules = require("../../src/rules/path-affiliate-rules.json");

const PREFS = {
  enabled: true,
  onboardingDone: true,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

/**
 * The real cleaning dependency, wired the way the service worker wires
 * handleProcessUrl: full context, every rule file present.
 */
const realClean = async (url) => processUrl(
  url, PREFS, domainRules, undefined, undefined, "", pathStripRules, pathAffiliateRules
);

/** The real guards, as the service worker passes them. */
const realDeps = {
  clean: realClean,
  isPrivateHost,
  maxLength: MAX_DESTINATION_LENGTH,
};

describe("#1264 — a resolved shortener destination is cleaned before it is used", () => {

  test("a destination on a wrapper with NO DNR equivalent is unwrapped", async () => {
    // This is the defect. anonym.to is in the WRAPPERS table but is not one of
    // the two recipes (facebook-l, facebook-lm) that wrapper-dnr-builder.js
    // mirrors into DNR, so nothing at the network layer would have unwrapped
    // it. Before this change the user navigated to the anonym.to hop itself.
    const out = await cleanResolvedDestination(
      "https://anonym.to/?https://example.com/article?utm_source=newsletter",
      realDeps
    );
    assert.equal(out, "https://example.com/article",
      "the wrapper hop must be resolved away, and the tracking param with it");
  });

  test("a fromParam wrapper is unwrapped and its inner tracking stripped", async () => {
    const out = await cleanResolvedDestination(
      "https://cc.loginfra.com/?u=https%3A%2F%2Fexample.com%2Fp%3Futm_source%3Dx",
      realDeps
    );
    assert.equal(out, "https://example.com/p");
  });

  test("path rules run too, not just param stripping", async () => {
    // The second stage the JS pipeline owns. The Amazon SEO slug is removed by
    // the path rules; DNR's Amazon canonical rule is the only path behaviour
    // at the network layer, so a destination reached this way kept its slug.
    const out = await cleanResolvedDestination(
      "https://anonym.to/?https://www.amazon.es/some-product-slug/dp/B08XYZ1234?utm_source=x",
      realDeps
    );
    assert.ok(!out.includes("some-product-slug"),
      `path-strip must remove the slug, got: ${out}`);
    assert.ok(out.includes("/dp/B08XYZ1234"), "the ASIN must survive");
    assert.ok(!out.includes("utm_source"), "and the tracking param must be gone");
  });

  test("an already-clean destination comes back byte-identical", async () => {
    const clean = "https://example.com/article";
    const out = await cleanResolvedDestination(clean, realDeps);
    assert.equal(out, clean);
  });

  test("unwrapping onto a private address falls back — the SSRF guard is not escapable", async () => {
    // resolveShortener refuses a destination on a private host. Without the
    // re-check, wrapping a private address inside a public wrapper would walk
    // straight past that guard, since the host only becomes private AFTER
    // unwrapping. The pipeline really does unwrap this one, so the fallback is
    // the only thing standing between it and the caller.
    const wrapped = "https://anonym.to/?http://192.168.1.1/admin";
    const unwrapped = (await realClean(wrapped)).cleanUrl;
    assert.equal(new URL(unwrapped).hostname, "192.168.1.1",
      "precondition: the pipeline DOES unwrap this to a private host");
    assert.ok(isPrivateHost("192.168.1.1"), "precondition: that host is private");

    const out = await cleanResolvedDestination(wrapped, realDeps);
    assert.equal(out, wrapped, "must fall back to the original destination");
  });
});

describe("#1264 — every failure path returns the original destination", () => {

  const guards = { isPrivateHost, maxLength: MAX_DESTINATION_LENGTH };
  const original = "https://example.com/p";

  test("a cleaner that throws falls back, and reports through onError", async () => {
    const seen = [];
    const out = await cleanResolvedDestination(original, {
      ...guards,
      clean: async () => { throw new Error("boom"); },
      onError: (err) => seen.push(err),
    });
    assert.equal(out, original);
    assert.equal(seen.length, 1, "the failure must be reported, not swallowed silently");
    assert.equal(seen[0].message, "boom");
  });

  test("a throwing cleaner with no onError still falls back rather than rejecting", async () => {
    const out = await cleanResolvedDestination(original, {
      ...guards,
      clean: async () => { throw new Error("boom"); },
    });
    assert.equal(out, original, "onError is optional; the fallback is not");
  });

  test("a result with no usable cleanUrl falls back", async () => {
    for (const bad of [undefined, null, {}, { cleanUrl: 42 }, { cleanUrl: null }]) {
      const out = await cleanResolvedDestination(original, {
        ...guards,
        clean: async () => bad,
      });
      assert.equal(out, original, `bad result ${JSON.stringify(bad)} must fall back`);
    }
  });

  test("an unparseable cleaned URL falls back", async () => {
    const out = await cleanResolvedDestination(original, {
      ...guards,
      clean: async () => ({ cleanUrl: "not a url at all" }),
    });
    assert.equal(out, original);
  });

  test("a non-http(s) cleaned URL falls back", async () => {
    // The content script refuses anything else, so letting this through would
    // turn the click into a silent no-op instead of a navigation.
    for (const scheme of ["ftp://example.com/x", "javascript:alert(1)", "data:text/html,x"]) {
      const out = await cleanResolvedDestination(original, {
        ...guards,
        clean: async () => ({ cleanUrl: scheme }),
      });
      assert.equal(out, original, `${scheme} must never be handed back`);
    }
  });

  test("a cleaned URL over the length cap falls back", async () => {
    // navigate() returns early above the cap, so an over-long value would also
    // become a silent no-op.
    const tooLong = "https://example.com/?q=" + "a".repeat(MAX_DESTINATION_LENGTH);
    assert.ok(tooLong.length > MAX_DESTINATION_LENGTH, "precondition");
    const out = await cleanResolvedDestination(original, {
      ...guards,
      clean: async () => ({ cleanUrl: tooLong }),
    });
    assert.equal(out, original);
  });

  test("a cleaned URL exactly at the cap is accepted", async () => {
    // The boundary belongs to the accepted side: resolveShortener rejects
    // ABOVE the cap, so re-asserting it must use the same comparison.
    const base = "https://example.com/?q=";
    const exact = base + "a".repeat(MAX_DESTINATION_LENGTH - base.length);
    assert.equal(exact.length, MAX_DESTINATION_LENGTH, "precondition");
    const out = await cleanResolvedDestination(original, {
      ...guards,
      clean: async () => ({ cleanUrl: exact }),
    });
    assert.equal(out, exact, "at the cap is within the cap");
  });

  test("a non-string or empty destination is returned untouched, cleaner never called", async () => {
    let called = false;
    const clean = async () => { called = true; return { cleanUrl: "https://x.example/" }; };
    for (const bad of ["", undefined, null, 42]) {
      const out = await cleanResolvedDestination(bad, { ...guards, clean });
      assert.equal(out, bad);
    }
    assert.equal(called, false, "nothing to clean means no pipeline call at all");
  });
});
