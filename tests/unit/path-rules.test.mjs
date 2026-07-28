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
} from "../../src/lib/path-rules.js";
import { pathStripRulesFixture } from "./helpers/path-rules-fixture.mjs";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Mirror of src/rules/path-strip-rules.json */
const STRIP_RULES = [
  {
    domain: "amazon",
    domainPattern: "(?:^|\\.)amazon\\.(?:com|co\\.uk|co\\.jp|com\\.au|com\\.br|com\\.mx|de|es|fr|in|it|nl|pl|se|sg|ca)$",
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

/**
 * Mirror of src/rules/path-affiliate-rules.json.
 *
 * drop-affiliate-injection (PR 1a): the inject* fields (injectPath,
 * injectParam, injectValue, affiliateIdSource) were removed from the real
 * JSON — this fixture only carries creator-referral detection/unwrap fields.
 */
const AFFILIATE_RULES = [
  {
    domain: "bookshop.org",
    referralPaths: ["^\\/a\\/[^/]+\\/", "^\\/shop\\/[^/]+\\/?$"],
    unwrapReferral: "^\\/a\\/[^/]+\\/(.+)$",
    note: "Bookshop creator-referral detection + unwrap",
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

// ── #1094 — Amazon domainPattern must not over-match lookalike domains ───────
//
// The previous domainPattern "(?:^|\\.)amazon\\.[a-z.]+$" matched ANY
// multi-label suffix after "amazon.", so amazon.com.attacker.net and
// amazon.attacker.net were (incorrectly) treated as Amazon and had their
// paths rewritten by applyPathStrip. Mirrors the #734 AliExpress lookalike
// fix: anchor to the exact known set of real Amazon TLDs instead of an
// open-ended character class.
describe("#1094 — Amazon domainPattern lookalike anchoring", () => {
  const PATH = "/Some-Product-Slug/dp/B0B9N3QSL3/ref=sr_1_1";
  const STRIPPED = "/dp/B0B9N3QSL3/";

  test("lookalike hosts are NOT matched — path is left untouched", () => {
    for (const host of [
      "amazon.com.attacker.net",
      "amazon.attacker.net",
      "amazon.co.uk.attacker.net",
      "notamazon.com",
      "myamazon.com",
    ]) {
      assert.equal(
        applyPathStrip(host, PATH, STRIP_RULES),
        PATH,
        `${host} must NOT be treated as Amazon (path must stay unrewritten)`
      );
    }
  });

  test("real amazon.<tld> hosts (and subdomains) still strip the path", () => {
    for (const host of [
      "amazon.com",
      "www.amazon.com",
      "amazon.co.uk",
      "amazon.co.jp",
      "amazon.de",
      "amazon.es",
      "amazon.fr",
      "amazon.it",
      "amazon.nl",
      "amazon.pl",
      "amazon.se",
      "amazon.sg",
      "amazon.ca",
      "amazon.in",
      "amazon.com.au",
      "amazon.com.br",
      "amazon.com.mx",
      "smile.amazon.com",
    ]) {
      assert.equal(
        applyPathStrip(host, PATH, STRIP_RULES),
        STRIPPED,
        `${host} must still be treated as Amazon (path must be stripped)`
      );
    }
  });

  // Guards the real src/rules/path-strip-rules.json file directly (not just
  // the inline STRIP_RULES mirror above), so a future edit to the JSON that
  // reintroduces an open-ended TLD suffix is caught here too.
  test("real path-strip-rules.json fixture rejects lookalikes and accepts genuine TLDs", () => {
    for (const host of ["amazon.com.attacker.net", "amazon.attacker.net"]) {
      assert.equal(applyPathStrip(host, PATH, pathStripRulesFixture), PATH);
    }
    for (const host of ["amazon.com", "amazon.co.uk", "amazon.com.au"]) {
      assert.equal(applyPathStrip(host, PATH, pathStripRulesFixture), STRIPPED);
    }
  });
});

// ── getPathAffiliatePolicy() ──────────────────────────────────────────────────

describe("getPathAffiliatePolicy()", () => {
  // Scenario 7 — non-bookshop hostname → no match
  test("7. non-bookshop hostname returns { creatorReferralPreserved: false }", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://amazon.com/p/something"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false });
  });

  // Scenario 8 — bookshop.org /a/creator-id/ → creatorReferralPreserved: true.
  // #959: AFFILIATE_RULES now carries unwrapReferral, so this /a/.../... path
  // also yields an unwrapTo destination (relative capture "some-book").
  test("8. bookshop.org /a/ referral path → creatorReferralPreserved: true, unwrapTo destination", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/12345/some-book"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: true,
      unwrapTo: "/some-book",
    });
  });

  // Scenario 9 — bookshop.org /shop/ storefront → creatorReferralPreserved: true
  test("9. bookshop.org /shop/ path → creatorReferralPreserved: true", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/shop/my-store"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true });
  });

  // Scenario 10 — bookshop.org /p/ product page → NO_MATCH (drop-affiliate-
  // injection PR 1a: injectPath/injectParam/injectValue were removed from the
  // rule schema entirely — there is no more "pendingInjection" concept).
  test("10. bookshop.org /p/ product page → no policy match (injection removed)", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/p/books/some-title/12345"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false });
  });

  // Scenario 11 — same /p/ path, this time already carrying a foreign
  // ?affiliate= param → still just NO_MATCH (nothing to compare against;
  // the query-param itself is left alone by this data-only loader).
  test("11. bookshop.org /p/ with an existing ?affiliate param → still no policy match", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/p/books/title/123?affiliate=99999"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false });
  });

  // Scenario 12 — www.bookshop.org normalized to bookshop.org → same as #10
  test("12. www.bookshop.org normalized → same no-match result as bookshop.org", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://www.bookshop.org/p/books/some-title/12345"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: false });
  });
});

// ── getPathAffiliatePolicy() unwrapTo (#959) ──────────────────────────────────

describe("getPathAffiliatePolicy() unwrapTo (#959)", () => {
  test("/a/creator/p/books/... → unwrapTo product destination", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator/p/books/9780000000000"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: true,
      unwrapTo: "/p/books/9780000000000",
    });
  });

  test("/a/creator/lists/... → unwrapTo list destination", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator/lists/best-of-2026"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: true,
      unwrapTo: "/lists/best-of-2026",
    });
  });

  test("/a/creator123/https://bookshop.org/p/... (same-origin embedded URL) → unwrapTo destination", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator123/https://bookshop.org/p/books/title/123"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, {
      creatorReferralPreserved: true,
      unwrapTo: "/p/books/title/123",
    });
  });

  test("/a/creator/https://evil.example/... (cross-origin embedded URL) → no unwrapTo", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator/https://evil.example/phishing"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true });
  });

  test("/shop/muga (no unwrapReferral match) → no unwrapTo", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/shop/muga"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true });
  });

  test("nesting guard: capture starting with /a/ → no unwrapTo", () => {
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator/a/other-creator/p/books/1"),
      AFFILIATE_RULES
    );
    assert.deepEqual(result, { creatorReferralPreserved: true });
  });

  test("rule entry without unwrapReferral field → old shape, no crash (backward compat)", () => {
    const rulesNoUnwrap = [
      {
        domain: "bookshop.org",
        referralPaths: ["^\\/a\\/[^/]+\\/", "^\\/shop\\/[^/]+\\/?$"],
        // unwrapReferral intentionally omitted
      },
    ];
    const result = getPathAffiliatePolicy(
      new URL("https://bookshop.org/a/creator/p/books/9780000000000"),
      rulesNoUnwrap
    );
    assert.deepEqual(result, { creatorReferralPreserved: true });
  });

  test("unwrapReferral as an invalid regex string → throws TypeError", () => {
    const badRule = [
      {
        domain: "bookshop.org",
        referralPaths: ["^\\/a\\/[^/]+\\/"],
        unwrapReferral: "(unclosed[", // invalid regex
      },
    ];
    assert.throws(
      () => getPathAffiliatePolicy(new URL("https://bookshop.org/a/creator/dest"), badRule),
      /unwrapReferral.*not a valid regex/i
    );
  });

  // drop-affiliate-injection (PR 1a): a rule entry that matches the REAL new
  // path-affiliate-rules.json shape (no inject* fields at all) must validate
  // and resolve correctly — this is the shape production rules use now.
  test("rule entry with NO inject* fields at all validates fine (new real schema shape)", () => {
    const rulesNoInject = [
      {
        domain: "bookshop.org",
        referralPaths: ["^\\/a\\/[^/]+\\/", "^\\/shop\\/[^/]+\\/?$"],
        unwrapReferral: "^\\/a\\/[^/]+\\/(.+)$",
      },
    ];
    const referral = getPathAffiliatePolicy(new URL("https://bookshop.org/shop/my-store"), rulesNoInject);
    assert.deepEqual(referral, { creatorReferralPreserved: true });
    const nonMatch = getPathAffiliatePolicy(new URL("https://bookshop.org/p/books/title/1"), rulesNoInject);
    assert.deepEqual(nonMatch, { creatorReferralPreserved: false });
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
      },
    ];
    assert.throws(
      () => getPathAffiliatePolicy(new URL("https://bookshop.org/p/foo"), badRule),
      /referralPaths must be an array/i
    );
  });
});
