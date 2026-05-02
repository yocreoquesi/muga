/** MUGA — Unit tests for B3 Impact Radius wrapper (issue #439).
 *
 * Run with: npm test
 *
 * Impact Radius is unique among the affiliate networks in the WRAPPERS table:
 * each merchant gets its own brand-prefixed subdomain on pxf.io
 * (e.g. gohealth.pxf.io, target.pxf.io, apple.pxf.io). The host pattern must
 * therefore wildcard-match ANY *.pxf.io subdomain while rejecting:
 *   - the bare apex pxf.io (no subdomain)
 *   - look-alikes such as notpxf.io or pxf.iox (suffix false positives)
 *
 * Destination is read from the `?u=` query parameter, same shape as
 * TradeTracker.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// Positive: brand-prefixed subdomains (real-shaped advertisers)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Impact Radius brand subdomains", () => {
  test("unwraps gohealth.pxf.io with u= parameter", () => {
    const dest = "https://gohealth.com/medicare";
    const input =
      "https://gohealth.pxf.io/c/12345/67890/11111?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["impact"]);
  });

  test("unwraps target.pxf.io with u= parameter", () => {
    const dest = "https://www.target.com/p/sku/A-12345";
    const input =
      "https://target.pxf.io/c/22222/333333/4567?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["impact"]);
  });

  test("unwraps apple.pxf.io with u= parameter", () => {
    const dest = "https://www.apple.com/shop/buy-mac/macbook-pro";
    const input =
      "https://apple.pxf.io/c/99999/111111/22222?subId1=foo&u=" +
      encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["impact"]);
  });

  test("detectWrapper resolves arbitrary brand subdomains as impact", () => {
    for (const host of [
      "gohealth.pxf.io",
      "target.pxf.io",
      "apple.pxf.io",
      "shop.pxf.io",
      "any-brand-123.pxf.io",
    ]) {
      const w = detectWrapper(`https://${host}/c/1/2/3?u=https%3A%2F%2Fx.com`);
      assert.ok(w, `expected detectWrapper to match host ${host}`);
      assert.equal(w.id, "impact");
    }
  });

  test("preserves query string on the unwrapped Impact destination", () => {
    const dest = "https://merchant.com/p?utm_source=impact&id=42";
    const input =
      "https://gohealth.pxf.io/c/1/2/3?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// Negative: subdomain matching boundaries
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Impact Radius non-matches", () => {
  test("apex pxf.io WITHOUT a subdomain does NOT match", () => {
    const input = "https://pxf.io/c/1/2/3?u=" + encodeURIComponent("https://x.com");
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("notpxf.io does NOT match (suffix false positive guard)", () => {
    const input =
      "https://notpxf.io/c/1/2/3?u=" + encodeURIComponent("https://x.com");
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("evil-notpxf.io does NOT match (subdomain look-alike guard)", () => {
    const input =
      "https://sub.notpxf.io/c/1/2/3?u=" + encodeURIComponent("https://x.com");
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("pxf.iox does NOT match (TLD suffix false positive guard)", () => {
    const input =
      "https://brand.pxf.iox/c/1/2/3?u=" + encodeURIComponent("https://x.com");
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("returns null when Impact URL has no u parameter", () => {
    const input = "https://gohealth.pxf.io/c/1/2/3?subId1=foo";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Impact u= is empty", () => {
    const input = "https://gohealth.pxf.io/c/1/2/3?u=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Impact u= is malformed", () => {
    const input = "https://gohealth.pxf.io/c/1/2/3?u=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when Impact u= is non-HTTP(S)", () => {
    const input =
      "https://gohealth.pxf.io/c/1/2/3?u=" +
      encodeURIComponent("javascript:alert(1)");
    assert.equal(unwrap(input), null);
  });

  test("returns null when Impact u= is file:// scheme", () => {
    const input =
      "https://gohealth.pxf.io/c/1/2/3?u=" +
      encodeURIComponent("file:///etc/passwd");
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Schema introspection — Impact entry is well-formed
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Impact Radius schema", () => {
  test("WRAPPERS contains impact with required schema fields", () => {
    const w = WRAPPERS.find((entry) => entry.id === "impact");
    assert.ok(w, "impact entry must exist in WRAPPERS");
    assert.ok(typeof w.name === "string" && w.name.length > 0);
    assert.ok(Array.isArray(w.hostPatterns) && w.hostPatterns.length > 0);
    assert.ok(typeof w.extract === "function");
  });
});
