/**
 * MUGA — Unit tests for redirect-unwrap URL extraction logic
 *
 * The content script (src/content/redirect-unwrap.js) cannot be imported
 * in Node.js (uses chrome.* APIs and IIFE pattern). These tests replicate
 * the core URL extraction logic — same REDIRECT_PARAMS list, same rules —
 * so any change to the content script must be reflected here.
 *
 * Logic under test:
 *   Given a URL, find the first query param in REDIRECT_PARAMS whose value
 *   is a valid http/https URL pointing to a different hostname.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REDIRECT_UNWRAP_SOURCE = readFileSync(
  join(__dirname, "../../src/content/redirect-unwrap.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Replicated from src/content/redirect-unwrap.js — keep in sync
// ---------------------------------------------------------------------------
// Keep in sync with src/content/redirect-unwrap.js
// "location", "return", "continue" excluded — too generic (SPA routing, OAuth flows)
// "to", "next", "target" excluded — too generic (SPA routing, auth flows, UI targets)
// "destination" excluded — SSO/corporate post-auth redirect target; unwrapping bypasses login (#158)
// All entries lowercase — param keys are normalised to lowercase at lookup time (#191).
// Keep in sync with src/content/redirect-unwrap.js
const REDIRECT_PARAMS = [
  "url", "redirect", "redirect_url", "dest",
  "goto", "returnurl", "return_url",
];

// Keep in sync with AFFILIATE_REDIRECT_PARAMS in src/content/redirect-unwrap.js
const AFFILIATE_REDIRECT_PARAMS = {
  "awin1.com":              "ued",
  "shareasale.com":         "urllink",
  "ad.admitad.com":         "ulp",
  "alitems.com":            "ulp",
  "redirect.viglink.com":   "u",
  "clk.tradedoubler.com":   "url",
};

/**
 * Extracts the unwrapped destination from a redirect-wrapper URL.
 * Returns the destination href string, or null if none found.
 */
function extractRedirectDestination(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // Normalise param names to lowercase before lookup — mirrors fix in redirect-unwrap.js (#191)
  for (const [rawKey, value] of parsed.searchParams) {
    const param = rawKey.toLowerCase();
    if (!REDIRECT_PARAMS.includes(param)) continue;
    if (!value || value.length > 2000) continue;

    let destination;
    try {
      destination = new URL(value);
    } catch {
      try {
        destination = new URL(decodeURIComponent(value));
      } catch {
        continue;
      }
    }

    if (!["http:", "https:"].includes(destination.protocol)) continue;
    if (destination.hostname === parsed.hostname) continue;

    return destination.href;
  }

  return null;
}

/**
 * Extracts destination from affiliate network redirect URLs.
 * Mirrors the AFFILIATE_REDIRECT_PARAMS logic in redirect-unwrap.js.
 */
function extractAffiliateRedirectDestination(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const currentHost = parsed.hostname.replace(/^www\./, "");
  const affiliateParam = AFFILIATE_REDIRECT_PARAMS[currentHost];
  if (!affiliateParam) return null;

  const raw = parsed.searchParams.get(affiliateParam);
  if (!raw || raw.length > 2000) return null;

  let dest;
  try {
    dest = new URL(raw);
  } catch {
    try { dest = new URL(decodeURIComponent(raw)); } catch { return null; }
  }

  if (!["http:", "https:"].includes(dest.protocol)) return null;
  if (!dest.hostname || dest.hostname === parsed.hostname) return null;

  return dest.href;
}

// Keep in sync with PEPPER_DOMAINS in redirect-unwrap.js
const PEPPER_DOMAINS = [
  "chollometro.com", "mydealz.de", "dealabs.com", "hotukdeals.com",
  "pepper.pl", "pepper.it", "pepper.ru", "pepper.com",
  "promodescuentos.com", "pelando.com.br", "preisjaeger.at",
  "nl.pepper.com", "pepper.se", "pepper.fr",
];

/**
 * Extracts the final store destination from a Pepper network intermediary URL.
 * In the real content script this intermediary URL is extracted from the
 * <meta http-equiv="refresh"> tag; here we test the URL extraction logic
 * from the intermediary (digidip/path.*) which carries ?url=DESTINATION.
 */
function extractPepperDestination(intermediaryUrl) {
  let parsed;
  try {
    parsed = new URL(intermediaryUrl);
  } catch {
    return null;
  }

  const destRaw = parsed.searchParams.get("url");
  if (!destRaw || destRaw.length > 2000) return null;

  let dest;
  try {
    dest = new URL(destRaw);
  } catch {
    try { dest = new URL(decodeURIComponent(destRaw)); } catch { return null; }
  }

  if (!["http:", "https:"].includes(dest.protocol)) return null;

  return dest.href;
}

/**
 * Checks if a given URL matches the Pepper /visit/ pattern.
 */
function isPepperVisitUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  return /^\/visit\//.test(parsed.pathname) && PEPPER_DOMAINS.includes(host);
}

/**
 * Extracts destination from Amazon /sspa/click sponsored product redirect URLs.
 * Mirrors the dedicated handler in redirect-unwrap.js.
 * The `url` param is a relative path resolved against the origin.
 */
function extractAmazonSspaDestination(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.pathname !== "/sspa/click") return null;

  const raw = parsed.searchParams.get("url");
  if (!raw || raw.length > 2000) return null;

  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }

  let dest;
  try { dest = new URL(decoded, parsed.origin); } catch { return null; }

  if (!["http:", "https:"].includes(dest.protocol)) return null;

  return dest.href;
}

// ---------------------------------------------------------------------------
// Supported redirect patterns (params present in REDIRECT_PARAMS)
// Note: Facebook (?u=) and Google Search (?q=) use short/generic param names
// not in REDIRECT_PARAMS — they are NOT handled by redirect-unwrap.js.
// Facebook unwrapping would require adding "u" which is too broad a param name
// and would cause false positives on many sites.
// ---------------------------------------------------------------------------
describe("redirect-unwrap — supported wrapper patterns", () => {

  test("Reddit out.reddit.com — unwraps ?url= param", () => {
    const dest = extractRedirectDestination(
      "https://out.reddit.com/t3_abc123?url=https%3A%2F%2Fexample.com%2Fpost&token=xyz"
    );
    assert.equal(dest, "https://example.com/post");
  });

  test("Steam linkfilter — unwraps ?url= param", () => {
    const dest = extractRedirectDestination(
      "https://store.steampowered.com/linkfilter/?url=https://github.com/owner/repo"
    );
    assert.equal(dest, "https://github.com/owner/repo");
  });

  test("Generic tracker with ?redirect= param", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/click?redirect=https://shop.com/product?id=42"
    );
    assert.equal(dest, "https://shop.com/product?id=42");
  });

  test("Generic tracker with ?goto= param", () => {
    const dest = extractRedirectDestination(
      "https://track.example.com/out?goto=https://publisher.com/article"
    );
    assert.equal(dest, "https://publisher.com/article");
  });

  test("Percent-encoded destination URL is decoded correctly", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/out?url=https%3A%2F%2Fdestination.com%2Fpath%3Fq%3Dtest"
    );
    assert.equal(dest, "https://destination.com/path?q=test");
  });

  test("?goto= param unwraps external URL", () => {
    const dest = extractRedirectDestination(
      "https://click.example.com/?goto=https://external.com/landing"
    );
    assert.equal(dest, "https://external.com/landing");
  });

});

// ---------------------------------------------------------------------------
// Safety guards — these must NOT be unwrapped
// ---------------------------------------------------------------------------
describe("redirect-unwrap — safety guards", () => {

  test("SSO ?destination= param is NOT unwrapped (would bypass corporate login)", () => {
    // "destination" is used by corporate/government SSO to signal post-auth redirect target.
    // MUGA must NOT unwrap it — doing so lets the user reach the resource without
    // completing authentication. See issue #158.
    const dest = extractRedirectDestination(
      "https://sso.empresa.com/login?destination=https://intranet.empresa.com/dashboard"
    );
    assert.equal(dest, null);
  });

  test("same-origin destination is NOT unwrapped", () => {
    // Internal SPA navigation: ?next=/dashboard or ?next=https://same.com/page
    const dest = extractRedirectDestination(
      "https://app.example.com/login?next=https://app.example.com/dashboard"
    );
    assert.equal(dest, null);
  });

  test("javascript: scheme destination is NOT followed", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/click?url=javascript:alert(1)"
    );
    assert.equal(dest, null);
  });

  test("data: URI destination is NOT followed", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/click?url=data:text/html,<h1>hi</h1>"
    );
    assert.equal(dest, null);
  });

  test("relative path destination is NOT followed", () => {
    const dest = extractRedirectDestination(
      "https://example.com/login?next=/dashboard"
    );
    assert.equal(dest, null);
  });

  test("URL with no redirect params returns null", () => {
    const dest = extractRedirectDestination(
      "https://example.com/product?id=42&color=red&utm_source=newsletter"
    );
    assert.equal(dest, null);
  });

  test("malformed URL returns null", () => {
    const dest = extractRedirectDestination("not-a-url");
    assert.equal(dest, null);
  });

  test("URL with empty redirect param value returns null", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/click?url="
    );
    assert.equal(dest, null);
  });

  test("handles double-encoded destination URL safely", () => {
    // Double-encoded https://example.com/page:
    //   %2568 → %68 (h), %253A → %3A (:), %252F → %2F (/)
    // searchParams.get() decodes once: "%68ttps%3A%2F%2Fexample.com%2Fpage"
    // new URL(value) fails; decodeURIComponent(value) → "https://example.com/page" which IS valid.
    // So the function successfully extracts the destination — it must NOT crash regardless.
    const url = "https://tracker.com/redirect?url=%2568ttps%253A%252F%252Fexample.com%252Fpage";
    const result = extractRedirectDestination(url);
    // Must not throw; actual outcome is a successful extraction via the decode fallback path
    assert.equal(result, "https://example.com/page");
  });

});

// ---------------------------------------------------------------------------
// Safety guards — blob: and vbscript: schemes must NOT be followed
// ---------------------------------------------------------------------------
describe("redirect-unwrap — blob: and vbscript: scheme guards", () => {

  test("blob: scheme destination is NOT followed (generic handler)", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/redirect?url=blob:https://tracker.example.com/abc-123"
    );
    assert.equal(dest, null);
  });

  test("vbscript: scheme destination is NOT followed (generic handler)", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/redirect?url=vbscript:MsgBox(1)"
    );
    assert.equal(dest, null);
  });

  test("blob: scheme destination is NOT followed (affiliate handler)", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=blob:https://www.awin1.com/abc-123"
    );
    assert.equal(dest, null);
  });

  test("vbscript: scheme destination is NOT followed (affiliate handler)", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=vbscript:MsgBox(1)"
    );
    assert.equal(dest, null);
  });

  test("blob: scheme destination is NOT followed (Pepper handler)", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url=blob:https://chollometro.digidip.net/abc"
    );
    assert.equal(dest, null);
  });

  test("vbscript: scheme destination is NOT followed (Pepper handler)", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url=vbscript:MsgBox(1)"
    );
    assert.equal(dest, null);
  });

  test("blob: scheme destination is NOT followed (Amazon /sspa/click handler)", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/sspa/click?url=blob:https://www.amazon.es/abc"
    );
    assert.equal(dest, null);
  });

});

// ---------------------------------------------------------------------------
// REDIRECT_PATH_RE — path guard for generic redirect unwrap
// ---------------------------------------------------------------------------
describe("REDIRECT_PATH_RE — path guard for generic redirect unwrap", () => {
  // Keep in sync with REDIRECT_PATH_RE in src/content/redirect-unwrap.js
  const REDIRECT_PATH_RE = /\/(redirect|bounce|out|away|leave|goto|jump|click|track|link|redir|forward|proxy|url|exit)\b/i;

  // Paths that SHOULD match (redirect-like keywords)
  test("matches /redirect", () => { assert.ok(REDIRECT_PATH_RE.test("/redirect")); });
  test("matches /bounce",   () => { assert.ok(REDIRECT_PATH_RE.test("/bounce")); });
  test("matches /out",      () => { assert.ok(REDIRECT_PATH_RE.test("/out")); });
  test("matches /away",     () => { assert.ok(REDIRECT_PATH_RE.test("/away")); });
  test("matches /leave",    () => { assert.ok(REDIRECT_PATH_RE.test("/leave")); });
  test("matches /goto",     () => { assert.ok(REDIRECT_PATH_RE.test("/goto")); });
  test("matches /jump",     () => { assert.ok(REDIRECT_PATH_RE.test("/jump")); });
  test("matches /click",    () => { assert.ok(REDIRECT_PATH_RE.test("/click")); });
  test("matches /track",    () => { assert.ok(REDIRECT_PATH_RE.test("/track")); });
  test("matches /link",     () => { assert.ok(REDIRECT_PATH_RE.test("/link")); });
  test("matches /redir",    () => { assert.ok(REDIRECT_PATH_RE.test("/redir")); });
  test("matches /forward",  () => { assert.ok(REDIRECT_PATH_RE.test("/forward")); });
  test("matches /proxy",    () => { assert.ok(REDIRECT_PATH_RE.test("/proxy")); });
  test("matches /url",      () => { assert.ok(REDIRECT_PATH_RE.test("/url")); });
  test("matches /exit",     () => { assert.ok(REDIRECT_PATH_RE.test("/exit")); });

  // Case insensitivity
  test("matches /Redirect (case insensitive)", () => {
    assert.ok(REDIRECT_PATH_RE.test("/Redirect"));
  });
  test("matches /TRACK (case insensitive)", () => {
    assert.ok(REDIRECT_PATH_RE.test("/TRACK"));
  });

  // Paths that should NOT match
  test("does not match /products", () => {
    assert.ok(!REDIRECT_PATH_RE.test("/products"));
  });
  test("does not match /tracker-dashboard (word boundary)", () => {
    assert.ok(!REDIRECT_PATH_RE.test("/tracker-dashboard"));
  });
  test("does not match /about", () => {
    assert.ok(!REDIRECT_PATH_RE.test("/about"));
  });
  test("does not match /", () => {
    assert.ok(!REDIRECT_PATH_RE.test("/"));
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive param matching — bug #191
// ---------------------------------------------------------------------------
describe("redirect-unwrap — case-insensitive params (#191)", () => {

  test("?URL=https://example.com (uppercase) — unwraps correctly (#191)", () => {
    // Before fix: parsed.searchParams.get('url') returned null for ?URL=...
    // After fix: keys are normalised to lowercase, so URL matches 'url' in REDIRECT_PARAMS.
    const dest = extractRedirectDestination(
      "https://tracker.example.com/click?URL=https://example.com/dest"
    );
    assert.equal(dest, "https://example.com/dest",
      "?URL= (uppercase) must unwrap after case-insensitive fix (#191)");
  });

  test("?Redirect=https://example.com (mixed case) — unwraps (#191)", () => {
    const dest = extractRedirectDestination(
      "https://tracker.example.com/go?Redirect=https://example.com/landing"
    );
    assert.equal(dest, "https://example.com/landing",
      "?Redirect= (mixed case) must unwrap after fix (#191)");
  });

  test("?returnUrl=https://example.com — unwraps (normalised to returnurl) (#191)", () => {
    const dest = extractRedirectDestination(
      "https://shop.example.com/login?returnUrl=https://example.com/checkout"
    );
    assert.equal(dest, "https://example.com/checkout",
      "?returnUrl= must unwrap after case-insensitive normalisation (#191)");
  });

  test("?RETURNURL=https://example.com (all caps) — unwraps after case-insensitive fix (#191)", () => {
    const dest = extractRedirectDestination(
      "https://shop.example.com/login?RETURNURL=https://example.com/account"
    );
    assert.equal(dest, "https://example.com/account",
      "?RETURNURL= (all caps) must unwrap after fix (#191)");
  });

});

// ---------------------------------------------------------------------------
// Priority — first matching param wins
// ---------------------------------------------------------------------------
describe("redirect-unwrap — param priority", () => {

  test("first matching param in REDIRECT_PARAMS list wins", () => {
    // 'url' comes before 'redirect' in the list — url wins
    const dest = extractRedirectDestination(
      "https://tracker.example.com/out?url=https://first.com/&redirect=https://second.com/"
    );
    assert.equal(dest, "https://first.com/");
  });

});

// ---------------------------------------------------------------------------
// C11 — Sync verification: replicated REDIRECT_PARAMS matches the real source
// redirect-unwrap.js is an IIFE content script using chrome.* APIs.
// ---------------------------------------------------------------------------
describe("C11 — replica sync verification (redirect-unwrap.js)", () => {

  test("source contains every param in the replicated REDIRECT_PARAMS array", () => {
    for (const param of REDIRECT_PARAMS) {
      assert.ok(
        REDIRECT_UNWRAP_SOURCE.includes(`"${param}"`),
        `Source must contain redirect param: "${param}"`
      );
    }
  });

  test("source does not contain extra redirect params beyond the replicated list", () => {
    // Extract the REDIRECT_PARAMS array literal from the source
    const match = REDIRECT_UNWRAP_SOURCE.match(
      /const REDIRECT_PARAMS\s*=\s*\[([\s\S]*?)\];/
    );
    assert.ok(match, "Source must contain a REDIRECT_PARAMS array declaration");
    const sourceParams = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(
      sourceParams.sort(),
      [...REDIRECT_PARAMS].sort(),
      "Source REDIRECT_PARAMS must exactly match the replicated list"
    );
  });

  test("source normalises param keys to lowercase before lookup (#191)", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("rawKey.toLowerCase()"),
      "Source must normalise param keys to lowercase (#191)"
    );
  });

  test("source blocks non-http(s) protocols", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes('"http:"') && REDIRECT_UNWRAP_SOURCE.includes('"https:"'),
      "Source must check for http:/https: protocol"
    );
  });

  test("source REDIRECT_PATH_RE regex matches replicated pattern", () => {
    // Verify the source contains the same path-guard regex as the replica.
    // We check for the exact string form of the replica regex inside the source.
    const REDIRECT_PATH_RE = /\/(redirect|bounce|out|away|leave|goto|jump|click|track|link|redir|forward|proxy|url|exit)\b/i;
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("const REDIRECT_PATH_RE = " + String(REDIRECT_PATH_RE)),
      `Source must declare REDIRECT_PATH_RE as ${String(REDIRECT_PATH_RE)}`
    );
  });

  test("source contains every entry in the replicated AFFILIATE_REDIRECT_PARAMS map", () => {
    for (const [domain, param] of Object.entries(AFFILIATE_REDIRECT_PARAMS)) {
      assert.ok(
        REDIRECT_UNWRAP_SOURCE.includes(`"${domain}"`) && REDIRECT_UNWRAP_SOURCE.includes(`"${param}"`),
        `Source must contain affiliate redirect entry: "${domain}" → "${param}"`
      );
    }
  });

  test("source AFFILIATE_REDIRECT_PARAMS exactly matches replicated map", () => {
    const match = REDIRECT_UNWRAP_SOURCE.match(
      /const AFFILIATE_REDIRECT_PARAMS\s*=\s*\{([\s\S]*?)\};/
    );
    assert.ok(match, "Source must contain an AFFILIATE_REDIRECT_PARAMS object declaration");
    const entries = [...match[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)];
    const sourceMap = Object.fromEntries(entries.map(m => [m[1], m[2]]));
    assert.deepEqual(sourceMap, AFFILIATE_REDIRECT_PARAMS,
      "Source AFFILIATE_REDIRECT_PARAMS must exactly match the replicated map");
  });
});

// ---------------------------------------------------------------------------
// Affiliate network redirect unwrapping
// ---------------------------------------------------------------------------
describe("redirect-unwrap — affiliate network redirects", () => {

  test("Awin (awin1.com) — unwraps ?ued= to store destination", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?awinmid=12345&ued=https%3A%2F%2Fwww.zalando.es%2Fproduct.html"
    );
    assert.equal(dest, "https://www.zalando.es/product.html");
  });

  test("ShareASale — unwraps ?urllink= to store destination", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.shareasale.com/r.cfm?b=999&u=111&urllink=https%3A%2F%2Fwww.shein.com%2Fdress-p-12345.html"
    );
    assert.equal(dest, "https://www.shein.com/dress-p-12345.html");
  });

  test("Admitad (ad.admitad.com) — unwraps ?ulp= to store destination", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://ad.admitad.com/g/abc123/?ulp=https%3A%2F%2Fwww.aliexpress.com%2Fitem%2F1005001234.html"
    );
    assert.equal(dest, "https://www.aliexpress.com/item/1005001234.html");
  });

  test("Admitad via AliExpress (alitems.com) — unwraps ?ulp=", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://alitems.com/g/abc/?ulp=https%3A%2F%2Fwww.aliexpress.com%2Fitem%2F999.html"
    );
    assert.equal(dest, "https://www.aliexpress.com/item/999.html");
  });

  test("VigLink (redirect.viglink.com) — unwraps ?u= to store", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://redirect.viglink.com/?key=abc&u=https%3A%2F%2Fwww.mediamarkt.de%2Fproduct%2F123"
    );
    assert.equal(dest, "https://www.mediamarkt.de/product/123");
  });

  test("Tradedoubler (clk.tradedoubler.com) — unwraps ?url= to store", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://clk.tradedoubler.com/click?p=999&url=https%3A%2F%2Fwww.fnac.es%2Fproducto%2F456"
    );
    assert.equal(dest, "https://www.fnac.es/producto/456");
  });

  test("non-encoded destination URL is also extracted", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=https://www.zalando.de/shoes.html"
    );
    assert.equal(dest, "https://www.zalando.de/shoes.html");
  });

});

// ---------------------------------------------------------------------------
// Affiliate redirect — safety guards
// ---------------------------------------------------------------------------
describe("redirect-unwrap — affiliate redirect safety guards", () => {

  test("unknown affiliate domain returns null", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://unknown-network.com/click?ued=https://store.com/page"
    );
    assert.equal(dest, null);
  });

  test("same-host destination is NOT unwrapped", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=https://www.awin1.com/other-page"
    );
    assert.equal(dest, null);
  });

  test("javascript: scheme destination is NOT followed", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=javascript:alert(1)"
    );
    assert.equal(dest, null);
  });

  test("data: URI destination is NOT followed", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued=data:text/html,<h1>hi</h1>"
    );
    assert.equal(dest, null);
  });

  test("empty param value returns null", () => {
    const dest = extractAffiliateRedirectDestination(
      "https://www.awin1.com/cread.php?ued="
    );
    assert.equal(dest, null);
  });

  test("param value exceeding 2000 chars returns null", () => {
    const longUrl = "https://store.com/" + "a".repeat(2000);
    const dest = extractAffiliateRedirectDestination(
      `https://www.awin1.com/cread.php?ued=${encodeURIComponent(longUrl)}`
    );
    assert.equal(dest, null);
  });

  test("malformed URL returns null", () => {
    const dest = extractAffiliateRedirectDestination("not-a-url");
    assert.equal(dest, null);
  });
});

// ---------------------------------------------------------------------------
// Amazon /sspa/click sponsored product redirect unwrapping
// ---------------------------------------------------------------------------
describe("redirect-unwrap — Amazon /sspa/click sponsored redirects", () => {

  test("standard /sspa/click with relative url param — resolves to product page", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/sspa/click?ie=UTF8&spc=MTo3Mzc4MjY5MzY1MjM0MTYwOjE3NzUwNTAzMjA6c3BfaHFwX3NoYXJlZDozMDA1NzU4MTc1NDIyMzI6Ojo6&url=%2Fdp%2FB01N5VHLUG%2Fref%3Dsspa_dk_hqp_detail_aax_0%3Fpsc%3D1%26aref%3DJc6HyeNHuL&aref=Jc6HyeNHuL&sp_cr=ZAZ"
    );
    assert.ok(dest, "must extract a destination");
    assert.ok(dest.startsWith("https://www.amazon.es/dp/B01N5VHLUG/"),
      "destination must resolve to the product page on the same origin");
  });

  test("percent-encoded url param is decoded correctly", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.com/sspa/click?url=%2Fdp%2FB09ABC1234%2Fref%3Dsspa_dk_detail_0"
    );
    assert.equal(dest, "https://www.amazon.com/dp/B09ABC1234/ref=sspa_dk_detail_0");
  });

  test("non-encoded relative url param works", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.de/sspa/click?url=/dp/B07XYZ9876/ref%3Dsspa_dk_detail_1"
    );
    assert.ok(dest);
    assert.ok(dest.startsWith("https://www.amazon.de/dp/B07XYZ9876/"));
  });

  test("missing url param returns null", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/sspa/click?ie=UTF8&spc=abc"
    );
    assert.equal(dest, null);
  });

  test("empty url param returns null", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/sspa/click?url="
    );
    assert.equal(dest, null);
  });

  test("non /sspa/click path returns null", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/dp/B01N5VHLUG?url=%2Fdp%2FB09ABC1234"
    );
    assert.equal(dest, null);
  });

  test("url param exceeding 2000 chars returns null", () => {
    const longPath = "/dp/" + "A".repeat(2000);
    const dest = extractAmazonSspaDestination(
      `https://www.amazon.es/sspa/click?url=${encodeURIComponent(longPath)}`
    );
    assert.equal(dest, null);
  });

  test("javascript: scheme in url param returns null", () => {
    const dest = extractAmazonSspaDestination(
      "https://www.amazon.es/sspa/click?url=javascript:alert(1)"
    );
    assert.equal(dest, null);
  });
});

// ---------------------------------------------------------------------------
// C11 — Sync: Amazon /sspa/click handler present in source
// ---------------------------------------------------------------------------
describe("C11 — replica sync verification (Amazon /sspa/click)", () => {

  test("source contains /sspa/click handler", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes('parsed.pathname === "/sspa/click"'),
      "Source must contain the /sspa/click pathname check"
    );
  });

  test("source resolves relative url param against origin", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("parsed.origin"),
      "Source must resolve relative URLs against parsed.origin"
    );
  });
});

// ---------------------------------------------------------------------------
// Pepper network (Chollometro, mydealz, dealabs, etc.) redirect unwrapping
// ---------------------------------------------------------------------------
describe("redirect-unwrap — Pepper network /visit/ redirects", () => {

  test("Chollometro /visit/ URL is recognised as Pepper pattern", () => {
    assert.ok(isPepperVisitUrl("https://www.chollometro.com/visit/homehighlights/1846350"));
  });

  test("mydealz /visit/ URL is recognised as Pepper pattern", () => {
    assert.ok(isPepperVisitUrl("https://www.mydealz.de/visit/threadclick/12345"));
  });

  test("dealabs /visit/ URL is recognised as Pepper pattern", () => {
    assert.ok(isPepperVisitUrl("https://www.dealabs.com/visit/homehot/99999"));
  });

  test("hotukdeals /visit/ URL is recognised as Pepper pattern", () => {
    assert.ok(isPepperVisitUrl("https://www.hotukdeals.com/visit/hottestlisting/55555"));
  });

  test("non-Pepper domain with /visit/ is NOT matched", () => {
    assert.ok(!isPepperVisitUrl("https://www.example.com/visit/something/123"));
  });

  test("Pepper domain without /visit/ path is NOT matched", () => {
    assert.ok(!isPepperVisitUrl("https://www.chollometro.com/ofertas/samsung-galaxy"));
  });

  test("digidip intermediary with ?url= extracts store destination", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url=https%3A%2F%2Fwww.amazon.es%2Fdp%2FB0DP53FSYX&ppref=https://www.chollometro.com&ref=ppr-es-12345"
    );
    assert.equal(dest, "https://www.amazon.es/dp/B0DP53FSYX");
  });

  test("digidip-amazon intermediary extracts store destination", () => {
    const dest = extractPepperDestination(
      "https://chollometro-amazon.digidip.net/visit?url=https%3A%2F%2Famzn.eu%2Fd%2F02BfOkgt&ppref=https://www.chollometro.com&ref=ppr-es-67890"
    );
    assert.equal(dest, "https://amzn.eu/d/02BfOkgt");
  });

  test("path.chollometro.com intermediary extracts store destination", () => {
    const dest = extractPepperDestination(
      "https://path.chollometro.com/pepper-es/redirect?url=https%3A%2F%2Fwww.carrefour.es%2Fsupermercado%2Fbebidas&product=ppr-es-11111"
    );
    assert.equal(dest, "https://www.carrefour.es/supermercado/bebidas");
  });

  test("non-encoded destination URL is also extracted", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url=https://store.steampowered.com/app/1590840/foo"
    );
    assert.equal(dest, "https://store.steampowered.com/app/1590840/foo");
  });

  test("missing url param returns null", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?ref=ppr-es-12345"
    );
    assert.equal(dest, null);
  });

  test("empty url param returns null", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url="
    );
    assert.equal(dest, null);
  });

  test("javascript: scheme in url param returns null", () => {
    const dest = extractPepperDestination(
      "https://chollometro.digidip.net/visit?url=javascript:alert(1)"
    );
    assert.equal(dest, null);
  });

  test("url param exceeding 2000 chars returns null", () => {
    const longUrl = "https://store.com/" + "x".repeat(2000);
    const dest = extractPepperDestination(
      `https://chollometro.digidip.net/visit?url=${encodeURIComponent(longUrl)}`
    );
    assert.equal(dest, null);
  });
});

// ---------------------------------------------------------------------------
// Security: Pepper intermediary allowlist (finding 4)
// ---------------------------------------------------------------------------

// Mirrors isPepperIntermediary() from redirect-unwrap.js
function isPepperIntermediary(hostname) {
  if (hostname === "digidip.net" || hostname.endsWith(".digidip.net")) return true;
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[0] === "path") return true;
  return false;
}

describe("Security: Pepper intermediary allowlist (finding 4)", () => {
  test("chollometro.digidip.net is an allowed intermediary", () => {
    assert.ok(isPepperIntermediary("chollometro.digidip.net"));
  });

  test("chollometro-amazon.digidip.net is an allowed intermediary", () => {
    assert.ok(isPepperIntermediary("chollometro-amazon.digidip.net"));
  });

  test("digidip.net itself is an allowed intermediary", () => {
    assert.ok(isPepperIntermediary("digidip.net"));
  });

  test("path.chollometro.com is an allowed intermediary", () => {
    assert.ok(isPepperIntermediary("path.chollometro.com"));
  });

  test("path.mydealz.de is an allowed intermediary", () => {
    assert.ok(isPepperIntermediary("path.mydealz.de"));
  });

  test("evil.com is NOT an allowed intermediary", () => {
    assert.ok(!isPepperIntermediary("evil.com"));
  });

  test("notdigidip.net is NOT an allowed intermediary", () => {
    assert.ok(!isPepperIntermediary("notdigidip.net"));
  });

  test("chollometro.com (the deal site itself) is NOT an allowed intermediary", () => {
    assert.ok(!isPepperIntermediary("chollometro.com"));
  });

  test("fake-digidip.net is NOT an allowed intermediary", () => {
    assert.ok(!isPepperIntermediary("fake-digidip.net"));
  });

  test("source contains PEPPER_INTERMEDIARY_ALLOWLIST constant", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("PEPPER_INTERMEDIARY_ALLOWLIST"),
      "Source must define PEPPER_INTERMEDIARY_ALLOWLIST"
    );
  });

  test("source contains isPepperIntermediary() guard function", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("isPepperIntermediary"),
      "Source must define isPepperIntermediary() guard"
    );
  });

  test("source gates Pepper extraction on isPepperIntermediary check", () => {
    const pepperBlock = REDIRECT_UNWRAP_SOURCE.slice(
      REDIRECT_UNWRAP_SOURCE.indexOf("PEPPER_DOMAINS"),
      REDIRECT_UNWRAP_SOURCE.indexOf("PEPPER_DOMAINS") + 2000
    );
    assert.ok(
      pepperBlock.includes("isPepperIntermediary(intermediary.hostname)"),
      "Pepper extraction must be gated by isPepperIntermediary()"
    );
  });
});

// ---------------------------------------------------------------------------
// C11 — Sync: Pepper network handler present in source
// ---------------------------------------------------------------------------
describe("C11 — replica sync verification (Pepper network)", () => {

  test("source contains PEPPER_DOMAINS array", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("PEPPER_DOMAINS"),
      "Source must contain a PEPPER_DOMAINS declaration"
    );
  });

  test("source contains every domain in the replicated PEPPER_DOMAINS list", () => {
    for (const domain of PEPPER_DOMAINS) {
      assert.ok(
        REDIRECT_UNWRAP_SOURCE.includes(`"${domain}"`),
        `Source must contain Pepper domain: "${domain}"`
      );
    }
  });

  test("source checks /visit/ pathname pattern", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes("/visit/"),
      "Source must check for /visit/ pathname"
    );
  });

  test("source reads meta http-equiv refresh for intermediary URL", () => {
    assert.ok(
      REDIRECT_UNWRAP_SOURCE.includes('meta[http-equiv="refresh"]'),
      "Source must query the meta refresh tag"
    );
  });
});
