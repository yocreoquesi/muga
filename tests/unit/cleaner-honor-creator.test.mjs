/**
 * MUGA — processUrl × Honor Creator Mode integration (#452, B14)
 *
 * Asserts the cleaner pipeline short-circuits with `action: "honored-creator"`
 * BEFORE the wrapper engine unwraps, and that the no-honor path remains
 * byte-identical to pre-feature behaviour.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

// Prior to #907 this fixture used Skimlinks (go.redirectingat.com). #907
// reclassified Skimlinks as pass-through (joining Awin/Impact/Rakuten/
// TradeTracker in AFFILIATE_REDIRECT_NETWORKS): detectWrapper() now returns
// null for it unconditionally, so shouldHonor() can never honor it — there
// is nothing left for honor-creator mode to gate. l.facebook.com is still a
// live WRAPPERS entry (default behaviour unwraps it; honor-creator mode
// preserves it unmodified when the referrer matches), so it replaces
// Skimlinks here as the wrapper fixture for this whole file.
const FACEBOOK_L =
  "https://l.facebook.com/l.php?u=https%3A%2F%2Famazon.com%2Fdp%2FB000&h=AT0abc";
const PLAIN_URL = "https://example.com/article?utm_source=foo";

describe("processUrl × honor creator (B14)", () => {
  test("honor path: matching referrer + wrapper URL → action=honored-creator, cleanUrl unchanged", () => {
    const result = processUrl(
      FACEBOOK_L,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ["youtube.com/@linustechtips"],
      },
      [],
      undefined,
      undefined,
      "https://www.youtube.com/@LinusTechTips/community",
    );
    assert.equal(result.action, "honored-creator");
    assert.equal(result.cleanUrl, FACEBOOK_L);
    assert.equal(result.network, "facebook-l");
    assert.equal(result.creator, "youtube.com/@linustechtips");
    assert.equal(result.junkRemoved, 0);
  });

  test("mode OFF + matching referrer + wrapper URL → unwraps as before (no honor)", () => {
    const honored = processUrl(
      FACEBOOK_L,
      {
        enabled: true,
        honorCreatorMode: false,
        creatorAllowlist: ["youtube.com/@linustechtips"],
      },
      [],
      undefined,
      undefined,
      "https://www.youtube.com/@LinusTechTips/community",
    );
    // Pre-feature: cleaner unwraps the Facebook wrapper to the merchant URL.
    assert.notEqual(honored.action, "honored-creator");
    assert.ok(honored.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });

  test("mode ON + non-matching referrer → not honored, behaves as before", () => {
    const before = processUrl(FACEBOOK_L, { enabled: true });
    const withMode = processUrl(
      FACEBOOK_L,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ["youtube.com/@linustechtips"],
      },
      [],
      undefined,
      undefined,
      "https://news.ycombinator.com/",
    );
    assert.notEqual(withMode.action, "honored-creator");
    assert.equal(withMode.cleanUrl, before.cleanUrl);
    assert.equal(withMode.action, before.action);
  });

  test("no referrer (background context) → not honored", () => {
    const withMode = processUrl(
      FACEBOOK_L,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ["youtube.com/@linustechtips"],
      },
      [],
      undefined,
      undefined,
      // referrer omitted — background-only contexts
    );
    assert.notEqual(withMode.action, "honored-creator");
  });

  test("non-wrapper URL with mode ON + matching referrer → standard cleaning", () => {
    const result = processUrl(
      PLAIN_URL,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ["youtube.com/@linustechtips"],
      },
      [],
      undefined,
      undefined,
      "https://www.youtube.com/@LinusTechTips/",
    );
    assert.notEqual(result.action, "honored-creator");
    // Standard tracking-param cleaning still happens.
    assert.equal(result.action, "cleaned");
    assert.ok(result.removedTracking.includes("utm_source"));
  });

  test("regression: pre-feature default behaviour (no referrer arg) is identical", () => {
    // Exact same call signature as before B14 — no 6th arg.
    const result = processUrl(FACEBOOK_L, { enabled: true });
    assert.notEqual(result.action, "honored-creator");
    assert.ok(result.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });
});
