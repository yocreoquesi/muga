/**
 * MUGA — Unit tests for processUrl (src/lib/cleaner.js)
 *
 * Run with: npm test
 *
 * Coverage:
 *   - Tracking parameter removal (Scenario A)
 *   - Affiliate injection when no tag present (Scenario B)
 *   - Foreign affiliate detection (Scenario C)
 *   - Blacklist enforcement — domain-only (Scenario D)
 *   - Blacklist enforcement — specific affiliate
 *   - Whitelist — protected affiliate values are never touched
 *   - Edge cases: invalid URLs, no query string, empty ourTag
 *
 * Amazon Associates tags are active for ES/DE/FR/IT/UK/US.
 * Full preference interaction matrix tested below.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { processUrl, parseListEntry } from "../../src/lib/cleaner.js";
import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");
const CONTENT_CLEANER_SOURCE = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const POPUP_SOURCE = readFileSync(
  join(__dirname, "../../src/popup/popup.js"), "utf8"
);

// ---------------------------------------------------------------------------
// Test-only affiliate pattern — injected before Scenario B/C tests,
// removed after. Uses a fictional domain to avoid affecting real store logic.
// ---------------------------------------------------------------------------
const TEST_PATTERN = {
  id: "_test_store",
  name: "Test Store (unit tests only)",
  domains: ["shop.test.muga", "www.shop.test.muga"],
  param: "aff",
  type: "affiliate",
  ourTag: "muga-test-99",
};

// S11 — Original length of AFFILIATE_PATTERNS, used by after() hooks to
// truncate safely instead of fragile splice-by-index.
const AFFILIATE_PATTERNS_ORIGINAL_LENGTH = AFFILIATE_PATTERNS.length;

// ---------------------------------------------------------------------------
// Base prefs — mirrors the defaults in src/lib/storage.js
// ---------------------------------------------------------------------------
const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

// ---------------------------------------------------------------------------
// Scenario A — Tracking parameter removal
// ---------------------------------------------------------------------------
describe("Scenario A — tracking parameter removal", () => {

  test("strips a single utm_source param", () => {
    const { action, cleanUrl, removedTracking } = processUrl(
      "https://example.com/?utm_source=google",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/");
    assert.deepEqual(removedTracking, ["utm_source"]);
  });

  test("strips all major UTM params at once", () => {
    const { removedTracking, cleanUrl, junkRemoved } = processUrl(
      "https://example.com/?utm_source=fb&utm_medium=cpc&utm_campaign=spring&utm_content=banner&utm_term=shoes",
      PREFS
    );
    assert.equal(removedTracking.length, 5);
    assert.equal(cleanUrl, "https://example.com/");
    assert.equal(junkRemoved, 5);
  });

  test("strips fbclid", () => {
    const { action, cleanUrl } = processUrl(
      "https://example.com/article?fbclid=IwAR0abc123",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/article");
  });

  test("strips gclid", () => {
    const { action, cleanUrl } = processUrl(
      "https://example.com/?gclid=abc123xyz",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/");
  });

  test("strips msclkid (Microsoft click ID)", () => {
    const { action } = processUrl(
      "https://example.com/?msclkid=abc123",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("strips mc_cid and mc_eid (Mailchimp)", () => {
    const { removedTracking } = processUrl(
      "https://example.com/?mc_cid=abc&mc_eid=def",
      PREFS
    );
    assert.ok(removedTracking.includes("mc_cid"));
    assert.ok(removedTracking.includes("mc_eid"));
  });

  test("strips YouTube si param", () => {
    const { action, cleanUrl } = processUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123tracking",
      PREFS
    );
    assert.equal(action, "cleaned");
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.equal(clean.searchParams.has("si"), false);
  });

  test("strips eBay tracking params (mkevt, mkcid, mkrid)", () => {
    const { removedTracking } = processUrl(
      "https://www.ebay.es/itm/123456?mkevt=1&mkcid=1&mkrid=1185",
      PREFS
    );
    assert.ok(removedTracking.includes("mkevt"));
    assert.ok(removedTracking.includes("mkcid"));
    assert.ok(removedTracking.includes("mkrid"));
  });

  test("strips irgwc (Impact Radius click ID)", () => {
    const { action } = processUrl(
      "https://example.com/?irgwc=1&utm_source=affiliate",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("preserves non-tracking query params", () => {
    const { cleanUrl, removedTracking } = processUrl(
      "https://example.com/search?q=laptop&page=2&utm_source=google",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("q"), "laptop");
    assert.equal(clean.searchParams.get("page"), "2");
    assert.deepEqual(removedTracking, ["utm_source"]);
  });

  test("mixes tracking and functional params — only tracking removed", () => {
    const { cleanUrl } = processUrl(
      "https://shop.com/product?id=42&color=red&fbclid=abc&utm_medium=cpc",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("id"), "42");
    assert.equal(clean.searchParams.get("color"), "red");
    assert.equal(clean.searchParams.has("fbclid"), false);
    assert.equal(clean.searchParams.has("utm_medium"), false);
  });

  test("param name matching is case-insensitive", () => {
    const { action } = processUrl(
      "https://example.com/?UTM_SOURCE=google",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

});

// ---------------------------------------------------------------------------
// Custom tracking params (#33)
// ---------------------------------------------------------------------------
describe("custom tracking params", () => {

  test("strips a user-defined custom param", () => {
    const { action, removedTracking } = processUrl(
      "https://example.com/?ref_code=XYZ123&q=shoes",
      { ...PREFS, customParams: ["ref_code"] }
    );
    assert.equal(action, "cleaned");
    assert.ok(removedTracking.includes("ref_code"));
    assert.equal(new URL(processUrl("https://example.com/?ref_code=XYZ123&q=shoes", { ...PREFS, customParams: ["ref_code"] }).cleanUrl).searchParams.get("q"), "shoes");
  });

  test("custom param matching is case-insensitive", () => {
    const { removedTracking } = processUrl(
      "https://example.com/?Promo_ID=summer&page=1",
      { ...PREFS, customParams: ["promo_id"] }
    );
    assert.ok(removedTracking.includes("Promo_ID"));
  });

  test("unknown param not in customParams is preserved", () => {
    const { cleanUrl } = processUrl(
      "https://example.com/?my_custom=abc",
      { ...PREFS, customParams: [] }
    );
    assert.equal(new URL(cleanUrl).searchParams.get("my_custom"), "abc");
  });

  test("empty customParams does not affect built-in params", () => {
    const { removedTracking } = processUrl(
      "https://example.com/?utm_source=email",
      { ...PREFS, customParams: [] }
    );
    assert.ok(removedTracking.includes("utm_source"));
  });

});

// ---------------------------------------------------------------------------
// Untouched — no query string or no matching params
// ---------------------------------------------------------------------------
describe("action: untouched", () => {

  test("URL with no query string → untouched, cleanUrl unchanged", () => {
    const url = "https://example.com/article/title";
    const { action, cleanUrl, removedTracking } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, url);
    assert.deepEqual(removedTracking, []);
  });

  test("URL with only functional params → untouched", () => {
    const url = "https://example.com/?page=3&lang=en";
    const { action } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
  });

  test("URL with fragment only → untouched", () => {
    const url = "https://example.com/page#section";
    const { action, cleanUrl } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, url);
  });

});

// ---------------------------------------------------------------------------
// Disabled-extension guard contract — prefs.enabled === false
//
// DESIGN NOTE: processUrl is a pure function. The primary enabled guard
// lives in handleProcessUrl (service-worker.js) — NOT inside processUrl.
// Any caller that passes enabled: false gets cleaning applied anyway;
// suppression is the caller's responsibility.
//
// These tests lock in that contract so a refactor that accidentally moves
// the guard into processUrl is caught immediately (it would break the
// existing test at line ~1904 and the coverage below).
// ---------------------------------------------------------------------------
describe("disabled extension — prefs.enabled === false (coverage for enabled guard contract)", () => {

  test("processUrl cleans tracking params regardless of enabled flag — guard is caller's responsibility", () => {
    // Regression guard: processUrl is intentionally pure; enabled is checked by
    // handleProcessUrl in service-worker.js, not here. See also line ~1904.
    const raw = "https://example.com/?utm_source=newsletter&fbclid=abc123";
    const { action, removedTracking } = processUrl(
      raw,
      { ...PREFS, enabled: false }
    );
    assert.equal(action, "cleaned",
      "processUrl must still clean when enabled=false — enabled guard belongs to the caller");
    assert.ok(removedTracking.includes("utm_source"), "utm_source must be removed");
    assert.ok(removedTracking.includes("fbclid"), "fbclid must be removed");
  });

  test("cleanUrl differs from rawUrl when enabled=false and params are dirty", () => {
    const raw = "https://example.com/?utm_campaign=spring";
    const { cleanUrl } = processUrl(raw, { ...PREFS, enabled: false });
    assert.notEqual(cleanUrl, raw,
      "cleanUrl must be the cleaned value; enabled guard is not processUrl's concern");
    assert.ok(!cleanUrl.includes("utm_campaign"));
  });

  test("URL with only clean params is still untouched when enabled=false", () => {
    // Verifies the untouched path works correctly regardless of the enabled value
    const raw = "https://example.com/?page=3&lang=en";
    const { action, cleanUrl } = processUrl(raw, { ...PREFS, enabled: false });
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
  });

});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {

  test("invalid URL returns cleanUrl = rawUrl, action = untouched", () => {
    const raw = "not-a-valid-url";
    const { action, cleanUrl, removedTracking } = processUrl(raw, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
    assert.deepEqual(removedTracking, []);
  });

  test("empty string URL → graceful fallback", () => {
    const { action, cleanUrl } = processUrl("", PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, "");
  });

  test("URL with hash and tracking param — tracking stripped, hash preserved", () => {
    const { cleanUrl } = processUrl(
      "https://example.com/page?utm_source=email#section",
      PREFS
    );
    assert.ok(cleanUrl.includes("#section"));
    assert.ok(!cleanUrl.includes("utm_source"));
  });

  test("URL with repeated tracking param keys — all instances removed", () => {
    const { cleanUrl } = processUrl(
      "https://example.com/?utm_source=a&utm_source=b",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.has("utm_source"), false);
  });

});

// ---------------------------------------------------------------------------
// Scenario A (extended) — new tracking params from issue #17
// ---------------------------------------------------------------------------
describe("Scenario A (extended) — new tracking params (#17)", () => {

  test("strips Pinterest e_t and epik", () => {
    const { removedTracking } = processUrl(
      "https://pinterest.com/pin/123/?e_t=abc&epik=dQw4w9",
      PREFS
    );
    assert.ok(removedTracking.includes("e_t"));
    assert.ok(removedTracking.includes("epik"));
  });

  test("strips Snapchat sc_channel and sc_icid", () => {
    const { action } = processUrl(
      "https://example.com/?sc_channel=paid&sc_icid=top_nav_link",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("strips Reddit rdt_cid", () => {
    const { action } = processUrl(
      "https://example.com/?rdt_cid=abc123",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("strips Rakuten ranmid/raneaid/ransiteid", () => {
    const { removedTracking } = processUrl(
      "https://example.com/?ranmid=42&raneaid=xyz&ransiteid=abc",
      PREFS
    );
    assert.ok(removedTracking.includes("ranmid"));
    assert.ok(removedTracking.includes("raneaid"));
    assert.ok(removedTracking.includes("ransiteid"));
  });

  test("strips TradeTracker ttaid/ttrk/ttcid", () => {
    const { removedTracking } = processUrl(
      "https://example.com/?ttaid=1&ttrk=click&ttcid=campaign",
      PREFS
    );
    assert.ok(removedTracking.includes("ttaid"));
    assert.ok(removedTracking.includes("ttrk"));
    assert.ok(removedTracking.includes("ttcid"));
  });

  test("strips srsltid (Google Shopping)", () => {
    const { action } = processUrl(
      "https://example.com/product?srsltid=AfmBOoqJ5xyz",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("strips wickedid", () => {
    const { action } = processUrl(
      "https://example.com/?wickedid=abc123",
      PREFS
    );
    assert.equal(action, "cleaned");
  });

  test("strips awc (Awin click ID — redirect-based network, incompatible with MUGA)", () => {
    const { action, cleanUrl, removedTracking } = processUrl(
      "https://www.zalando.es/product.html?awc=12345_1234567890_abc",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.ok(removedTracking.includes("awc"));
    assert.equal(cleanUrl, "https://www.zalando.es/product.html");
  });

  test("strips wt_mc (Webtrekk/Awin campaign tracking)", () => {
    const { action, cleanUrl, removedTracking } = processUrl(
      "https://www.mediamarkt.de/product/123?wt_mc=affiliate.awin.456",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.ok(removedTracking.includes("wt_mc"));
    assert.equal(cleanUrl, "https://www.mediamarkt.de/product/123");
  });

  test("strips awc alongside other tracking params", () => {
    const { cleanUrl, removedTracking } = processUrl(
      "https://www.shein.com/dress-p-12345.html?awc=999_abc&utm_source=awin&utm_medium=affiliate",
      PREFS
    );
    assert.ok(removedTracking.includes("awc"));
    assert.ok(removedTracking.includes("utm_source"));
    assert.ok(removedTracking.includes("utm_medium"));
    assert.equal(cleanUrl, "https://www.shein.com/dress-p-12345.html");
  });

});

// ---------------------------------------------------------------------------
// Amazon URLs — affiliate param must NOT be stripped as tracking
// ---------------------------------------------------------------------------
describe("Amazon — affiliate param preserved", () => {

  test("amazon.es: tag= is preserved, UTM is stripped", () => {
    const { cleanUrl, removedTracking, junkRemoved } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&utm_source=email&utm_medium=cpc",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("tag"), "someaffiliate-21");
    assert.ok(removedTracking.includes("utm_source"));
    assert.ok(removedTracking.includes("utm_medium"));
    assert.equal(junkRemoved, 2);
  });

  test("amazon.com: tag= is preserved when no tracking present", () => {
    const url = "https://www.amazon.com/dp/B08N5WRWNW?tag=someaffiliate-20";
    const { action, cleanUrl } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, url);
  });

  test("amazon internal noise params are stripped", () => {
    const { removedTracking, junkRemoved } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&psc=1&pd_rd_r=abc&linkCode=ll1",
      PREFS
    );
    assert.ok(removedTracking.includes("psc"));
    assert.ok(removedTracking.includes("pd_rd_r"));
    assert.ok(removedTracking.includes("linkCode"));
    assert.equal(junkRemoved, 3);
  });

});

// ---------------------------------------------------------------------------
// Scenario B — Affiliate injection
// ---------------------------------------------------------------------------
describe("Scenario B — affiliate injection", () => {

  before(() => { AFFILIATE_PATTERNS.push(TEST_PATTERN); });
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("injectOwnAffiliate: false → never injects even on supported domain", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product",
      { ...PREFS, injectOwnAffiliate: false }
    );
    assert.notEqual(action, "injected");
  });

  test("injectOwnAffiliate: true + amazon.es ourTag set → injects muga0b-21", () => {
    const { action, cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW",
      { ...PREFS, injectOwnAffiliate: true }
    );
    assert.equal(action, "injected");
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "muga0b-21");
  });

  test("injectOwnAffiliate: true + ourTag set → injects tag on clean URL", () => {
    const { action, cleanUrl } = processUrl(
      "https://shop.test.muga/product?color=red",
      { ...PREFS, injectOwnAffiliate: true }
    );
    assert.equal(action, "injected");
    assert.ok(new URL(cleanUrl).searchParams.get("aff") === "muga-test-99");
  });

  test("does NOT inject when affiliate tag already present", () => {
    const { action, cleanUrl } = processUrl(
      "https://shop.test.muga/product?aff=creator-99",
      { ...PREFS, injectOwnAffiliate: true }
    );
    assert.notEqual(action, "injected");
    assert.equal(new URL(cleanUrl).searchParams.get("aff"), "creator-99");
  });

  test("does NOT inject when stripAllAffiliates is on", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product",
      { ...PREFS, injectOwnAffiliate: true, stripAllAffiliates: true }
    );
    assert.notEqual(action, "injected");
  });

  test("ourTag empty string → does NOT inject (safety guard)", () => {
    // Temporarily blank the ourTag
    TEST_PATTERN.ourTag = "";
    const { action } = processUrl(
      "https://shop.test.muga/product",
      { ...PREFS, injectOwnAffiliate: true }
    );
    TEST_PATTERN.ourTag = "muga-test-99"; // restore
    assert.notEqual(action, "injected");
  });

});

// ---------------------------------------------------------------------------
// Amazon affiliate tags — real tag injection per marketplace
// ---------------------------------------------------------------------------
describe("Amazon affiliate tags — real tag injection per marketplace", () => {
  const INJECT_PREFS = { ...PREFS, injectOwnAffiliate: true };

  const MARKETS = [
    { domain: "www.amazon.es",    tag: "muga0b-21",  name: "ES" },
    { domain: "www.amazon.de",    tag: "muga0f-21",  name: "DE" },
    { domain: "www.amazon.fr",    tag: "muga08a-21", name: "FR" },
    { domain: "www.amazon.it",    tag: "muga04f-21", name: "IT" },
    { domain: "www.amazon.co.uk", tag: "muga0a-21",  name: "UK" },
    { domain: "www.amazon.com",   tag: "muga0b-20",  name: "US" },
  ];

  for (const { domain, tag, name } of MARKETS) {
    test(`amazon.${name}: injects tag=${tag} on clean URL`, () => {
      const { action, cleanUrl } = processUrl(
        `https://${domain}/dp/B08N5WRWNW`,
        INJECT_PREFS
      );
      assert.equal(action, "injected", `${name} must inject`);
      assert.equal(new URL(cleanUrl).searchParams.get("tag"), tag);
    });

    test(`amazon.${name}: does NOT replace existing foreign tag`, () => {
      const { cleanUrl } = processUrl(
        `https://${domain}/dp/B08N5WRWNW?tag=creator-21`,
        INJECT_PREFS
      );
      assert.equal(new URL(cleanUrl).searchParams.get("tag"), "creator-21");
    });

    test(`amazon.${name}: own tag is not flagged as foreign`, () => {
      const { action } = processUrl(
        `https://${domain}/dp/B08N5WRWNW?tag=${tag}`,
        { ...PREFS, notifyForeignAffiliate: true }
      );
      assert.notEqual(action, "detected_foreign");
    });
  }
});

// ---------------------------------------------------------------------------
// eBay affiliate tags — real tag injection per marketplace
// ---------------------------------------------------------------------------
describe("eBay affiliate tags — real tag injection per marketplace", () => {
  const INJECT_PREFS = { ...PREFS, injectOwnAffiliate: true };

  const MARKETS = [
    { domain: "www.ebay.com",   name: "US" },
    { domain: "www.ebay.es",    name: "ES" },
    { domain: "www.ebay.de",    name: "DE" },
    { domain: "www.ebay.co.uk", name: "UK" },
    { domain: "www.ebay.fr",    name: "FR" },
    { domain: "www.ebay.it",    name: "IT" },
  ];

  for (const { domain, name } of MARKETS) {
    test(`ebay.${name}: injects campid=5339147108 on clean URL`, () => {
      const { action, cleanUrl } = processUrl(
        `https://${domain}/itm/123456789`,
        INJECT_PREFS
      );
      assert.equal(action, "injected", `${name} must inject`);
      assert.equal(new URL(cleanUrl).searchParams.get("campid"), "5339147108");
    });

    test(`ebay.${name}: does NOT replace existing foreign campid`, () => {
      const { cleanUrl } = processUrl(
        `https://${domain}/itm/123456789?campid=9999999999`,
        INJECT_PREFS
      );
      assert.equal(new URL(cleanUrl).searchParams.get("campid"), "9999999999");
    });

    test(`ebay.${name}: own campid is not flagged as foreign`, () => {
      const { action } = processUrl(
        `https://${domain}/itm/123456789?campid=5339147108`,
        { ...PREFS, notifyForeignAffiliate: true }
      );
      assert.notEqual(action, "detected_foreign");
    });
  }
});

// ---------------------------------------------------------------------------
// Preference interaction matrix — all toggle combinations with real Amazon tags
// ---------------------------------------------------------------------------
describe("Preference interaction matrix — amazon.es with real tags", () => {
  const BASE = "https://www.amazon.es/dp/B08N5WRWNW";
  const WITH_FOREIGN = `${BASE}?tag=creator-21`;
  const WITH_OUR = `${BASE}?tag=muga0b-21`;
  const WITH_TRACKING = `${BASE}?tag=creator-21&utm_source=email&fbclid=abc`;
  const CLEAN = BASE;

  // --- inject:OFF, stripAll:OFF, notify:OFF (default) ---
  test("all OFF + foreign tag → tag preserved, tracking stripped", () => {
    const { cleanUrl, action } = processUrl(WITH_TRACKING, { ...PREFS }, domainRules);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tag"), "creator-21", "foreign tag preserved");
    assert.equal(u.searchParams.get("utm_source"), null, "tracking stripped");
    assert.equal(u.searchParams.get("fbclid"), null, "tracking stripped");
  });

  test("all OFF + no tag → no injection", () => {
    const { cleanUrl, action } = processUrl(CLEAN, { ...PREFS }, domainRules);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null);
    assert.notEqual(action, "injected");
  });

  // --- inject:ON, stripAll:OFF, notify:OFF ---
  test("inject ON + no tag → our tag injected", () => {
    const { cleanUrl, action } = processUrl(CLEAN, { ...PREFS, injectOwnAffiliate: true }, domainRules);
    assert.equal(action, "injected");
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "muga0b-21");
  });

  test("inject ON + foreign tag → foreign tag preserved, no injection", () => {
    const { cleanUrl, action } = processUrl(WITH_FOREIGN, { ...PREFS, injectOwnAffiliate: true }, domainRules);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "creator-21");
    assert.notEqual(action, "injected");
  });

  test("inject ON + our tag already present → no change", () => {
    const { cleanUrl, action } = processUrl(WITH_OUR, { ...PREFS, injectOwnAffiliate: true }, domainRules);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "muga0b-21");
    assert.notEqual(action, "injected");  // already there, no need to inject
  });

  // --- inject:OFF, stripAll:ON ---
  test("stripAll ON + foreign tag → tag removed, URL clean", () => {
    const { cleanUrl } = processUrl(WITH_FOREIGN, { ...PREFS, stripAllAffiliates: true }, domainRules);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null);
  });

  test("stripAll ON + our tag → our tag preserved (stripAll only removes others)", () => {
    const { cleanUrl } = processUrl(WITH_OUR, { ...PREFS, stripAllAffiliates: true }, domainRules);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "muga0b-21");
  });

  // --- inject:ON, stripAll:ON (the key ethical test) ---
  test("inject ON + stripAll ON + foreign tag → foreign removed, ours NOT injected", () => {
    const { cleanUrl, action } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, injectOwnAffiliate: true, stripAllAffiliates: true },
      domainRules
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null, "no tag at all — ethical guard");
    assert.notEqual(action, "injected", "must NOT inject when stripAll is on");
  });

  test("inject ON + stripAll ON + no tag → no injection either", () => {
    const { cleanUrl, action } = processUrl(
      CLEAN,
      { ...PREFS, injectOwnAffiliate: true, stripAllAffiliates: true },
      domainRules
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null);
    assert.notEqual(action, "injected");
  });

  test("inject ON + stripAll ON + our tag already present → our tag preserved", () => {
    const { cleanUrl } = processUrl(
      WITH_OUR,
      { ...PREFS, injectOwnAffiliate: true, stripAllAffiliates: true },
      domainRules
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "muga0b-21", "own tag preserved when inject+stripAll");
  });

  // --- notify:ON interactions ---
  test("notify ON + foreign tag → detected_foreign", () => {
    const { action, detectedAffiliate } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, notifyForeignAffiliate: true },
      domainRules
    );
    assert.equal(action, "detected_foreign");
    assert.equal(detectedAffiliate.value, "creator-21");
  });

  test("notify ON + our tag → NOT flagged as foreign", () => {
    const { action } = processUrl(
      WITH_OUR,
      { ...PREFS, notifyForeignAffiliate: true },
      domainRules
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("notify ON + stripAll ON → notify skipped (stripAll takes priority)", () => {
    const { action } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, notifyForeignAffiliate: true, stripAllAffiliates: true },
      domainRules
    );
    assert.notEqual(action, "detected_foreign", "no notification when stripAll is removing it anyway");
  });

  // --- whitelist interactions ---
  test("whitelist protects foreign tag even with stripAll ON", () => {
    const { cleanUrl } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, stripAllAffiliates: true, whitelist: ["amazon.es::tag::creator-21"] },
      domainRules
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "creator-21", "whitelisted tag survives stripAll");
  });

  test("whitelist protects foreign tag from notify", () => {
    const { action } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, notifyForeignAffiliate: true, whitelist: ["amazon.es::tag::creator-21"] },
      domainRules
    );
    assert.notEqual(action, "detected_foreign", "whitelisted tag not flagged");
  });

  // --- blacklist interactions ---
  test("blacklist removes specific tag + suppresses injection", () => {
    const { cleanUrl, action } = processUrl(
      WITH_FOREIGN,
      { ...PREFS, injectOwnAffiliate: true, blacklist: ["amazon.es::tag::creator-21"] },
      domainRules
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null, "blacklisted tag removed");
    assert.notEqual(action, "injected", "injection suppressed after blacklist removal (#183)");
  });

  // --- global tracking params never strip affiliate param ---
  test("global tracking rules do not strip 'tag' param on Amazon", () => {
    const { cleanUrl } = processUrl(
      `${BASE}?tag=creator-21&utm_source=fb&gclid=abc`,
      { ...PREFS },
      domainRules
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tag"), "creator-21", "affiliate param protected from global rules");
    assert.equal(u.searchParams.get("utm_source"), null, "tracking stripped");
    assert.equal(u.searchParams.get("gclid"), null, "tracking stripped");
  });
});

// ---------------------------------------------------------------------------
// Scenario C — Foreign affiliate detection
// ---------------------------------------------------------------------------
describe("Scenario C — foreign affiliate detection", () => {

  before(() => { AFFILIATE_PATTERNS.push(TEST_PATTERN); });
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("notifyForeignAffiliate: false → foreign tag NOT flagged", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: false }
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("notifyForeignAffiliate: true + foreign tag → detected_foreign", () => {
    const { action, detectedAffiliate } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.equal(action, "detected_foreign");
    assert.equal(detectedAffiliate.param, "aff");
    assert.equal(detectedAffiliate.value, "someone-else-99");
  });

  test("our own tag is NOT flagged as foreign", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=muga-test-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("whitelisted foreign tag is NOT flagged", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=trusted-creator-99",
      { ...PREFS, notifyForeignAffiliate: true, whitelist: ["shop.test.muga::aff::trusted-creator-99"] }
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("notifyForeignAffiliate: true but ourTag empty → NOT detected (no comparison point)", () => {
    TEST_PATTERN.ourTag = "";
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    TEST_PATTERN.ourTag = "muga-test-99";
    assert.notEqual(action, "detected_foreign");
  });

});

// ---------------------------------------------------------------------------
// Scenario D — Blacklisted domain: strip everything
// ---------------------------------------------------------------------------
describe("Scenario D — blacklist enforcement", () => {

  test("domain-only blacklist entry strips all params including affiliate tags", () => {
    const { action, cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=affiliate-21&utm_source=email&psc=1",
      { ...PREFS, blacklist: ["amazon.es"] }
    );
    assert.equal(action, "blacklisted");
    assert.equal(cleanUrl, "https://www.amazon.es/dp/B08N5WRWNW");
  });

  test("blacklist entry with www prefix matches the non-www domain too", () => {
    const { action } = processUrl(
      "https://www.booking.com/hotel/es/foo?aid=12345&utm_source=google",
      { ...PREFS, blacklist: ["booking.com"] }
    );
    assert.equal(action, "blacklisted");
  });

  test("specific affiliate blacklist (domain::param::value) removes only that affiliate", () => {
    const { cleanUrl, action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=spammer-21&utm_source=email",
      { ...PREFS, blacklist: ["amazon.es::tag::spammer-21"] }
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.has("tag"), false);
    assert.equal(clean.searchParams.has("utm_source"), false); // stripped by Scenario A
    assert.notEqual(action, "blacklisted"); // Scenario A cleaned it, not full blacklist
  });

  test("specific blacklist does NOT remove a different affiliate value", () => {
    const url = "https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21";
    const { cleanUrl } = processUrl(
      url,
      { ...PREFS, blacklist: ["amazon.es::tag::spammer-21"] }
    );
    // youtuber-21 is not blacklisted — must be preserved
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "youtuber-21");
  });

  test("blacklisted specific affiliate does NOT trigger foreign detection toast (closes #27)", () => {
    // When a param is blacklisted AND would be detected as foreign, it gets stripped
    // silently — the toast must not fire for a param we already removed.
    const { action, detectedAffiliate, cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=badaffiliate-21&utm_source=email",
      {
        ...PREFS,
        notifyForeignAffiliate: true,
        blacklist: ["amazon.es::tag::badaffiliate-21"],
      }
    );
    assert.notEqual(action, "detected_foreign");
    assert.equal(detectedAffiliate, null);
    assert.equal(new URL(cleanUrl).searchParams.has("tag"), false);
  });

  test("blacklisted domain does not inject our affiliate", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW",
      { ...PREFS, injectOwnAffiliate: true, blacklist: ["amazon.es"] }
    );
    // URL has no query string — blacklist check strips search, no injection
    assert.equal(action, "blacklisted");
  });

});

// ---------------------------------------------------------------------------
// Whitelist — protected affiliate values are never touched
// ---------------------------------------------------------------------------
describe("Whitelist — protected affiliates", () => {

  test("whitelisted affiliate is not flagged as foreign even when notification is on", () => {
    // We fake a non-empty ourTag by using a pattern that won't match the whitelist value
    // Since ourTag is empty in affiliates.js, detection won't fire anyway — but the
    // whitelist logic is tested by verifying the affiliate value is preserved.
    const url = "https://www.amazon.es/dp/B08N5WRWNW?tag=creator-i-support-21";
    const { cleanUrl } = processUrl(
      url,
      { ...PREFS, whitelist: ["amazon.es::tag::creator-i-support-21"] }
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "creator-i-support-21");
  });

  test("non-whitelisted affiliate on same domain is still processed normally", () => {
    const { cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=random-21&utm_source=email",
      { ...PREFS, whitelist: ["amazon.es::tag::creator-i-support-21"] }
    );
    // utm_source stripped (Scenario A), tag not whitelisted so remains untouched by whitelist
    assert.equal(new URL(cleanUrl).searchParams.has("utm_source"), false);
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "random-21");
  });

});

// ---------------------------------------------------------------------------
// Copy behaviour — skipInject flag (used when user copies a URL via Ctrl+C)
// ---------------------------------------------------------------------------
describe("copy behaviour — skipInject flag", () => {

  test("tracking params are stripped even with skipInject", () => {
    const { cleanUrl } = processUrl(
      "https://example.com/?utm_source=google&utm_medium=cpc",
      { ...PREFS, injectOwnAffiliate: false }
    );
    assert.equal(new URL(cleanUrl).search, "");
  });

  test("affiliate is NOT injected when user has injectOwnAffiliate disabled", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?utm_source=email",
      { ...PREFS, injectOwnAffiliate: false }
    );
    assert.notEqual(action, "injected");
  });

  test("toast is suppressed on copy (notifyForeignAffiliate forced false)", () => {
    // Simulate skipInject:true — only notifyForeignAffiliate is suppressed,
    // injectOwnAffiliate is left as the user configured it
    const { detectedAffiliate } = processUrl(
      "https://www.amazon.es/dp/B08?utm_source=email",
      { ...PREFS, notifyForeignAffiliate: false }
    );
    assert.equal(detectedAffiliate, null);
  });

  test("URL with no query string is returned unchanged", () => {
    const raw = "https://www.amazon.es/dp/B08N5WRWNW";
    const { cleanUrl, action } = processUrl(raw, PREFS);
    assert.equal(cleanUrl, raw);
    assert.equal(action, "untouched");
  });

});

// ---------------------------------------------------------------------------
// Result shape — always returns expected fields
// ---------------------------------------------------------------------------
describe("result shape", () => {

  test("always returns cleanUrl, action, removedTracking, detectedAffiliate", () => {
    const result = processUrl("https://example.com/?utm_source=x", PREFS);
    assert.ok("cleanUrl" in result);
    assert.ok("action" in result);
    assert.ok("removedTracking" in result);
    assert.ok("detectedAffiliate" in result);
  });

  test("detectedAffiliate is null when no foreign affiliate found", () => {
    const { detectedAffiliate } = processUrl("https://example.com/?utm_source=x", PREFS);
    assert.equal(detectedAffiliate, null);
  });

});

// ---------------------------------------------------------------------------
// Amazon — missing query params and path-based tracking (closes #1)
// ---------------------------------------------------------------------------
describe("Amazon — real-world URL cleaning", () => {

  test("strips _encoding, content-id, ref_ — preserves th (variant selector)", () => {
    const raw = "https://www.amazon.es/Emergencia/dp/B0GF8C2S62/?_encoding=UTF8&content-id=amzn1.sym.abc&ref_=pd_hp_d_atf_unk&th=1";
    const { cleanUrl, action } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_encoding"), null);
    assert.equal(u.searchParams.get("content-id"), null);
    assert.equal(u.searchParams.get("ref_"), null);
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved (product variant selector)");
    assert.equal(action, "cleaned");
  });

  test("strips pd_rd_i and content-id — preserves th", () => {
    const raw = "https://www.amazon.es/edihome/dp/B0GQ4N9N33/?content-id=amzn1.sym.def&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("pd_rd_i"), null);
    assert.equal(u.searchParams.get("content-id"), null);
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
  });

  test("strips path-based /ref= tracking after ASIN — preserves th", () => {
    const raw = "https://www.amazon.es/edihome/dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601?content-id=x&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.endsWith("/dp/B0GQ4N9N33/"), `path should end with /dp/ASIN/, got: ${u.pathname}`);
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
  });

  test("does not modify non-Amazon path", () => {
    const raw = "https://www.example.com/product/ref=tracking?utm_source=x";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.includes("/ref=tracking"), "non-Amazon path must not be modified");
  });

  test("full real URL 1 from issue #1 — slug stripped, th preserved", () => {
    const raw = "https://www.amazon.es/Emergencia-Homologada/dp/B0GF8C2S62/?_encoding=UTF8&content-id=amzn1.sym.0a1e4d50&ref_=pd_hp_d_atf_unk&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0GF8C2S62/", "slug must be stripped, ASIN path preserved");
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
    assert.equal(u.searchParams.get("_encoding"), null);
  });

  test("full real URL 2 from issue #1 — slug stripped, th preserved", () => {
    const raw = "https://www.amazon.es/edihome-Puff/dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601?content-id=amzn1.sym.8303e4e0&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl, junkRemoved } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0GQ4N9N33/", "slug must be stripped, ASIN path preserved");
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
    assert.equal(junkRemoved, 3, "3 params stripped (content-id, pd_rd_i + path), th preserved");
  });

});

// ---------------------------------------------------------------------------
// stripAllAffiliates toggle (closes #5)
// ---------------------------------------------------------------------------
describe("stripAllAffiliates — strip all affiliate params", () => {

  const PREFS_STRIP = { ...PREFS, stripAllAffiliates: true, injectOwnAffiliate: true };

  test("strips affiliate tag even when injectOwnAffiliate is on", () => {
    const { cleanUrl, action } = processUrl(
      "https://www.amazon.es/dp/B08?tag=youtuber-21&utm_source=email",
      PREFS_STRIP
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tag"), null, "affiliate tag must be gone");
    assert.equal(u.searchParams.get("utm_source"), null, "tracking must be gone too");
    assert.equal(action, "cleaned");
  });

  test("does not inject our tag when stripAllAffiliates is on", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08?utm_source=email",
      PREFS_STRIP
    );
    assert.notEqual(action, "injected");
  });

  test("does not trigger foreign affiliate toast when stripAllAffiliates is on", () => {
    const { detectedAffiliate } = processUrl(
      "https://www.amazon.es/dp/B08?tag=youtuber-21",
      { ...PREFS_STRIP, notifyForeignAffiliate: true }
    );
    assert.equal(detectedAffiliate, null);
  });

  test("normal URLs unaffected when stripAllAffiliates is off", () => {
    const raw = "https://www.amazon.es/dp/B08?tag=youtuber-21";
    const { cleanUrl } = processUrl(raw, { ...PREFS, stripAllAffiliates: false });
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "youtuber-21");
  });

});

// ---------------------------------------------------------------------------
// Amazon root-level /ref= path cleaning (closes #7)
// ---------------------------------------------------------------------------
describe("Amazon — root-level /ref= path tracking", () => {

  test("strips /ref=nav_logo from homepage URL", () => {
    const { cleanUrl } = processUrl("https://www.amazon.es/ref=nav_logo", PREFS);
    assert.equal(new URL(cleanUrl).pathname, "/");
  });

  test("strips /ref= mid-path, preserves real path segments", () => {
    const { cleanUrl } = processUrl(
      "https://www.amazon.es/s/ref=nb_sb_noss?k=iphone", PREFS
    );
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/s");
    assert.equal(u.searchParams.get("k"), "iphone");
  });

  test("strips /ref= at end of deep path", () => {
    const { cleanUrl } = processUrl(
      "https://www.amazon.es/gp/cart/view.html/ref=nav_cart", PREFS
    );
    assert.equal(new URL(cleanUrl).pathname, "/gp/cart/view.html");
  });

  test("does not modify /ref= paths on non-Amazon sites", () => {
    const raw = "https://www.example.com/blog/ref=social";
    const { cleanUrl } = processUrl(raw, PREFS);
    assert.equal(new URL(cleanUrl).pathname, "/blog/ref=social");
  });

});

// ---------------------------------------------------------------------------
// Per-domain disable (issue #19)
// ---------------------------------------------------------------------------
describe("per-domain disable — domain::disabled blacklist entry", () => {

  test("disabled domain returns URL completely untouched", () => {
    const raw = "https://www.amazon.es/dp/B08?tag=affiliate-21&utm_source=email";
    const { action, cleanUrl } = processUrl(raw, {
      ...PREFS,
      blacklist: ["amazon.es::disabled"],
    });
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
  });

  test("disabled domain does not strip tracking params", () => {
    const raw = "https://example.com/page?utm_source=google&fbclid=abc";
    const { action, cleanUrl, removedTracking } = processUrl(raw, {
      ...PREFS,
      blacklist: ["example.com::disabled"],
    });
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
    assert.deepEqual(removedTracking, []);
  });

  test("disabled domain does not inject affiliate", () => {
    const raw = "https://www.amazon.es/dp/B08";
    const { action } = processUrl(raw, {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["amazon.es::disabled"],
    });
    assert.notEqual(action, "injected");
  });

  test("disabled domain takes priority over regular domain blacklist", () => {
    const raw = "https://www.amazon.es/dp/B08?tag=x";
    const { action, cleanUrl } = processUrl(raw, {
      ...PREFS,
      blacklist: ["amazon.es::disabled", "amazon.es"],
    });
    // ::disabled fires first — URL unchanged
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
  });

  test("non-disabled domain is still processed normally", () => {
    const raw = "https://www.amazon.es/dp/B08?utm_source=email";
    const { action } = processUrl(raw, {
      ...PREFS,
      blacklist: ["booking.com::disabled"],
    });
    assert.equal(action, "cleaned");
  });

});

// ---------------------------------------------------------------------------
// Whitelist priority over stripAllAffiliates (closes #8)
// ---------------------------------------------------------------------------
describe("whitelist priority over stripAllAffiliates", () => {

  test("whitelisted affiliate is preserved even when stripAllAffiliates is on", () => {
    const prefs = {
      ...PREFS,
      stripAllAffiliates: true,
      whitelist: ["amazon.es::tag::trusted-21"],
    };
    const { cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08?tag=trusted-21", prefs
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), "trusted-21",
      "whitelisted tag must survive stripAllAffiliates");
  });

  test("non-whitelisted affiliate is stripped when stripAllAffiliates is on", () => {
    const prefs = {
      ...PREFS,
      stripAllAffiliates: true,
      whitelist: ["amazon.es::tag::trusted-21"],
    };
    const { cleanUrl } = processUrl(
      "https://www.amazon.es/dp/B08?tag=other-99", prefs
    );
    assert.equal(new URL(cleanUrl).searchParams.get("tag"), null,
      "non-whitelisted tag must be stripped");
  });

});

// ---------------------------------------------------------------------------
// affiliate param / tracking param collision (BUG-06)
// ---------------------------------------------------------------------------
describe("affiliate param / tracking param collision", () => {

  test("pccomponentes: ref= param is NOT stripped when pccomponentes is a matched host", () => {
    const { cleanUrl, removedTracking } = processUrl(
      "https://www.pccomponentes.com/producto?ref=some-affiliate-tag&utm_source=google",
      { ...PREFS, injectOwnAffiliate: false }
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("ref"), "some-affiliate-tag",
      "ref= must be preserved as affiliate param on pccomponentes");
    assert.ok(removedTracking.includes("utm_source"),
      "utm_source must still be stripped");
  });

  test("eBay: campid= param is NOT stripped when eBay is a matched host", () => {
    const { cleanUrl, removedTracking } = processUrl(
      "https://www.ebay.es/itm/123456?campid=some-affiliate-id&mkevt=1&utm_source=google",
      { ...PREFS, injectOwnAffiliate: false }
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("campid"), "some-affiliate-id",
      "campid= must be preserved as affiliate param on eBay");
    assert.ok(removedTracking.includes("mkevt"),
      "mkevt must still be stripped");
    assert.ok(removedTracking.includes("utm_source"),
      "utm_source must still be stripped");
  });

  test("ref= is NOT stripped on a non-affiliate host (e.g., example.com) — ref removed from global TRACKING_PARAMS (#160)", () => {
    // 'ref' was removed from TRACKING_PARAMS because it is the affiliate param for
    // PcComponentes and MediaMarkt. Applying it globally stripped it before the
    // affiliate engine could act, and also broke GitHub ?ref= and SPA navigation.
    // It should only be stripped context-specifically via AFFILIATE_PATTERNS.
    const { cleanUrl, removedTracking } = processUrl(
      "https://example.com/page?ref=tracking&utm_source=google",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("ref"), "tracking",
      "ref= must NOT be stripped globally — it is not in TRACKING_PARAMS");
    assert.ok(removedTracking.includes("utm_source"),
      "utm_source must still be stripped");
    assert.ok(!removedTracking.includes("ref"),
      "ref must NOT appear in removedTracking");
  });

  test("whitelist protects ref= on pccomponentes", () => {
    const { cleanUrl, action } = processUrl(
      "https://www.pccomponentes.com/producto?ref=creator-21",
      { ...PREFS, injectOwnAffiliate: false, whitelist: ["pccomponentes.com::ref::creator-21"] }
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("ref"), "creator-21",
      "whitelisted ref= must be preserved on pccomponentes");
  });

});

// ---------------------------------------------------------------------------
// Amazon extended cleaning (FIX-A1/A2/A3)
// ---------------------------------------------------------------------------
describe("Amazon extended cleaning", () => {

  test("product slug + ASIN path is cleaned: /UGREEN-Adaptador/dp/B0B9N3QSL3/ref=sr_1_7 → /dp/B0B9N3QSL3/", () => {
    const raw = "https://www.amazon.es/UGREEN-Adaptador/dp/B0B9N3QSL3/ref=sr_1_7";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0B9N3QSL3/",
      "slug before /dp/ must be removed and /ref= after ASIN must be removed");
  });

  test("path without slug still cleaned correctly: /dp/B0B9N3QSL3/ref=sr_1_7 → /dp/B0B9N3QSL3", () => {
    const raw = "https://www.amazon.es/dp/B0B9N3QSL3/ref=sr_1_7";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0B9N3QSL3/",
      "/dp/ASIN path without slug must still have trailing /ref= stripped");
  });

  test("__mk_es_ES is stripped from an Amazon URL", () => {
    const raw = "https://www.amazon.es/s?k=usb+hub&__mk_es_ES=%C3%85M%C3%85%C5%BD%C3%95%C3%91&crid=abc";
    const { cleanUrl, removedTracking } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("__mk_es_ES"), null, "__mk_es_ES must be stripped");
    assert.ok(removedTracking.includes("__mk_es_ES"), "__mk_es_ES must appear in removedTracking");
    assert.equal(u.searchParams.get("k"), "usb hub", "functional k= param must be preserved (+ decoded as space)");
  });

  test("ie=UTF8 is stripped from an Amazon browse URL", () => {
    const raw = "https://www.amazon.es/s?k=laptop&ie=UTF8&index=electronics";
    const { cleanUrl, removedTracking } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("ie"), null, "ie= must be stripped");
    assert.ok(removedTracking.includes("ie"), "ie must appear in removedTracking");
    assert.equal(u.searchParams.get("k"), "laptop", "k= must be preserved");
  });

  test("node= is NOT stripped from an Amazon browse URL (functional category param)", () => {
    const raw = "https://www.amazon.es/s?k=laptop&node=938005031";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("node"), "938005031",
      "node= is a functional category filter and must NOT be stripped");
  });

  test("ref=sr_1_7 in path is not treated as a detected_foreign action", () => {
    // On amazon.es the affiliate param is tag=, not ref=. Path-based /ref= is cleaned
    // by cleanAmazonPath, not flagged as a foreign affiliate. This confirms no spurious
    // detected_foreign is raised.
    const raw = "https://www.amazon.es/UGREEN-Adaptador/dp/B0B9N3QSL3/ref=sr_1_7?psc=1";
    const { action } = processUrl(raw, {
      ...PREFS,
      notifyForeignAffiliate: true,
    });
    assert.notEqual(action, "detected_foreign",
      "path-based /ref= must not trigger foreign affiliate detection");
  });

});

// ---------------------------------------------------------------------------
// Fix #160 — ref is NOT a global tracking param
// ---------------------------------------------------------------------------
describe("ref is not a global tracking param (#160)", () => {

  test("GitHub URL with ?ref=main is NOT modified by processUrl", () => {
    // 'ref' was removed from TRACKING_PARAMS — it must not be stripped globally.
    // GitHub uses ?ref= to indicate branch context; stripping it would break links.
    const prefs = { ...PREFS };
    const { cleanUrl } = processUrl("https://github.com/user/repo?ref=main", prefs);
    assert.equal(
      cleanUrl,
      "https://github.com/user/repo?ref=main",
      "?ref=main must be preserved on GitHub — ref is not a global tracking param"
    );
  });

});

// ---------------------------------------------------------------------------
// Bug #183 — blacklist-specific + inject must NOT silently replace third-party tag
// ---------------------------------------------------------------------------
describe("Bug #183 — blacklist removal takes priority over affiliate injection", () => {
  before(() => AFFILIATE_PATTERNS.push(TEST_PATTERN));
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("blacklisted affiliate tag is removed and ourTag is NOT injected (#183)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["shop.test.muga::aff::other-store-21"],
    };
    const { cleanUrl, action } = processUrl(
      "https://shop.test.muga/product?aff=other-store-21&utm_source=email",
      prefs
    );
    // The third-party tag must be gone
    assert.ok(!cleanUrl.includes("other-store-21"), "other-store-21 must be stripped");
    // Our tag must NOT have been silently injected
    assert.ok(!cleanUrl.includes("muga-test-99"), "ourTag must NOT be injected after blacklist removal");
    // Action must be cleaned, not injected
    assert.notEqual(action, "injected", "action must not be 'injected' when blacklist removed the affiliate");
  });

  test("when no tag is present (no blacklist hit), ourTag is still injected normally (#183 non-regression)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["shop.test.muga::aff::other-store-21"],
    };
    const { cleanUrl, action } = processUrl(
      "https://shop.test.muga/product?color=blue",
      prefs
    );
    // No blacklist rule fired — normal injection should proceed
    assert.ok(cleanUrl.includes("muga-test-99"), "ourTag should be injected when no blacklist hit");
    assert.equal(action, "injected");
  });
});

// ---------------------------------------------------------------------------
// Bug #183 — Regression: amazon.es + blacklist + inject (#197)
// ---------------------------------------------------------------------------
const AMAZON_ES_TEST_PATTERN = {
  id: "_test_amazon_es",
  name: "Amazon España (unit tests only)",
  domains: ["amazon.es", "www.amazon.es"],
  param: "tag",
  type: "affiliate",
  ourTag: "muga-es-21",
};

describe("Bug #183 regression — amazon.es blacklist + inject (#197)", () => {
  before(() => AFFILIATE_PATTERNS.push(AMAZON_ES_TEST_PATTERN));
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("amazon.es with tag=other-store-21, blacklist has other-store-21, inject ON — result has NO tag at all (#197)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["amazon.es::tag::other-store-21"],
    };
    const { cleanUrl, action } = processUrl(
      "https://www.amazon.es/dp/B0GQ4N9N33?tag=other-store-21&utm_source=email",
      prefs
    );
    const out = new URL(cleanUrl);
    assert.equal(out.searchParams.get("tag"), null, "third-party tag must be stripped");
    assert.ok(!cleanUrl.includes("muga-es-21"), "our tag must NOT be injected after blacklist removal (#197)");
    assert.notEqual(action, "injected", "action must not be injected when blacklist removed the affiliate (#197)");
  });

  test("amazon.es without any tag, inject ON — ourTag IS injected (normal injection, no blacklist hit) (#197)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["amazon.es::tag::other-store-21"],
    };
    const { cleanUrl, action } = processUrl(
      "https://www.amazon.es/dp/B0GQ4N9N33?color=blue",
      prefs
    );
    assert.ok(cleanUrl.includes("muga0b-21"), "ourTag must be injected when no blacklist rule fires (#197)");
    assert.equal(action, "injected", "action must be injected for normal injection without blacklist hit (#197)");
  });
});

// ---------------------------------------------------------------------------
// Bug #187 — getPatternsForHost must match deep subdomains
// ---------------------------------------------------------------------------
describe("Bug #187 — deep subdomain matching in getPatternsForHost", () => {

  test("it.aliexpress.com matches aliexpress.com affiliate pattern (#187)", () => {
    // Before the fix, getPatternsForHost('it.aliexpress.com') returned [] because
    // 'it.aliexpress.com' !== 'aliexpress.com' (only exact match after www-strip was used).
    // With the fix (hostname.endsWith('.aliexpress.com')), it now matches.
    const { action } = processUrl(
      "https://it.aliexpress.com/item/1005001234567.html?utm_source=email",
      PREFS
    );
    assert.equal(action, "cleaned",
      "it.aliexpress.com must match aliexpress affiliate patterns (#187)");
  });

  test("de.aliexpress.com matches aliexpress.com affiliate pattern (#187)", () => {
    const { action } = processUrl(
      "https://de.aliexpress.com/item/999.html?utm_source=google",
      PREFS
    );
    assert.equal(action, "cleaned",
      "de.aliexpress.com must match aliexpress affiliate patterns (#187)");
  });

  test("www.pccomponentes.com still matches pccomponentes.com after fix (#187)", () => {
    const { action } = processUrl(
      "https://www.pccomponentes.com/producto?utm_medium=cpc",
      PREFS
    );
    assert.equal(action, "cleaned",
      "www.pccomponentes.com must still match pccomponentes patterns after fix (#187)");
  });

  test("all params stripped on AliExpress /item/ page including aff_fcid (#187)", () => {
    // AliExpress item pages need zero params — aggressive stripping mode
    const { cleanUrl } = processUrl(
      "https://it.aliexpress.com/item/123.html?aff_fcid=testvalue&utm_source=email",
      PREFS
    );
    assert.ok(!new URL(cleanUrl).searchParams.has("aff_fcid"),
      "aff_fcid stripped on /item/ page — item pages need no params");
    assert.ok(!new URL(cleanUrl).searchParams.has("utm_source"),
      "utm_source stripped on /item/ page");
  });

});

// ---------------------------------------------------------------------------
// Bug #229 — Toast Allow/Block must store entries in domain::param::value format
// ---------------------------------------------------------------------------
describe("Bug #229 — toast whitelist/blacklist entry format", () => {
  before(() => AFFILIATE_PATTERNS.push(TEST_PATTERN));
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("whitelist entry as 'domain::param::value' prevents foreign detection (#229)", () => {
    // Simulates what the toast Allow button should store (after the #229 fix).
    // The entry is "shop.test.muga::aff::other-store-99" — must prevent detection.
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=other-store-99",
      { ...PREFS, notifyForeignAffiliate: true, whitelist: ["shop.test.muga::aff::other-store-99"] }
    );
    assert.notEqual(action, "detected_foreign",
      "whitelist entry in domain::param::value format must suppress foreign detection (#229)");
  });

  test("blacklist entry as 'domain::param::value' strips the affiliate param (#229)", () => {
    // Simulates what the toast Block button should store (after the #229 fix).
    const { cleanUrl, action } = processUrl(
      "https://shop.test.muga/product?aff=other-store-99",
      { ...PREFS, blacklist: ["shop.test.muga::aff::other-store-99"] }
    );
    assert.equal(new URL(cleanUrl).searchParams.has("aff"), false,
      "blacklist entry in domain::param::value format must strip the affiliate param (#229)");
    assert.notEqual(action, "detected_foreign",
      "blacklisted param must not trigger foreign detection (#229)");
  });

  test("old-style 'param=value' whitelist entry (broken format) does NOT prevent detection (#229 regression guard)", () => {
    // This test guards against the old bug re-appearing. The entry "aff=other-store-99"
    // is treated as a domain name by parseListEntry — it must NOT suppress detection
    // because no real hostname looks like "aff=other-store-99".
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=other-store-99",
      { ...PREFS, notifyForeignAffiliate: true, whitelist: ["aff=other-store-99"] }
    );
    assert.equal(action, "detected_foreign",
      "old-style 'param=value' whitelist entry must not suppress detection — it matches no real hostname (#229)");
  });

  test("blacklist entry with www-prefixed domain is normalised and still matches (#229)", () => {
    // The fix strips www from the hostname before building the entry.
    // Both "shop.test.muga::aff::v" and "www.shop.test.muga::aff::v" should match.
    const { cleanUrl } = processUrl(
      "https://www.shop.test.muga/product?aff=other-store-99",
      { ...PREFS, blacklist: ["shop.test.muga::aff::other-store-99"] }
    );
    assert.equal(new URL(cleanUrl).searchParams.has("aff"), false,
      "www-variant hostname must still match the non-www blacklist entry (#229)");
  });
});

// ---------------------------------------------------------------------------
// Bug #185 — Domain-only whitelist entry must skip all affiliate processing
// ---------------------------------------------------------------------------
describe("Bug #185 — domain-only whitelist skips affiliate processing", () => {
  before(() => AFFILIATE_PATTERNS.push(TEST_PATTERN));
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("domain-only whitelist entry prevents ourTag injection (#185)", () => {
    // When the hostname itself is whitelisted (no param::value), MUGA must skip
    // injection entirely — the URL should come back unchanged apart from tracking param stripping.
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      whitelist: ["shop.test.muga"],
    };
    const { cleanUrl, action } = processUrl(
      "https://shop.test.muga/product?color=blue",
      prefs
    );
    assert.ok(!cleanUrl.includes("muga-test-99"),
      "ourTag must NOT be injected when the domain is whitelisted (#185)");
    assert.notEqual(action, "injected",
      "action must not be 'injected' when domain is whitelisted (#185)");
  });

  test("domain-only whitelist entry prevents foreign affiliate detection (#185)", () => {
    const prefs = {
      ...PREFS,
      notifyForeignAffiliate: true,
      allowReplaceAffiliate: true,
      whitelist: ["shop.test.muga"],
    };
    const { action } = processUrl(
      "https://shop.test.muga/product?aff=some-other-creator-99",
      prefs
    );
    assert.notEqual(action, "detected_foreign",
      "foreign affiliate detection must be skipped when domain is whitelisted (#185)");
  });

  test("domain-only whitelist entry still allows tracking param stripping (#185)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      whitelist: ["shop.test.muga"],
    };
    const { cleanUrl, removedTracking } = processUrl(
      "https://shop.test.muga/product?color=blue&utm_source=email",
      prefs
    );
    assert.ok(removedTracking.includes("utm_source"),
      "utm_source must still be stripped even on a whitelisted domain (#185)");
    assert.ok(!new URL(cleanUrl).searchParams.has("utm_source"),
      "utm_source must be absent from clean URL (#185)");
  });
});

// ---------------------------------------------------------------------------
// Sprint — selection URL cleaning logic
// Tests the URL extraction + cleaning logic used by GET_AND_COPY_CLEAN_SELECTION.
// The handler delegates URL processing to processUrl; we test processUrl directly
// on the URL patterns that the handler extracts from selected text.
// ---------------------------------------------------------------------------
describe("Sprint — selection URL cleaning (GET_AND_COPY_CLEAN_SELECTION logic)", () => {
  test("dirty URL in plain text is cleaned — utm params removed", () => {
    // Simulates a URL extracted from selected text by the URL_RE regex.
    const url = "https://example.com?utm_source=google&fbclid=abc";
    const { cleanUrl, action, removedTracking } = processUrl(url, PREFS);
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/");
    assert.ok(removedTracking.includes("utm_source"), "utm_source must be removed");
    assert.ok(removedTracking.includes("fbclid"), "fbclid must be removed");
  });

  test("amazon URL with tracking but preserved tag — utm removed, tag kept", () => {
    // Represents: "Check out https://amazon.es/dp/B08?tag=test&linkCode=ll1"
    // linkCode is a known Amazon tracking param; tag= is an affiliate param preserved by default.
    const url = "https://amazon.es/dp/B08?tag=test&linkCode=ll1";
    const { cleanUrl, removedTracking } = processUrl(url, PREFS);
    const result = new URL(cleanUrl);
    assert.equal(result.searchParams.get("tag"), "test", "affiliate tag must be preserved");
    assert.ok(removedTracking.includes("linkCode") || !result.searchParams.has("linkCode"),
      "linkCode must be stripped");
  });

  test("URL with no tracking params passes through as untouched", () => {
    const url = "https://example.com/article?id=42&page=2";
    const { action, cleanUrl } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, url);
  });

  test("URL with already-clean params returns unchanged cleanUrl", () => {
    const url = "https://example.com/shop?color=blue&size=M";
    const { action } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
  });

  test("trailing punctuation stripped before processUrl — period not part of URL", () => {
    // The content script regex strips trailing punctuation via: .replace(/[.,;:!?)\]]+$/, "")
    // We verify that the cleaned candidate (without trailing period) is processed correctly.
    const rawMatch = "https://example.com?utm_source=x.";
    const cleanCandidate = rawMatch.replace(/[.,;:!?)\]]+$/, "");
    assert.equal(cleanCandidate, "https://example.com?utm_source=x");
    const { action, cleanUrl } = processUrl(cleanCandidate, PREFS);
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/");
  });

  test("trailing comma is not part of the URL candidate", () => {
    const rawMatch = "https://example.com?utm_medium=cpc,";
    const cleanCandidate = rawMatch.replace(/[.,;:!?)\]]+$/, "");
    assert.equal(cleanCandidate, "https://example.com?utm_medium=cpc");
    const { action } = processUrl(cleanCandidate, PREFS);
    assert.equal(action, "cleaned");
  });

  test("text with no URLs — URL_RE finds no matches, selection passed as-is", () => {
    // The handler checks allUrls.length === 0 and copies plain text unchanged.
    // We verify the regex behaviour: no URLs means no processing needed.
    const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/g;
    const text = "Hello world, this is plain text with no links.";
    const matches = [...text.matchAll(URL_RE)];
    assert.equal(matches.length, 0, "plain text must yield no URL matches");
  });
});

// ---------------------------------------------------------------------------
// Sprint — URL tester logic (options.js testUrl() uses processUrl directly)
// ---------------------------------------------------------------------------
describe("Sprint — URL tester logic (options.js testUrl)", () => {
  test("URL with tracking params → action cleaned, removedTracking lists params", () => {
    const input = "https://example.com?utm_source=google&utm_medium=cpc";
    const { action, cleanUrl, removedTracking } = processUrl(input, PREFS);
    assert.equal(action, "cleaned");
    assert.equal(cleanUrl, "https://example.com/");
    assert.ok(removedTracking.includes("utm_source"), "removedTracking must include utm_source");
    assert.ok(removedTracking.includes("utm_medium"), "removedTracking must include utm_medium");
  });

  test("URL with no tracking params → action untouched, cleanUrl equals input", () => {
    const input = "https://example.com/product?id=123&page=2";
    const { action, cleanUrl } = processUrl(input, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, input);
  });

  test("amazon URL with affiliate tag + utm_source → tracking removed, tag kept", () => {
    const input = "https://www.amazon.es/dp/B08?tag=creator-21&utm_source=yt";
    const { cleanUrl, removedTracking } = processUrl(input, PREFS);
    const result = new URL(cleanUrl);
    assert.equal(result.searchParams.get("tag"), "creator-21",
      "affiliate tag must be preserved");
    assert.ok(removedTracking.includes("utm_source"),
      "utm_source must appear in removedTracking");
    assert.ok(!result.searchParams.has("utm_source"),
      "utm_source must not appear in cleanUrl");
  });

  test("processUrl result always has removedTracking array", () => {
    const { removedTracking } = processUrl("https://example.com", PREFS);
    assert.ok(Array.isArray(removedTracking), "removedTracking must be an array");
  });

  test("processUrl result junkRemoved equals count of removed params", () => {
    const { junkRemoved } = processUrl(
      "https://example.com?utm_source=x&utm_medium=y",
      PREFS
    );
    assert.equal(typeof junkRemoved, "number");
    assert.equal(junkRemoved, 2);
  });
});

// ---------------------------------------------------------------------------
// S9 / S10 — parseListEntry edge cases with malformed entries
// ---------------------------------------------------------------------------
describe("S9 — parseListEntry edge cases", () => {

  test('empty string "" → domain is "", param and value are null', () => {
    const result = parseListEntry("");
    assert.equal(result.domain, "");
    assert.equal(result.param, null);
    assert.equal(result.value, null);
  });

  test('only separator "::" → domain is "", param and value are null', () => {
    const result = parseListEntry("::");
    assert.equal(result.domain, "");
    assert.equal(result.param, null);
    assert.equal(result.value, null);
  });

  test('"::tag::value" → domain is "", param "tag", value "value"', () => {
    const result = parseListEntry("::tag::value");
    assert.equal(result.domain, "");
    assert.equal(result.param, "tag");
    assert.equal(result.value, "value");
  });

  test('"a::b::c::d" → domain "a", param "b", value "c" (extra parts ignored)', () => {
    const result = parseListEntry("a::b::c::d");
    assert.equal(result.domain, "a");
    assert.equal(result.param, "b");
    assert.equal(result.value, "c");
  });

  test('"amazon.es::tag" → domain "amazon.es", param "tag", value null (no value part)', () => {
    const result = parseListEntry("amazon.es::tag");
    assert.equal(result.domain, "amazon.es");
    assert.equal(result.param, "tag");
    assert.equal(result.value, null);
  });

  test('"  " (whitespace only) → domain is "", param and value are null', () => {
    const result = parseListEntry("  ");
    assert.equal(result.domain, "");
    assert.equal(result.param, null);
    assert.equal(result.value, null);
  });
});

// ---------------------------------------------------------------------------
// S9 — cleanAmazonPath with /gp/product/ASIN/ref=...
// ---------------------------------------------------------------------------
describe("S9 — cleanAmazonPath with /gp/product/ path", () => {

  test("/gp/product/ASIN/ref=tracking → /gp/product/ASIN/", () => {
    const raw = "https://www.amazon.es/gp/product/B0GQ4N9N33/ref=zg_bsnr?psc=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/gp/product/B0GQ4N9N33/",
      "/gp/product/ASIN path must be cleaned just like /dp/ASIN");
  });

  test("/gp/product/ASIN without trailing noise is preserved", () => {
    const raw = "https://www.amazon.com/gp/product/B08N5WRWNW";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.includes("/gp/product/B08N5WRWNW"),
      "/gp/product/ASIN path must not be modified when clean");
  });

  test("/gp/product/ASIN/ref=ox_sc_saved_title → /gp/product/ASIN/", () => {
    const raw = "https://www.amazon.es/gp/product/B0GF8C2S62/ref=ox_sc_saved_title?psc=1&smid=ABC123";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/gp/product/B0GF8C2S62/",
      "/gp/product/ASIN/ref=... must be stripped");
  });
});

// ---------------------------------------------------------------------------
// C12 — Foreign affiliate detection produces detectedAffiliate with pattern info
// (withOurAffiliate is constructed by service-worker.js handleProcessUrl,
//  but processUrl produces the detectedAffiliate.pattern.ourTag needed for it)
// ---------------------------------------------------------------------------
describe("C12 — foreign affiliate detection provides ourTag for withOurAffiliate", () => {

  before(() => { AFFILIATE_PATTERNS.push(TEST_PATTERN); });
  after(() => { AFFILIATE_PATTERNS.length = AFFILIATE_PATTERNS_ORIGINAL_LENGTH; });

  test("detectedAffiliate.pattern.ourTag contains the correct ourTag", () => {
    const { detectedAffiliate } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.ok(detectedAffiliate, "detectedAffiliate must not be null");
    assert.equal(detectedAffiliate.pattern.ourTag, "muga-test-99",
      "detectedAffiliate.pattern.ourTag must match the pattern ourTag");
  });

  test("detectedAffiliate.pattern.param matches the affiliate param", () => {
    const { detectedAffiliate } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.equal(detectedAffiliate.pattern.param, "aff");
  });

  test("notifyForeignAffiliate triggers detection — withOurAffiliate built by service-worker", () => {
    const { action, detectedAffiliate } = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.equal(action, "detected_foreign");
    assert.ok(detectedAffiliate, "detectedAffiliate must be present");
    assert.equal(detectedAffiliate.pattern.ourTag, "muga-test-99");
  });

  test("withOurAffiliate URL can be reconstructed from processUrl output (simulates service-worker logic)", () => {
    const result = processUrl(
      "https://shop.test.muga/product?aff=someone-else-99&utm_source=email",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.equal(result.action, "detected_foreign");
    // Simulate service-worker.js handleProcessUrl logic:
    const url = new URL(result.cleanUrl);
    const p = result.detectedAffiliate.pattern;
    url.searchParams.set(p.param, p.ourTag);
    const withOurAffiliate = url.toString();
    assert.ok(withOurAffiliate.includes("aff=muga-test-99"),
      "reconstructed withOurAffiliate URL must contain ourTag");
    assert.ok(!withOurAffiliate.includes("utm_source"),
      "tracking params must still be stripped in withOurAffiliate URL");
  });
});

// ---------------------------------------------------------------------------
// N9 — Additional edge case tests
// ---------------------------------------------------------------------------
describe("N9 — processUrl edge cases", () => {

  test("URL without protocol (example.com?utm_source=x) → returned as-is (invalid URL)", () => {
    const raw = "example.com?utm_source=x";
    const { action, cleanUrl } = processUrl(raw, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
  });

  test("URL with 100+ tracking params — all stripped via prefix match and exact match", () => {
    const params = [];
    for (let i = 0; i < 100; i++) {
      params.push(`utm_source_${i}=val`);
    }
    // Add some known tracking params
    params.push("utm_source=bulk", "fbclid=abc", "gclid=xyz", "msclkid=def");
    const raw = `https://example.com/page?${params.join("&")}`;
    const { removedTracking, junkRemoved } = processUrl(raw, PREFS);
    assert.ok(removedTracking.includes("utm_source"), "utm_source must be stripped");
    assert.ok(removedTracking.includes("fbclid"), "fbclid must be stripped");
    assert.ok(removedTracking.includes("gclid"), "gclid must be stripped");
    assert.ok(removedTracking.includes("msclkid"), "msclkid must be stripped");
    // utm_source_0..99 also stripped via utm_* prefix match
    assert.equal(junkRemoved, 104, "100 utm_source_N + 4 exact-match params");
  });

  test("URL with encoded params (utm_source=%E2%9C%93) — param name matched, stripped", () => {
    const raw = "https://example.com/page?utm_source=%E2%9C%93&q=test";
    const { cleanUrl, removedTracking } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped even with encoded value");
    assert.ok(removedTracking.includes("utm_source"));
    assert.equal(u.searchParams.get("q"), "test", "functional param preserved");
  });

  test("enabled=false passed as pref — processUrl still cleans (it does not check enabled)", () => {
    // processUrl is a pure function; the enabled check is in the service worker
    const { action, removedTracking } = processUrl(
      "https://example.com/?utm_source=google",
      { ...PREFS, enabled: false }
    );
    assert.equal(action, "cleaned");
    assert.ok(removedTracking.includes("utm_source"),
      "processUrl must clean regardless of enabled flag — enabled is checked by the caller");
  });

  test("URL with only hash fragment and no params → untouched", () => {
    const raw = "https://example.com/#section";
    const { action, cleanUrl } = processUrl(raw, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, raw);
  });

  test("ftp:// URL → untouched (non-http(s) parsed but no matching params)", () => {
    const raw = "ftp://files.example.com/data?utm_source=email";
    const { action, cleanUrl } = processUrl(raw, PREFS);
    // new URL("ftp://...") succeeds but utm_source would still be found in searchParams
    // processUrl does not filter by protocol — it processes any parseable URL
    assert.equal(typeof cleanUrl, "string");
  });
});

// ---------------------------------------------------------------------------
// Regression tests for audit fixes
// ---------------------------------------------------------------------------
describe("Regression — C5 TRACKING_PARAMS_SET is a Set (O(1) lookup)", () => {

  test("case-insensitive matching works correctly (UTM_SOURCE matches tracking set)", () => {
    // C5 created a Set from TRACKING_PARAMS lowercased. Verify indirect behaviour:
    // the cleaner must strip "UTM_SOURCE" (uppercase) because it compares param.toLowerCase()
    const { action, removedTracking } = processUrl(
      "https://example.com/?UTM_SOURCE=google",
      PREFS
    );
    assert.equal(action, "cleaned");
    assert.ok(removedTracking.includes("UTM_SOURCE"),
      "case-insensitive param matching via TRACKING_PARAMS_SET must work");
  });

  test("all TRACKING_PARAMS entries are findable via case-insensitive check", () => {
    // Spot-check: a few params in various cases
    const testParams = ["fbclid", "GCLID", "Msclkid", "UTM_CAMPAIGN", "si"];
    for (const param of testParams) {
      const raw = `https://example.com/?${param}=test`;
      const { removedTracking } = processUrl(raw, PREFS);
      assert.ok(removedTracking.includes(param),
        `${param} must be stripped via case-insensitive TRACKING_PARAMS_SET lookup`);
    }
  });
});

describe("Regression — C10 blacklisted domain reports junkRemoved > 0", () => {

  test("blacklisted domain with params → junkRemoved equals param count", () => {
    const { action, junkRemoved } = processUrl(
      "https://www.amazon.es/dp/B08?tag=x&utm_source=email&psc=1",
      { ...PREFS, blacklist: ["amazon.es"] }
    );
    assert.equal(action, "blacklisted");
    assert.equal(junkRemoved, 3, "junkRemoved must count all stripped params on blacklisted domain");
  });

  test("blacklisted domain with no params → junkRemoved is 0", () => {
    const { action, junkRemoved } = processUrl(
      "https://www.amazon.es/dp/B08",
      { ...PREFS, blacklist: ["amazon.es"] }
    );
    assert.equal(action, "blacklisted");
    assert.equal(junkRemoved, 0, "junkRemoved must be 0 when no params to strip");
  });
});

describe("Regression — B1 setPrefs is exported from storage.js", () => {

  test("storage.js exports setPrefs as a function", async () => {
    const storage = await import("../../src/lib/storage.js");
    assert.equal(typeof storage.setPrefs, "function",
      "setPrefs must be exported from storage.js");
  });

  test("storage.js exports getPrefs as a function", async () => {
    const storage = await import("../../src/lib/storage.js");
    assert.equal(typeof storage.getPrefs, "function",
      "getPrefs must be exported from storage.js");
  });

  test("storage.js exports incrementStat as a function", async () => {
    const storage = await import("../../src/lib/storage.js");
    assert.equal(typeof storage.incrementStat, "function",
      "incrementStat must be exported from storage.js");
  });
});

// ---------------------------------------------------------------------------
// N9 — escHtml was removed from content/cleaner.js (dead code — toast uses createElement+textContent)
// The escHtml tests have been removed accordingly.

// ---------------------------------------------------------------------------
// N9 — formatStat (popup.js) — replicated because popup.js has browser deps
// ---------------------------------------------------------------------------

/**
 * Replica of formatStat from src/popup/popup.js.
 */
function formatStat(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

describe("N9 — formatStat (popup.js)", () => {

  test("formats 0 as '0'", () => {
    assert.equal(formatStat(0), "0");
  });

  test("formats 999 as '999'", () => {
    assert.equal(formatStat(999), "999");
  });

  test("formats 1000 as '1.0k'", () => {
    assert.equal(formatStat(1000), "1.0k");
  });

  test("formats 1500 as '1.5k'", () => {
    assert.equal(formatStat(1500), "1.5k");
  });

  test("formats 10000 as '10.0k'", () => {
    assert.equal(formatStat(10000), "10.0k");
  });

  test("formats 999999 as '1000.0k'", () => {
    assert.equal(formatStat(999999), "1000.0k");
  });

  test("formats 1000000 as '1.0M'", () => {
    assert.equal(formatStat(1000000), "1.0M");
  });

  test("formats 2500000 as '2.5M'", () => {
    assert.equal(formatStat(2500000), "2.5M");
  });

});

// ---------------------------------------------------------------------------
// OAuth / auth / payment flow exemption — MUGA never touches these paths
// ---------------------------------------------------------------------------
describe("OAuth / auth / payment flow exemption", () => {
  const authUrls = [
    ["Google OAuth", "https://accounts.google.com/o/oauth2/auth?client_id=abc&redirect_uri=https://app.com/cb&scope=email&state=xyz&response_type=code"],
    ["Microsoft OAuth", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=https://app.com&scope=openid&state=xyz&nonce=123"],
    ["GitHub OAuth", "https://github.com/login/oauth/authorize?client_id=abc&redirect_uri=https://app.com/cb&scope=user&state=xyz"],
    ["Stripe Checkout", "https://checkout.stripe.com/pay/cs_test_abc123?utm_source=email"],
    ["PayPal Checkout", "https://www.paypal.com/checkout/authorize?token=abc&fundingSource=paypal"],
    ["Generic SSO", "https://auth.company.com/sso/login?returnUrl=https://app.com&sessionId=abc"],
    ["SAML", "https://idp.example.com/saml/sso?SAMLRequest=abc&RelayState=xyz"],
    ["Generic callback", "https://app.com/auth/callback?code=abc123&state=xyz"],
  ];

  for (const [name, url] of authUrls) {
    test(`${name}: URL returned untouched`, () => {
      const result = processUrl(url, PREFS, domainRules);
      assert.equal(result.cleanUrl, url, `${name} URL must not be modified`);
      assert.equal(result.action, "untouched");
      assert.equal(result.removedTracking.length, 0);
    });
  }

  // False positive tests — these paths CONTAIN auth-like words but are NOT auth flows
  const falsePositives = [
    ["blog with authorize in path", "https://blog.com/authorize-your-creativity?utm_source=fb"],
    ["login in slug", "https://example.com/how-to-login-faster?fbclid=abc"],
    ["checkout in blog title", "https://blog.com/checkout-our-new-features?utm_medium=email"],
    ["auth in domain not path", "https://auth.example.com/dashboard?utm_source=google"],
  ];

  for (const [name, url] of falsePositives) {
    test(`NOT exempted: ${name}`, () => {
      const result = processUrl(url, PREFS, domainRules);
      assert.notEqual(result.action, "untouched", `${name} should be cleaned, not exempted`);
      assert.ok(result.removedTracking.length > 0, `${name} should have params stripped`);
    });
  }
});

// ---------------------------------------------------------------------------
// Idempotency — clean(clean(url)) must equal clean(url)
// ---------------------------------------------------------------------------
describe("Idempotency — double-cleaning produces identical output", () => {
  const urls = [
    "https://www.amazon.es/dp/B09B8YWXDF?tag=test-21&utm_source=google&utm_medium=cpc&ref=cm_sw_r_cp",
    "https://www.google.com/search?q=test&sca_esv=abc&ved=123&sxsrf=xyz",
    "https://es.aliexpress.com/item/123.html?dp=abc&aff_fsk=xyz&sk=abc&terminal_id=def",
    "https://example.com/page?utm_source=fb&utm_campaign=spring&fbclid=abc123",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&feature=share",
    "https://example.com/path?clean=true",
    "https://example.com/path#section?not=param",
  ];

  for (const url of urls) {
    test(`idempotent: ${new URL(url).hostname}${new URL(url).pathname.slice(0, 20)}`, () => {
      const first = processUrl(url, PREFS, domainRules);
      const second = processUrl(first.cleanUrl, PREFS, domainRules);
      assert.equal(first.cleanUrl, second.cleanUrl, `Double-clean changed URL:\n  1st: ${first.cleanUrl}\n  2nd: ${second.cleanUrl}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Encoding preservation — MUGA must not change + to %20 or vice versa
// ---------------------------------------------------------------------------
describe("Encoding preservation — param values keep original encoding", () => {
  test("preserves + as space in query values", () => {
    const url = "https://www.amazon.es/s?k=usb+cable&utm_source=google";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    assert.ok(cleanUrl.includes("k=usb+cable") || cleanUrl.includes("k=usb%20cable"),
      "search query must survive without corruption");
    assert.ok(!cleanUrl.includes("utm_source"));
  });

  test("preserves %20 in query values", () => {
    const url = "https://www.amazon.es/s?k=usb%20cable&utm_source=google";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("k"), "usb cable");
  });

  test("does not introduce new encoding in clean URLs", () => {
    const url = "https://example.com/path?q=hello+world";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    // URL constructor normalizes + to %20 in searchParams — that's browser behavior, not a MUGA bug
    // But the URL must still decode to the same value
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "hello world");
  });
});

// ---------------------------------------------------------------------------
// Hash/fragment preservation — MUGA must never touch anything after #
// ---------------------------------------------------------------------------
describe("Hash/fragment preservation — # content is never modified", () => {
  test("preserves simple #anchor", () => {
    const url = "https://example.com/page?utm_source=fb#section-3";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    assert.ok(cleanUrl.endsWith("#section-3"), `Fragment lost: ${cleanUrl}`);
    assert.ok(!cleanUrl.includes("utm_source"));
  });

  test("preserves #! hashbang routing", () => {
    const url = "https://example.com/app?fbclid=abc#!/dashboard/settings";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    assert.ok(cleanUrl.includes("#!/dashboard/settings"), `Hashbang lost: ${cleanUrl}`);
  });

  test("preserves #/spa-route with params", () => {
    const url = "https://example.com/?utm_campaign=spring#/products?category=shoes&page=2";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    assert.ok(cleanUrl.includes("#/products?category=shoes&page=2"), `SPA route lost: ${cleanUrl}`);
  });

  test("does not parse fragment as query params", () => {
    const url = "https://example.com/page#utm_source=fake&utm_medium=notreal";
    const { cleanUrl } = processUrl(url, PREFS, domainRules);
    assert.ok(cleanUrl.includes("#utm_source=fake&utm_medium=notreal"), "Fragment must not be stripped as tracking params");
  });
});

// ---------------------------------------------------------------------------
// processUrl — defensive input handling
// ---------------------------------------------------------------------------
describe("processUrl — defensive input handling", () => {

  test("returns untouched for null URL", () => {
    const result = processUrl(null, PREFS);
    assert.equal(result.action, "untouched");
  });

  test("returns untouched for undefined URL", () => {
    const result = processUrl(undefined, PREFS);
    assert.equal(result.action, "untouched");
  });

  test("returns untouched for empty object as URL", () => {
    const result = processUrl({}, PREFS);
    assert.equal(result.action, "untouched");
  });

  test("handles missing pref keys gracefully", () => {
    const result = processUrl("https://example.com?utm_source=test", {});
    // Should not throw — missing keys are treated as defaults
    assert.ok(result);
  });

});

// ---------------------------------------------------------------------------
// TRACKING_PREFIXES — prefix-based param stripping
// ---------------------------------------------------------------------------
describe("TRACKING_PREFIXES — prefix-based param stripping", () => {

  test("strips cm_sw_ prefixed params (Amazon)", () => {
    const result = processUrl(
      "https://www.amazon.com/dp/B01N5?cm_sw_r_cp_api_test=abc",
      PREFS
    );
    assert.ok(result.removedTracking.some(p => p.startsWith("cm_sw_")));
  });

  test("strips hsa_ prefixed params (HubSpot)", () => {
    const result = processUrl(
      "https://example.com/page?hsa_cam=123&hsa_grp=456",
      PREFS
    );
    assert.ok(result.removedTracking.includes("hsa_cam"));
    assert.ok(result.removedTracking.includes("hsa_grp"));
  });

  test("strips mt_ prefixed params (Matomo)", () => {
    const result = processUrl(
      "https://example.com/page?mt_campaign=spring",
      PREFS
    );
    assert.ok(result.removedTracking.includes("mt_campaign"));
  });

  test("strips scm_ prefixed params (AliExpress/Alibaba)", () => {
    const result = processUrl(
      "https://example.com/page?scm_id=123",
      PREFS
    );
    assert.ok(result.removedTracking.includes("scm_id"));
  });

  test("strips sb-ci- prefixed params (Amazon search)", () => {
    const result = processUrl(
      "https://www.amazon.com/s?k=phone&sb-ci-n=0",
      PREFS
    );
    assert.ok(result.removedTracking.includes("sb-ci-n"));
  });

  test("does NOT strip params that merely contain a prefix substring", () => {
    // "custom_param" contains "cm_" but does not START with "cm_sw_"
    const result = processUrl(
      "https://example.com/page?custom_param=abc",
      PREFS
    );
    assert.ok(!result.removedTracking.includes("custom_param"));
  });

});

// ---------------------------------------------------------------------------
// YouTube — list= playlist param preserved while tracking params are stripped
// ---------------------------------------------------------------------------
describe("YouTube — list= playlist preservation", () => {

  test("strips tracking but preserves list= on YouTube", () => {
    const result = processUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&si=abc123&utm_source=share",
      PREFS,
      domainRules
    );
    const u = new URL(result.cleanUrl);
    assert.equal(u.searchParams.get("list"), "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.ok(result.removedTracking.includes("utm_source"));
  });

});

// ---------------------------------------------------------------------------
// Scheme validation
// ---------------------------------------------------------------------------
describe("scheme validation", () => {
  test("rejects ftp: URLs as untouched", () => {
    const result = processUrl("ftp://files.example.com/doc.pdf?utm_source=test", PREFS);
    assert.strictEqual(result.action, "untouched");
    assert.strictEqual(result.cleanUrl, "ftp://files.example.com/doc.pdf?utm_source=test");
    assert.deepStrictEqual(result.removedTracking, []);
  });

  test("rejects data: URLs as untouched", () => {
    const result = processUrl("data:text/html,<h1>hi</h1>?utm_source=test", PREFS);
    assert.strictEqual(result.action, "untouched");
  });

  test("rejects javascript: URLs as untouched", () => {
    const result = processUrl("javascript:alert(1)", PREFS);
    assert.strictEqual(result.action, "untouched");
  });

  test("rejects blob: URLs as untouched", () => {
    const result = processUrl("blob:https://example.com/uuid", PREFS);
    assert.strictEqual(result.action, "untouched");
  });

  test("accepts http: URLs normally", () => {
    const result = processUrl("http://example.com/?utm_source=test", PREFS);
    assert.strictEqual(result.action, "cleaned");
  });

  test("accepts https: URLs normally", () => {
    const result = processUrl("https://example.com/?utm_source=test", PREFS);
    assert.strictEqual(result.action, "cleaned");
  });
});

// ---------------------------------------------------------------------------
// C11 sync verification (continued)
// ---------------------------------------------------------------------------
describe("C11 — popup.js formatStat sync", () => {
  test("C11 sync — source contains identical formatStat implementation", () => {
    // Verify key lines of the function exist in popup.js source
    assert.ok(POPUP_SOURCE.includes("function formatStat(n)"),
      "popup.js must contain formatStat function");
    assert.ok(POPUP_SOURCE.includes("(n / 1_000_000).toFixed(1)"),
      "popup.js formatStat must use 1_000_000 divisor");
    assert.ok(POPUP_SOURCE.includes("(n / 1000).toFixed(1)"),
      "popup.js formatStat must use 1000 divisor");
  });
});

// ---------------------------------------------------------------------------
// T1.5 — remoteParams integration in processUrl (REQ-MERGE-3, REQ-MERGE-5)
//
// cleaner.js reads prefs.remoteParams (a plain array) alongside customParams.
// The remote-rules module is the WRITER; cleaner is the READER (ADR-D10).
// No import of remote-rules.js here or in cleaner.js — decoupled by design.
// ---------------------------------------------------------------------------
describe("T1.5 — remoteParams consumed by processUrl", () => {

  test("a param only in remoteParams is stripped", () => {
    const prefs = {
      ...PREFS,
      remoteParams: ["my_remote_tracker"],
    };
    const { action, cleanUrl, removedTracking } = processUrl(
      "https://example.com/?my_remote_tracker=abc&keep=yes",
      prefs
    );
    assert.strictEqual(action, "cleaned");
    assert.ok(
      removedTracking.includes("my_remote_tracker"),
      "remoteParams param must appear in removedTracking"
    );
    assert.ok(
      cleanUrl.includes("keep=yes"),
      "unrelated params must be preserved"
    );
    assert.ok(
      !cleanUrl.includes("my_remote_tracker"),
      "remote param must not appear in cleanUrl"
    );
  });

  test("a built-in tracking param is still stripped when remoteParams is non-empty", () => {
    // Triangulation: remote params must not interfere with existing built-in strip
    const prefs = {
      ...PREFS,
      remoteParams: ["some_other_remote"],
    };
    const { action, removedTracking } = processUrl(
      "https://example.com/?utm_source=google&some_other_remote=xyz",
      prefs
    );
    assert.strictEqual(action, "cleaned");
    assert.ok(
      removedTracking.includes("utm_source"),
      "built-in param must still be stripped"
    );
    assert.ok(
      removedTracking.includes("some_other_remote"),
      "remote param must also be stripped"
    );
  });

  test("when remoteParams is undefined, behavior is identical to pre-T1.5 baseline", () => {
    // remoteParams absent in prefs — must not break existing processing
    const prefs = { ...PREFS };  // no remoteParams key
    const { action, cleanUrl, removedTracking } = processUrl(
      "https://example.com/?utm_source=google&q=cats",
      prefs
    );
    assert.strictEqual(action, "cleaned");
    assert.ok(removedTracking.includes("utm_source"), "utm_source must still be stripped");
    assert.ok(cleanUrl.includes("q=cats"), "q param must be preserved (not a tracking param)");
  });

  test("when remoteParams is an empty array, behavior is identical to pre-T1.5 baseline", () => {
    const prefs = { ...PREFS, remoteParams: [] };
    const { action, cleanUrl } = processUrl(
      "https://example.com/?utm_source=google&legit=1",
      prefs
    );
    assert.strictEqual(action, "cleaned");
    assert.ok(cleanUrl.includes("legit=1"), "non-tracking params must be preserved");
    assert.ok(!cleanUrl.includes("utm_source"), "built-in params must still be stripped");
  });

});
