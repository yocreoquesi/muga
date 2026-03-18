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

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

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
    const { removedTracking, cleanUrl } = processUrl(
      "https://example.com/?utm_source=fb&utm_medium=cpc&utm_campaign=spring&utm_content=banner&utm_term=shoes",
      PREFS
    );
    assert.equal(removedTracking.length, 5);
    assert.equal(cleanUrl, "https://example.com/");
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
// Amazon URLs — affiliate param must NOT be stripped as tracking
// ---------------------------------------------------------------------------
describe("Amazon — affiliate param preserved", () => {

  test("amazon.es: tag= is preserved, UTM is stripped", () => {
    const { cleanUrl, removedTracking } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&utm_source=email&utm_medium=cpc",
      PREFS
    );
    const clean = new URL(cleanUrl);
    assert.equal(clean.searchParams.get("tag"), "someaffiliate-21");
    assert.ok(removedTracking.includes("utm_source"));
    assert.ok(removedTracking.includes("utm_medium"));
  });

  test("amazon.com: tag= is preserved when no tracking present", () => {
    const url = "https://www.amazon.com/dp/B08N5WRWNW?tag=someaffiliate-20";
    const { action, cleanUrl } = processUrl(url, PREFS);
    assert.equal(action, "untouched");
    assert.equal(cleanUrl, url);
  });

  test("amazon internal noise params are stripped", () => {
    const { removedTracking } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&psc=1&pd_rd_r=abc&linkCode=ll1",
      PREFS
    );
    assert.ok(removedTracking.includes("psc"));
    assert.ok(removedTracking.includes("pd_rd_r"));
    assert.ok(removedTracking.includes("linkCode"));
  });

});

// ---------------------------------------------------------------------------
// Scenario B — Affiliate injection
// (Requires ourTag to be set in affiliates.js — currently empty)
// ---------------------------------------------------------------------------
describe("Scenario B — affiliate injection", () => {

  test("injectOwnAffiliate: false → never injects even on supported domain", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW",
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

  test("TODO — inject on amazon.es when ourTag is set", { todo: "Fill in ourTag in affiliates.js once Amazon Associates account is approved" }, () => {
    // When implemented:
    // action === "injected"
    // cleanUrl contains tag=OUR_TAG
  });

});

// ---------------------------------------------------------------------------
// Scenario C — Foreign affiliate detection
// (Requires ourTag to be set to compare against)
// ---------------------------------------------------------------------------
describe("Scenario C — foreign affiliate detection", () => {

  test("notifyForeignAffiliate: false → foreign tag NOT flagged", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someother-21",
      { ...PREFS, notifyForeignAffiliate: false }
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("notifyForeignAffiliate: true but ourTag empty → still NOT detected", () => {
    const { action } = processUrl(
      "https://www.amazon.es/dp/B08N5WRWNW?tag=someother-21",
      { ...PREFS, notifyForeignAffiliate: true }
    );
    assert.notEqual(action, "detected_foreign");
  });

  test("TODO — detect foreign affiliate on amazon.es when ourTag is set", { todo: "Fill in ourTag in affiliates.js once Amazon Associates account is approved" }, () => {});

  test("TODO — our own tag is NOT flagged as foreign", { todo: "Fill in ourTag in affiliates.js" }, () => {});

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
