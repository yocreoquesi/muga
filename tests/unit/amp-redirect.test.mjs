/**
 * MUGA — Unit tests for AMP redirect logic (src/content/amp-redirect.js)
 *
 * amp-redirect.js is an IIFE content script that cannot be imported directly
 * (it calls chrome.runtime.sendMessage at the top level). Instead, the pure
 * detection and safety-check logic is replicated here as testable helpers that
 * mirror the real implementation exactly.
 *
 * Run with: npm test
 *
 * Coverage:
 *   - AMP page detection: html[amp], html[⚡], /amp in path, ?amp in query
 *   - Canonical URL extraction from <link rel="canonical">
 *   - https guard: http canonical is blocked
 *   - Same-domain check passes (amp.example.com → example.com)
 *   - Cross-domain blocked (amp.example.com → evil.com)
 *   - URL already equals canonical: no redirect needed
 *   - Invalid (malformed) canonical URL
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure helpers — mirror the logic in amp-redirect.js
// ---------------------------------------------------------------------------

/**
 * Returns the canonical href string from a <link rel="canonical"> element,
 * or null if the element is missing or has no href.
 *
 * @param {Element|null} linkEl
 * @returns {string|null}
 */
function extractCanonical(linkEl) {
  if (!linkEl || !linkEl.href) return null;
  return linkEl.href;
}

/**
 * Returns true when the given URL should be treated as an AMP page.
 * Strict URL-based checks prevent false positives for paths like /trampoline,
 * /campaign, or /example-amp-meter (#189).
 *
 * @param {object} opts
 * @param {boolean} opts.hasAmpAttr   - document.documentElement.hasAttribute("amp")
 * @param {boolean} opts.hasLightningAttr - document.documentElement.hasAttribute("⚡")
 * @param {string}  opts.currentUrl   - window.location.href
 * @returns {boolean}
 */
function isAmpPage({ hasAmpAttr, hasLightningAttr, currentUrl }) {
  const parsedCurrent = (() => { try { return new URL(currentUrl); } catch { return null; } })();
  const isAmpByUrl = parsedCurrent && (
    parsedCurrent.hostname.startsWith("amp.") ||
    parsedCurrent.pathname.startsWith("/amp/") ||
    parsedCurrent.pathname === "/amp" ||
    parsedCurrent.pathname.endsWith("/amp") ||
    parsedCurrent.searchParams.has("amp")
  );
  return (
    hasAmpAttr ||
    hasLightningAttr ||
    !!isAmpByUrl
  );
}

/**
 * Returns true when it is safe to redirect to canonicalUrl.
 * Safety rules (mirrors amp-redirect.js):
 *   1. canonicalUrl must parse as a valid URL
 *   2. protocol must be https:
 *   3. hostname must be the same domain or a parent domain of currentUrl
 *   4. canonicalUrl must differ from currentUrl
 *
 * @param {string} currentUrl
 * @param {string} canonicalUrl
 * @returns {boolean}
 */
function shouldRedirect(currentUrl, canonicalUrl) {
  if (canonicalUrl === currentUrl) return false;
  try {
    const canonical_ = new URL(canonicalUrl);
    const current_ = new URL(currentUrl);
    if (canonical_.protocol !== "https:") return false;
    if (
      canonical_.hostname === current_.hostname ||
      current_.hostname.endsWith("." + canonical_.hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractCanonical", () => {
  test("returns href from a valid link element", () => {
    const el = { href: "https://example.com/article" };
    assert.equal(extractCanonical(el), "https://example.com/article");
  });

  test("returns null when element is null", () => {
    assert.equal(extractCanonical(null), null);
  });

  test("returns null when href is empty string (falsy)", () => {
    const el = { href: "" };
    assert.equal(extractCanonical(el), null);
  });

  test("returns null when href is undefined", () => {
    const el = { href: undefined };
    assert.equal(extractCanonical(el), null);
  });
});

describe("isAmpPage — AMP detection", () => {
  const base = { hasAmpAttr: false, hasLightningAttr: false };

  test("detects html[amp] attribute", () => {
    assert.equal(isAmpPage({ ...base, hasAmpAttr: true, currentUrl: "https://example.com/" }), true);
  });

  test("detects html[⚡] attribute", () => {
    assert.equal(isAmpPage({ ...base, hasLightningAttr: true, currentUrl: "https://example.com/" }), true);
  });

  test("detects /amp in URL path", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/amp/article" }), true);
  });

  test("detects ?amp query param", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/article?amp=1" }), true);
  });

  test("detects ?amp without value (bare param string contains ?amp)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/article?amp" }), true);
  });

  test("returns false for a plain non-AMP URL", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/article" }), false);
  });

  test("/camping does NOT trigger AMP detection — stricter path check (#189)", () => {
    // '/camping' does not start with '/amp/', does not end with '/amp', so isAmpPage returns false.
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/camping/trip" }), false);
  });

  test("detects amp. subdomain (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://amp.example.com/article" }), true);
  });

  test("detects path ending in /amp (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/article/amp" }), true);
  });

  test("/trampoline does NOT trigger AMP detection — false positive fixed (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/trampoline" }), false);
  });

  test("/campaign does NOT trigger AMP detection — false positive fixed (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/campaign" }), false);
  });

  test("/example-amp-meter does NOT trigger AMP detection — false positive fixed (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/example-amp-meter" }), false);
  });

  test("/vampire does NOT trigger AMP detection (#189)", () => {
    assert.equal(isAmpPage({ ...base, currentUrl: "https://example.com/vampire/castle" }), false);
  });
});

describe("shouldRedirect — safety checks", () => {
  test("allows redirect from amp subdomain to parent domain (same root)", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "https://example.com/article"),
      true
    );
  });

  test("allows redirect when canonical is on the exact same hostname", () => {
    assert.equal(
      shouldRedirect("https://example.com/article?amp=1", "https://example.com/article"),
      true
    );
  });

  test("blocks cross-domain redirect", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "https://evil.com/article"),
      false
    );
  });

  test("blocks http canonical (https guard)", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "http://example.com/article"),
      false
    );
  });

  test("returns false when canonical equals current URL (no redirect needed)", () => {
    const url = "https://example.com/article";
    assert.equal(shouldRedirect(url, url), false);
  });

  test("returns false for a malformed canonical URL", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "not-a-valid-url"),
      false
    );
  });

  test("returns false for an empty canonical string", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", ""),
      false
    );
  });

  test("blocks sibling subdomain (not a parent domain relationship)", () => {
    // amp.example.com → other.example.com: current.endsWith(".other.example.com") is false
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "https://other.example.com/article"),
      false
    );
  });

  test("allows deeper subdomain to redirect to shallower canonical", () => {
    assert.equal(
      shouldRedirect("https://m.amp.example.com/p", "https://example.com/p"),
      true
    );
  });
});
