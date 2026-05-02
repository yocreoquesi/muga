/**
 * MUGA — Unit tests for B7 (#442): Canonical URL Extractor
 *
 * Pure module under test: src/lib/canonical-extractor.js
 *
 * The extractor sits as the SECOND tier in the cleaner pipeline:
 *   Wrapper Engine → Canonical Extractor → existing cleaner.
 *
 * It is consulted only when the wrapper engine DETECTED an opaque wrapper
 * (host matched a wrapper config) but EXTRACTION FAILED — i.e. the
 * destination is not in the URL and must be read from the page DOM.
 *
 * Pure-function design (Approach A): the caller (content script with real
 * DOM access) extracts `<link rel="canonical">` href and JSON-LD `@id`
 * values up-front and passes them as a normalised "canonical bundle"
 * object. The pure module decides what to return per the rules. Tests
 * construct the bundle directly — no jsdom or DOMParser required.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractCanonical } from "../../src/lib/canonical-extractor.js";
import { processUrl } from "../../src/lib/cleaner.js";

// ── Pure module ─────────────────────────────────────────────────────────────

describe("B7 canonical-extractor — bundle inputs", () => {
  test("returns null when bundle is null/undefined", () => {
    assert.strictEqual(extractCanonical(null), null);
    assert.strictEqual(extractCanonical(undefined), null);
  });

  test("returns null when bundle is not an object", () => {
    assert.strictEqual(extractCanonical("https://example.com"), null);
    assert.strictEqual(extractCanonical(42), null);
  });

  test("returns null when neither linkCanonical nor jsonLdId present", () => {
    assert.strictEqual(extractCanonical({}), null);
    assert.strictEqual(extractCanonical({ linkCanonical: "", jsonLdId: "" }), null);
    assert.strictEqual(extractCanonical({ linkCanonical: null, jsonLdId: null }), null);
  });

  test("returns linkCanonical when only it is present", () => {
    const result = extractCanonical({
      linkCanonical: "https://merchant.example.com/product/42",
    });
    assert.strictEqual(result, "https://merchant.example.com/product/42");
  });

  test("returns jsonLdId when only it is present", () => {
    const result = extractCanonical({
      jsonLdId: "https://merchant.example.com/product/42",
    });
    assert.strictEqual(result, "https://merchant.example.com/product/42");
  });

  test("prefers linkCanonical when BOTH agree", () => {
    const url = "https://merchant.example.com/product/42";
    const result = extractCanonical({ linkCanonical: url, jsonLdId: url });
    assert.strictEqual(result, url);
  });

  test("prefers linkCanonical when both DISAGREE (W3C standard wins over JSON-LD metadata)", () => {
    const result = extractCanonical({
      linkCanonical: "https://merchant.example.com/canonical",
      jsonLdId:      "https://merchant.example.com/jsonld",
    });
    assert.strictEqual(result, "https://merchant.example.com/canonical");
  });

  test("falls through to jsonLdId when linkCanonical is malformed", () => {
    const result = extractCanonical({
      linkCanonical: "not a url",
      jsonLdId: "https://merchant.example.com/jsonld",
    });
    assert.strictEqual(result, "https://merchant.example.com/jsonld");
  });

  test("rejects non-http(s) schemes — javascript:", () => {
    assert.strictEqual(
      extractCanonical({ linkCanonical: "javascript:alert(1)" }),
      null
    );
  });

  test("rejects non-http(s) schemes — data:", () => {
    assert.strictEqual(
      extractCanonical({ linkCanonical: "data:text/html,<h1>x</h1>" }),
      null
    );
  });

  test("rejects file:// schemes", () => {
    assert.strictEqual(
      extractCanonical({ linkCanonical: "file:///etc/passwd" }),
      null
    );
  });

  test("rejects malformed URLs in BOTH slots → returns null", () => {
    const result = extractCanonical({
      linkCanonical: "not a url",
      jsonLdId: "::also broken::",
    });
    assert.strictEqual(result, null);
  });

  test("rejects URLs over the 2000-character cap", () => {
    const longUrl = "https://example.com/" + "a".repeat(2100);
    assert.ok(longUrl.length > 2000);
    assert.strictEqual(extractCanonical({ linkCanonical: longUrl }), null);
  });

  test("accepts URLs up to the 2000-character cap", () => {
    // Build a URL that is exactly 2000 chars long.
    const base = "https://example.com/";
    const padding = "a".repeat(2000 - base.length);
    const url = base + padding;
    assert.strictEqual(url.length, 2000);
    assert.strictEqual(extractCanonical({ linkCanonical: url }), url);
  });

  test("accepts http:// (not just https://)", () => {
    const result = extractCanonical({ linkCanonical: "http://example.com/page" });
    assert.strictEqual(result, "http://example.com/page");
  });

  test("trims surrounding whitespace before parsing", () => {
    const result = extractCanonical({
      linkCanonical: "   https://example.com/x   ",
    });
    assert.strictEqual(result, "https://example.com/x");
  });
});

// ── Pipeline integration ────────────────────────────────────────────────────
//
// The canonical extractor is consulted from processUrl when:
//   1. Feature flag `canonicalExtractorEnabled` is true (default ON)
//   2. The URL host is a recognized wrapper (detectWrapper matches)
//   3. Wrapper engine extraction failed (no destination in the URL)
//   4. A canonical bundle was provided by the caller
//
// In every other case (flag off, no bundle, non-wrapper, wrapper that was
// successfully unwrapped), the integration is a no-op.

describe("B7 canonical-extractor — pipeline integration", () => {
  // t.co is registered as a wrapper but its extract() returns null when no
  // ?url=/?u= is present. That is the canonical "opaque wrapper" case.
  const OPAQUE_WRAPPER_URL = "https://t.co/abcdef";
  const CANONICAL_DEST = "https://merchant.example.com/article";

  const PREFS_BASE = {
    enabled: true,
    injectOwnAffiliate: false,
    notifyForeignAffiliate: false,
    blacklist: [],
    whitelist: [],
  };

  test("flag ON + opaque wrapper + bundle present → cleanUrl is the canonical destination", () => {
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      { linkCanonical: CANONICAL_DEST }
    );
    assert.strictEqual(cleanUrl, CANONICAL_DEST);
  });

  test("flag ON + opaque wrapper + bundle prefers linkCanonical over jsonLdId", () => {
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      {
        linkCanonical: "https://merchant.example.com/canonical",
        jsonLdId:      "https://merchant.example.com/jsonld",
      }
    );
    assert.strictEqual(cleanUrl, "https://merchant.example.com/canonical");
  });

  test("flag OFF + opaque wrapper + bundle present → no canonical promotion", () => {
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: false },
      [],
      { linkCanonical: CANONICAL_DEST }
    );
    assert.notStrictEqual(cleanUrl, CANONICAL_DEST);
  });

  test("flag ON + opaque wrapper + NO bundle → no canonical promotion (background worker case)", () => {
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      []
      // bundle intentionally omitted
    );
    assert.notStrictEqual(cleanUrl, CANONICAL_DEST);
  });

  test("flag ON + non-wrapper URL + bundle present → bundle is ignored", () => {
    // A plain URL is not a wrapper; the canonical tier must NOT fire.
    const plain = "https://example.com/article?utm_source=foo";
    const { cleanUrl } = processUrl(
      plain,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      { linkCanonical: "https://attacker.example/take-over" }
    );
    // Tracking still strips, but the canonical takeover does NOT happen.
    assert.notStrictEqual(cleanUrl, "https://attacker.example/take-over");
    assert.ok(cleanUrl.startsWith("https://example.com/article"));
  });

  test("flag ON + wrapper that successfully extracted → bundle is ignored", () => {
    // Awin successfully unwraps to the merchant; canonical tier must not run.
    const merchant = "https://merchant.com/p";
    const wrapper = `https://www.awin1.com/cread.php?awinmid=1&p=${encodeURIComponent(merchant)}`;
    const { cleanUrl } = processUrl(
      wrapper,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      { linkCanonical: "https://attacker.example/take-over" }
    );
    assert.notStrictEqual(cleanUrl, "https://attacker.example/take-over");
    assert.ok(cleanUrl.startsWith("https://merchant.com/p"));
  });

  test("flag default (undefined in prefs) behaves as ON", () => {
    // Acceptance: feature flag default is ON. When prefs lack the key,
    // the pipeline must still consult the canonical extractor.
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      PREFS_BASE, // no canonicalExtractorEnabled
      [],
      { linkCanonical: CANONICAL_DEST }
    );
    assert.strictEqual(cleanUrl, CANONICAL_DEST);
  });

  test("canonical destination is run through the rest of the cleaner (tracking strip)", () => {
    // When the canonical points to a URL with tracking params, those params
    // must still be stripped by the existing cleaner stage.
    const { cleanUrl, removedTracking } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      { linkCanonical: "https://merchant.example.com/article?utm_source=tw" }
    );
    assert.strictEqual(cleanUrl, "https://merchant.example.com/article");
    assert.deepEqual(removedTracking, ["utm_source"]);
  });

  test("non-http(s) canonical is rejected — pipeline falls through unchanged", () => {
    const { cleanUrl } = processUrl(
      OPAQUE_WRAPPER_URL,
      { ...PREFS_BASE, canonicalExtractorEnabled: true },
      [],
      { linkCanonical: "javascript:alert(1)" }
    );
    assert.notStrictEqual(cleanUrl, "javascript:alert(1)");
  });
});

// ── Storage default ─────────────────────────────────────────────────────────

describe("B7 canonical-extractor — storage defaults", () => {
  test("PREF_DEFAULTS contains canonicalExtractorEnabled=true", async () => {
    const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
    assert.ok(
      Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "canonicalExtractorEnabled"),
      "PREF_DEFAULTS must declare canonicalExtractorEnabled"
    );
    assert.strictEqual(PREF_DEFAULTS.canonicalExtractorEnabled, true);
  });
});
