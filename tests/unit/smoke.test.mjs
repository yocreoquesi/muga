/**
 * MUGA — Smoke Tests
 *
 * End-to-end URL cleaning verification using real-world URLs from popular sites.
 * Each test represents a URL pattern users encounter daily. These are the last
 * line of defense before a release — if a smoke test fails, the build is broken.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
  customParams: [],
  disabledCategories: [],
};

function clean(url) {
  return processUrl(url, PREFS, domainRules);
}

// ---------------------------------------------------------------------------
// Smoke 1 — Google Search
// ---------------------------------------------------------------------------
describe("Smoke: Google Search", () => {
  test("preserves query, strips tracking", () => {
    const { cleanUrl } = clean(
      "https://www.google.com/search?q=best+headphones&sca_esv=abc&ved=123&ei=xyz&gs_lcp=def&sclient=gws-wiz&sxsrf=test&usg=AOv"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "best headphones");
    assert.ok(!u.searchParams.has("sca_esv"));
    assert.ok(!u.searchParams.has("ved"));
    assert.ok(!u.searchParams.has("ei"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 2 — Amazon product (Chollometro-style link)
// ---------------------------------------------------------------------------
describe("Smoke: Amazon product from deal site", () => {
  test("strips ref, social_share, preserves tag", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/dp/B07JNVH9D8?ref=cm_sw_r_cso_cp_apan_dp_KP63TZ0DQH7N1Y09NXJ4&social_share=cm_sw_r_cso_cp_apan_dp_KP63TZ0DQH7N1Y09NXJ4&tag=pepperugc-21&utm_source=chollometro"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tag"), "pepperugc-21");
    assert.ok(!u.searchParams.has("ref"));
    assert.ok(!u.searchParams.has("social_share"));
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 3 — AliExpress item page
// ---------------------------------------------------------------------------
describe("Smoke: AliExpress item page", () => {
  test("strips ALL params from /item/ page", () => {
    const { cleanUrl } = clean(
      "https://es.aliexpress.com/item/1005007831452483.html?dp=ppr-es-969667807&aff_fcid=abc&tt=CPS_NORMAL&aff_fsk=xyz&aff_platform=portals-tool&sk=xyz&terminal_id=abc123&afSmartRedirect=y&gatewayAdapt=glo2esp"
    );
    assert.equal(cleanUrl, "https://es.aliexpress.com/item/1005007831452483.html");
  });
});

// ---------------------------------------------------------------------------
// Smoke 4 — YouTube share link
// ---------------------------------------------------------------------------
describe("Smoke: YouTube share link", () => {
  test("preserves v and t, strips si and feature", () => {
    const { cleanUrl } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&si=abc123trackingtoken&feature=share&pp=ygU&utm_source=twitter"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.equal(u.searchParams.get("t"), "42");
    assert.ok(!u.searchParams.has("si"));
    assert.ok(!u.searchParams.has("feature"));
    assert.ok(!u.searchParams.has("pp"));
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 5 — Facebook post link
// ---------------------------------------------------------------------------
describe("Smoke: Facebook link", () => {
  test("preserves story ID, strips tracking", () => {
    const { cleanUrl } = clean(
      "https://www.facebook.com/permalink.php?story_fbid=12345&id=67890&mibextid=abc&paipv=def&hc_ref=ghi&fref=nf&__tn__=kK"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("story_fbid"), "12345");
    assert.equal(u.searchParams.get("id"), "67890");
    assert.ok(!u.searchParams.has("mibextid"));
    assert.ok(!u.searchParams.has("hc_ref"));
    assert.ok(!u.searchParams.has("__tn__"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 6 — Twitter/X share
// ---------------------------------------------------------------------------
describe("Smoke: Twitter/X link", () => {
  test("strips share tracking params", () => {
    const { cleanUrl } = clean(
      "https://x.com/user/status/123456789?t=abc&s=20&ref_src=twsrc&src=share"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("t"));
    assert.ok(!u.searchParams.has("s"));
    assert.ok(!u.searchParams.has("ref_src"));
    assert.ok(!u.searchParams.has("src"));
    assert.equal(u.search, "");
  });
});

// ---------------------------------------------------------------------------
// Smoke 7 — Reddit link
// ---------------------------------------------------------------------------
describe("Smoke: Reddit link", () => {
  test("preserves context, strips share_id", () => {
    const { cleanUrl } = clean(
      "https://www.reddit.com/r/privacy/comments/abc123/muga/?share_id=xyz&ref=share&ref_source=link&utm_medium=android"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("share_id"));
    assert.ok(!u.searchParams.has("ref"));
    assert.ok(!u.searchParams.has("utm_medium"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 8 — LinkedIn job search
// ---------------------------------------------------------------------------
describe("Smoke: LinkedIn search", () => {
  test("preserves search filters, strips tracking", () => {
    const { cleanUrl } = clean(
      "https://www.linkedin.com/jobs/search/?keywords=developer&location=Madrid&trackingId=abc&lipi=xyz&lici=def"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("keywords"), "developer");
    assert.equal(u.searchParams.get("location"), "Madrid");
    assert.ok(!u.searchParams.has("trackingId"));
    assert.ok(!u.searchParams.has("lipi"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 9 — OAuth flow NOT cleaned
// ---------------------------------------------------------------------------
describe("Smoke: OAuth flow exemption", () => {
  test("Google OAuth untouched", () => {
    const { cleanUrl, action } = clean(
      "https://accounts.google.com/o/oauth2/auth?client_id=abc&redirect_uri=https://app.com/cb&state=xyz&utm_source=email"
    );
    assert.equal(action, "untouched");
  });

  test("Stripe checkout untouched", () => {
    const { action } = clean("https://checkout.stripe.com/pay/cs_test_abc?utm_source=email");
    assert.equal(action, "untouched");
  });

  test("normal page with auth-like word IS cleaned", () => {
    const { removedTracking } = clean("https://blog.com/authorize-your-brand?utm_source=fb");
    assert.ok(removedTracking.includes("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 10 — TikTok share
// ---------------------------------------------------------------------------
describe("Smoke: TikTok share", () => {
  test("preserves video, strips share tracking", () => {
    const { cleanUrl } = clean(
      "https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc&sender_web_id=abc&is_copy_url=1"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("is_from_webapp"));
    assert.ok(!u.searchParams.has("sender_device"));
    assert.ok(!u.searchParams.has("is_copy_url"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 11 — Generic UTM newsletter link
// ---------------------------------------------------------------------------
describe("Smoke: Generic UTM link", () => {
  test("strips all utm_ params and fbclid", () => {
    const { cleanUrl } = clean(
      "https://example.com/article/great-read?utm_source=newsletter&utm_medium=email&utm_campaign=weekly&utm_content=top&utm_term=tech&fbclid=IwAR3abc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.search, "");
    assert.equal(cleanUrl, "https://example.com/article/great-read");
  });
});

// ---------------------------------------------------------------------------
// Smoke 12 — Idempotency canary
// ---------------------------------------------------------------------------
describe("Smoke: Idempotency", () => {
  test("double-clean produces same result", () => {
    const url = "https://www.amazon.es/dp/B09B8YWXDF?tag=test-21&utm_source=fb&ref=cm_sw_r&pd_rd_r=abc";
    const first = clean(url);
    const second = clean(first.cleanUrl);
    assert.equal(first.cleanUrl, second.cleanUrl);
  });
});

// ---------------------------------------------------------------------------
// Smoke 13 — Hash preservation
// ---------------------------------------------------------------------------
describe("Smoke: Hash/fragment preserved", () => {
  test("fragment survives cleaning", () => {
    const { cleanUrl } = clean("https://example.com/page?utm_source=fb&fbclid=abc#section-3");
    assert.ok(cleanUrl.endsWith("#section-3"));
    assert.ok(!cleanUrl.includes("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 14 — Instagram share
// ---------------------------------------------------------------------------
describe("Smoke: Instagram share", () => {
  test("strips igsh share tracking", () => {
    const { cleanUrl } = clean(
      "https://www.instagram.com/p/ABC123/?igsh=xyz&img_index=1&utm_source=ig_web"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("igsh"));
    assert.ok(!u.searchParams.has("img_index"));
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Smoke 15 — Amazon path cleaning
// ---------------------------------------------------------------------------
describe("Smoke: Amazon path cleaning", () => {
  test("strips /ref=xxx from path and product slug", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/UGREEN-Adaptador-Compatible/dp/B0B9N3QSL3/ref=sr_1_5?tag=test-21&dchild=1&qid=123"
    );
    const u = new URL(cleanUrl);
    assert.ok(u.pathname.includes("/dp/B0B9N3QSL3"));
    assert.ok(!u.pathname.includes("/ref="));
    assert.ok(!u.pathname.includes("UGREEN"));
    assert.equal(u.searchParams.get("tag"), "test-21");
    assert.ok(!u.searchParams.has("dchild"));
    assert.ok(!u.searchParams.has("qid"));
  });
});
