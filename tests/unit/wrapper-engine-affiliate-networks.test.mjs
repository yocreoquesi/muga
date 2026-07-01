/**
 * MUGA — Unit tests for B2 affiliate-network wrappers (issue #438).
 *
 * Run with: npm test
 *
 * Networks originally covered here (extending B1's WRAPPERS table):
 *   - Skimlinks      (go.redirectingat.com, go.skimresources.com → url=)
 *   - ShareASale     (shareasale.com /r.cfm → urllink=)
 *
 * Both were retired from the wrapper engine in #907, extending the
 * ADR-0003 policy that already retired Awin (#684), Impact / Rakuten /
 * TradeTracker (#692): their redirect hosts are now in
 * AFFILIATE_REDIRECT_NETWORKS (pass-through) so the network's 30x can
 * populate the merchant's first-party cookie at landing. Local-unwrap risked
 * dropping the click context the merchant's tag needs at landing — same
 * rationale as the Awin/Impact/Rakuten/TradeTracker retirements in
 * tests/unit/wrapper-engine.test.mjs, which this file now mirrors.
 *
 * Rakuten LinkShare and TradeTracker retirement assertions live in
 * tests/unit/wrapper-engine.test.mjs alongside the Awin retirement block.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// Skimlinks retired (#907) — same shape as the Awin retirement.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Skimlinks retired (#907)", () => {
  test("WRAPPERS table does NOT contain a skimlinks entry", () => {
    assert.equal(WRAPPERS.find((w) => w.id === "skimlinks"), undefined);
  });

  test("detectWrapper returns null for go.redirectingat.com URLs", () => {
    const dest = "https://merchant.com/product";
    assert.equal(
      detectWrapper("https://go.redirectingat.com/?id=12345X&xs=1&url=" + encodeURIComponent(dest)),
      null,
    );
  });

  test("detectWrapper returns null for go.skimresources.com URLs", () => {
    const dest = "https://shop.example.com/item/42";
    assert.equal(
      detectWrapper("https://go.skimresources.com/?id=99999X&url=" + encodeURIComponent(dest)),
      null,
    );
  });

  test("unwrap returns null for go.redirectingat.com — passes through unchanged", () => {
    const dest = "https://merchant.com/product";
    const input = "https://go.redirectingat.com/?id=12345X&xs=1&url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });

  test("unwrap returns null for go.skimresources.com — passes through unchanged", () => {
    const dest = "https://shop.example.com/item/42";
    const input = "https://go.skimresources.com/?id=99999X&url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// ShareASale retired (#907) — same shape as the Awin retirement.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — ShareASale retired (#907)", () => {
  test("WRAPPERS table does NOT contain a shareasale entry", () => {
    assert.equal(WRAPPERS.find((w) => w.id === "shareasale"), undefined);
  });

  test("detectWrapper returns null for shareasale.com/r.cfm URLs", () => {
    const dest = "https://merchant.com/landing";
    const input =
      "https://shareasale.com/r.cfm?b=12345&u=67890&m=11111&urllink=" + encodeURIComponent(dest);
    assert.equal(detectWrapper(input), null);
  });

  test("detectWrapper returns null for www.shareasale.com URLs", () => {
    const dest = "https://merchant.com/landing";
    assert.equal(
      detectWrapper("https://www.shareasale.com/r.cfm?urllink=" + encodeURIComponent(dest)),
      null,
    );
  });

  test("unwrap returns null for shareasale.com/r.cfm — passes through unchanged", () => {
    const dest = "https://merchant.com/landing";
    const input =
      "https://shareasale.com/r.cfm?b=12345&u=67890&m=11111&urllink=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Chain interaction — both retired networks together
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Skimlinks × ShareASale interaction post-retirement (#907)", () => {
  test("ShareASale wrapping Skimlinks: outer host alone decides pass-through — unwrap returns null", () => {
    // Even though the ShareASale urllink= value embeds a Skimlinks URL, the
    // outer host (shareasale.com) is itself pass-through, so detectWrapper
    // never even looks at the query string.
    const merchant = "https://merchant.com/final";
    const skim = "https://go.redirectingat.com/?id=1&url=" + encodeURIComponent(merchant);
    const outer = "https://shareasale.com/r.cfm?urllink=" + encodeURIComponent(skim);
    assert.equal(unwrap(outer), null);
    assert.equal(detectWrapper(outer), null);
  });
});

// ---------------------------------------------------------------------------
// Schema introspection — both retired ids are fully absent from WRAPPERS
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B2 schema (post-#907 retirement)", () => {
  for (const id of ["skimlinks", "shareasale"]) {
    test(`WRAPPERS does NOT contain ${id}`, () => {
      assert.equal(WRAPPERS.find((entry) => entry.id === id), undefined);
    });
  }

  test("detectWrapper resolves the retired B2 networks to null", () => {
    assert.equal(
      detectWrapper("https://go.redirectingat.com/?url=https%3A%2F%2Fx.com"),
      null,
    );
    assert.equal(
      detectWrapper("https://go.skimresources.com/?url=https%3A%2F%2Fx.com"),
      null,
    );
    assert.equal(
      detectWrapper("https://shareasale.com/r.cfm?urllink=https%3A%2F%2Fx.com"),
      null,
    );
  });
});
