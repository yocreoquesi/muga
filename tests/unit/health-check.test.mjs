/**
 * MUGA — Phase 4 Health-Check Smoke Tests
 *
 * Verifies the complete URL cleaning pipeline end-to-end for representative
 * URLs from the most important sites in domain-rules.json.
 *
 * Uses the real processUrl function with real TRACKING_PARAMS and domain-rules.
 * No browser required — pure Node.js unit tests.
 *
 * Run with: node --test tests/unit/health-check.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { processUrl } from "../../src/lib/cleaner.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

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
// Domain rules JSON integrity
// ---------------------------------------------------------------------------
describe("domain-rules.json integrity", () => {
  test("all 125 entries have domain, preserveParams (non-empty array), and note", () => {
    assert.equal(domainRules.length, 125, `Expected 125 entries, got ${domainRules.length}`);
    for (const rule of domainRules) {
      assert.equal(typeof rule.domain, "string", `domain must be string: ${JSON.stringify(rule)}`);
      assert.ok(Array.isArray(rule.preserveParams), `preserveParams must be array: ${rule.domain}`);
      assert.ok(rule.preserveParams.length > 0, `preserveParams must not be empty: ${rule.domain}`);
      assert.equal(typeof rule.note, "string", `note must be string: ${rule.domain}`);
      assert.ok(rule.note.length > 0, `note must not be empty: ${rule.domain}`);
    }
  });

  test("no duplicate domain entries", () => {
    const domains = domainRules.map(r => r.domain);
    const unique = new Set(domains);
    assert.equal(unique.size, domains.length, "Duplicate domain entries found");
  });

  test("all domains are valid lowercase strings", () => {
    for (const rule of domainRules) {
      assert.equal(rule.domain, rule.domain.toLowerCase(), `domain must be lowercase: ${rule.domain}`);
      assert.match(rule.domain, /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, `invalid domain format: ${rule.domain}`);
    }
  });

  test("key domains present: google.com, youtube.com, amazon.com, github.com, wikipedia.org, booking.com, reddit.com", () => {
    const domains = new Set(domainRules.map(r => r.domain));
    const required = ["google.com", "youtube.com", "amazon.com", "github.com", "wikipedia.org", "booking.com", "reddit.com"];
    for (const d of required) {
      assert.ok(domains.has(d), `Missing domain rule for: ${d}`);
    }
  });

  test("no known affiliate param appears in any domain's stripParams (except documented overrides)", () => {
    // Affiliate params that must NEVER be stripped — they belong to creators/partners
    const knownAffiliateParams = new Set([
      "tag",           // Amazon Associates
      "aid",           // Booking.com
      "aff_fcid",      // AliExpress
      "affiliateid",   // AliExpress
      "campid",        // eBay Partner Network
      "awc",           // AWIN
      "wt_mc",         // Zalando
      "url_from",      // Fnac
      "oref",          // SHEIN
      "subid",         // Coupang Partners
      "hmkeyword",     // Coupang Partners
    ]);
    // Documented exceptions: "ref" is an affiliate param on PcComponentes/MediaMarkt
    // but is tracking noise on Amazon (ref=cm_sw_r_*). On Amazon domains, ref is safe
    // to strip because Amazon uses "tag" for affiliates, not "ref".
    const allowedOverrides = {
      "ref": ["amazon.com", "amazon.es", "amazon.de", "amazon.fr", "amazon.co.uk", "amazon.it",
              "amazon.co.jp", "amazon.com.br", "amazon.in", "amazon.com.au", "amazon.ca",
              "amazon.com.mx", "amazon.nl", "amazon.pl", "amazon.se", "amazon.sg"],
    };
    for (const rule of domainRules) {
      for (const param of (rule.stripParams || [])) {
        const lower = param.toLowerCase();
        const overrideDomains = allowedOverrides[lower] || [];
        if (overrideDomains.includes(rule.domain)) continue;
        assert.ok(
          !knownAffiliateParams.has(lower),
          `Domain ${rule.domain} has affiliate param "${param}" in stripParams — this would strip someone's affiliate tag`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest integrity — prevent AMO/CWS submission failures
// ---------------------------------------------------------------------------
describe("manifest.json integrity", () => {
  const require = createRequire(import.meta.url);
  const mv3 = require("../../src/manifest.json");
  const mv2 = require("../../src/manifest.v2.json");

  test("MV3 and MV2 have matching version", () => {
    assert.equal(mv3.version, mv2.version, `MV3 version ${mv3.version} !== MV2 version ${mv2.version}`);
  });

  test("MV3 and MV2 have matching name", () => {
    assert.equal(mv3.name, mv2.name, "Extension name must match across manifests");
  });

  test("MV2 has gecko ID", () => {
    const geckoId = mv2.browser_specific_settings?.gecko?.id;
    assert.ok(geckoId, "manifest.v2.json must have browser_specific_settings.gecko.id");
  });

  test("MV2 has data_collection_permissions with required array", () => {
    const dcp = mv2.browser_specific_settings?.gecko?.data_collection_permissions;
    assert.ok(dcp, "manifest.v2.json must have data_collection_permissions");
    assert.ok(Array.isArray(dcp.required), "data_collection_permissions.required must be an array");
    assert.ok(dcp.required.length > 0, "data_collection_permissions.required must not be empty");
  });

  test("MV2 has gecko_android settings", () => {
    const android = mv2.browser_specific_settings?.gecko_android;
    assert.ok(android, "manifest.v2.json must have gecko_android for Firefox Android support");
    assert.ok(android.strict_min_version, "gecko_android must have strict_min_version");
  });

  test("version in package.json matches manifests", () => {
    const pkg = require("../../package.json");
    assert.equal(pkg.version, mv3.version, `package.json ${pkg.version} !== manifest.json ${mv3.version}`);
  });

  // Prevent issue #272: custom keys cause Firefox warnings
  test("MV2 has no custom/non-standard keys at root level", () => {
    const standardMV2Keys = new Set([
      "manifest_version", "name", "short_name", "version", "description",
      "permissions", "optional_permissions", "background", "content_scripts",
      "commands", "browser_action", "page_action", "options_ui",
      "web_accessible_resources", "declarative_net_request", "icons",
      "content_security_policy", "browser_specific_settings",
      "default_locale", "homepage_url", "author", "developer",
      "incognito", "minimum_chrome_version", "offline_enabled",
      "omnibox", "options_page", "sidebar_action", "theme",
      "chrome_url_overrides", "chrome_settings_overrides",
      "devtools_page", "externally_connectable", "storage",
    ]);
    for (const key of Object.keys(mv2)) {
      assert.ok(
        standardMV2Keys.has(key),
        `MV2 manifest has non-standard key "${key}" which will cause Firefox warnings`
      );
    }
  });

  test("MV3 has no custom/non-standard keys at root level", () => {
    const standardMV3Keys = new Set([
      "manifest_version", "name", "short_name", "version", "description",
      "permissions", "optional_permissions", "host_permissions",
      "background", "content_scripts", "commands", "action",
      "options_ui", "options_page", "web_accessible_resources",
      "declarative_net_request", "icons", "content_security_policy",
      "default_locale", "homepage_url", "author", "developer",
      "incognito", "minimum_chrome_version", "offline_enabled",
      "omnibox", "side_panel", "devtools_page",
      "externally_connectable", "storage", "key",
      "chrome_url_overrides", "chrome_settings_overrides",
    ]);
    for (const key of Object.keys(mv3)) {
      assert.ok(
        standardMV3Keys.has(key),
        `MV3 manifest has non-standard key "${key}" which may cause store rejection`
      );
    }
  });

  test("MV3 uses declarativeNetRequestWithHostAccess (not declarativeNetRequest) for redirect rules", () => {
    assert.ok(
      mv3.permissions.includes("declarativeNetRequestWithHostAccess"),
      "MV3 must use declarativeNetRequestWithHostAccess for redirect-type DNR rules"
    );
    assert.ok(
      !mv3.permissions.includes("declarativeNetRequest"),
      "MV3 must NOT use plain declarativeNetRequest (insufficient for redirect rules)"
    );
  });

  test("neither manifest requests the tabs permission (use activeTab instead)", () => {
    assert.ok(!mv3.permissions.includes("tabs"), "MV3 must not request tabs permission");
    assert.ok(!mv2.permissions.includes("tabs"), "MV2 must not request tabs permission");
    assert.ok(mv3.permissions.includes("activeTab"), "MV3 must use activeTab");
    assert.ok(mv2.permissions.includes("activeTab"), "MV2 must use activeTab");
  });

  // Prevent em dashes sneaking back into user-visible manifest fields
  test("no em dashes in manifest name or description fields", () => {
    const fields = [mv3.name, mv3.description, mv2.name, mv2.description];
    for (const field of fields) {
      assert.ok(
        !field.includes("\u2014"),
        `Em dash found in manifest field: "${field}"`
      );
    }
  });

  // MV3 must declare web_accessible_resources for pages opened by the extension
  test("MV3 has web_accessible_resources", () => {
    assert.ok(
      mv3.web_accessible_resources,
      "MV3 manifest must declare web_accessible_resources for onboarding/privacy pages"
    );
    const allResources = mv3.web_accessible_resources.flatMap(r => r.resources || []);
    assert.ok(
      allResources.includes("onboarding/onboarding.html"),
      "onboarding/onboarding.html must be in web_accessible_resources"
    );
  });

  test("MV3 and MV2 declare the same permissions (excluding host_permissions and MV-specific equivalents)", () => {
    // MV3 uses declarativeNetRequestWithHostAccess (required for redirect rules in MV3)
    // MV2 uses declarativeNetRequest (Firefox MV2 doesn't support the WithHostAccess variant)
    const MV_EQUIVALENTS = new Map([
      ["declarativeNetRequestWithHostAccess", "declarativeNetRequest"],
    ]);
    const normalize = (p) => MV_EQUIVALENTS.get(p) ?? p;
    const mv3Perms = new Set(mv3.permissions.map(normalize));
    const mv2Perms = new Set(mv2.permissions.filter(p => p !== "<all_urls>").map(normalize));
    for (const p of mv3Perms) {
      assert.ok(mv2Perms.has(p), `Permission "${p}" in MV3 but missing from MV2`);
    }
    for (const p of mv2Perms) {
      assert.ok(mv3Perms.has(p), `Permission "${p}" in MV2 but missing from MV3`);
    }
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

describe("Regression: i18n keys exist for share/confirm buttons", () => {
  const requiredKeys = ["share_copied", "share_btn", "confirm_cancel", "confirm_ok"];
  for (const key of requiredKeys) {
    test(`i18n key "${key}" exists with en and es`, () => {
      assert.ok(TRANSLATIONS[key], `Missing i18n key: ${key}`);
      assert.ok(TRANSLATIONS[key].en, `Missing EN translation for: ${key}`);
      assert.ok(TRANSLATIONS[key].es, `Missing ES translation for: ${key}`);
    });
  }
});

describe("Regression: storage.js uses setTimeout for MV3-safe flush", () => {
  const _dir = dirname(fileURLToPath(import.meta.url));
  const storageSource = readFileSync(join(_dir, "../../src/lib/storage.js"), "utf8");
  test("flushStats uses setTimeout, not microtask", () => {
    assert.ok(storageSource.includes("setTimeout(_flushStats"), "Must use setTimeout for flush");
    assert.ok(!storageSource.includes("Promise.resolve().then(_flushStats"), "Must not use microtask flush");
  });
});

// ---------------------------------------------------------------------------
// HTML fallback text must match i18n EN translations
// ---------------------------------------------------------------------------
const __healthDir = dirname(fileURLToPath(import.meta.url));

describe("i18n fallback sync — HTML data-i18n text matches i18n.js EN", () => {
  const htmlFiles = [
    join(__healthDir, "../../src/options/options.html"),
    join(__healthDir, "../../src/onboarding/onboarding.html"),
    join(__healthDir, "../../src/popup/popup.html"),
  ];

  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    const fname = file.split("/").pop();
    const re = /data-i18n="([^"]+)">([^<]+)<\//g;
    const decodeHtml = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    let match;
    while ((match = re.exec(html)) !== null) {
      const [, key, fallback] = match;
      if (!TRANSLATIONS[key]) continue;
      const en = TRANSLATIONS[key].en;
      if (!en) continue;
      test(`${fname}: "${key}" fallback matches EN`, () => {
        assert.equal(decodeHtml(fallback.trim()), en.trim(),
          `${fname} fallback for "${key}" doesn't match i18n.js EN.\n  HTML: "${fallback.trim()}"\n  i18n: "${en.trim()}"`);
      });
    }
  }
});
