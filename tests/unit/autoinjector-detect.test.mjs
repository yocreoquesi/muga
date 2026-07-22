/**
 * MUGA — Auto-injector dual-key detection predicate (affiliate-autoinject-notice)
 *
 * Distinguishes a platform that auto-injects its OWN affiliate tag onto every
 * outbound link (e.g. forocoches.com/link.php?url=... -> amazon.es/?tag=eleinst-21)
 * from a genuine creator who posted their own affiliate link through the same
 * platform. The predicate only fires when BOTH keys match:
 *   1. document.referrer host is a known auto-injector's injectorHosts, AND
 *   2. the landing URL's affiliate param value EXACTLY equals one of that
 *      entry's knownTags.
 *
 * The genuine-creator negative (same referrer, a value NOT in knownTags) is
 * the headline test — it is the entire reason this predicate is dual-keyed
 * instead of referrer-only. It must never go green falsely.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AUTOINJECTOR_PATTERNS,
  getAutoInjectorForReferrer,
  detectAutoInjectedTag,
} from "../../src/lib/redirect-networks.js";

describe("AUTOINJECTOR_PATTERNS — data shape", () => {
  test("is deep-frozen", () => {
    assert.ok(Object.isFrozen(AUTOINJECTOR_PATTERNS), "outer array must be frozen");
    assert.ok(Object.isFrozen(AUTOINJECTOR_PATTERNS[0]), "entries must be frozen");
    assert.ok(Object.isFrozen(AUTOINJECTOR_PATTERNS[0].injectorHosts), "injectorHosts must be frozen");
    assert.ok(Object.isFrozen(AUTOINJECTOR_PATTERNS[0].knownTags), "knownTags must be frozen");
  });

  test("contains the Forocoches seed entry, isomorphic to REDIRECT_NETWORK_PATTERNS shape", () => {
    const entry = AUTOINJECTOR_PATTERNS.find((e) => e.id === "forocoches");
    assert.ok(entry, "forocoches entry must exist");
    assert.equal(entry.platform, "Forocoches");
    assert.deepEqual(entry.injectorHosts, ["forocoches.com"]);
    assert.equal(entry.merchantDomain, "amazon.es");
    assert.equal(entry.param, "tag");
    assert.deepEqual(entry.knownTags, ["eleinst-21"]);
    assert.ok(Array.isArray(entry.references) && entry.references.length > 0);
    assert.ok(typeof entry.notes === "string" && entry.notes.length > 0);
  });
});

describe("getAutoInjectorForReferrer — accessor", () => {
  test("returns the entry for a known injector host", () => {
    const entry = getAutoInjectorForReferrer("forocoches.com");
    assert.ok(entry);
    assert.equal(entry.id, "forocoches");
  });

  test("returns null for an unknown host", () => {
    assert.equal(getAutoInjectorForReferrer("youtube.com"), null);
  });

  test("returns null for missing/empty input", () => {
    assert.equal(getAutoInjectorForReferrer(""), null);
    assert.equal(getAutoInjectorForReferrer(null), null);
    assert.equal(getAutoInjectorForReferrer(undefined), null);
  });
});

describe("detectAutoInjectedTag — dual-key predicate", () => {
  test("Scenario: known auto-injector fires (POSITIVE)", () => {
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://forocoches.com/forums/showthread.php?t=123",
      new URLSearchParams("tag=eleinst-21"),
    );
    assert.ok(result, "must detect the known platform tag");
    assert.equal(result.platform, "Forocoches");
    assert.equal(result.param, "tag");
    assert.equal(result.value, "eleinst-21");
    assert.equal(result.merchantDomain, "amazon.es");
    assert.equal(result.scopedBlacklistEntry, "amazon.es::tag::eleinst-21");
  });

  test("Scenario: genuine creator tag on the SAME referrer is NEVER flagged (headline NEGATIVE)", () => {
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://forocoches.com/forums/showthread.php?t=123",
      new URLSearchParams("tag=youtuber-21"),
    );
    assert.equal(result, null, "a genuine creator's own tag must never be flagged");
  });

  test("Scenario: known injector referrer with no tag param", () => {
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://forocoches.com/forums/showthread.php?t=123",
      new URLSearchParams(""),
    );
    assert.equal(result, null);
  });

  test("Scenario: known injector referrer with an out-of-list tag value", () => {
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://forocoches.com/forums/showthread.php?t=123",
      new URLSearchParams("tag=some-other-value"),
    );
    assert.equal(result, null);
  });

  test("Scenario: known tag value WITHOUT the injector referrer (referrer-only negative)", () => {
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://youtube.com/watch?v=abc",
      new URLSearchParams("tag=eleinst-21"),
    );
    assert.equal(result, null, "referrer-host key is missing — must not match on tag value alone");
  });

  test("Scenario: direct navigation, no referrer at all", () => {
    const result = detectAutoInjectedTag("amazon.es", "", new URLSearchParams("tag=eleinst-21"));
    assert.equal(result, null);
    assert.equal(detectAutoInjectedTag("amazon.es", null, new URLSearchParams("tag=eleinst-21")), null);
    assert.equal(detectAutoInjectedTag("amazon.es", undefined, new URLSearchParams("tag=eleinst-21")), null);
  });

  test("Scenario: malformed input fails closed, never throws", () => {
    assert.doesNotThrow(() => {
      assert.equal(detectAutoInjectedTag("amazon.es", "not a valid url::::", new URLSearchParams("tag=eleinst-21")), null);
      assert.equal(detectAutoInjectedTag(null, "https://forocoches.com/x", new URLSearchParams("tag=eleinst-21")), null);
      assert.equal(detectAutoInjectedTag("amazon.es", "https://forocoches.com/x", null), null);
      assert.equal(detectAutoInjectedTag(undefined, undefined, undefined), null);
    });
  });

  test("Scenario: APPEND case — poster tag + platform tag both present flags/scopes ONLY the platform tag", () => {
    const params = new URLSearchParams();
    params.set("tag", "eleinst-21");
    // Simulate append mode: a second, unrelated custom param carrying the poster's
    // own reference stays out of scopedBlacklistEntry entirely (different param name).
    params.set("ref", "posterref-99");
    const result = detectAutoInjectedTag(
      "amazon.es",
      "https://forocoches.com/forums/showthread.php?t=123",
      params,
    );
    assert.ok(result);
    assert.equal(result.value, "eleinst-21");
    assert.ok(!result.scopedBlacklistEntry.includes("posterref-99"), "poster's own ref must never appear in the scoped entry");
  });

  test("accepts a plain object with a get() method (URL.searchParams-like) as well as URLSearchParams", () => {
    const fakeParams = { get: (k) => (k === "tag" ? "eleinst-21" : null) };
    const result = detectAutoInjectedTag("amazon.es", "https://forocoches.com/x", fakeParams);
    assert.ok(result);
    assert.equal(result.value, "eleinst-21");
  });
});
