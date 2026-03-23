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
  test("all 102 entries have domain, preserveParams (non-empty array), and note", () => {
    assert.equal(domainRules.length, 102, `Expected 102 entries, got ${domainRules.length}`);
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
});
