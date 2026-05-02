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

const SKIMLINKS = "https://go.redirectingat.com/?id=1&url=https%3A%2F%2Famazon.com%2Fdp%2FB000";
const PLAIN_URL = "https://example.com/article?utm_source=foo";

describe("processUrl × honor creator (B14)", () => {
  test("honor path: matching referrer + wrapper URL → action=honored-creator, cleanUrl unchanged", () => {
    const result = processUrl(
      SKIMLINKS,
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
    assert.equal(result.cleanUrl, SKIMLINKS);
    assert.equal(result.network, "skimlinks");
    assert.equal(result.creator, "youtube.com/@linustechtips");
    assert.equal(result.junkRemoved, 0);
  });

  test("mode OFF + matching referrer + wrapper URL → unwraps as before (no honor)", () => {
    const honored = processUrl(
      SKIMLINKS,
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
    // Pre-feature: cleaner unwraps the Skimlinks wrapper to the merchant URL.
    assert.notEqual(honored.action, "honored-creator");
    assert.ok(honored.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });

  test("mode ON + non-matching referrer → not honored, behaves as before", () => {
    const before = processUrl(SKIMLINKS, { enabled: true });
    const withMode = processUrl(
      SKIMLINKS,
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
      SKIMLINKS,
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
    const result = processUrl(SKIMLINKS, { enabled: true });
    assert.notEqual(result.action, "honored-creator");
    assert.ok(result.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });
});
