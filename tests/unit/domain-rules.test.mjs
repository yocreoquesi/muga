/**
 * MUGA — Unit tests for domain-rules.json compatibility layer
 *
 * Verifies that functional URL params on top-100 sites are preserved
 * while tracking params are still stripped.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { processUrl, getPreservedParams } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// ---------------------------------------------------------------------------
// Base prefs — minimal, tracking strip always on
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
// Helper
// ---------------------------------------------------------------------------
function clean(rawUrl) {
  return processUrl(rawUrl, PREFS, domainRules);
}

// ---------------------------------------------------------------------------
// getPreservedParams unit tests
// ---------------------------------------------------------------------------
describe("getPreservedParams", () => {
  test("returns empty set when domainRules is empty", () => {
    const s = getPreservedParams("google.com", []);
    assert.equal(s.size, 0);
  });

  test("exact domain match", () => {
    const rules = [{ domain: "google.com", preserveParams: ["q", "hl"] }];
    const s = getPreservedParams("google.com", rules);
    assert.ok(s.has("q"));
    assert.ok(s.has("hl"));
  });

  test("subdomain match — www.google.com matches google.com rule", () => {
    const rules = [{ domain: "google.com", preserveParams: ["q"] }];
    const s = getPreservedParams("www.google.com", rules);
    assert.ok(s.has("q"));
  });

  test("deep subdomain match — mail.google.com matches google.com rule", () => {
    const rules = [{ domain: "google.com", preserveParams: ["hl"] }];
    const s = getPreservedParams("mail.google.com", rules);
    assert.ok(s.has("hl"));
  });

  test("non-matching domain returns empty set", () => {
    const rules = [{ domain: "google.com", preserveParams: ["q"] }];
    const s = getPreservedParams("bing.com", rules);
    assert.equal(s.size, 0);
  });

  test("partial domain must not match — egoogle.com must NOT match google.com", () => {
    const rules = [{ domain: "google.com", preserveParams: ["q"] }];
    const s = getPreservedParams("egoogle.com", rules);
    assert.equal(s.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Google — search query preserved, tracking stripped
// ---------------------------------------------------------------------------
describe("Google search", () => {
  test("preserves q, strips si (YouTube share tracking reused by Google)", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.google.com/search?q=javascript+tutorial&si=tracking123&utm_source=newsletter"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "javascript tutorial");
    assert.ok(!u.searchParams.has("si"));
    assert.ok(!u.searchParams.has("utm_source"));
    assert.ok(removedTracking.includes("utm_source"));
  });

  test("preserves hl and gl — language and region params", () => {
    const { cleanUrl } = clean(
      "https://www.google.com/search?q=test&hl=es&gl=ES&gclid=abc123"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "test");
    assert.equal(u.searchParams.get("hl"), "es");
    assert.equal(u.searchParams.get("gl"), "ES");
    assert.ok(!u.searchParams.has("gclid"));
  });

  test("preserves tbm (search type) and num (results count)", () => {
    const { cleanUrl } = clean(
      "https://www.google.com/search?q=muga&tbm=isch&num=20&fbclid=xyz"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tbm"), "isch");
    assert.equal(u.searchParams.get("num"), "20");
    assert.ok(!u.searchParams.has("fbclid"));
  });
});

// ---------------------------------------------------------------------------
// Bing — search params preserved
// ---------------------------------------------------------------------------
describe("Bing search", () => {
  test("preserves q and form, strips msclkid", () => {
    const { cleanUrl } = clean(
      "https://www.bing.com/search?q=node+js&form=QBLH&msclkid=abc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "node js");
    assert.equal(u.searchParams.get("form"), "QBLH");
    assert.ok(!u.searchParams.has("msclkid"));
  });
});

// ---------------------------------------------------------------------------
// DuckDuckGo — search query preserved
// ---------------------------------------------------------------------------
describe("DuckDuckGo search", () => {
  test("preserves q, strips utm_source", () => {
    const { cleanUrl } = clean(
      "https://duckduckgo.com/?q=privacy+browser&utm_source=email"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "privacy browser");
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Amazon — product/search params preserved, internal tracking stripped
// ---------------------------------------------------------------------------
describe("Amazon", () => {
  test("preserves k (search keyword) and s (sort), strips pd_rd_r and psc", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.com/s?k=laptop&s=review-rank&pd_rd_r=abc123&psc=1"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("k"), "laptop");
    assert.equal(u.searchParams.get("s"), "review-rank");
    assert.ok(!u.searchParams.has("pd_rd_r"));
    assert.ok(!u.searchParams.has("psc"));
    assert.ok(removedTracking.includes("pd_rd_r"));
  });

  test("strips ref and linkCode on amazon.es — ref is tracking noise", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.es/s?k=auriculares&ref=nb_sb_noss&linkCode=ll2"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("k"), "auriculares");
    assert.ok(!u.searchParams.has("ref"), "ref should be stripped on Amazon");
    assert.ok(!u.searchParams.has("linkCode"));
    assert.ok(removedTracking.includes("ref"));
  });

  test("strips ascsubtag on amazon.com", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.com/dp/B0ABC12345/?ascsubtag=abc&k=test"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ascsubtag"));
    assert.equal(u.searchParams.get("k"), "test");
  });
});

// ---------------------------------------------------------------------------
// eBay — search params preserved, tracking stripped
// ---------------------------------------------------------------------------
describe("eBay", () => {
  test("preserves _nkw and _sacat, strips mkevt and mkcid", () => {
    const { cleanUrl } = clean(
      "https://www.ebay.com/sch/i.html?_nkw=iphone+13&_sacat=0&mkevt=1&mkcid=1"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_nkw"), "iphone 13");
    assert.equal(u.searchParams.get("_sacat"), "0");
    assert.ok(!u.searchParams.has("mkevt"));
    assert.ok(!u.searchParams.has("mkcid"));
  });

  test("preserves _sop (sort order) on ebay.es", () => {
    const { cleanUrl } = clean(
      "https://www.ebay.es/sch/i.html?_nkw=tablet&_sop=12&mkrid=abc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_sop"), "12");
    assert.ok(!u.searchParams.has("mkrid"));
  });
});

// ---------------------------------------------------------------------------
// YouTube — video/playlist params preserved, si stripped
// ---------------------------------------------------------------------------
describe("YouTube", () => {
  test("preserves v, t and list — strips si (share tracking)", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PLtest123&si=trackingtoken"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.equal(u.searchParams.get("t"), "42");
    assert.equal(u.searchParams.get("list"), "PLtest123");
    assert.ok(!u.searchParams.has("si"));
    assert.ok(removedTracking.includes("si"));
  });

  test("ab_channel is preserved on YouTube (functional — channel context)", () => {
    // ab_channel is in global TRACKING_PARAMS but YouTube domain rule preserves it
    const { cleanUrl } = clean(
      "https://www.youtube.com/watch?v=abc&ab_channel=Fireship&si=trackme"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "abc");
    assert.equal(u.searchParams.get("ab_channel"), "Fireship");
    assert.ok(!u.searchParams.has("si"));
  });

  test("ab_channel is stripped on non-YouTube domain (global tracking param)", () => {
    const { cleanUrl } = clean(
      "https://example.com/page?ab_channel=test&utm_source=email"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ab_channel"));
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Reddit — sort/pagination preserved, tracking stripped
// ---------------------------------------------------------------------------
describe("Reddit", () => {
  test("preserves sort, t, after, limit — strips rdt_cid", () => {
    const { cleanUrl } = clean(
      "https://www.reddit.com/r/javascript/?sort=top&t=week&after=t3_abc&limit=25&rdt_cid=xyz"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("sort"), "top");
    assert.equal(u.searchParams.get("t"), "week");
    assert.equal(u.searchParams.get("after"), "t3_abc");
    assert.equal(u.searchParams.get("limit"), "25");
    assert.ok(!u.searchParams.has("rdt_cid"));
  });
});

// ---------------------------------------------------------------------------
// GitHub — tab, search, ref preserved, tracking stripped
// ---------------------------------------------------------------------------
describe("GitHub", () => {
  test("preserves tab and q, strips utm_source", () => {
    const { cleanUrl } = clean(
      "https://github.com/search?q=muga+extension&type=repositories&utm_source=newsletter"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "muga extension");
    assert.equal(u.searchParams.get("type"), "repositories");
    assert.ok(!u.searchParams.has("utm_source"));
  });

  test("preserves ref (branch ref) — ref is NOT in TRACKING_PARAMS", () => {
    const { cleanUrl } = clean(
      "https://github.com/user/repo/tree/main?ref=main&utm_campaign=launch"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("ref"), "main");
    assert.ok(!u.searchParams.has("utm_campaign"));
  });
});

// ---------------------------------------------------------------------------
// Wikipedia — navigation params preserved
// ---------------------------------------------------------------------------
describe("Wikipedia", () => {
  test("preserves search, action, oldid — strips utm_*", () => {
    const { cleanUrl } = clean(
      "https://en.wikipedia.org/wiki/JavaScript?action=history&oldid=1234567&utm_source=ref"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("action"), "history");
    assert.equal(u.searchParams.get("oldid"), "1234567");
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// StackOverflow — sort and pagination preserved
// ---------------------------------------------------------------------------
describe("StackOverflow", () => {
  test("preserves tab, sort, page, pagesize — strips utm_*", () => {
    const { cleanUrl } = clean(
      "https://stackoverflow.com/questions?tab=Votes&sort=newest&page=2&pagesize=50&utm_medium=email"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tab"), "Votes");
    assert.equal(u.searchParams.get("sort"), "newest");
    assert.equal(u.searchParams.get("page"), "2");
    assert.equal(u.searchParams.get("pagesize"), "50");
    assert.ok(!u.searchParams.has("utm_medium"));
  });
});

// ---------------------------------------------------------------------------
// Booking.com — booking/search params preserved
// ---------------------------------------------------------------------------
describe("Booking.com", () => {
  test("preserves checkin, checkout, adults, rooms — strips utm_*", () => {
    const { cleanUrl } = clean(
      "https://www.booking.com/searchresults.html?ss=Madrid&checkin=2026-04-01&checkout=2026-04-05&adults=2&rooms=1&utm_source=email"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("checkin"), "2026-04-01");
    assert.equal(u.searchParams.get("checkout"), "2026-04-05");
    assert.equal(u.searchParams.get("adults"), "2");
    assert.equal(u.searchParams.get("rooms"), "1");
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Travel (Iberia) — flight search params preserved
// ---------------------------------------------------------------------------
describe("Iberia", () => {
  test("preserves origin, destination, outboundDate, adults — strips utm_*", () => {
    const { cleanUrl } = clean(
      "https://www.iberia.com/flights?origin=MAD&destination=BCN&outboundDate=2026-05-01&adults=1&utm_campaign=spring"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("origin"), "MAD");
    assert.equal(u.searchParams.get("destination"), "BCN");
    assert.equal(u.searchParams.get("outboundDate"), "2026-05-01");
    assert.ok(!u.searchParams.has("utm_campaign"));
  });
});

// ---------------------------------------------------------------------------
// Domain with no rules — ALL tracking params stripped normally
// ---------------------------------------------------------------------------
describe("Domain with no rules", () => {
  test("all tracking params stripped on unknown domain", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://example.com/page?utm_source=twitter&utm_campaign=launch&fbclid=abc&gclid=xyz&ref=homepage"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("utm_source"));
    assert.ok(!u.searchParams.has("utm_campaign"));
    assert.ok(!u.searchParams.has("fbclid"));
    assert.ok(!u.searchParams.has("gclid"));
    // ref is not in TRACKING_PARAMS (removed PR #165) — so it stays
    assert.equal(u.searchParams.get("ref"), "homepage");
    assert.ok(removedTracking.length >= 4);
  });

  test("clean URL passes through untouched when no tracking params", () => {
    const raw = "https://example.com/article/hello-world";
    const { cleanUrl, action } = clean(raw);
    assert.equal(cleanUrl, raw);
    assert.equal(action, "untouched");
  });
});

// ---------------------------------------------------------------------------
// LinkedIn — job search params preserved
// ---------------------------------------------------------------------------
describe("LinkedIn", () => {
  test("preserves keywords and location, strips li_fat_id", () => {
    const { cleanUrl } = clean(
      "https://www.linkedin.com/jobs/search/?keywords=engineer&location=Madrid&li_fat_id=abc123"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("keywords"), "engineer");
    assert.equal(u.searchParams.get("location"), "Madrid");
    assert.ok(!u.searchParams.has("li_fat_id"));
  });
});

// ---------------------------------------------------------------------------
// Spanish real-estate sites
// ---------------------------------------------------------------------------
describe("Idealista", () => {
  test("preserves tipo and order, strips utm_*", () => {
    const { cleanUrl } = clean(
      "https://www.idealista.com/venta-viviendas/madrid/?tipo=pisos&order=desc&utm_source=portal"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tipo"), "pisos");
    assert.equal(u.searchParams.get("order"), "desc");
    assert.ok(!u.searchParams.has("utm_source"));
  });
});

// ---------------------------------------------------------------------------
// Amazon store page — lp_asin, store_ref, bl_grd_status stripped (#267)
// ---------------------------------------------------------------------------
describe("Amazon store page URL", () => {
  test("strips lp_asin, store_ref, bl_grd_status from store page", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.es/stores/UGREEN/page/CF129B44-045C-4C53-AAE7-E2394B703029?lp_asin=B0B9N3QSL3&store_ref=bl_ast_dp_brandlogo_sto&bl_grd_status=override"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("lp_asin"));
    assert.ok(!u.searchParams.has("store_ref"));
    assert.ok(!u.searchParams.has("bl_grd_status"));
    assert.equal(removedTracking.length, 3);
  });

  test("strips field-lbr_brands_browse-bin from store page", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.es/stores/page/9A938D7A-DE82-426E-A8E6-CF16CA1EFFCA?field-lbr_brands_browse-bin=AmazonBasics"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("field-lbr_brands_browse-bin"));
    assert.equal(u.search, "");
    assert.ok(removedTracking.includes("field-lbr_brands_browse-bin"));
  });

  test("strips ingress and visitId from store page", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/stores/page/063F9A53-F6FA-47C3-B5F1-BA4025D14CC8?ingress=0&visitId=0ba739a1-553d-41f4-b2a8-0807b3006c87"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ingress"));
    assert.ok(!u.searchParams.has("visitId"));
    assert.equal(u.search, "");
  });

  test("strips ref and social_share from Chollometro-style Amazon link", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.es/dp/B07JNVH9D8?ref=cm_sw_r_cso_cp_apan_dp_KP63TZ0DQH7N1Y09NXJ4&social_share=cm_sw_r_cso_cp_apan_dp_KP63TZ0DQH7N1Y09NXJ4&tag=pepperugc-21"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ref"), "ref must be stripped");
    assert.ok(!u.searchParams.has("social_share"), "social_share must be stripped");
    assert.equal(u.searchParams.get("tag"), "pepperugc-21", "affiliate tag preserved");
    assert.ok(removedTracking.includes("ref"));
    assert.ok(removedTracking.includes("social_share"));
  });

  test("strips dib, dib_tag, sprefix, crid, dchild, qid from search", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/s?k=usb+cable&dib=abc&dib_tag=se&sprefix=usb&crid=xyz&dchild=1&qid=123456"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("k"), "usb cable");
    assert.ok(!u.searchParams.has("dib"));
    assert.ok(!u.searchParams.has("dib_tag"));
    assert.ok(!u.searchParams.has("sprefix"));
    assert.ok(!u.searchParams.has("crid"));
    assert.ok(!u.searchParams.has("dchild"));
    assert.ok(!u.searchParams.has("qid"));
  });
});

// ---------------------------------------------------------------------------
// AliExpress — affiliate and tracking params stripped
// ---------------------------------------------------------------------------
describe("AliExpress — strips affiliate noise, preserves search", () => {
  test("strips all tracking from Chollometro-style AliExpress link", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://es.aliexpress.com/item/1005007831452483.html?dp=ppr-es-969667807&aff_fcid=abc&tt=CPS_NORMAL&aff_fsk=xyz&aff_platform=portals-tool&sk=xyz&terminal_id=abc123&afSmartRedirect=y&gatewayAdapt=glo2esp"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("dp"));
    assert.ok(!u.searchParams.has("tt"));
    assert.ok(!u.searchParams.has("aff_fsk"));
    assert.ok(!u.searchParams.has("aff_platform"));
    assert.ok(!u.searchParams.has("sk"));
    assert.ok(!u.searchParams.has("terminal_id"));
    assert.ok(!u.searchParams.has("afSmartRedirect"));
    assert.ok(!u.searchParams.has("gatewayAdapt"));
    assert.ok(removedTracking.length >= 7, `expected >=7 params removed, got ${removedTracking.length}`);
  });

  test("preserves search params on AliExpress", () => {
    const { cleanUrl } = clean(
      "https://es.aliexpress.com/wholesale?SearchText=usb+cable&catId=0&spm=a2g0o.home.1000002.0"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("SearchText"), "usb cable");
    assert.ok(!u.searchParams.has("spm"));
  });
});

// ---------------------------------------------------------------------------
// Domain stripParams — domain-specific stripping via domain-rules.json
// ---------------------------------------------------------------------------
describe("domain stripParams", () => {
  test("Twitter: strips t, s, src (share tracking) — preserves q, f", () => {
    const { cleanUrl } = clean(
      "https://twitter.com/user/status/12345?t=abc&s=20&src=hashtag_click&q=test&f=live"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("t"));
    assert.ok(!u.searchParams.has("s"));
    assert.ok(!u.searchParams.has("src"));
    assert.equal(u.searchParams.get("q"), "test");
    assert.equal(u.searchParams.get("f"), "live");
  });

  test("YouTube: strips feature, pp — preserves v, t, list", () => {
    const { cleanUrl } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&feature=shared&pp=abc&list=PLtest"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("feature"));
    assert.ok(!u.searchParams.has("pp"));
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.equal(u.searchParams.get("t"), "42");
    assert.equal(u.searchParams.get("list"), "PLtest");
  });

  test("youtu.be: strips feature — preserves t", () => {
    const { cleanUrl } = clean(
      "https://youtu.be/dQw4w9WgXcQ?t=42&feature=shared&si=trackingtoken"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("feature"));
    assert.ok(!u.searchParams.has("si"));
    assert.equal(u.searchParams.get("t"), "42");
  });

  test("Google: strips ved, ei, sca_esv — preserves q, cid", () => {
    const { cleanUrl } = clean(
      "https://www.google.com/search?q=test&ved=abc&ei=xyz&sca_esv=123&cid=business123"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ved"));
    assert.ok(!u.searchParams.has("ei"));
    assert.ok(!u.searchParams.has("sca_esv"));
    assert.equal(u.searchParams.get("q"), "test");
    assert.equal(u.searchParams.get("cid"), "business123");
  });

  test("TikTok: strips is_from_webapp, sender_device — preserves q", () => {
    const { cleanUrl } = clean(
      "https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc&q=trending"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("is_from_webapp"));
    assert.ok(!u.searchParams.has("sender_device"));
    assert.equal(u.searchParams.get("q"), "trending");
  });

  test("Reddit: strips share_id, ref — preserves sort, context", () => {
    const { cleanUrl } = clean(
      "https://www.reddit.com/r/test/comments/abc?sort=top&context=3&share_id=xyz&ref=share"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("share_id"));
    assert.ok(!u.searchParams.has("ref"));
    assert.equal(u.searchParams.get("sort"), "top");
    assert.equal(u.searchParams.get("context"), "3");
  });
});

// ---------------------------------------------------------------------------
// New global tracking params
// ---------------------------------------------------------------------------
describe("new global tracking params", () => {
  test("strips GA4 cross-domain params (_gl, _ga, _gac)", () => {
    const { cleanUrl } = clean(
      "https://example.com/page?_gl=1*abc&_ga=2.123&_gac=1.def"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("_gl"));
    assert.ok(!u.searchParams.has("_ga"));
    assert.ok(!u.searchParams.has("_gac"));
  });

  test("strips Meta params (mibextid, fb_action_ids, fb_ref)", () => {
    const { cleanUrl } = clean(
      "https://example.com/?mibextid=abc&fb_action_ids=123&fb_ref=timeline"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("mibextid"));
    assert.ok(!u.searchParams.has("fb_action_ids"));
    assert.ok(!u.searchParams.has("fb_ref"));
  });

  test("strips Branch.io params", () => {
    const { cleanUrl } = clean(
      "https://example.com/?_branch_match_id=abc&_branch_referrer=xyz"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("_branch_match_id"));
    assert.ok(!u.searchParams.has("_branch_referrer"));
  });

  test("strips Shopify params (_pos, _ss, _sid)", () => {
    const { cleanUrl } = clean(
      "https://myshop.com/products/item?_pos=1&_ss=r&_sid=abc"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("_pos"));
    assert.ok(!u.searchParams.has("_ss"));
    assert.ok(!u.searchParams.has("_sid"));
  });
});

// ---------------------------------------------------------------------------
// utm_* prefix match — catches non-standard UTM variants
// ---------------------------------------------------------------------------
describe("utm_* prefix match", () => {
  test("strips non-standard utm_ variants (utm_wave, utm_emailid, utm_newsletterid)", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://example.com/page?q=hello&utm_wave=spring&utm_emailid=abc&utm_newsletterid=xyz&utm_brand=acme"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("utm_wave"));
    assert.ok(!u.searchParams.has("utm_emailid"));
    assert.ok(!u.searchParams.has("utm_newsletterid"));
    assert.ok(!u.searchParams.has("utm_brand"));
    assert.equal(removedTracking.length, 4);
  });

  test("does not strip non-utm params that happen to start with 'ut'", () => {
    const { cleanUrl } = clean(
      "https://example.com/?utility=power&utensil=fork"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("utility"), "power");
    assert.equal(u.searchParams.get("utensil"), "fork");
  });
});

// ---------------------------------------------------------------------------
// Asian/Russian market domains
// ---------------------------------------------------------------------------
describe("Bilibili", () => {
  test("strips share/fingerprint tracking — preserves p, t", () => {
    const { cleanUrl } = clean(
      "https://www.bilibili.com/video/BV1xx?p=1&t=120&spm_id_from=333.999&vd_source=abc123&share_source=copy_web&from=search"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("p"), "1");
    assert.equal(u.searchParams.get("t"), "120");
    assert.ok(!u.searchParams.has("spm_id_from"));
    assert.ok(!u.searchParams.has("vd_source"));
    assert.ok(!u.searchParams.has("share_source"));
    assert.ok(!u.searchParams.has("from"));
  });
});

describe("Flipkart", () => {
  test("strips otracker, ssid — preserves q", () => {
    const { cleanUrl } = clean(
      "https://www.flipkart.com/search?q=phone&otracker=search&ssid=abc&marketplace=FLIPKART"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "phone");
    assert.ok(!u.searchParams.has("otracker"));
    assert.ok(!u.searchParams.has("ssid"));
    assert.ok(!u.searchParams.has("marketplace"));
  });
});

// ---------------------------------------------------------------------------
// domainRules.json — structural validation
// ---------------------------------------------------------------------------
describe("domain-rules.json structure", () => {
  test("is an array", () => {
    assert.ok(Array.isArray(domainRules));
  });

  test("every entry has domain (string) and preserveParams (non-empty array)", () => {
    for (const rule of domainRules) {
      assert.equal(typeof rule.domain, "string", `bad domain in rule: ${JSON.stringify(rule)}`);
      assert.ok(Array.isArray(rule.preserveParams), `preserveParams must be array in: ${rule.domain}`);
      assert.ok(rule.preserveParams.length > 0, `preserveParams must not be empty in: ${rule.domain}`);
    }
  });

  test("no duplicate domains", () => {
    const domains = domainRules.map(r => r.domain);
    const unique = new Set(domains);
    assert.equal(unique.size, domains.length, "Duplicate domain entries found");
  });

  test("covers key domains: google.com, youtube.com, amazon.com, github.com, wikipedia.org", () => {
    const domains = new Set(domainRules.map(r => r.domain));
    for (const d of ["google.com", "youtube.com", "amazon.com", "github.com", "wikipedia.org"]) {
      assert.ok(domains.has(d), `Missing domain rule for: ${d}`);
    }
  });
});
