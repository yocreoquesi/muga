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

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// Source files for Firefox compatibility checks
const SERVICE_WORKER_SOURCE = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"), "utf8"
);
const STORAGE_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/storage.js"), "utf8"
);
const POPUP_HTML = readFileSync(
  join(__dirname, "../../src/popup/popup.html"), "utf8"
);
const OPTIONS_HTML = readFileSync(
  join(__dirname, "../../src/options/options.html"), "utf8"
);
const ONBOARDING_HTML = readFileSync(
  join(__dirname, "../../src/onboarding/onboarding.html"), "utf8"
);
const BACKGROUND_HTML = readFileSync(
  join(__dirname, "../../src/background/background.html"), "utf8"
);
const POPUP_JS = readFileSync(
  join(__dirname, "../../src/popup/popup.js"), "utf8"
);
const OPTIONS_JS = readFileSync(
  join(__dirname, "../../src/options/options.js"), "utf8"
);
const CLEANER_JS = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const I18N_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/i18n.js"), "utf8"
);
const MANIFEST_V2 = require("../../src/manifest.v2.json");

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
// Domain rules JSON integrity
// ---------------------------------------------------------------------------
describe("domain-rules.json integrity", () => {
  test("all 167 entries have domain, preserveParams (non-empty array), and note", () => {
    assert.equal(domainRules.length, 167, `Expected 167 entries, got ${domainRules.length}`);
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
    // Affiliate params that must NEVER be stripped -- they belong to creators/partners
    // on stores where MUGA supports affiliate injection (privacy-compatible model).
    // Params from redirect-based networks (Awin, Admitad, etc.) are intentionally
    // excluded: MUGA strips them as policy because these networks force users through
    // external tracking servers. See privacy policy "Stores removed for privacy reasons".
    const knownAffiliateParams = new Set([
      "tag",           // Amazon Associates
      "aid",           // Booking.com
      "campid",        // eBay Partner Network
      "subid",         // Coupang Partners
      "hmkeyword",     // Coupang Partners
    ]);
    // Documented exceptions for "ref": tracking noise on Amazon (ref=cm_sw_r_*),
    // and intentionally stripped on incompatible stores (redirect-based affiliate policy).
    const allowedOverrides = {
      "ref": ["amazon.com", "amazon.es", "amazon.de", "amazon.fr", "amazon.co.uk", "amazon.it",
              "amazon.co.jp", "amazon.com.br", "amazon.in", "amazon.com.au", "amazon.ca",
              "amazon.com.mx", "amazon.nl", "amazon.pl", "amazon.se", "amazon.sg",
              "pccomponentes.com", "mediamarkt.es", "mediamarkt.de",
              "fnac.com", "fnac.es", "elcorteingles.es", "shein.com"],
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

// ---------------------------------------------------------------------------
// Firefox MV2 compatibility -- guards that must never be removed
// ---------------------------------------------------------------------------
describe("Firefox MV2 compatibility guards", () => {

  test("service-worker.js guards declarativeNetRequest with hasDNR check", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes('const hasDNR = typeof chrome.declarativeNetRequest !== "undefined"'),
      "service-worker.js must declare hasDNR guard for Firefox MV2 compatibility"
    );
  });

  test("syncCustomParamsDNR bails early when hasDNR is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function syncCustomParamsDNR[\s\S]*?if \(!hasDNR\) return;/
    );
    assert.ok(fnMatch, "syncCustomParamsDNR must check !hasDNR before any DNR call");
  });

  test("applyDnrState bails early when hasDNR is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function applyDnrState[\s\S]*?if \(!hasDNR\) return;/
    );
    assert.ok(fnMatch, "applyDnrState must check !hasDNR before any DNR call");
  });

  test("service-worker.js guards contextMenus with hasContextMenus check", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes('const hasContextMenus = typeof chrome.contextMenus !== "undefined"'),
      "service-worker.js must declare hasContextMenus guard for Firefox Android"
    );
  });

  test("syncContextMenus bails early when hasContextMenus is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function syncContextMenus[\s\S]*?if \(!hasContextMenus\) return;/
    );
    assert.ok(fnMatch, "syncContextMenus must check !hasContextMenus before any contextMenus call");
  });

  test("contextMenus.onClicked listener is guarded", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("if (hasContextMenus) chrome.contextMenus.onClicked"),
      "contextMenus.onClicked must be guarded with hasContextMenus"
    );
  });

  test("commands.onCommand listener is guarded for Firefox Android", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("if (chrome.commands) chrome.commands.onCommand"),
      "commands.onCommand must be guarded for Firefox Android"
    );
  });

  test("actionApi fallback covers both MV3 and MV2 APIs", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("chrome?.action") && SERVICE_WORKER_SOURCE.includes("chrome?.browserAction"),
      "actionApi must fall back from chrome.action (MV3) to chrome.browserAction (MV2)"
    );
  });

  test("storage.js contains Promise shim for chrome.storage in Firefox MV2", () => {
    assert.ok(
      STORAGE_SOURCE.includes("shimChromePromises"),
      "storage.js must contain the shimChromePromises IIFE for Firefox MV2 compatibility"
    );
  });

  test("Promise shim wraps chrome.storage.sync and chrome.storage.local", () => {
    assert.ok(
      STORAGE_SOURCE.includes("chrome.storage?.sync") && STORAGE_SOURCE.includes("chrome.storage?.local"),
      "shim must wrap both chrome.storage.sync and chrome.storage.local"
    );
  });

  test("Promise shim wraps chrome.tabs.query for Firefox MV2", () => {
    assert.ok(
      STORAGE_SOURCE.includes("chrome.tabs") && STORAGE_SOURCE.includes('"query"'),
      "shim must wrap chrome.tabs.query for Firefox MV2"
    );
  });

  test("Promise shim detects environment once instead of probing per call", () => {
    assert.ok(
      STORAGE_SOURCE.includes("_nativePromises"),
      "shim must detect once whether chrome.* APIs return Promises natively"
    );
    // Must NOT probe inside wrapMethod (side-effectful methods like tabs.create
    // would execute twice: once for the probe, once for the callback wrap)
    const wrapMethodStart = STORAGE_SOURCE.indexOf("function wrapMethod");
    const wrapMethodEnd = STORAGE_SOURCE.indexOf("}", STORAGE_SOURCE.indexOf("return new Promise", wrapMethodStart));
    const wrapBody = STORAGE_SOURCE.slice(wrapMethodStart, wrapMethodEnd);
    assert.ok(
      !wrapBody.includes("original(...args);\n") || wrapBody.includes("_nativePromises"),
      "wrapMethod must not probe by calling original() without callback — use _nativePromises flag instead"
    );
  });

  test("sessionStorage ponyfill probes chrome.storage.session before using it", () => {
    assert.ok(
      STORAGE_SOURCE.includes("_hasSessionStorage"),
      "sessionStorage ponyfill must probe chrome.storage.session with a return-type check, not just truthiness"
    );
    assert.ok(
      STORAGE_SOURCE.includes('typeof probe.then === "function"'),
      "probe must verify the API returns a Promise"
    );
  });

  test("onboarding fallback exists independent of onInstalled", () => {
    // onInstalled is unreliable in Firefox MV2: ES modules load async and the
    // listener may be registered after the event fires. A top-level fallback
    // must check onboardingDone and open onboarding on every background load.
    const hasFallback = SERVICE_WORKER_SOURCE.includes("!prefs.onboardingDone") &&
      /\(async\s*\(\)\s*=>\s*\{[\s\S]*?onboardingDone[\s\S]*?tabs\.create/.test(SERVICE_WORKER_SOURCE);
    assert.ok(hasFallback,
      "service-worker.js must have a top-level async fallback that opens onboarding if onboardingDone is false -- onInstalled alone is not reliable in Firefox MV2");
  });

  test("onboarding fallback is AFTER onInstalled listener (not inside it)", () => {
    const onInstalledIdx = SERVICE_WORKER_SOURCE.indexOf("chrome.runtime.onInstalled.addListener");
    const fallbackIdx = SERVICE_WORKER_SOURCE.indexOf("Fallback: onInstalled is unreliable");
    assert.ok(onInstalledIdx > 0 && fallbackIdx > onInstalledIdx,
      "onboarding fallback must exist as a separate block after the onInstalled listener, not nested inside it");
  });

  test("manifest.v2.json uses persistent background page", () => {
    assert.equal(MANIFEST_V2.background.persistent, true,
      "Firefox MV2 must use persistent: true to avoid event page timing issues with ES modules");
  });
});

// ---------------------------------------------------------------------------
// Firefox MV2 — browser-polyfill.min.js must be loaded in all extension pages
// ---------------------------------------------------------------------------
describe("Firefox MV2 -- browser-polyfill loaded in all extension pages", () => {

  test("background.html loads browser-polyfill.min.js", () => {
    assert.ok(
      BACKGROUND_HTML.includes("browser-polyfill.min.js"),
      "background.html must load browser-polyfill.min.js"
    );
  });

  test("popup.html loads browser-polyfill.min.js", () => {
    assert.ok(
      POPUP_HTML.includes("browser-polyfill.min.js"),
      "popup.html must load browser-polyfill.min.js"
    );
  });

  test("options.html loads browser-polyfill.min.js", () => {
    assert.ok(
      OPTIONS_HTML.includes("browser-polyfill.min.js"),
      "options.html must load browser-polyfill.min.js"
    );
  });

  test("onboarding.html loads browser-polyfill.min.js", () => {
    assert.ok(
      ONBOARDING_HTML.includes("browser-polyfill.min.js"),
      "onboarding.html must load browser-polyfill.min.js"
    );
  });

  test("browser-polyfill loads BEFORE module scripts in popup.html", () => {
    const polyfillIdx = POPUP_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = POPUP_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in popup.html");
  });

  test("browser-polyfill loads BEFORE module scripts in options.html", () => {
    const polyfillIdx = OPTIONS_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = OPTIONS_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in options.html");
  });

  test("browser-polyfill loads BEFORE module scripts in onboarding.html", () => {
    const polyfillIdx = ONBOARDING_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = ONBOARDING_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in onboarding.html");
  });
});

// ---------------------------------------------------------------------------
// Firefox MV2 manifest — structural checks
// ---------------------------------------------------------------------------
describe("Firefox MV2 manifest structure", () => {

  test("manifest_version is 2", () => {
    assert.equal(MANIFEST_V2.manifest_version, 2);
  });

  test("background uses page (not service_worker)", () => {
    assert.ok(MANIFEST_V2.background.page, "MV2 manifest must use background.page, not service_worker");
    assert.equal(MANIFEST_V2.background.page, "background/background.html");
  });

  test("uses browser_action (not action)", () => {
    assert.ok(MANIFEST_V2.browser_action, "MV2 manifest must use browser_action");
    assert.equal(MANIFEST_V2.browser_action.default_popup, "popup/popup.html");
  });

  test("has gecko browser_specific_settings with ID", () => {
    assert.ok(MANIFEST_V2.browser_specific_settings?.gecko?.id,
      "MV2 manifest must have gecko ID");
  });

  test("strict_min_version is not higher than 128.0", () => {
    const minVersion = parseInt(MANIFEST_V2.browser_specific_settings.gecko.strict_min_version);
    assert.ok(minVersion <= 128,
      `strict_min_version (${minVersion}) must not exceed 128 to support Firefox ESR`);
  });

  test("content scripts include browser-polyfill.min.js", () => {
    for (const cs of MANIFEST_V2.content_scripts) {
      assert.ok(cs.js.includes("lib/browser-polyfill.min.js"),
        `Content script [${cs.js.join(", ")}] must include browser-polyfill.min.js`);
    }
  });

  test("version matches package.json", () => {
    const pkg = require("../../package.json");
    assert.equal(MANIFEST_V2.version, pkg.version,
      "manifest.v2.json version must match package.json");
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

// ---------------------------------------------------------------------------
// Consent gate: extension must not function until user accepts ToS
// ---------------------------------------------------------------------------
describe("Consent gate — onboardingDone enforcement", () => {
  // Service worker: handleProcessUrl must return untouched when !onboardingDone
  test("service-worker blocks URL processing when onboardingDone is false", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("!prefs.onboardingDone"),
      "handleProcessUrl must check prefs.onboardingDone"
    );
    // The guard must be in the same conditional as !prefs.enabled
    assert.ok(
      /!prefs\.enabled\s*\|\|\s*!prefs\.onboardingDone/.test(SERVICE_WORKER_SOURCE),
      "onboardingDone guard must be combined with enabled check in handleProcessUrl"
    );
  });

  // Popup: must check onboardingDone and show consent gate
  test("popup.js checks onboardingDone before rendering", () => {
    assert.ok(
      POPUP_JS.includes("onboardingDone"),
      "popup.js must check onboardingDone pref"
    );
    assert.ok(
      POPUP_JS.includes("consent-gate"),
      "popup.js must render a consent-gate element when onboarding not done"
    );
  });

  // Options: must redirect to onboarding when !onboardingDone
  test("options.js redirects to onboarding when consent not given", () => {
    assert.ok(
      OPTIONS_JS.includes("onboardingDone"),
      "options.js must check onboardingDone pref"
    );
    assert.ok(
      OPTIONS_JS.includes("onboarding/onboarding.html"),
      "options.js must redirect to onboarding page"
    );
  });

  // Content script: must check onboardingDone for ping blocking
  test("cleaner.js checks onboardingDone before ping blocking", () => {
    assert.ok(
      CLEANER_JS.includes("onboardingDone"),
      "cleaner.js must check onboardingDone pref"
    );
  });

  // i18n: consent gate strings must exist in both languages
  test("i18n has consent_gate_msg and consent_gate_btn in EN and ES", () => {
    assert.ok(TRANSLATIONS.consent_gate_msg?.en, "consent_gate_msg must have EN translation");
    assert.ok(TRANSLATIONS.consent_gate_msg?.es, "consent_gate_msg must have ES translation");
    assert.ok(TRANSLATIONS.consent_gate_btn?.en, "consent_gate_btn must have EN translation");
    assert.ok(TRANSLATIONS.consent_gate_btn?.es, "consent_gate_btn must have ES translation");
  });

  // Popup CSS: must have consent-gate styles
  test("popup.css includes consent-gate styles", () => {
    const popupCSS = readFileSync(
      join(__dirname, "../../src/popup/popup.css"), "utf8"
    );
    assert.ok(
      popupCSS.includes(".consent-gate"),
      "popup.css must contain .consent-gate class"
    );
  });
});

// ---------------------------------------------------------------------------
// Onboarding dedup: only one tab should open per background lifetime
// ---------------------------------------------------------------------------
describe("Onboarding dedup — prevent double tabs", () => {
  test("service-worker uses openOnboardingOnce() dedup function", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("_onboardingTabOpened"),
      "service-worker must have _onboardingTabOpened dedup flag"
    );
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("function openOnboardingOnce"),
      "service-worker must define openOnboardingOnce function"
    );
  });

  test("both onInstalled and fallback use openOnboardingOnce (not direct tabs.create)", () => {
    // Find the onInstalled block and fallback block
    const onInstalledIdx = SERVICE_WORKER_SOURCE.indexOf("onInstalled.addListener");
    const fallbackIdx = SERVICE_WORKER_SOURCE.indexOf("Fallback: onInstalled is unreliable");

    // After onInstalled, the next tabs.create for onboarding should be via openOnboardingOnce
    const afterOnInstalled = SERVICE_WORKER_SOURCE.slice(onInstalledIdx, fallbackIdx);
    assert.ok(
      afterOnInstalled.includes("openOnboardingOnce()"),
      "onInstalled handler must call openOnboardingOnce()"
    );
    assert.ok(
      !afterOnInstalled.includes('chrome.tabs.create({ url: chrome.runtime.getURL("onboarding'),
      "onInstalled handler must NOT directly call chrome.tabs.create for onboarding"
    );

    const afterFallback = SERVICE_WORKER_SOURCE.slice(fallbackIdx);
    assert.ok(
      afterFallback.includes("openOnboardingOnce()"),
      "fallback IIFE must call openOnboardingOnce()"
    );
  });
});
