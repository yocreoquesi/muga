/**
 * MUGA — Unit tests for the Wrapper Engine (src/lib/wrapper-engine.js)
 *
 * Run with: npm test
 *
 * Coverage (slice B1, issue #434, updated by #684):
 *   - Facebook l.facebook.com happy path (?u= param)
 *   - Malformed wrapper URL (no u, malformed u)
 *   - Non-wrapper inputs (regular URLs, invalid URLs, non-HTTP)
 *   - Recursion: 2-hop and 3-hop chains
 *   - Recursion bounded by maxHops (default 3 + custom override + defensive defaults)
 *   - detectWrapper() introspection
 *   - WRAPPERS table no longer contains Awin (retired per ADR-0003 / #684);
 *     Awin is now pass-through via AFFILIATE_REDIRECT_NETWORKS
 *   - Integration with processUrl: unwrap before tracking strip; preserve
 *     creator affiliate tag on the unwrapped destination
 *
 * Recursion semantics: each call to extract() counts as one hop. With
 * maxHops=3 and 4+ levels of nesting, the engine returns the URL after
 * 3 unwraps (still wrapped) rather than recursing further.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// Facebook l.facebook.com happy paths — drop-in shape for the previous Awin
// `?p=` family. Same param-extraction contract, no affiliate semantics.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Facebook l.facebook.com", () => {
  test("unwraps l.facebook.com/l.php with u= parameter", () => {
    const input =
      "https://l.facebook.com/l.php?u=" +
      encodeURIComponent("https://www.elcorteingles.es/producto/123") +
      "&h=AT2abc";
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, "https://www.elcorteingles.es/producto/123");
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["facebook-l"]);
  });

  test("preserves query string on the unwrapped destination", () => {
    const dest = "https://merchant.com/product?utm_source=google&id=42";
    const input = "https://l.facebook.com/l.php?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("returns null when URL has no u parameter", () => {
    const input = "https://l.facebook.com/l.php?h=abc";
    assert.equal(unwrap(input), null);
  });

  test("returns null when u is empty", () => {
    const input = "https://l.facebook.com/l.php?u=";
    assert.equal(unwrap(input), null);
  });

  test("returns null for malformed u parameter (not a URL)", () => {
    const input = "https://l.facebook.com/l.php?u=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when u points to a non-HTTP(S) destination", () => {
    const input =
      "https://l.facebook.com/l.php?u=" + encodeURIComponent("ftp://example.com/file");
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Awin retired — confirm the wrapper no longer exists; pass-through path.
// See docs/adr/0003-awin-redirect-model-resolution.md (#684).
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Awin retired (ADR-0003 / #684)", () => {
  test("WRAPPERS table does NOT contain an awin entry", () => {
    assert.equal(WRAPPERS.find(w => w.id === "awin"), undefined);
  });

  test("detectWrapper returns null for awin1.com URLs", () => {
    assert.equal(
      detectWrapper("https://www.awin1.com/cread.php?p=https%3A%2F%2Fmerchant.com"),
      null,
    );
    assert.equal(
      detectWrapper("https://awin1.com/awclick.php?id=1"),
      null,
    );
  });

  test("unwrap returns null for awin1.com — passes through unchanged", () => {
    const input =
      "https://www.awin1.com/cread.php?awinmid=1&p=https%3A%2F%2Fmerchant.com";
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Non-wrapper inputs — graceful null
// ---------------------------------------------------------------------------
describe("Wrapper Engine — non-wrapper inputs", () => {
  test("returns null for a regular merchant URL", () => {
    const input = "https://www.amazon.com/dp/B08N5WRWNW?tag=foo-21";
    assert.equal(unwrap(input), null);
  });

  test("returns null for an invalid URL string", () => {
    assert.equal(unwrap("not-a-url"), null);
  });

  test("returns null for non-HTTP(S) protocols", () => {
    assert.equal(unwrap("ftp://example.com/file"), null);
    assert.equal(unwrap("file:///etc/passwd"), null);
    assert.equal(unwrap("javascript:alert(1)"), null);
  });

  test("returns null for empty string", () => {
    assert.equal(unwrap(""), null);
  });
});

// ---------------------------------------------------------------------------
// Recursion (multi-hop) — exercised via l.facebook.com chains.
// ---------------------------------------------------------------------------
function lwrap(dest) {
  return "https://l.facebook.com/l.php?u=" + encodeURIComponent(dest);
}

describe("Wrapper Engine — recursion", () => {
  test("unwraps two hops (l.facebook wrapping l.facebook wrapping merchant)", () => {
    const inner = lwrap("https://merchant.com/product");
    const outer = lwrap(inner);
    const result = unwrap(outer);
    assert.ok(result);
    assert.equal(result.unwrapped, "https://merchant.com/product");
    assert.equal(result.hops, 2);
    assert.deepEqual(result.networks, ["facebook-l", "facebook-l"]);
  });

  test("unwraps three hops (default maxHops boundary)", () => {
    const merchant = "https://merchant.com/product";
    const lvl1 = lwrap(merchant);
    const lvl2 = lwrap(lvl1);
    const lvl3 = lwrap(lvl2);
    const result = unwrap(lvl3);
    assert.ok(result);
    assert.equal(result.unwrapped, merchant);
    assert.equal(result.hops, 3);
    assert.deepEqual(result.networks, ["facebook-l", "facebook-l", "facebook-l"]);
  });

  test("stops at maxHops=3 when there are more levels nested", () => {
    // 4 levels of nesting; with maxHops=3 we expect exactly 3 unwraps
    // and the final URL to still be a wrapped URL (the level-1 wrapper).
    const merchant = "https://merchant.com/product";
    const lvl1 = lwrap(merchant);
    const lvl2 = lwrap(lvl1);
    const lvl3 = lwrap(lvl2);
    const lvl4 = lwrap(lvl3);
    const result = unwrap(lvl4);
    assert.ok(result);
    assert.equal(result.hops, 3);
    assert.equal(result.unwrapped, lvl1, "after 3 unwraps from lvl4 we are at lvl1");
  });

  test("respects custom maxHops option", () => {
    const inner = lwrap("https://merchant.com/product");
    const outer = lwrap(inner);
    const result = unwrap(outer, { maxHops: 1 });
    assert.ok(result);
    assert.equal(result.hops, 1);
    assert.equal(result.unwrapped, inner);
  });

  test("treats maxHops=0 or negative as the default", () => {
    const inner = lwrap("https://merchant.com/product");
    const outer = lwrap(inner);
    const r0 = unwrap(outer, { maxHops: 0 });
    const rNeg = unwrap(outer, { maxHops: -5 });
    // Both should fall back to the default (3) and unwrap fully.
    assert.equal(r0.hops, 2);
    assert.equal(rNeg.hops, 2);
  });
});

// ---------------------------------------------------------------------------
// Schema and detection introspection
// ---------------------------------------------------------------------------
describe("Wrapper Engine — schema and detection", () => {
  test("detectWrapper returns the matching config for a wrapper URL", () => {
    const config = detectWrapper("https://l.facebook.com/l.php?u=foo");
    assert.ok(config);
    assert.equal(config.id, "facebook-l");
    assert.equal(typeof config.name, "string");
  });

  test("detectWrapper returns null for non-matching URLs", () => {
    assert.equal(detectWrapper("https://example.com"), null);
    assert.equal(detectWrapper("https://www.amazon.com/dp/B08"), null);
  });

  test("detectWrapper returns null for invalid URLs", () => {
    assert.equal(detectWrapper("not-a-url"), null);
  });

  test("WRAPPERS table is exported and well-shaped", () => {
    assert.ok(Array.isArray(WRAPPERS));
    assert.ok(WRAPPERS.length > 0, "WRAPPERS must not be empty");
    const fb = WRAPPERS.find(w => w.id === "facebook-l");
    assert.ok(fb, "facebook-l entry must exist in WRAPPERS");
    assert.ok(typeof fb.name === "string" && fb.name.length > 0);
    assert.ok(Array.isArray(fb.hostPatterns));
    assert.ok(typeof fb.extract === "function");
  });

  test("each WRAPPERS entry has the required schema fields", () => {
    for (const w of WRAPPERS) {
      assert.ok(typeof w.id === "string" && w.id.length > 0, `id missing on ${JSON.stringify(w)}`);
      assert.ok(typeof w.name === "string" && w.name.length > 0, `name missing on ${w.id}`);
      assert.ok(Array.isArray(w.hostPatterns) && w.hostPatterns.length > 0, `hostPatterns missing on ${w.id}`);
      assert.ok(typeof w.extract === "function", `extract missing on ${w.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration with cleaner.js — wrapper unwraps before tracking strip
// ---------------------------------------------------------------------------
describe("Wrapper Engine — integration with processUrl", () => {
  test("processUrl unwraps l.facebook.com and then strips tracking on the destination", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    // l.facebook.com wraps a merchant URL that itself carries a UTM tracker.
    // Expected: unwrap to merchant, then strip utm_source.
    const dest = "https://merchant.com/product?utm_source=google";
    const wrapped = lwrap(dest);
    const result = processUrl(wrapped, PREFS);
    assert.equal(result.cleanUrl, "https://merchant.com/product");
    assert.equal(result.action, "cleaned");
    assert.ok(result.removedTracking.includes("utm_source"));
  });

  test("processUrl on a non-wrapper URL is unaffected", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    const result = processUrl("https://example.com/page?utm_source=google", PREFS);
    assert.equal(result.cleanUrl, "https://example.com/page");
    assert.equal(result.action, "cleaned");
  });

  test("processUrl preserves a creator affiliate tag on the unwrapped destination", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    // l.facebook.com wraps an Amazon URL with a creator's affiliate tag — must survive.
    const dest = "https://www.amazon.com/dp/B08N5WRWNW?tag=creator-21&utm_source=fb";
    const wrapped = lwrap(dest);
    const result = processUrl(wrapped, PREFS);
    // Path is normalized by cleanAmazonPath; tag preserved; utm stripped.
    assert.ok(result.cleanUrl.includes("tag=creator-21"));
    assert.ok(!result.cleanUrl.includes("utm_source"));
    assert.ok(!result.cleanUrl.includes("l.facebook.com"));
  });

  test("processUrl on awin1.com URL passes through unchanged (retired wrapper)", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    // After #684, Awin is no longer local-unwrapped. The browser must follow
    // the 30x so the network's MasterTag can populate the merchant's cookie.
    const wrapped =
      "https://www.awin1.com/cread.php?awinmid=1&p=" +
      encodeURIComponent("https://merchant.com/product");
    const result = processUrl(wrapped, PREFS);
    assert.equal(result.cleanUrl, wrapped);
    assert.equal(result.action, "untouched");
  });
});
