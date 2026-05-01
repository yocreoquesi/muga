/**
 * MUGA — Unit tests for the Wrapper Engine (src/lib/wrapper-engine.js)
 *
 * Run with: npm test
 *
 * Coverage (slice B1, issue #434):
 *   - Awin happy path (cread.php and awclick.php)
 *   - Malformed Awin URL (no p, malformed p)
 *   - Non-wrapper inputs (regular URLs, invalid URLs, non-HTTP)
 *   - Recursion: 2-hop and 3-hop chains
 *   - Recursion bounded by maxHops (default 3 + custom override + defensive defaults)
 *   - Loop detection guard (via maxHops; explicit loop tests added in B2 once
 *     a second wrapper makes constructible loops possible)
 *   - detectWrapper() introspection
 *   - WRAPPERS table is exported and contains Awin
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
// Awin happy paths
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Awin", () => {
  test("unwraps awin1.com/cread.php with p= parameter", () => {
    const input =
      "https://www.awin1.com/cread.php?awinmid=1234&awinaffid=5678&clickref=&" +
      "p=https%3A%2F%2Fwww.elcorteingles.es%2Fproducto%2F123";
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, "https://www.elcorteingles.es/producto/123");
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["awin"]);
  });

  test("unwraps awin1.com/awclick.php variant", () => {
    const input =
      "https://www.awin1.com/awclick.php?mid=1234&id=5678&" +
      "p=https%3A%2F%2Fmerchant.com%2Fproduct";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, "https://merchant.com/product");
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["awin"]);
  });

  test("matches awin1.com without www subdomain", () => {
    const input = "https://awin1.com/cread.php?p=https%3A%2F%2Fmerchant.com%2Fproduct";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, "https://merchant.com/product");
  });

  test("preserves query string on the unwrapped destination", () => {
    const dest = "https://merchant.com/product?utm_source=google&id=42";
    const input = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("returns null when Awin URL has no p parameter", () => {
    const input = "https://www.awin1.com/cread.php?awinmid=1234";
    assert.equal(unwrap(input), null);
  });

  test("returns null when p is empty", () => {
    const input = "https://www.awin1.com/cread.php?p=";
    assert.equal(unwrap(input), null);
  });

  test("returns null for malformed p parameter (not a URL)", () => {
    const input = "https://www.awin1.com/cread.php?p=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when p points to a non-HTTP(S) destination", () => {
    const input =
      "https://www.awin1.com/cread.php?p=" + encodeURIComponent("ftp://example.com/file");
    assert.equal(unwrap(input), null);
  });

  test("does not match Awin paths other than cread.php / awclick.php", () => {
    const input = "https://www.awin1.com/some-other-page?p=https%3A%2F%2Fmerchant.com";
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
// Recursion (multi-hop)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — recursion", () => {
  test("unwraps two hops (Awin wrapping Awin wrapping merchant)", () => {
    const inner =
      "https://www.awin1.com/cread.php?p=https%3A%2F%2Fmerchant.com%2Fproduct";
    const outer =
      "https://www.awin1.com/cread.php?p=" + encodeURIComponent(inner);
    const result = unwrap(outer);
    assert.ok(result);
    assert.equal(result.unwrapped, "https://merchant.com/product");
    assert.equal(result.hops, 2);
    assert.deepEqual(result.networks, ["awin", "awin"]);
  });

  test("unwraps three hops (default maxHops boundary)", () => {
    const merchant = "https://merchant.com/product";
    const lvl1 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(merchant);
    const lvl2 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(lvl1);
    const lvl3 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(lvl2);
    const result = unwrap(lvl3);
    assert.ok(result);
    assert.equal(result.unwrapped, merchant);
    assert.equal(result.hops, 3);
    assert.deepEqual(result.networks, ["awin", "awin", "awin"]);
  });

  test("stops at maxHops=3 when there are more levels nested", () => {
    // 4 levels of nesting; with maxHops=3 we expect exactly 3 unwraps
    // and the final URL to still be a wrapped Awin URL (the level-1 wrapper).
    const merchant = "https://merchant.com/product";
    const lvl1 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(merchant);
    const lvl2 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(lvl1);
    const lvl3 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(lvl2);
    const lvl4 = "https://www.awin1.com/cread.php?p=" + encodeURIComponent(lvl3);
    const result = unwrap(lvl4);
    assert.ok(result);
    assert.equal(result.hops, 3);
    assert.equal(result.unwrapped, lvl1, "after 3 unwraps from lvl4 we are at lvl1");
  });

  test("respects custom maxHops option", () => {
    const inner =
      "https://www.awin1.com/cread.php?p=https%3A%2F%2Fmerchant.com%2Fproduct";
    const outer =
      "https://www.awin1.com/cread.php?p=" + encodeURIComponent(inner);
    const result = unwrap(outer, { maxHops: 1 });
    assert.ok(result);
    assert.equal(result.hops, 1);
    assert.equal(result.unwrapped, inner);
  });

  test("treats maxHops=0 or negative as the default", () => {
    const inner =
      "https://www.awin1.com/cread.php?p=https%3A%2F%2Fmerchant.com%2Fproduct";
    const outer =
      "https://www.awin1.com/cread.php?p=" + encodeURIComponent(inner);
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
    const config = detectWrapper("https://www.awin1.com/cread.php?p=foo");
    assert.ok(config);
    assert.equal(config.id, "awin");
    assert.equal(typeof config.name, "string");
  });

  test("detectWrapper returns null for non-matching URLs", () => {
    assert.equal(detectWrapper("https://example.com"), null);
    assert.equal(detectWrapper("https://www.amazon.com/dp/B08"), null);
  });

  test("detectWrapper returns null for invalid URLs", () => {
    assert.equal(detectWrapper("not-a-url"), null);
  });

  test("WRAPPERS table is exported and contains Awin", () => {
    assert.ok(Array.isArray(WRAPPERS));
    const awin = WRAPPERS.find(w => w.id === "awin");
    assert.ok(awin, "awin entry must exist in WRAPPERS");
    assert.ok(typeof awin.name === "string" && awin.name.length > 0);
    assert.ok(Array.isArray(awin.hostPatterns));
    assert.ok(typeof awin.extract === "function");
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
  test("processUrl unwraps Awin and then strips tracking on the destination", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    // Awin wraps a merchant URL that itself carries a UTM tracker.
    // Expected: unwrap to merchant, then strip utm_source.
    const dest = "https://merchant.com/product?utm_source=google";
    const wrapped =
      "https://www.awin1.com/cread.php?awinmid=1&p=" + encodeURIComponent(dest);
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
    // Awin wraps an Amazon URL with a creator's affiliate tag — must survive.
    const dest = "https://www.amazon.com/dp/B08N5WRWNW?tag=creator-21&utm_source=fb";
    const wrapped =
      "https://www.awin1.com/cread.php?awinmid=1&p=" + encodeURIComponent(dest);
    const result = processUrl(wrapped, PREFS);
    // Path is normalized by cleanAmazonPath; tag preserved; utm stripped.
    assert.ok(result.cleanUrl.includes("tag=creator-21"));
    assert.ok(!result.cleanUrl.includes("utm_source"));
    assert.ok(!result.cleanUrl.includes("awin1.com"));
  });
});
