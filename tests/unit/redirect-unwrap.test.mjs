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
    if (!value) continue;

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
});
