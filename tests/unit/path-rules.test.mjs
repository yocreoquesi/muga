/**
 * MUGA — path-rules.js unit tests (issue #625, REQ-9)
 *
 * 16 scenarios covering applyPathStrip, getPathAffiliatePolicy, WeakMap
 * cache performance, and schema-violation throws.
 *
 * Tests are pure — no filesystem reads, no chrome/fetch/DOM mocks required.
 * Fixtures are inline rule objects mirroring the shape of the real JSON files.
 *
 * Run with: npm test -- path-rules
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyPathStrip,
  getPathAffiliatePolicy,
  loadPathStripRules,
  loadPathAffiliateRules,
} from "../../src/lib/path-rules.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Mirror of src/rules/path-strip-rules.json */
const STRIP_RULES = [
  {
    domain: "amazon",
    domainPattern: "(?:^|\\.)amazon\\.[a-z.]+$",
    pathPatterns: [
      "\\/[^/]+\\/dp\\/([A-Za-z0-9]{10})",
      "(\\/dp\\/[A-Za-z0-9]{10})\\/.+",
      "(\\/gp\\/product\\/[A-Za-z0-9]{10})\\/.+",
      "\\/ref=[^/?#]*",
    ],
    replacements: ["/dp/$1", "$1/", "$1/", ""],
    flags: ["", "", "", "g"],
    fallbackPathname: "/",
    note: "Amazon path-strip — all TLDs",
  },
];

/** Mirror of src/rules/path-affiliate-rules.json */
const AFFILIATE_RULES = [
  {
    domain: "bookshop.org",
    referralPaths: ["^\\/a\\/[^/]+\\/", "^\\/shop\\/[^/]+\\/?$"],
    injectPath: "/p/",
    injectParam: "affiliate",
    injectValue: "124046",
    affiliateIdSource: "MUGA_OWN",
    note: "Bookshop creator-referral detection + own-affiliate injection",
  },
];

// ── applyPathStrip ─────────────────────────────────────────────────────────────

describe("applyPathStrip()", () => {
  // Scenario 1 — empty rules → unchanged pathname
  test("1. empty rules array returns pathname unchanged", () => {
    assert.equal(applyPathStrip("amazon.com", "/dp/B0001/", []), "/dp/B0001/");
  });

  // Scenario 2 — non-matching hostname → unchanged
  test("2. non-matching hostname returns pathname unchanged", () => {
    assert.equal(
      applyPathStrip("example.com", "/some/path", STRIP_RULES),
      "/some/path"
    );
  });

  // Scenario 3 — amazon.com product slug stripped (all 4 passes chained)
  test("3. amazon.com slug + ref stripped → /dp/ASIN/", () => {
    assert.equal(
      applyPathStrip(
        "amazon.com",
        "/UGREEN-Adaptador/dp/B0B9N3QSL3/ref=dp_abc",
        STRIP_RULES
      ),
      "/dp/B0B9N3QSL3/"
    );
  });

  // Scenario 4 — amazon.co.uk TLD regex match
  test("4. amazon.co.uk TLD variant matched by domainPattern", () => {
    assert.equal(
      applyPathStrip(
        "amazon.co.uk",
        "/Product-Name/dp/B0GQ4N9N33/ref=sr_1_1",
        STRIP_RULES
      ),
      "/dp/B0GQ4N9N33/"
    );
  });

  // Scenario 5 — /gp/product/ path variant
  test("5. /gp/product/ path variant stripped correctly", () => {
    assert.equal(
      applyPathStrip(
        "amazon.es",
        "/gp/product/B0GQ4N9N33/ref=sr_1_2/extra",
        STRIP_RULES
      ),
      "/gp/product/B0GQ4N9N33/"
    );
  });

  // Scenario 6 — all replacements yield empty string → fallback to "/"
  test("6. empty result falls back to fallbackPathname", () => {
    const stripAllRule = [
      {
        domain: "test",
        domainPattern: "^test\\.example\\.com$",
        pathPatterns: [".*"],
        replacements: [""],
        flags: [""],
        fallbackPathname: "/",
      },
    ];
    assert.equal(
      applyPathStrip("test.example.com", "/anything/here", stripAllRule),
      "/"
    );
  });
});

// ── getPathAffiliatePolicy() ──────────────────────────────────────────────────

describe("getPathAffiliatePolicy()", () => {
  // Scenario 7 — non-bookshop hostname → both false/null
  test("7. non-bookshop hostname returns { false, null }", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://amazon.com/p/something"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false, pendingInjection: null });
  });

  // Scenario 8 — bookshop.org /a/creator-id/ → creatorReferralPreserved: true
  test("8. bookshop.org /a/ referral path → creatorReferralPreserved: true", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/12345/some-book"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true, pendingInjection: null });
  });

  // Scenario 9 — bookshop.org /shop/ storefront → creatorReferralPreserved: true
  test("9. bookshop.org /shop/ path → creatorReferralPreserved: true", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/shop/my-store"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true, pendingInjection: null });
  });

  // Scenario 10 — bookshop.org /p/ without affiliate param → pendingInjection
  test("10. bookshop.org /p/ without affiliate param → pendingInjection", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/p/books/some-title/12345"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: false,
      pendingInjection: { param: "affiliate", value: "124046" },
    });
  });

  // Scenario 11 — bookshop.org /p/ WITH existing ?affiliate=X → pendingInjection: null
  test("11. bookshop.org /p/ with existing ?affiliate param → pendingInjection: null", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/p/books/title/123?affiliate=99999"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false, pendingInjection: null });
  });

  // Scenario 12 — www.bookshop.org normalized to bookshop.org → same as #10
  test("12. www.bookshop.org normalized → same injection result as bookshop.org", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://www.bookshop.org/p/books/some-title/12345"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: false,
      pendingInjection: { param: "affiliate", value: "124046" },
    });
  });
});

// ── WeakMap cache performance ─────────────────────────────────────────────────

describe("WeakMap cache", () => {
  // Scenario 13 — 1000 applyPathStrip calls with same rules ref → fast
  test("13. 1000 applyPathStrip calls with same rules array ref complete quickly", () => {
    const rules = [...STRIP_RULES]; // same reference used across all calls
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      applyPathStrip("amazon.com", `/Product-${i}/dp/B0B9N3QSL3/ref=x`, rules);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `1000 calls took ${elapsed}ms — expected < 500ms`);
  });

  // Scenario 14 — 1000 getPathAffiliatePolicy calls with same rules ref → fast
  test("14. 1000 getPathAffiliatePolicy calls with same rules array ref complete quickly", () => {
    const rules = [...AFFILIATE_RULES]; // same reference used across all calls
    const url = new URL("https://bookshop.org/p/books/some-title/12345");
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      getPathAffiliatePolicy(url, rules);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `1000 calls took ${elapsed}ms — expected < 500ms`);
  });
});

// ── Schema violation throws ───────────────────────────────────────────────────

describe("schema validation", () => {
  // Scenario 15 — mismatched pathPatterns/replacements → throws
  test("15. applyPathStrip with mismatched pathPatterns/replacements lengths → throws", () => {
    const badRule = [
      {
        domain: "bad",
        domainPattern: "^bad\\.com$",
        pathPatterns: ["/foo", "/bar"],
        replacements: ["/baz"], // length mismatch
        flags: [],
        fallbackPathname: "/",
      },
    ];
    assert.throws(
      () => applyPathStrip("bad.com", "/foo", badRule),
      /pathPatterns.*replacements|different length/i
    );
  });

  // Scenario 16 — non-array referralPaths → throws
  test("16. getPathAffiliatePolicy with non-array referralPaths → throws", () => {
    const badRule = [
      {
        domain: "bookshop.org",
        referralPaths: "not-an-array", // should be array
        injectPath: "/p/",
        injectParam: "affiliate",
        injectValue: "124046",
        affiliateIdSource: "MUGA_OWN",
      },
    ];
    assert.throws(
      () => getPathAffiliatePolicy(new URL("https://bookshop.org/p/foo"), badRule),
      /referralPaths must be an array/i
    );
  });
});
