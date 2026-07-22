/**
 * MUGA — processUrl side-channel wiring for auto-injected affiliate tags
 * (affiliate-autoinject-notice).
 *
 * `detectAutoInjectedTag` must be attached to the result as `result.autoInjected`
 * WITHOUT changing cleaning behaviour at all. This is a hard invariant per
 * AGENTS.md Business Rules (Scenario C, block-on-violation): default action
 * stays KEEP, and the signal must be a pure read-only side channel — it is
 * detected but not acted upon by the cleaner itself. The dedicated invariant
 * test below proves `action`, `cleanUrl`, and `removedTracking` are byte-for-
 * byte identical whether or not a match is detected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { processUrl } from "../../src/lib/cleaner.js";
import { stripAutoInjectedTag, isAutoInjectedTagPresent } from "../../src/lib/affiliates.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const FOROCOCHES_REFERRER = "https://forocoches.com/forums/showthread.php?t=123";
const AMAZON_AUTOINJECTED_URL = "https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21";
const AMAZON_GENUINE_CREATOR_URL = "https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21";

describe("processUrl — result.autoInjected side channel", () => {
  test("attaches result.autoInjected when a known auto-injector fires", () => {
    const result = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    assert.ok(result.autoInjected, "result.autoInjected must be present");
    assert.equal(result.autoInjected.platform, "Forocoches");
    assert.equal(result.autoInjected.scopedBlacklistEntry, "amazon.es::tag::eleinst-21");
  });

  test("result.autoInjected is undefined for a genuine creator tag on the same referrer", () => {
    const result = processUrl(AMAZON_GENUINE_CREATOR_URL, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    assert.equal(result.autoInjected, undefined);
  });

  test("result.autoInjected is undefined with no referrer", () => {
    const result = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, "");
    assert.equal(result.autoInjected, undefined);
  });
});

describe("processUrl — cleaning behaviour is UNCHANGED by autoInjected detection (invariant)", () => {
  test("action, cleanUrl, and removedTracking are identical whether or not autoInjected fires", () => {
    // Same URL processed with and without the referrer that flips autoInjected
    // detection on. The Forocoches/#eleinst-21 pair is a known FOREIGN affiliate
    // tag independent of this feature (Scenario C, pre-existing), so both runs
    // already produce the same "detected_foreign" action — the point of this
    // test is that attaching autoInjected changes NOTHING about that shape.
    const withReferrer = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    const withoutReferrer = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, "");

    assert.equal(withReferrer.action, withoutReferrer.action, "action must be unchanged");
    assert.equal(withReferrer.cleanUrl, withoutReferrer.cleanUrl, "cleanUrl must be unchanged");
    assert.deepEqual(withReferrer.removedTracking, withoutReferrer.removedTracking, "removedTracking must be unchanged");

    // Sanity: the two results DO differ on the new side-channel field only.
    assert.ok(withReferrer.autoInjected);
    assert.equal(withoutReferrer.autoInjected, undefined);
  });

  test("default behaviour stays KEEP: notifyForeignAffiliate OFF (default), tag detected, tag is kept in cleanUrl", () => {
    const result = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    assert.equal(PREF_DEFAULTS.notifyForeignAffiliate, false, "sanity: pref must default off");
    assert.ok(result.cleanUrl.includes("tag=eleinst-21"), "the auto-injected tag must be KEPT, never silently stripped/replaced");
  });
});

describe("stripAutoInjectedTag — precise same-nav removal (LOW-1)", () => {
  test("drops exactly the auto-injected pair from the current URL", () => {
    const out = stripAutoInjectedTag("https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21", "tag", "eleinst-21");
    assert.equal(out, "https://www.amazon.es/dp/B08N5WRWNW");
  });

  test("a co-present genuine creator tag on the SAME param survives", () => {
    const out = stripAutoInjectedTag(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21&tag=youtuber-21",
      "tag",
      "eleinst-21",
    );
    const u = new URL(out);
    assert.deepEqual(u.searchParams.getAll("tag"), ["youtuber-21"], "creator tag must remain, platform tag gone");
  });

  test("leaves other params intact, removing only the platform pair", () => {
    const out = stripAutoInjectedTag(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21&ie=UTF8",
      "tag",
      "eleinst-21",
    );
    const u = new URL(out);
    assert.equal(u.searchParams.get("ie"), "UTF8");
    assert.equal(u.searchParams.has("tag"), false);
  });

  test("no matching pair → returns the input unchanged", () => {
    const input = "https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21";
    assert.equal(stripAutoInjectedTag(input, "tag", "eleinst-21"), input);
  });

  test("malformed URL falls back to the input string (never throws)", () => {
    assert.equal(stripAutoInjectedTag("not a url", "tag", "eleinst-21"), "not a url");
  });
});

describe("processUrl — result.autoInjected.removeUrl (LOW-1 payload wiring)", () => {
  test("removeUrl strips the platform tag from the CURRENT (cleaned) URL", () => {
    const result = processUrl(AMAZON_AUTOINJECTED_URL, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    assert.ok(result.autoInjected, "autoInjected must be present");
    assert.equal(typeof result.autoInjected.removeUrl, "string");
    assert.ok(!result.autoInjected.removeUrl.includes("tag=eleinst-21"), "removeUrl must not carry the auto-injected tag");
    // Sanity: the read-only invariant still holds — cleanUrl itself KEEPS the tag.
    assert.ok(result.cleanUrl.includes("tag=eleinst-21"), "cleanUrl must be unchanged (default KEEP)");
  });

  test("removeUrl preserves a co-present genuine creator tag on the same param", () => {
    const url = "https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21&tag=youtuber-21";
    const result = processUrl(url, PREF_DEFAULTS, [], undefined, undefined, FOROCOCHES_REFERRER);
    assert.ok(result.autoInjected, "autoInjected must be present");
    const u = new URL(result.autoInjected.removeUrl);
    assert.deepEqual(u.searchParams.getAll("tag"), ["youtuber-21"], "creator tag survives in removeUrl");
  });
});

describe("isAutoInjectedTagPresent — stale-signal gate (LOW-2)", () => {
  test("true when the exact pair is still present", () => {
    assert.equal(
      isAutoInjectedTagPresent("https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21", "tag", "eleinst-21"),
      true,
    );
  });

  test("false when the tag was stripped from the cleaned URL", () => {
    assert.equal(
      isAutoInjectedTagPresent("https://www.amazon.es/dp/B08N5WRWNW", "tag", "eleinst-21"),
      false,
    );
  });

  test("false when only a different value remains on the same param", () => {
    assert.equal(
      isAutoInjectedTagPresent("https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21", "tag", "eleinst-21"),
      false,
    );
  });

  test("false (never throws) on a malformed URL", () => {
    assert.equal(isAutoInjectedTagPresent("not a url", "tag", "eleinst-21"), false);
  });
});
