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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AMP_REDIRECT_SOURCE = readFileSync(
  join(__dirname, "../../src/content/amp-redirect.js"),
  "utf8"
);

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
 * Safety rules (mirrors amp-redirect.js after security fix):
 *   1. canonicalUrl must parse as a valid URL
 *   2. protocol must be https:
 *   3. currentUrl hostname must start with "amp." (subdomain requirement)
 *   4. canonical hostname must be a strict parent domain (subdomain → parent only)
 *   5. canonicalUrl must differ from currentUrl
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
    // Only follow canonical tags on pages with an explicit "amp." subdomain prefix.
    if (!current_.hostname.startsWith("amp.")) return false;
    // Redirect only if the canonical is on a parent domain (subdomain → parent)
    if (current_.hostname.endsWith("." + canonical_.hostname)) {
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
  test("allows redirect from amp subdomain to parent domain (canonical AMP case)", () => {
    assert.equal(
      shouldRedirect("https://amp.example.com/article", "https://example.com/article"),
      true
    );
  });

  test("blocks redirect when current page does not have amp. subdomain prefix", () => {
    // Security fix: same-hostname redirect via injected canonical is blocked unless
    // the page is on an "amp." subdomain (the legitimate AMP use-case).
    assert.equal(
      shouldRedirect("https://example.com/article?amp=1", "https://example.com/article"),
      false
    );
  });

  test("blocks redirect from non-amp. subdomain even with AMP attributes", () => {
    // A page at www.example.com with html[amp] can inject a canonical — must not redirect
    assert.equal(
      shouldRedirect("https://www.example.com/article", "https://example.com/article"),
      false
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
    const url = "https://amp.example.com/article";
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

  test("deeper amp. subdomain redirect blocked (m.amp. does not start with amp.)", () => {
    // m.amp.example.com does not startsWith("amp."), so it is blocked for safety.
    // The common case is amp.example.com, not nested amp subdomains.
    assert.equal(
      shouldRedirect("https://m.amp.example.com/p", "https://example.com/p"),
      false
    );
  });
});

// ---------------------------------------------------------------------------
// C11 — Sync verification: replicated logic matches the real source
// amp-redirect.js is an IIFE content script using chrome.* APIs, so we
// cannot import it directly. Instead we verify that key logic fragments in
// the source file match the replicated helpers above.
// ---------------------------------------------------------------------------
describe("C11 — replica sync verification (amp-redirect.js)", () => {

  test("source contains the same AMP URL detection conditions as isAmpPage replica", () => {
    // Key conditions that must appear in the source:
    const conditions = [
      'hostname.startsWith("amp.")',
      'pathname.startsWith("/amp/")',
      'pathname === "/amp"',
      'pathname.endsWith("/amp")',
      'searchParams.has("amp")',
    ];
    for (const cond of conditions) {
      assert.ok(
        AMP_REDIRECT_SOURCE.includes(cond),
        `Source must contain AMP detection condition: ${cond}`
      );
    }
  });

  test("source contains the same https guard as shouldRedirect replica", () => {
    assert.ok(
      AMP_REDIRECT_SOURCE.includes('canonical_.protocol !== "https:"'),
      "Source must contain the https protocol guard"
    );
  });

  test("source contains the same domain safety check as shouldRedirect replica", () => {
    assert.ok(
      AMP_REDIRECT_SOURCE.includes('current_.hostname.endsWith("." + canonical_.hostname)'),
      "Source must contain the parent-domain endsWith check"
    );
  });

  test("source requires amp. subdomain prefix before following canonical (security fix)", () => {
    assert.ok(
      AMP_REDIRECT_SOURCE.includes('current_.hostname.startsWith("amp.")'),
      "Source must require amp. subdomain prefix before trusting canonical tag"
    );
  });

  test("source contains canonical URL equality check", () => {
    assert.ok(
      AMP_REDIRECT_SOURCE.includes("canonicalUrl === currentUrl"),
      "Source must contain the canonical === current check (no redirect when equal)"
    );
  });
});
