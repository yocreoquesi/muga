/**
 * MUGA — Cleaner Domain Rules Tests
 *
 * Verifies processUrl behavior for per-domain rules: functional params
 * preserved, tracking stripped, path cleaning and regression coverage.
 *
 * Uses the real processUrl function with real TRACKING_PARAMS and domain-rules.
 * No browser required — pure Node.js unit tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// ---------------------------------------------------------------------------
// Base prefs — minimal, tracking strip always on, no injection
// ---------------------------------------------------------------------------
const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  blacklist: [],
  whitelist: [],
};

function clean(rawUrl) {
  return processUrl(rawUrl, PREFS, domainRules);
}

// ---------------------------------------------------------------------------
// Search engines
// ---------------------------------------------------------------------------
describe("Google — functional params preserved, tracking stripped", () => {
  test("q preserved, utm_source stripped, gclid stripped", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.google.com/search?q=javascript+tutorial&utm_source=newsletter&gclid=abc123"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "javascript tutorial");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
    assert.ok(!u.searchParams.has("gclid"), "gclid must be stripped");
    assert.ok(removedTracking.includes("utm_source"));
    assert.ok(removedTracking.includes("gclid"));
  });

  test("new ClearURLs/AdGuard params stripped (sei, iflsig, pcampaignid, cshid, fbs, vet, dpr)", () => {
    const { cleanUrl } = clean(
      "https://www.google.com/search?q=test&sei=abc&iflsig=def&pcampaignid=ghi&cshid=jkl&fbs=mno&vet=pqr&dpr=2"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "test");
    for (const p of ["sei", "iflsig", "pcampaignid", "cshid", "fbs", "vet", "dpr"]) {
      assert.ok(!u.searchParams.has(p), `${p} must be stripped`);
    }
  });
});

describe("Bing — functional params preserved, tracking stripped", () => {
  test("q preserved, form preserved (bing preserveParams), utm_campaign stripped", () => {
    const { cleanUrl } = clean(
      "https://www.bing.com/search?q=test&form=QBLH&utm_campaign=test"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "test");
    assert.equal(u.searchParams.get("form"), "QBLH");
    assert.ok(!u.searchParams.has("utm_campaign"), "utm_campaign must be stripped");
  });

  test("cvid session tracking stripped", () => {
    const { cleanUrl } = clean(
      "https://www.bing.com/search?q=test&form=QBLH&cvid=abc123def"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "test");
    assert.ok(!u.searchParams.has("cvid"), "cvid must be stripped");
  });
});

describe("DuckDuckGo — functional params preserved, tracking stripped", () => {
  test("q preserved, ia preserved, utm_source stripped", () => {
    const { cleanUrl } = clean(
      "https://duckduckgo.com/?q=privacy&ia=web&utm_source=organic"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "privacy");
    assert.equal(u.searchParams.get("ia"), "web");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
  });
});

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
describe("YouTube — v preserved, si stripped, ab_channel preserved", () => {
  test("v preserved, si stripped, utm_source stripped", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123&utm_source=share"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.ok(!u.searchParams.has("si"), "si must be stripped");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
    assert.ok(removedTracking.includes("si"));
  });

  test("v preserved, ab_channel preserved (youtube domain rule), utm_medium stripped", () => {
    const { cleanUrl } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ab_channel=RickAstleyVEVO&utm_medium=social"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.equal(
      u.searchParams.get("ab_channel"),
      "RickAstleyVEVO",
      "ab_channel must be preserved on YouTube"
    );
    assert.ok(!u.searchParams.has("utm_medium"), "utm_medium must be stripped");
  });

  test("embed referrer tracking stripped (embeds_referring_euri, embeds_referring_origin, kw)", () => {
    const { cleanUrl } = clean(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&embeds_referring_euri=https%3A%2F%2Fexample.com&embeds_referring_origin=https%3A%2F%2Fexample.com&kw=rick"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("v"), "dQw4w9WgXcQ");
    assert.ok(!u.searchParams.has("embeds_referring_euri"), "embeds_referring_euri must be stripped");
    assert.ok(!u.searchParams.has("embeds_referring_origin"), "embeds_referring_origin must be stripped");
    assert.ok(!u.searchParams.has("kw"), "kw must be stripped");
  });
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------
describe("GitHub — tab and q preserved, utm stripped", () => {
  test("utm_source stripped, tab preserved", () => {
    const { cleanUrl } = clean(
      "https://github.com/user/repo?utm_source=github&tab=readme-ov-file"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("tab"), "readme-ov-file");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
  });

  test("q preserved in GitHub search, utm_campaign stripped", () => {
    const { cleanUrl } = clean(
      "https://github.com/search?q=muga&utm_campaign=launch"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "muga");
    assert.ok(!u.searchParams.has("utm_campaign"), "utm_campaign must be stripped");
  });
});

// ---------------------------------------------------------------------------
// Amazon
// ---------------------------------------------------------------------------
describe("Amazon — search params preserved, tracking stripped", () => {
  test("k preserved, utm_source stripped, pd_rd_r stripped", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.amazon.com/s?k=laptop&utm_source=google&pd_rd_r=abc123"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("k"), "laptop");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
    assert.ok(!u.searchParams.has("pd_rd_r"), "pd_rd_r must be stripped");
    assert.ok(removedTracking.includes("pd_rd_r"));
  });
});

describe("Amazon: path cleaning regression tests", () => {
  test("lowercase ASIN in /dp/ path is cleaned", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.com/dp/b0gq4n9n33/ref=cm_sw_r_cp_api?tag=creator-20"
    );
    assert.ok(!cleanUrl.includes("/ref="), "ref= path segment must be stripped even with lowercase ASIN");
    assert.ok(cleanUrl.includes("b0gq4n9n33"), "lowercase ASIN must be preserved");
    assert.ok(cleanUrl.includes("tag=creator-20"), "affiliate tag must be preserved");
  });

  test("mixed-case ASIN in /dp/ path is cleaned", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/dp/B0Gq4N9n33/ref=sr_1_1?tag=test-21"
    );
    assert.ok(!cleanUrl.includes("/ref="), "ref= must be stripped with mixed-case ASIN");
  });

  test("notamazon.com does not trigger Amazon path cleaning", () => {
    const { cleanUrl } = clean(
      "https://notamazon.com/dp/B00EXAMPLE/ref=test123?utm_source=x"
    );
    // ref= in path should NOT be stripped (not a real Amazon domain)
    assert.ok(cleanUrl.includes("/ref=test123"), "non-Amazon domain must not trigger path cleaning");
  });

  test("Amazon Fresh tracking params stripped (almBrandId, mrai, fpw)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/afx/lists/pastpurchases/?almBrandId=TGEgUGxhemEgZGUgRGlh&almBrandId=TGEgUGxhemEgZGUgRGlh&mrai=B01LQAY030&fpw=alm&tag=muga0b-21"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("almBrandId"), "almBrandId must be stripped");
    assert.ok(!u.searchParams.has("mrai"), "mrai must be stripped");
    assert.ok(!u.searchParams.has("fpw"), "fpw must be stripped");
    assert.equal(u.searchParams.get("tag"), "muga0b-21", "affiliate tag must be preserved");
  });

  test("Amazon sponsored product tracking stripped (aref, sp_csd)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/dp/B01N5VHLUG/ref=sspa_dk_detail_4?aref=Jc6HyeNHuL&sp_csd=d2lkZ2V0TmFtZT1zcF9kZXRhaWxfdGhlbWF0aWM&th=1"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("aref"), "aref must be stripped");
    assert.ok(!u.searchParams.has("sp_csd"), "sp_csd must be stripped");
    assert.equal(u.searchParams.get("th"), "1", "th (variant selector) must be preserved");
    assert.ok(!cleanUrl.includes("/ref="), "ref= in path must be stripped");
  });

  test("Amazon Fresh params stripped across all Amazon TLDs", () => {
    for (const tld of ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it"]) {
      const { cleanUrl } = clean(
        `https://www.${tld}/afx/lists/pastpurchases/?almBrandId=abc&mrai=B01X&fpw=alm`
      );
      const u = new URL(cleanUrl);
      assert.ok(!u.searchParams.has("almBrandId"), `${tld}: almBrandId must be stripped`);
      assert.ok(!u.searchParams.has("mrai"), `${tld}: mrai must be stripped`);
      assert.ok(!u.searchParams.has("fpw"), `${tld}: fpw must be stripped`);
    }
  });

  test("Amazon search session tracking stripped (qid, sr, crid, sprefix, dib)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/s?k=auriculares&qid=1711900000&sr=8-1&crid=ABC123&sprefix=auric%2Caps&dib=abc&dib_tag=se"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("qid"), "qid must be stripped");
    assert.ok(!u.searchParams.has("sr"), "sr must be stripped");
    assert.ok(!u.searchParams.has("crid"), "crid must be stripped");
    assert.ok(!u.searchParams.has("sprefix"), "sprefix must be stripped");
    assert.ok(!u.searchParams.has("dib"), "dib must be stripped");
    assert.ok(!u.searchParams.has("dib_tag"), "dib_tag must be stripped");
    assert.equal(u.searchParams.get("k"), "auriculares", "k (search keyword) must be preserved");
  });

  test("Amazon page framework tracking stripped (pf_rd_*, pd_rd_*)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.com/dp/B00EXAMPLE?pf_rd_r=ABC&pf_rd_p=DEF&pd_rd_r=GHI&pd_rd_w=JKL&pd_rd_wg=MNO&th=1"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("pf_rd_r"), "pf_rd_r must be stripped");
    assert.ok(!u.searchParams.has("pf_rd_p"), "pf_rd_p must be stripped");
    assert.ok(!u.searchParams.has("pd_rd_r"), "pd_rd_r must be stripped");
    assert.ok(!u.searchParams.has("pd_rd_w"), "pd_rd_w must be stripped");
    assert.ok(!u.searchParams.has("pd_rd_wg"), "pd_rd_wg must be stripped");
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
  });

  test("Amazon affiliate sub-tracking stripped (ascsubtag, linkCode, linkId)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.es/dp/B00EXAMPLE?ascsubtag=abc123&linkCode=ll1&linkId=def456&tag=muga0b-21"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("ascsubtag"), "ascsubtag must be stripped");
    assert.ok(!u.searchParams.has("linkCode"), "linkCode must be stripped");
    assert.ok(!u.searchParams.has("linkId"), "linkId must be stripped");
  });

  test("Amazon encoding and UI params stripped (_encoding, ie, psc)", () => {
    const { cleanUrl } = clean(
      "https://www.amazon.de/dp/B00EXAMPLE?_encoding=UTF8&ie=UTF8&psc=1&th=1"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("_encoding"), "_encoding must be stripped");
    assert.ok(!u.searchParams.has("ie"), "ie must be stripped");
    assert.ok(!u.searchParams.has("psc"), "psc must be stripped");
    assert.equal(u.searchParams.get("th"), "1", "th must be preserved");
  });
});

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------
describe("Reddit — sort and t preserved, utm stripped", () => {
  test("sort preserved, t preserved, utm_source stripped", () => {
    const { cleanUrl } = clean(
      "https://www.reddit.com/r/javascript?sort=new&t=week&utm_source=reddit"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("sort"), "new");
    assert.equal(u.searchParams.get("t"), "week");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
  });
});

// ---------------------------------------------------------------------------
// eBay
// ---------------------------------------------------------------------------
describe("eBay — _nkw preserved, utm stripped", () => {
  test("_nkw preserved, _sacat preserved, utm_medium stripped", () => {
    const { cleanUrl } = clean(
      "https://www.ebay.com/sch/i.html?_nkw=laptop&_sacat=0&utm_medium=cpc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_nkw"), "laptop");
    assert.equal(u.searchParams.get("_sacat"), "0");
    assert.ok(!u.searchParams.has("utm_medium"), "utm_medium must be stripped");
  });
});

// ---------------------------------------------------------------------------
// Wikipedia
// ---------------------------------------------------------------------------
describe("Wikipedia — search preserved, tracking stripped", () => {
  test("search preserved, utm_source stripped", () => {
    const { cleanUrl } = clean(
      "https://en.wikipedia.org/w/index.php?search=javascript&utm_source=wiki"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("search"), "javascript");
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
  });
});

// ---------------------------------------------------------------------------
// Booking.com
// ---------------------------------------------------------------------------
describe("Booking.com — destination and checkin/checkout preserved", () => {
  test("ss preserved, checkin preserved, checkout preserved, utm_campaign stripped", () => {
    const { cleanUrl } = clean(
      "https://www.booking.com/searchresults.html?ss=Madrid&checkin=2026-04-01&checkout=2026-04-10&utm_campaign=brand"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("ss"), "Madrid");
    assert.equal(u.searchParams.get("checkin"), "2026-04-01");
    assert.equal(u.searchParams.get("checkout"), "2026-04-10");
    assert.ok(!u.searchParams.has("utm_campaign"), "utm_campaign must be stripped");
  });
});

// ---------------------------------------------------------------------------
// Non-listed domain — everything stripped
// ---------------------------------------------------------------------------
describe("Non-listed domain — all tracking stripped, no functional preservation", () => {
  test("utm_source, fbclid stripped; q stripped (no domain rule for example.com)", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://example.com/page?utm_source=test&fbclid=abc&q=something"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("utm_source"), "utm_source must be stripped");
    assert.ok(!u.searchParams.has("fbclid"), "fbclid must be stripped");
    // q has no domain rule protection on example.com, but q is not in TRACKING_PARAMS — stays
    // fbclid and utm_source are confirmed tracking params
    assert.ok(removedTracking.includes("utm_source"));
    assert.ok(removedTracking.includes("fbclid"));
  });
});

// ---------------------------------------------------------------------------
// Regression tests for bug fixes (1.8.1)
// ---------------------------------------------------------------------------
describe("Regression: Amazon ASIN case sensitivity", () => {
  test("lowercase ASIN in /dp/ path is preserved", () => {
    const { cleanUrl } = clean("https://www.amazon.com/dp/b0b9n3qsl3?tag=someone-20");
    assert.ok(cleanUrl.includes("b0b9n3qsl3"), "Lowercase ASIN must not be broken");
  });

  test("mixed-case ASIN in /dp/ path is preserved", () => {
    const { cleanUrl } = clean("https://www.amazon.com/Some-Product/dp/B0b9N3qSl3?ref=sr_1_1");
    assert.ok(cleanUrl.includes("B0b9N3qSl3"), "Mixed-case ASIN must be preserved");
  });

  test("notamazon.com is not treated as Amazon domain", () => {
    const { cleanUrl } = clean("https://notamazon.com/dp/B0B9N3QSL3?ref=tracking");
    // Should NOT apply Amazon path cleaning
    const u = new URL(cleanUrl);
    assert.ok(!cleanUrl.includes("/dp/B0B9N3QSL3/"), "notamazon.com must not get Amazon path normalization");
  });
});

describe("Coupang product page cleaning", () => {
  test("strips tracking params, keeps clean product URL", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://www.coupang.com/vp/products/9380846500?itemId=123&vendorItemId=456&src=1032001&spec=10305200&addtag=400&ctag=9380846500&lptag=CFM&itime=20230101&pageType=PRODUCT&pageValue=9380846500&wPcid=abc&wRef=cr&wTime=20230101&redirect=HP_Btn&mcid=abc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.pathname, "/vp/products/9380846500");
    assert.equal(u.search, "");
    assert.ok(removedTracking.includes("itemId"));
    assert.ok(removedTracking.includes("vendorItemId"));
  });

  test("preserves affiliate params subId and hmKeyword", () => {
    const { cleanUrl } = clean(
      "https://www.coupang.com/vp/products/9380846500?subId=partner123&hmKeyword=test"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("subId"), "partner123");
    assert.equal(u.searchParams.get("hmKeyword"), "test");
  });

  test("preserves search functional params", () => {
    const { cleanUrl } = clean(
      "https://www.coupang.com/np/search?q=laptop&page=2&sorter=bestAsc&channel=user&src=1032001"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "laptop");
    assert.equal(u.searchParams.get("page"), "2");
    assert.equal(u.searchParams.get("sorter"), "bestAsc");
    assert.equal(u.searchParams.has("channel"), false);
    assert.equal(u.searchParams.has("src"), false);
  });
});

describe("Danawa search URL cleaning", () => {
  test("strips tracking params from search URLs", () => {
    const { cleanUrl } = clean(
      "https://search.danawa.com/dsearch.php?q=RTX+5070&logger_kw=RTX+5070&loc=main_search"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "RTX 5070");
    assert.equal(u.searchParams.has("logger_kw"), false);
    assert.equal(u.searchParams.has("loc"), false);
  });
});

describe("Naver Shopping URL cleaning", () => {
  test("strips click attribution, preserves search params", () => {
    const { cleanUrl, removedTracking } = clean(
      "https://search.shopping.naver.com/search?query=laptop&sort=rel&frm=NVSCPRO&NaPm=ct%3Dabc&nv_ad=1"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("query"), "laptop");
    assert.equal(u.searchParams.get("sort"), "rel");
    assert.equal(u.searchParams.has("frm"), false);
    assert.equal(u.searchParams.has("NaPm"), false);
    assert.equal(u.searchParams.has("nv_ad"), false);
  });
});

describe("DCInside URL cleaning", () => {
  test("strips referral tracking, preserves gallery/post params", () => {
    const { cleanUrl } = clean(
      "https://gall.dcinside.com/board/view/?id=programming&no=2918073&page=1&from=A08&exception_mode=1"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("id"), "programming");
    assert.equal(u.searchParams.get("no"), "2918073");
    assert.equal(u.searchParams.get("page"), "1");
    assert.equal(u.searchParams.has("from"), false);
    assert.equal(u.searchParams.has("exception_mode"), false);
  });
});

describe("Namu.wiki URL cleaning", () => {
  test("strips from param on search URLs", () => {
    const { cleanUrl } = clean(
      "https://namu.wiki/search?q=Python&from=external"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "Python");
    assert.equal(u.searchParams.has("from"), false);
  });
});

describe("Regression: DuckDuckGo preserveParams no duplicates", () => {
  test("domain-rules.json has no duplicate preserveParams for any domain", () => {
    for (const rule of domainRules) {
      if (!rule.preserveParams) continue;
      const seen = new Set();
      for (const p of rule.preserveParams) {
        assert.ok(!seen.has(p), `Duplicate preserveParam "${p}" on domain ${rule.domain}`);
        seen.add(p);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-portal tracking param coverage (ClearURLs/AdGuard parity)
// ---------------------------------------------------------------------------
describe("Cross-portal tracking param stripping", () => {
  test("Facebook: __cft__, dti, tracking, sfnsn stripped; q preserved", () => {
    const { cleanUrl } = clean(
      "https://www.facebook.com/events?q=music&__cft__=abc&dti=123&tracking=yes&sfnsn=mo"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "music");
    for (const p of ["__cft__", "dti", "tracking", "sfnsn"]) {
      assert.ok(!u.searchParams.has(p), `Facebook: ${p} must be stripped`);
    }
  });

  test("TikTok: share tracking stripped (u_code, share_link_id, tt_from, sec_user_id)", () => {
    const { cleanUrl } = clean(
      "https://www.tiktok.com/@user/video/123?u_code=abc&share_link_id=def&tt_from=copy&sec_user_id=ghi&web_id=jkl&q=dance"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "dance");
    for (const p of ["u_code", "share_link_id", "tt_from", "sec_user_id", "web_id"]) {
      assert.ok(!u.searchParams.has(p), `TikTok: ${p} must be stripped`);
    }
  });

  test("LinkedIn: refId, trk, origin stripped; keywords preserved", () => {
    const { cleanUrl } = clean(
      "https://www.linkedin.com/jobs/search/?keywords=engineer&refId=abc&trk=homepage-basic_suggested-search&origin=GLOBAL_SEARCH_HEADER"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("keywords"), "engineer");
    for (const p of ["refId", "trk", "origin"]) {
      assert.ok(!u.searchParams.has(p), `LinkedIn: ${p} must be stripped`);
    }
  });

  test("Reddit: correlation_id, ref_campaign, rdt, post_index stripped; sort preserved", () => {
    const { cleanUrl } = clean(
      "https://www.reddit.com/r/javascript?sort=new&correlation_id=abc&ref_campaign=share&rdt=12345&post_index=3"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("sort"), "new");
    for (const p of ["correlation_id", "ref_campaign", "rdt", "post_index"]) {
      assert.ok(!u.searchParams.has(p), `Reddit: ${p} must be stripped`);
    }
  });

  test("eBay: _trkparms, _trksid, _from stripped; _nkw preserved", () => {
    const { cleanUrl } = clean(
      "https://www.ebay.com/sch/i.html?_nkw=laptop&_trkparms=abc&_trksid=p123&_from=R40"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("_nkw"), "laptop");
    for (const p of ["_trkparms", "_trksid", "_from"]) {
      assert.ok(!u.searchParams.has(p), `eBay: ${p} must be stripped`);
    }
  });

  test("Spotify: sp_cid, dlsi stripped; context preserved", () => {
    const { cleanUrl } = clean(
      "https://open.spotify.com/track/abc?context=spotify:playlist:123&sp_cid=campaign1&dlsi=sharetoken"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("context"), "spotify:playlist:123");
    for (const p of ["sp_cid", "dlsi"]) {
      assert.ok(!u.searchParams.has(p), `Spotify: ${p} must be stripped`);
    }
  });

  test("Netflix: jbd, jbr stripped; q and jbv preserved", () => {
    const { cleanUrl } = clean(
      "https://www.netflix.com/browse?q=action&jbv=123&jbd=abc&jbr=def"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("q"), "action");
    assert.equal(u.searchParams.get("jbv"), "123");
    for (const p of ["jbd", "jbr"]) {
      assert.ok(!u.searchParams.has(p), `Netflix: ${p} must be stripped`);
    }
  });

  test("NYTimes: smid, referringSource, impression_id stripped", () => {
    const { cleanUrl } = clean(
      "https://www.nytimes.com/article?query=climate&smid=tw-share&referringSource=articleShare&impression_id=abc"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("query"), "climate");
    for (const p of ["smid", "referringSource", "impression_id"]) {
      assert.ok(!u.searchParams.has(p), `NYT: ${p} must be stripped`);
    }
  });

  test("AliExpress: gps-id, initiative_id stripped; SearchText preserved", () => {
    const { cleanUrl } = clean(
      "https://www.aliexpress.com/wholesale?SearchText=phone&gps-id=abc&initiative_id=def&utparam-url=ghi"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("SearchText"), "phone");
    for (const p of ["gps-id", "initiative_id", "utparam-url"]) {
      assert.ok(!u.searchParams.has(p), `AliExpress: ${p} must be stripped`);
    }
  });

  test("Yahoo: soc_src, soc_trk stripped; p preserved", () => {
    const { cleanUrl } = clean(
      "https://search.yahoo.com/search?p=test&soc_src=social&soc_trk=tw"
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("p"), "test");
    for (const p of ["soc_src", "soc_trk"]) {
      assert.ok(!u.searchParams.has(p), `Yahoo: ${p} must be stripped`);
    }
  });

  test("Twitter/X: cn campaign name stripped", () => {
    const { cleanUrl } = clean(
      "https://twitter.com/user/status/123?cn=campaign1&t=abc&s=20"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("cn"), "Twitter: cn must be stripped");
    assert.ok(!u.searchParams.has("t"), "Twitter: t must be stripped");
    assert.ok(!u.searchParams.has("s"), "Twitter: s must be stripped");
  });

  test("Shopify: pr_prod_strat, pr_rec_id, pr_ref_pid stripped globally", () => {
    const { cleanUrl } = clean(
      "https://example-store.myshopify.com/products/widget?pr_prod_strat=copurchase&pr_rec_id=abc&pr_ref_pid=123&pr_rec_pid=456&pr_seq=uniform"
    );
    const u = new URL(cleanUrl);
    for (const p of ["pr_prod_strat", "pr_rec_id", "pr_ref_pid", "pr_rec_pid", "pr_seq"]) {
      assert.ok(!u.searchParams.has(p), `Shopify: ${p} must be stripped`);
    }
  });

  test("Etsy: organic_search_click stripped; click_key stripped", () => {
    const { cleanUrl } = clean(
      "https://www.etsy.com/listing/123?organic_search_click=1&click_key=abc&ref=search_grid"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("organic_search_click"), "Etsy: organic_search_click must be stripped");
    assert.ok(!u.searchParams.has("click_key"), "Etsy: click_key must be stripped");
    assert.ok(!u.searchParams.has("ref"), "Etsy: ref must be stripped");
  });

  test("BBC: facebook_page, at_bbc_team stripped", () => {
    const { cleanUrl } = clean(
      "https://www.bbc.com/news/article?facebook_page=bbcnews&at_bbc_team=editorial"
    );
    const u = new URL(cleanUrl);
    assert.ok(!u.searchParams.has("facebook_page"), "BBC: facebook_page must be stripped");
    assert.ok(!u.searchParams.has("at_bbc_team"), "BBC: at_bbc_team must be stripped");
  });
});
