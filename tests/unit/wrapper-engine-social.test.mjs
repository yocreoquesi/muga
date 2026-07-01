/**
 * MUGA — Unit tests for B4 social/short-URL wrappers (issue #440).
 *
 * Run with: npm test
 *
 * Networks covered (extending the WRAPPERS table):
 *   - t.co              (Twitter): path-based redirect; engine cannot do HTTP.
 *                       The wrapper is REGISTERED so detectWrapper() flags the
 *                       host, but extraction is best-effort: when a query
 *                       fallback is present (?url=, ?u=) it is returned;
 *                       otherwise null.
 *   - l.facebook.com    /l.php → ?u=  (Facebook outbound link wrapper, web)
 *   - lm.facebook.com   /l.php → ?u=  (Facebook mobile outbound link wrapper)
 *   - l.instagram.com   → ?u=         (Instagram outbound link wrapper)
 *
 * Acceptance highlights (from #440):
 *   - Each wrapper detects without false positives on the parent domain
 *     (facebook.com / instagram.com / twitter.com must NOT match).
 *   - Facebook `l` and `lm` subdomains are tested separately (different hosts).
 *   - Recursion smoke test: l.facebook.com wrapping t.co wrapping a merchant
 *     URL resolves end-to-end through processUrl (see #907 note above the
 *     "B4 recursion through processUrl" describe block for why this no
 *     longer uses Skimlinks).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// t.co — Twitter short-URL host
// ---------------------------------------------------------------------------
describe("Wrapper Engine — t.co", () => {
  test("detectWrapper recognizes t.co host (registered as wrapper)", () => {
    const w = detectWrapper("https://t.co/abcdef");
    assert.ok(w, "t.co must be a recognized wrapper host");
    assert.equal(w.id, "tco");
  });

  test("returns null for path-based t.co (no query fallback) — best-effort", () => {
    // The real t.co hides the destination behind an HTTP redirect we cannot
    // follow. With no query fallback, extraction returns null gracefully and
    // unwrap() therefore returns null (engine contract: null on first miss).
    const input = "https://t.co/abcdef";
    assert.equal(unwrap(input), null);
  });

  test("extracts destination from ?url= query fallback when present", () => {
    const dest = "https://merchant.example.com/p/123";
    const input = "https://t.co/abcdef?url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result for ?url= fallback");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["tco"]);
  });

  test("extracts destination from ?u= query fallback when present", () => {
    const dest = "https://merchant.example.com/landing";
    const input = "https://t.co/xyz789?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("returns null when t.co query fallback is malformed", () => {
    const input = "https://t.co/abcdef?url=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when t.co query fallback is non-HTTP(S)", () => {
    const input =
      "https://t.co/abcdef?url=" + encodeURIComponent("javascript:alert(1)");
    assert.equal(unwrap(input), null);
  });

  test("returns null when t.co query fallback is empty", () => {
    const input = "https://t.co/abcdef?url=";
    assert.equal(unwrap(input), null);
  });

  test("twitter.com (parent domain) does NOT match t.co wrapper", () => {
    // The shortener is t.co, not twitter.com. Avoid false-positive on the
    // social network's main domain.
    assert.equal(detectWrapper("https://twitter.com/user/status/123"), null);
    assert.equal(detectWrapper("https://www.twitter.com/user"), null);
    assert.equal(detectWrapper("https://x.com/user/status/123"), null);
  });

  test("subdomains of t.co do NOT match (exact host only)", () => {
    assert.equal(detectWrapper("https://api.t.co/abcdef"), null);
  });
});

// ---------------------------------------------------------------------------
// Facebook l.php — web (l.facebook.com) and mobile (lm.facebook.com)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — l.facebook.com", () => {
  test("unwraps l.facebook.com/l.php with u= parameter", () => {
    const dest = "https://merchant.example.com/p/42";
    const input =
      "https://l.facebook.com/l.php?u=" +
      encodeURIComponent(dest) +
      "&h=AT0abc&__tn__=R";
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["facebook-l"]);
  });

  test("returns null when l.facebook.com URL has no u parameter", () => {
    const input = "https://l.facebook.com/l.php?h=AT0abc";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.facebook.com u= is empty", () => {
    const input = "https://l.facebook.com/l.php?u=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.facebook.com u= is malformed", () => {
    const input = "https://l.facebook.com/l.php?u=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.facebook.com u= is non-HTTP(S)", () => {
    const input =
      "https://l.facebook.com/l.php?u=" + encodeURIComponent("ftp://example.com/x");
    assert.equal(unwrap(input), null);
  });

  test("does not match l.facebook.com paths other than /l.php as Facebook", () => {
    // #531's generic wrapper path (which used to legitimately match this URL
    // as `generic-u`) was removed in #907 — detectWrapper now returns null
    // entirely for unrecognized path shapes. What this test guards is the
    // EXPLICIT Facebook entry's path-prefix boundary, so we assert the
    // matched id is not the Facebook explicit one.
    const input =
      "https://l.facebook.com/other?u=" + encodeURIComponent("https://merchant.com");
    const w = detectWrapper(input);
    assert.notEqual(w?.id, "facebook-l");
  });

  test("preserves query string on the unwrapped Facebook destination", () => {
    const dest = "https://merchant.example.com/p?utm_source=fb&id=42";
    const input =
      "https://l.facebook.com/l.php?u=" + encodeURIComponent(dest) + "&h=AT0";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

describe("Wrapper Engine — lm.facebook.com (mobile)", () => {
  test("unwraps lm.facebook.com/l.php with u= parameter", () => {
    const dest = "https://merchant.example.com/m/42";
    const input =
      "https://lm.facebook.com/l.php?u=" +
      encodeURIComponent(dest) +
      "&h=AT0abc";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["facebook-lm"]);
  });

  test("returns null when lm.facebook.com URL has no u parameter", () => {
    const input = "https://lm.facebook.com/l.php?h=AT0abc";
    assert.equal(unwrap(input), null);
  });

  test("does not match lm.facebook.com paths other than /l.php as Facebook", () => {
    // See sibling test on l.facebook.com: the #531 generic path (which used
    // to match here) was removed in #907. This guards the EXPLICIT
    // facebook-lm entry's path boundary.
    const input =
      "https://lm.facebook.com/other?u=" + encodeURIComponent("https://merchant.com");
    const w = detectWrapper(input);
    assert.notEqual(w?.id, "facebook-lm");
  });
});

describe("Wrapper Engine — Facebook parent-domain false-positive guard", () => {
  test("facebook.com (apex) does NOT match either Facebook wrapper", () => {
    // Only the l. and lm. subdomains carry outbound link wrappers; the apex
    // is the social network itself and must never be flagged AS FACEBOOK.
    // The #531 generic path (which used to match the ?u= variant) was
    // removed in #907 — detectWrapper returns null here now. Still assert
    // the matched id is never one of the Facebook explicit entries.
    assert.equal(detectWrapper("https://facebook.com/user/posts/1"), null);
    const w = detectWrapper("https://facebook.com/l.php?u=https%3A%2F%2Fx.com");
    assert.notEqual(w?.id, "facebook-l");
    assert.notEqual(w?.id, "facebook-lm");
  });

  test("www.facebook.com does NOT match either Facebook wrapper", () => {
    assert.equal(detectWrapper("https://www.facebook.com/user/posts/1"), null);
    const w = detectWrapper("https://www.facebook.com/l.php?u=https%3A%2F%2Fx.com");
    assert.notEqual(w?.id, "facebook-l");
    assert.notEqual(w?.id, "facebook-lm");
  });

  test("m.facebook.com (mobile main) does NOT match Facebook (only lm. does)", () => {
    const w = detectWrapper("https://m.facebook.com/l.php?u=https%3A%2F%2Fx.com");
    assert.notEqual(w?.id, "facebook-l");
    assert.notEqual(w?.id, "facebook-lm");
  });

  test("l and lm hosts produce DIFFERENT wrapper ids", () => {
    const wL = detectWrapper("https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com");
    const wLm = detectWrapper("https://lm.facebook.com/l.php?u=https%3A%2F%2Fx.com");
    assert.ok(wL);
    assert.ok(wLm);
    assert.notEqual(wL.id, wLm.id, "l. and lm. must be tracked separately");
  });
});

// ---------------------------------------------------------------------------
// l.instagram.com
// ---------------------------------------------------------------------------
describe("Wrapper Engine — l.instagram.com", () => {
  test("unwraps l.instagram.com with u= parameter", () => {
    const dest = "https://merchant.example.com/ig/42";
    const input =
      "https://l.instagram.com/?u=" +
      encodeURIComponent(dest) +
      "&e=AT0abc";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["instagram-l"]);
  });

  test("returns null when l.instagram.com URL has no u parameter", () => {
    const input = "https://l.instagram.com/?e=AT0abc";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.instagram.com u= is empty", () => {
    const input = "https://l.instagram.com/?u=";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.instagram.com u= is malformed", () => {
    const input = "https://l.instagram.com/?u=not-a-url";
    assert.equal(unwrap(input), null);
  });

  test("returns null when l.instagram.com u= is non-HTTP(S)", () => {
    const input =
      "https://l.instagram.com/?u=" + encodeURIComponent("file:///etc/passwd");
    assert.equal(unwrap(input), null);
  });

  test("instagram.com (parent) does NOT match the Instagram wrapper", () => {
    assert.equal(detectWrapper("https://instagram.com/user/p/abc"), null);
    assert.equal(detectWrapper("https://www.instagram.com/user/p/abc"), null);
  });

  test("preserves query string on the unwrapped Instagram destination", () => {
    const dest = "https://merchant.example.com/p?utm_source=ig&id=42";
    const input = "https://l.instagram.com/?u=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// Recursion smoke: Facebook wrapping t.co wrapping a merchant.
// End-to-end through processUrl (the production entry point).
//
// Prior to #907 this smoke test chained Facebook → Skimlinks (go.redirectingat.com)
// → merchant. Skimlinks was reclassified pass-through in #907 (see
// tests/unit/wrapper-engine-affiliate-networks.test.mjs), so a URL wrapped
// in go.redirectingat.com is no longer a second WRAPPERS hop — it's the
// terminal (still-opaque) result. t.co is still a live WRAPPERS entry with
// a query-fallback extractor (?url=/?u=), so it replaces Skimlinks as the
// second hop here. The FB-wrapping-a-pass-through-network case is covered
// separately below.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B4 recursion through processUrl", () => {
  test("l.facebook.com wrapping t.co wrapping merchant resolves end-to-end", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    // Merchant carries a tracker that must be stripped AFTER both unwraps,
    // proving the full pipeline (FB → t.co → merchant → cleaner) executed.
    const merchantWithTracker =
      "https://merchant.example.com/p/123?utm_source=fb";
    const merchantClean = "https://merchant.example.com/p/123";
    const tco =
      "https://t.co/?url=" + encodeURIComponent(merchantWithTracker);
    const fb = "https://l.facebook.com/l.php?u=" + encodeURIComponent(tco);
    const result = processUrl(fb, PREFS);
    assert.equal(result.cleanUrl, merchantClean);
    assert.equal(result.action, "cleaned");
    assert.ok(result.removedTracking.includes("utm_source"));
  });

  test("unwrap() reports both networks for FB → t.co → merchant chain", () => {
    const merchant = "https://merchant.example.com/final";
    const tco = "https://t.co/?url=" + encodeURIComponent(merchant);
    const outer = "https://l.facebook.com/l.php?u=" + encodeURIComponent(tco);
    const result = unwrap(outer);
    assert.ok(result);
    assert.equal(result.unwrapped, merchant);
    assert.equal(result.hops, 2);
    assert.deepEqual(result.networks, ["facebook-l", "tco"]);
  });

  test("l.facebook.com wrapping a pass-through network (Skimlinks) stops at 1 hop — the pass-through URL is terminal (#907)", () => {
    // Facebook still unwraps (its own hop), but the resulting Skimlinks URL
    // is not itself a WRAPPERS match anymore (detectWrapper returns null —
    // it's an AFFILIATE_REDIRECT_NETWORKS pass-through host). The chain
    // stops there, still wrapped, so the network's own 30x can execute.
    const merchant = "https://merchant.example.com/final";
    const skim =
      "https://go.redirectingat.com/?id=1&url=" + encodeURIComponent(merchant);
    const outer = "https://l.facebook.com/l.php?u=" + encodeURIComponent(skim);
    const result = unwrap(outer);
    assert.ok(result);
    assert.equal(result.unwrapped, skim, "chain stops at the Skimlinks URL — it is not further unwrapped");
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["facebook-l"]);
    assert.equal(detectWrapper(result.unwrapped), null, "the terminal URL is pass-through, not a wrapper");
  });
});

// ---------------------------------------------------------------------------
// Schema introspection — every new B4 entry is well-formed
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B4 schema", () => {
  for (const id of ["tco", "facebook-l", "facebook-lm", "instagram-l"]) {
    test(`WRAPPERS contains ${id} with required schema fields`, () => {
      const w = WRAPPERS.find((entry) => entry.id === id);
      assert.ok(w, `${id} entry must exist in WRAPPERS`);
      assert.ok(typeof w.name === "string" && w.name.length > 0);
      assert.ok(Array.isArray(w.hostPatterns) && w.hostPatterns.length > 0);
      assert.ok(typeof w.extract === "function");
    });
  }

  test("detectWrapper resolves each new B4 network correctly", () => {
    assert.equal(
      detectWrapper("https://t.co/abc?url=https%3A%2F%2Fx.com").id,
      "tco"
    );
    assert.equal(
      detectWrapper("https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com").id,
      "facebook-l"
    );
    assert.equal(
      detectWrapper("https://lm.facebook.com/l.php?u=https%3A%2F%2Fx.com").id,
      "facebook-lm"
    );
    assert.equal(
      detectWrapper("https://l.instagram.com/?u=https%3A%2F%2Fx.com").id,
      "instagram-l"
    );
  });
});
