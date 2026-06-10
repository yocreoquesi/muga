/**
 * MUGA — Latent-footgun guards (issue #831).
 *
 * Six items pinned in a single file; each describe block is self-contained.
 * All tests use public interfaces only — no internals, no mocks of production
 * state.
 *
 * Run with: npm test -- latent-guards-831
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ── Item 1 — getPatternsForHost most-specific suffix match ───────────────────
// Before the fix the suffix loop returned the first Map-iteration hit.  If
// "store.amazon.co.uk" appears before "amazon.co.uk" in iteration order, a
// `host.endsWith(".store.amazon.co.uk")` match would silently win over the
// more-specific "amazon.co.uk" match.  The fix: pick the LONGEST matching
// domain string so that "amazon.co.uk" always beats "amazon".
//
// The real AFFILIATE_PATTERNS table uses exact domains (no wildcards), so
// this guard is exercised only by adding a synthetic two-suffix collision.
// We do that by temporarily extending AFFILIATE_PATTERNS and forcing a
// _rebuildHostIndex().  Because the test needs to mutate module state, we
// use the live import and clean up afterwards.

import {
  AFFILIATE_PATTERNS,
  getPatternsForHost,
} from "../../src/lib/affiliates.js";

describe("Item 1 — getPatternsForHost most-specific suffix match", () => {
  // --- baseline: existing data untouched ---
  test("amazon.com returns patterns (existing data unchanged)", () => {
    const patterns = getPatternsForHost("amazon.com");
    assert.ok(Array.isArray(patterns) && patterns.length > 0,
      "amazon.com must return at least one pattern");
  });

  test("www.amazon.com strips www. and returns same patterns as amazon.com", () => {
    const bare = getPatternsForHost("amazon.com");
    const www  = getPatternsForHost("www.amazon.com");
    assert.deepEqual(www, bare, "www-stripped lookup must match bare domain");
  });

  // --- synthetic two-suffix collision ---
  // We add TWO synthetic programs: one for the short suffix "synth-base.io"
  // and one for the more-specific suffix "shop.synth-base.io".
  // For "deep.shop.synth-base.io" the correct winner is "shop.synth-base.io"
  // (longer match) not "synth-base.io" (shorter match).

  const SYNTH_SHORT = {
    id: "test-synth-short",
    name: "SynthShort",
    group: "SynthShort",
    domains: ["synth-base.io"],
    param: "short_param",
    type: "affiliate",
    ourTag: {},
    references: [],
  };
  const SYNTH_LONG = {
    id: "test-synth-long",
    name: "SynthLong",
    group: "SynthLong",
    domains: ["shop.synth-base.io"],
    param: "long_param",
    type: "affiliate",
    ourTag: {},
    references: [],
  };

  let origLength;

  // Inject two synthetic entries, force index rebuild, then clean up.
  test("two-suffix collision: deeper suffix beats shallower suffix", () => {
    origLength = AFFILIATE_PATTERNS.length;
    AFFILIATE_PATTERNS.push(SYNTH_SHORT, SYNTH_LONG);

    try {
      // Force rebuild by changing length (getPatternsForHost checks _indexedLength).
      // The length changed by push, so rebuild triggers automatically on next call.

      // Exact match for the shallow apex should still return the short-param program.
      const exactShort = getPatternsForHost("synth-base.io");
      assert.ok(exactShort.some(p => p.param === "short_param"),
        "synth-base.io exact match must return SYNTH_SHORT patterns");

      // Exact match for the deep domain should return the long-param program.
      const exactLong = getPatternsForHost("shop.synth-base.io");
      assert.ok(exactLong.some(p => p.param === "long_param"),
        "shop.synth-base.io exact match must return SYNTH_LONG patterns");

      // Suffix match for a sub-subdomain: "deep.shop.synth-base.io"
      // Both "synth-base.io" and "shop.synth-base.io" are suffix matches.
      // The LONGER matching domain ("shop.synth-base.io") must win.
      const suffixResult = getPatternsForHost("deep.shop.synth-base.io");
      assert.ok(suffixResult.some(p => p.param === "long_param"),
        "deep.shop.synth-base.io must pick the MORE SPECIFIC suffix (shop.synth-base.io)");
      assert.ok(!suffixResult.some(p => p.param === "short_param"),
        "deep.shop.synth-base.io must NOT pick the less-specific suffix (synth-base.io)");
    } finally {
      // Remove injected entries to avoid polluting other tests.
      AFFILIATE_PATTERNS.splice(origLength, 2);
    }
  });
});

// ── Item 2 — path-rules duplicate-domain guard ───────────────────────────────
// _ensureAffiliateIndex: duplicate rule.domain → must throw, not silently
//   last-writer-wins.
// _ensureStripIndex: duplicate exact domainPattern → must throw.
// applyPathStrip: first-match-wins for non-duplicate patterns is documented
//   in comments; no runtime change needed.

import {
  applyPathStrip,
  getPathAffiliatePolicy,
} from "../../src/lib/path-rules.js";

describe("Item 2 — path-rules duplicate-domain guards", () => {
  test("_ensureAffiliateIndex throws on duplicate rule.domain", () => {
    const dupRules = [
      {
        domain: "dup.example.com",
        referralPaths: ["^/a/"],
        injectPath: "/p/",
        injectParam: "affiliate",
        injectValue: "111",
        affiliateIdSource: "MUGA_OWN",
      },
      {
        domain: "dup.example.com",   // ← same domain, second entry
        referralPaths: ["^/b/"],
        injectPath: "/p/",
        injectParam: "affiliate",
        injectValue: "222",
        affiliateIdSource: "MUGA_OWN",
      },
    ];
    assert.throws(
      () => getPathAffiliatePolicy(new URL("https://dup.example.com/p/foo"), dupRules),
      /duplicate.*domain|domain.*duplicate/i,
      "Must throw a clear Error when two affiliate rules share the same domain"
    );
  });

  test("_ensureStripIndex throws on exact duplicate domainPattern string", () => {
    const dupStripRules = [
      {
        domain: "first",
        domainPattern: "^dup\\.strip\\.example\\.com$",
        pathPatterns: ["\\/foo"],
        replacements: [""],
        flags: [""],
        fallbackPathname: "/",
      },
      {
        domain: "second",
        domainPattern: "^dup\\.strip\\.example\\.com$",  // ← exact duplicate pattern
        pathPatterns: ["\\/bar"],
        replacements: [""],
        flags: [""],
        fallbackPathname: "/",
      },
    ];
    assert.throws(
      () => applyPathStrip("dup.strip.example.com", "/foo", dupStripRules),
      /duplicate.*domainPattern|domainPattern.*duplicate/i,
      "Must throw a clear Error when two strip rules share an exact domainPattern"
    );
  });

  test("unique affiliate domains are accepted without error", () => {
    const okRules = [
      {
        domain: "first.example.com",
        referralPaths: ["^/a/"],
        injectPath: "/p/",
        injectParam: "affiliate",
        injectValue: "111",
        affiliateIdSource: "MUGA_OWN",
      },
      {
        domain: "second.example.com",
        referralPaths: ["^/b/"],
        injectPath: "/p/",
        injectParam: "affiliate",
        injectValue: "222",
        affiliateIdSource: "MUGA_OWN",
      },
    ];
    assert.doesNotThrow(
      () => getPathAffiliatePolicy(new URL("https://first.example.com/p/foo"), okRules),
      "Distinct domains must not throw"
    );
  });

  test("unique strip domainPatterns are accepted without error", () => {
    const okStripRules = [
      {
        domain: "a",
        domainPattern: "^site-a\\.example\\.com$",
        pathPatterns: ["\\/foo"],
        replacements: [""],
        flags: [""],
        fallbackPathname: "/",
      },
      {
        domain: "b",
        domainPattern: "^site-b\\.example\\.com$",
        pathPatterns: ["\\/bar"],
        replacements: [""],
        flags: [""],
        fallbackPathname: "/",
      },
    ];
    assert.doesNotThrow(
      () => applyPathStrip("site-a.example.com", "/foo", okStripRules),
      "Distinct domainPatterns must not throw"
    );
  });
});

// ── Item 3 — getLandingPolicy www-normalization ──────────────────────────────
// Exact-hostname same-origin check treated www.x.com vs x.com as cross-origin.
// The fix: strip "www." from BOTH sides before comparing, mirroring affiliates.js.

import { getLandingPolicy } from "../../src/lib/cleaner.js";

describe("Item 3 — getLandingPolicy www-normalization", () => {
  // The same-origin guard short-circuits and returns EMPTY_LANDING_POLICY
  // (preserve.size === 0, network === null) for same-origin navigations.
  // Before the fix, www.merchant.com → merchant.com navigation was treated
  // as cross-origin, which could accidentally preserve a param that should
  // have been stripped on the second navigation.

  test("www.landing ← bare.referrer is treated as same-origin (returns empty policy)", () => {
    // Landing on www.merchant.com, referrer is bare merchant.com.
    // These are the same site — the policy must be empty.
    const policy = getLandingPolicy("www.merchant.com", "https://merchant.com/page");
    assert.equal(policy.preserve.size, 0,
      "www.merchant.com ← merchant.com must be same-origin → empty preserve set");
    assert.equal(policy.network, null,
      "www.merchant.com ← merchant.com must be same-origin → null network");
  });

  test("bare.landing ← www.referrer is treated as same-origin (returns empty policy)", () => {
    // Landing on bare merchant.com, referrer is www.merchant.com.
    const policy = getLandingPolicy("merchant.com", "https://www.merchant.com/page");
    assert.equal(policy.preserve.size, 0,
      "merchant.com ← www.merchant.com must be same-origin → empty preserve set");
    assert.equal(policy.network, null);
  });

  test("www.landing ← www.referrer is treated as same-origin (returns empty policy)", () => {
    const policy = getLandingPolicy("www.merchant.com", "https://www.merchant.com/other-page");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("bare.landing ← bare.referrer is unchanged (still same-origin)", () => {
    const policy = getLandingPolicy("merchant.com", "https://merchant.com/other");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("genuinely different origins are not collapsed by www-strip (cross-origin still works)", () => {
    // A real redirect network referrer from a DIFFERENT domain must still produce
    // a non-empty policy.  We use awin1.com as the referrer (known Awin redirect host).
    const policy = getLandingPolicy("www.zalando.es", "https://www.awin1.com/cread.php");
    assert.ok(policy.preserve.size > 0,
      "A real cross-origin network referrer must still produce a non-empty preserve set");
    assert.equal(policy.network, "awin");
  });
});

// ── Item 4 — Anchor the Amazon /ref= path pass ───────────────────────────────
// The pattern `\/ref=[^/?#]*` with flag "g" strips ANY path segment starting
// `ref=`, including mid-path ones like /products/ref=something/details.
// Anchoring with `$` restricts it to trailing ref markers only.

describe("Item 4 — Amazon /ref= strip is terminal-only", () => {
  // We import applyPathStrip with the REAL path-strip-rules.json, just like
  // the service worker does at runtime.
  const pathStripRules = require("../../src/rules/path-strip-rules.json");

  test("trailing /ref=nav_logo is stripped from Amazon product URL", () => {
    const result = applyPathStrip(
      "amazon.com",
      "/dp/B0B9N3QSL3/ref=nav_logo",
      pathStripRules
    );
    assert.equal(result, "/dp/B0B9N3QSL3/",
      "Trailing /ref= must be stripped, leaving only the canonical /dp/ASIN/ path");
  });

  test("mid-path segment containing literal /ref= is preserved", () => {
    // Example: a hypothetical URL whose slug happens to contain "ref=".
    // This should NOT be stripped — only trailing /ref= markers should go.
    const slugResult = applyPathStrip(
      "amazon.com",
      "/products/ref=something/detail/B0B9N3QSL3",
      pathStripRules
    );
    assert.ok(
      slugResult.includes("ref=something") || slugResult.includes("/dp/"),
      "mid-path ref= segment must survive unless the ASIN canonicalizer rewrote the whole path"
    );
    // After the pass 1 slug→/dp/ rewrite the path changes, but the mid-path
    // ref= token must not have been consumed.
    // Test a pure /ref= mid-path without an ASIN slug to isolate the guard:
    const midRef = applyPathStrip(
      "amazon.com",
      "/ref=mid-path/some-product/details",
      pathStripRules
    );
    assert.ok(
      !midRef.startsWith("/some-product"),
      "mid-path /ref= must not reduce path to only what follows ref="
    );
    // Key invariant: the path after stripping must NOT lose content that
    // precedes a mid-path /ref= marker.
    // A simpler direct check: a path with /ref= NOT at the end should not
    // be reduced to an empty string or fallback "/".
    assert.notEqual(midRef, "/", "Mid-path /ref= must not wipe the entire path");
  });

  test("trailing /ref= with query string — $ anchor does not consume the ?", () => {
    // The regex matches against pathname only.  The $ anchors to the end of
    // the pathname string, not the full URL.  A trailing /ref=nav at the end
    // of the pathname (before any ?) must still be stripped.
    const result = applyPathStrip(
      "amazon.co.uk",
      "/dp/B0GQ4N9N33/ref=sr_1_1",
      pathStripRules
    );
    assert.equal(result, "/dp/B0GQ4N9N33/",
      "Trailing /ref= before an implicit end-of-pathname must be stripped");
  });

  test("real Amazon fixture from existing tests — still stripped correctly", () => {
    // Mirrors path-rules.test.mjs scenario 3 — confirms backward compatibility.
    const result = applyPathStrip(
      "amazon.com",
      "/UGREEN-Adaptador/dp/B0B9N3QSL3/ref=dp_abc",
      pathStripRules
    );
    assert.equal(result, "/dp/B0B9N3QSL3/");
  });
});

// ── Item 5 — domain-rules casing guard ──────────────────────────────────────
// The loader lowercases BOTH lists at runtime (getDomainParamSets line 189/190).
// The JSON entries are therefore case-insensitive at runtime.  We add a
// config-integrity check that rejects non-lowercase entries so the JSON stays
// readable and internally consistent (human-authored entries that differ only
// in case would be confusing).
//
// DECISION: We DO normalize all entries to lowercase in domain-rules.json
// (see implementation notes) because:
//   1. The runtime already lowercases both lists → behaviour is byte-identical.
//   2. preserveParams entries like "SearchText" on aliexpress.com are matched
//      against url.searchParams.keys() which yields the ORIGINAL case from the
//      URL.  The comparison is always `param.toLowerCase() vs preserved.has(lower)`
//      → case-insensitive both ways.  Lowercasing the JSON entry is safe.
//   3. A config-integrity check that enforces lowercase in the JSON catches
//      future human-authored mix-case entries before they reach production.

describe("Item 5 — domain-rules casing integrity", () => {
  const domainRules = require("../../src/rules/domain-rules.json");

  test("all stripParams entries in domain-rules.json are lowercase", () => {
    const violations = [];
    for (const rule of domainRules) {
      for (const p of (rule.stripParams || [])) {
        if (p !== p.toLowerCase()) {
          violations.push({ domain: rule.domain, param: p, list: "stripParams" });
        }
      }
    }
    assert.deepStrictEqual(
      violations, [],
      "All stripParams entries must be lowercase (loader lowercases at runtime; " +
      "JSON must match to avoid confusion):\n" +
      violations.map(v => `  ${v.domain}: stripParams "${v.param}"`).join("\n")
    );
  });

  test("all preserveParams entries in domain-rules.json are lowercase", () => {
    const violations = [];
    for (const rule of domainRules) {
      for (const p of (rule.preserveParams || [])) {
        if (p !== p.toLowerCase()) {
          violations.push({ domain: rule.domain, param: p, list: "preserveParams" });
        }
      }
    }
    assert.deepStrictEqual(
      violations, [],
      "All preserveParams entries must be lowercase (loader lowercases at runtime; " +
      "JSON must match to avoid confusion):\n" +
      violations.map(v => `  ${v.domain}: preserveParams "${v.param}"`).join("\n")
    );
  });
});

// ── Item 6 — param-classifier SHAPE_VALUE_LENGTH_MIN boundary ────────────────
// The code: `value.length <= SHAPE_VALUE_LENGTH_MIN` (SHAPE_VALUE_LENGTH_MIN = 16)
// The comment: "value length > SHAPE_VALUE_LENGTH_MIN"
// These are consistent — the comment says "> 16" and the code excludes <= 16.
// A 16-char value is EXCLUDED (the boundary is STRICTLY above 16).
// DECISION: The comment is correct; we pin the boundary with a test.

import {
  classifyByShape,
  SHAPE_VALUE_LENGTH_MIN,
} from "../../src/lib/param-classifier.js";

// A 17-char value with tracker shape (high entropy base64 chars):
// "AbCdEfGhIjKlMnOpQ" — 17 chars, all base64-alphabet, high entropy.
const VALUE_17 = "AbCdEfGhIjKlMnOpQ";   // 17 chars — above threshold
const VALUE_16 = "AbCdEfGhIjKlMnOp";    // 16 chars — at threshold, EXCLUDED
const VALUE_15 = "AbCdEfGhIjKlMnO";     // 15 chars — below threshold, EXCLUDED

describe("Item 6 — SHAPE_VALUE_LENGTH_MIN boundary (exactly-16 is EXCLUDED)", () => {
  // Confirm the constant itself.
  test("SHAPE_VALUE_LENGTH_MIN exports as 16", () => {
    assert.equal(SHAPE_VALUE_LENGTH_MIN, 16);
  });

  // The code uses `<= SHAPE_VALUE_LENGTH_MIN` which means:
  //   length 16 → false (excluded)
  //   length 17 → true  (included)
  // This is consistent with the comment "> 16" (strictly greater than 16).

  // With flag ON and a suspicious key, 17-char high-entropy value → STRIPPED.
  test("value of length 17 with suspicious key is classified for stripping (flag ON)", () => {
    assert.equal(VALUE_17.length, 17, "sanity: VALUE_17 must be 17 chars");
    const r = classifyByShape(
      `https://example.com/?click_id=${VALUE_17}`,
      { experimentalParamClassesEnabled: true },
    );
    // click_id matches /_id$/ pattern; VALUE_17 is base64-ish with > 4.0 entropy.
    assert.ok(
      r.stripParams.includes("click_id"),
      "17-char high-entropy value with suspicious key must be stripped (strictly above threshold)"
    );
  });

  // With flag ON and a suspicious key, EXACTLY-16-char value → NOT STRIPPED.
  // This pins the boundary: the comment "value length > 16" and the code
  // `<= SHAPE_VALUE_LENGTH_MIN` are consistent — 16 is excluded.
  test("value of EXACTLY 16 chars is NOT classified for stripping (boundary excluded)", () => {
    assert.equal(VALUE_16.length, 16, "sanity: VALUE_16 must be 16 chars");
    const r = classifyByShape(
      `https://example.com/?click_id=${VALUE_16}`,
      { experimentalParamClassesEnabled: true },
    );
    assert.ok(
      !r.stripParams.includes("click_id"),
      // The comment says "> 16" (strictly greater); 16-char values are too short
      // to confidently classify as trackers (#544). The <= guard is INTENTIONAL.
      "Exactly-16-char value must NOT be stripped (boundary is strictly above 16, comment is correct)"
    );
  });

  // Below-16 also excluded (belt-and-suspenders).
  test("value of 15 chars is NOT classified for stripping", () => {
    assert.equal(VALUE_15.length, 15, "sanity: VALUE_15 must be 15 chars");
    const r = classifyByShape(
      `https://example.com/?click_id=${VALUE_15}`,
      { experimentalParamClassesEnabled: true },
    );
    assert.ok(
      !r.stripParams.includes("click_id"),
      "15-char value must not be stripped (below threshold)"
    );
  });
});
