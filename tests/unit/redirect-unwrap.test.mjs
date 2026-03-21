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

// ---------------------------------------------------------------------------
// Replicated from src/content/redirect-unwrap.js — keep in sync
// ---------------------------------------------------------------------------
const REDIRECT_PARAMS = [
  "url", "redirect", "redirect_url", "destination", "dest",
  "target", "to", "goto", "next", "return", "returnUrl",
  "return_url", "continue", "location",
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

  for (const param of REDIRECT_PARAMS) {
    const value = parsed.searchParams.get(param);
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

  test("Generic tracker with ?destination= param", () => {
    const dest = extractRedirectDestination(
      "https://partner.example.com/go?destination=https://merchant.com/deal"
    );
    assert.equal(dest, "https://merchant.com/deal");
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

  test("?to= param unwraps external URL", () => {
    const dest = extractRedirectDestination(
      "https://click.example.com/?to=https://external.com/landing"
    );
    assert.equal(dest, "https://external.com/landing");
  });

});

// ---------------------------------------------------------------------------
// Safety guards — these must NOT be unwrapped
// ---------------------------------------------------------------------------
describe("redirect-unwrap — safety guards", () => {

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
