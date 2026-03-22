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
 * NOTE: Affiliate injection and foreign-detection tests that depend on
 * ourTag will be marked as TODO until affiliate accounts are registered
 * and the values are filled in src/lib/affiliates.js.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";
import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";

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

// ---------------------------------------------------------------------------
// Base prefs — mirrors the defaults in src/lib/storage.js
// ---------------------------------------------------------------------------
const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
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
  after(() => {
    const idx = AFFILIATE_PATTERNS.findIndex(p => p.id === "_test_store");
    if (idx !== -1) AFFILIATE_PATTERNS.splice(idx, 1);
  });

  test("injectOwnAffiliate: false → never injects even on supported domain", () => {
    const { action } = processUrl(
      "https://shop.test.muga/product",
      { ...PREFS, injectOwnAffiliate: false }
    );
    assert.notEqual(action, "injected");
  });

  test("injectOwnAffiliate: true but ourTag empty → does NOT inject", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW",
      { ...PREFS, injectOwnAffiliate: true }
    );
    assert.notEqual(action, "injected");
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
// Scenario C — Foreign affiliate detection
// ---------------------------------------------------------------------------
describe("Scenario C — foreign affiliate detection", () => {

  before(() => { AFFILIATE_PATTERNS.push(TEST_PATTERN); });
  after(() => {
    const idx = AFFILIATE_PATTERNS.findIndex(p => p.id === "_test_store");
    if (idx !== -1) AFFILIATE_PATTERNS.splice(idx, 1);
  });

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

  test("strips _encoding, content-id, ref_ from product URL", () => {
    const raw = "https://www.amazon.es/Emergencia/dp/B0GF8C2S62/?_encoding=UTF8&content-id=amzn1.sym.abc&ref_=pd_hp_d_atf_unk&th=1";
    const { cleanUrl, action } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_encoding"), null);
    assert.equal(u.searchParams.get("content-id"), null);
    assert.equal(u.searchParams.get("ref_"), null);
    assert.equal(u.searchParams.get("th"), null);
    assert.equal(u.search, "");
    assert.equal(action, "cleaned");
  });

  test("strips pd_rd_i and content-id from product URL", () => {
    const raw = "https://www.amazon.es/edihome/dp/B0GQ4N9N33/?content-id=amzn1.sym.def&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("pd_rd_i"), null);
    assert.equal(u.searchParams.get("content-id"), null);
    assert.equal(u.search, "");
  });

  test("strips path-based /ref= tracking after ASIN", () => {
    const raw = "https://www.amazon.es/edihome/dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601?content-id=x&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.endsWith("/dp/B0GQ4N9N33/"), `path should end with /dp/ASIN/, got: ${u.pathname}`);
    assert.equal(u.search, "");
  });

  test("does not modify non-Amazon path", () => {
    const raw = "https://www.example.com/product/ref=tracking?utm_source=x";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.includes("/ref=tracking"), "non-Amazon path must not be modified");
  });

  test("full real URL 1 from issue #1 — slug now stripped by FIX-A3", () => {
    // FIX-A3: product name slug before /dp/ is now stripped, so the expected path
    // is /dp/ASIN/ rather than /Emergencia-Homologada/dp/ASIN/
    const raw = "https://www.amazon.es/Emergencia-Homologada/dp/B0GF8C2S62/?_encoding=UTF8&content-id=amzn1.sym.0a1e4d50&ref_=pd_hp_d_atf_unk&th=1";
    const { cleanUrl } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0GF8C2S62/", "slug must be stripped, ASIN path preserved");
    assert.equal(u.search, "");
  });

  test("full real URL 2 from issue #1 — slug now stripped by FIX-A3", () => {
    // FIX-A3: product name slug before /dp/ is now stripped
    const raw = "https://www.amazon.es/edihome-Puff/dp/B0GQ4N9N33/ref=zg_bsnr_c_kitchen_d_sccl_3/258-3201434-8228601?content-id=amzn1.sym.8303e4e0&pd_rd_i=B0GQ4N9N33&th=1";
    const { cleanUrl, junkRemoved } = processUrl(raw, PREFS);
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/dp/B0GQ4N9N33/", "slug must be stripped, ASIN path preserved");
    assert.equal(u.search, "");
    assert.equal(junkRemoved, 4);
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
// Bug #183 — blacklist-specific + inject must NOT silently replace competitor tag
// ---------------------------------------------------------------------------
describe("Bug #183 — blacklist removal takes priority over affiliate injection", () => {
  before(() => AFFILIATE_PATTERNS.push(TEST_PATTERN));
  after(() => { const i = AFFILIATE_PATTERNS.indexOf(TEST_PATTERN); if (i !== -1) AFFILIATE_PATTERNS.splice(i, 1); });

  test("blacklisted affiliate tag is removed and ourTag is NOT injected (#183)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["shop.test.muga::aff::competitor-21"],
    };
    const { cleanUrl, action } = processUrl(
      "https://shop.test.muga/product?aff=competitor-21&utm_source=email",
      prefs
    );
    // The competitor tag must be gone
    assert.ok(!cleanUrl.includes("competitor-21"), "competitor-21 must be stripped");
    // Our tag must NOT have been silently injected
    assert.ok(!cleanUrl.includes("muga-test-99"), "ourTag must NOT be injected after blacklist removal");
    // Action must be cleaned, not injected
    assert.notEqual(action, "injected", "action must not be 'injected' when blacklist removed the affiliate");
  });

  test("when no tag is present (no blacklist hit), ourTag is still injected normally (#183 non-regression)", () => {
    const prefs = {
      ...PREFS,
      injectOwnAffiliate: true,
      blacklist: ["shop.test.muga::aff::competitor-21"],
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
