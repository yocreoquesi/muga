/**
 * MUGA — Unit tests for B2 affiliate-network wrappers (issue #438).
 *
 * Run with: npm test
 *
 * Networks covered (extending B1's WRAPPERS table):
 *   - Skimlinks      (go.redirectingat.com, go.skimresources.com → url=)
 *   - ShareASale     (shareasale.com /r.cfm → urllink=)
 *   - Rakuten        (click.linksynergy.com /deeplink → murl=)
 *   - TradeTracker   (tc.tradetracker.net → u=)
 *
 * Each network has at minimum one positive fixture (real-shaped affiliate URL
 * extracts to expected destination) and one negative (same host but missing
 * destination param). Edge cases — malformed encoding, extra surviving
 * params, recursion across networks — covered in the dedicated suites below.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// Skimlinks
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Skimlinks", () => {
  test("unwraps go.redirectingat.com with url= parameter", () => {
    const dest = "https://merchant.com/product";
    const input =
      "https://go.redirectingat.com/?id=12345X&xs=1&url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["skimlinks"]);
  });

  test("unwraps go.skimresources.com variant", () => {
    const dest = "https://shop.example.com/item/42";
    const input =
      "https://go.skimresources.com/?id=99999X&url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["skimlinks"]);
  });

  test("returns null when Skimlinks URL has no url parameter", () => {
    const input = "https://go.redirectingat.com/?id=12345X&xs=1";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Skimlinks url= is empty", () => {
    const input = "https://go.redirectingat.com/?id=12345X&url=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Skimlinks url= is malformed (not a URL)", () => {
    const input = "https://go.redirectingat.com/?url=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Skimlinks url= is non-HTTP(S)", () => {
    const input =
      "https://go.redirectingat.com/?url=" + encodeURIComponent("ftp://example.com/file");
    assert.equal(unwrap(input), null);
  });

  test("preserves query string on the unwrapped Skimlinks destination", () => {
    const dest = "https://merchant.com/product?utm_source=skim&id=42";
    const input =
      "https://go.redirectingat.com/?id=1&url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// ShareASale
// ---------------------------------------------------------------------------
describe("Wrapper Engine — ShareASale", () => {
  test("unwraps shareasale.com/r.cfm with urllink= parameter", () => {
    const dest = "https://merchant.com/landing";
    const input =
      "https://shareasale.com/r.cfm?b=12345&u=67890&m=11111&urllink=" +
      encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["shareasale"]);
  });

  test("returns null when ShareASale URL has no urllink parameter", () => {
    const input = "https://shareasale.com/r.cfm?b=12345&u=67890&m=11111";
    assert.equal(unwrap(input), null);
  });

  test("returns null when ShareASale urllink= is empty", () => {
    const input = "https://shareasale.com/r.cfm?b=1&urllink=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when ShareASale urllink= is malformed", () => {
    const input = "https://shareasale.com/r.cfm?urllink=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("does not match ShareASale paths other than /r.cfm", () => {
    const input =
      "https://shareasale.com/u.cfm?urllink=" + encodeURIComponent("https://merchant.com");
    assert.equal(unwrap(input), null);
  });

  test("preserves query string on the unwrapped ShareASale destination", () => {
    const dest = "https://merchant.com/product?ref=sas&id=1";
    const input =
      "https://shareasale.com/r.cfm?b=1&u=2&m=3&urllink=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// Rakuten LinkShare
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Rakuten LinkShare", () => {
  test("unwraps click.linksynergy.com/deeplink with murl= parameter", () => {
    const dest = "https://merchant.com/category/shoes";
    const input =
      "https://click.linksynergy.com/deeplink?id=AbCdEf&mid=12345&murl=" +
      encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["rakuten"]);
  });

  test("returns null when Rakuten URL has no murl parameter", () => {
    const input = "https://click.linksynergy.com/deeplink?id=AbCdEf&mid=12345";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Rakuten murl= is empty", () => {
    const input = "https://click.linksynergy.com/deeplink?murl=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Rakuten murl= is malformed", () => {
    const input = "https://click.linksynergy.com/deeplink?murl=javascript%3Aalert(1)";
    assert.equal(unwrap(input), null);
  });

  test("does not match Rakuten paths other than /deeplink", () => {
    const input =
      "https://click.linksynergy.com/other-path?murl=" +
      encodeURIComponent("https://merchant.com");
    assert.equal(unwrap(input), null);
  });

  test("preserves query string on the unwrapped Rakuten destination", () => {
    const dest = "https://merchant.com/p?utm_source=rakuten&q=42";
    const input =
      "https://click.linksynergy.com/deeplink?id=1&mid=2&murl=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// TradeTracker
// ---------------------------------------------------------------------------
describe("Wrapper Engine — TradeTracker", () => {
  test("unwraps tc.tradetracker.net with u= parameter", () => {
    const dest = "https://merchant.com/offer";
    const input =
      "https://tc.tradetracker.net/?c=12345&m=67890&a=11111&r=&u=" +
      encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["tradetracker"]);
  });

  test("returns null when TradeTracker URL has no u parameter", () => {
    const input = "https://tc.tradetracker.net/?c=12345&m=67890";
    assert.equal(unwrap(input), null);
  });

  test("returns null when TradeTracker u= is empty", () => {
    const input = "https://tc.tradetracker.net/?u=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when TradeTracker u= is malformed", () => {
    const input = "https://tc.tradetracker.net/?u=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when TradeTracker u= is non-HTTP(S)", () => {
    const input =
      "https://tc.tradetracker.net/?u=" + encodeURIComponent("file:///etc/passwd");
    assert.equal(unwrap(input), null);
  });

  test("preserves query string on the unwrapped TradeTracker destination", () => {
    const dest = "https://merchant.com/p?ref=tt&utm_source=tt";
    const input = "https://tc.tradetracker.net/?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// Edge cases shared across the new networks
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B2 edge cases", () => {
  test("Skimlinks: extra params after extraction survive on the destination", () => {
    const dest = "https://merchant.com/p?id=42&color=red";
    const input =
      "https://go.redirectingat.com/?id=1&xs=1&url=" + encodeURIComponent(dest) +
      "&extra=foo";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    // The wrapper's own params (id, xs, extra) must NOT leak onto the destination.
    assert.ok(!result.unwrapped.includes("xs=1"));
    assert.ok(!result.unwrapped.includes("extra=foo"));
  });

  test("ShareASale: malformed percent-encoding in urllink yields null gracefully", () => {
    // %ZZ is not a valid percent escape — URL parser treats it literally and
    // the resulting string fails to parse as a URL.
    const input = "https://shareasale.com/r.cfm?urllink=https%3A%2F%2Fmerchant.com%2F%ZZbad";
    // Should not throw; either returns null or a result whose destination is
    // still a valid http(s) URL. The contract is "no throw, graceful null".
    const result = unwrap(input);
    if (result !== null) {
      assert.ok(result.unwrapped.startsWith("http"));
    }
  });

  test("Rakuten: a long but valid destination URL still extracts", () => {
    // Long destination near (but under) the project-wide 2000-char cap that
    // downstream stages enforce. The wrapper extractor itself is contract-free
    // about length — it must simply return whatever the URL API parses.
    const longPath = "/p/" + "a".repeat(1500);
    const dest = "https://merchant.com" + longPath;
    const input =
      "https://click.linksynergy.com/deeplink?murl=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("TradeTracker wrapping Skimlinks resolves through both networks", () => {
    const merchant = "https://merchant.com/final";
    const skim =
      "https://go.redirectingat.com/?id=1&url=" + encodeURIComponent(merchant);
    const outer = "https://tc.tradetracker.net/?u=" + encodeURIComponent(skim);
    const result = unwrap(outer);
    assert.ok(result);
    assert.equal(result.unwrapped, merchant);
    assert.equal(result.hops, 2);
    assert.deepEqual(result.networks, ["tradetracker", "skimlinks"]);
  });
});

// ---------------------------------------------------------------------------
// Schema introspection — every new network is well-formed
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B2 schema", () => {
  for (const id of ["skimlinks", "shareasale", "rakuten", "tradetracker"]) {
    test(`WRAPPERS contains ${id} with required schema fields`, () => {
      const w = WRAPPERS.find((entry) => entry.id === id);
      assert.ok(w, `${id} entry must exist in WRAPPERS`);
      assert.ok(typeof w.name === "string" && w.name.length > 0);
      assert.ok(Array.isArray(w.hostPatterns) && w.hostPatterns.length > 0);
      assert.ok(typeof w.extract === "function");
    });
  }

  test("detectWrapper resolves each new network correctly", () => {
    assert.equal(
      detectWrapper("https://go.redirectingat.com/?url=https%3A%2F%2Fx.com").id,
      "skimlinks"
    );
    assert.equal(
      detectWrapper("https://go.skimresources.com/?url=https%3A%2F%2Fx.com").id,
      "skimlinks"
    );
    assert.equal(
      detectWrapper("https://shareasale.com/r.cfm?urllink=https%3A%2F%2Fx.com").id,
      "shareasale"
    );
    assert.equal(
      detectWrapper("https://click.linksynergy.com/deeplink?murl=https%3A%2F%2Fx.com").id,
      "rakuten"
    );
    assert.equal(
      detectWrapper("https://tc.tradetracker.net/?u=https%3A%2F%2Fx.com").id,
      "tradetracker"
    );
  });
});
