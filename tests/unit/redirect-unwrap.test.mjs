/**
 * MUGA — Unit tests for redirect-unwrap URL extraction logic
 *
 * These tests replicate the URL parsing logic from src/content/redirect-unwrap.js
 * without requiring a browser DOM. They verify the extraction and validation
 * of destination URLs from known tracking redirect wrappers.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Replicate the URL extraction logic from redirect-unwrap.js
// Returns the destination URL string if valid http/https, otherwise null.
// ---------------------------------------------------------------------------
function extractDestination(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname;
  let destination = null;

  if (host === 'l.facebook.com') {
    destination = url.searchParams.get('u');
  } else if (host === 'out.reddit.com') {
    destination = url.searchParams.get('url');
  } else if (host === 'www.google.com' && url.pathname === '/url') {
    destination = url.searchParams.get('q') || url.searchParams.get('url');
  } else if (host === 'store.steampowered.com' && url.pathname.startsWith('/linkfilter/')) {
    destination = url.searchParams.get('url');
  } else if (host === 'www.instagram.com' && url.pathname.startsWith('/l/')) {
    try {
      destination = atob(url.pathname.replace('/l/', ''));
    } catch(e) {}
  }

  if (!destination) return null;

  try {
    const dest = new URL(destination);
    if (dest.protocol === 'https:' || dest.protocol === 'http:') {
      return destination;
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("redirect-unwrap — URL extraction logic", () => {

  test("Facebook l.php: extracts destination from u= param", () => {
    const result = extractDestination(
      "https://l.facebook.com/l.php?u=https%3A%2F%2Factualsite.com%2Farticle&h=AT0abc"
    );
    assert.equal(result, "https://actualsite.com/article");
  });

  test("Reddit out.reddit.com: extracts destination from url= param", () => {
    const result = extractDestination(
      "https://out.reddit.com/t3_xxx?url=https%3A%2F%2Factualsite.com%2Fpost&token=xyz"
    );
    assert.equal(result, "https://actualsite.com/post");
  });

  test("Google /url: extracts destination from q= param", () => {
    const result = extractDestination(
      "https://www.google.com/url?q=https%3A%2F%2Factualsite.com%2Fpage&sa=D&source=editors"
    );
    assert.equal(result, "https://actualsite.com/page");
  });

  test("Steam linkfilter: extracts destination from url= param", () => {
    const result = extractDestination(
      "https://store.steampowered.com/linkfilter/?url=https%3A%2F%2Factualsite.com%2Fgame"
    );
    assert.equal(result, "https://actualsite.com/game");
  });

  test("Invalid destination (javascript: protocol): returns null", () => {
    const result = extractDestination(
      "https://l.facebook.com/l.php?u=javascript%3Aalert(1)&h=AT0abc"
    );
    assert.equal(result, null);
  });

  test("Invalid destination (not a URL): returns null", () => {
    const result = extractDestination(
      "https://l.facebook.com/l.php?u=not-a-url&h=AT0abc"
    );
    assert.equal(result, null);
  });

  test("Google /url with url= fallback param: extracts destination", () => {
    const result = extractDestination(
      "https://www.google.com/url?url=https%3A%2F%2Factualsite.com%2Fother"
    );
    assert.equal(result, "https://actualsite.com/other");
  });

  test("Unrecognised host: returns null", () => {
    const result = extractDestination(
      "https://example.com/redirect?url=https://actualsite.com"
    );
    assert.equal(result, null);
  });

});
