/**
 * MUGA — TS-4/TS-5/TS-6/TS-14: Unit tests for unwrapAndExtract.
 *
 * RED phase: imports __test__.unwrapAndExtract which does not exist yet.
 * Must FAIL until the function is extracted and exported (issue #627).
 *
 * Covers:
 *   TS-4  — canonical extractor path → { kind: "continue", url, rawUrl, creatorReferralPreserved }
 *   TS-5  — honor-creator short-circuit → { kind: "done", payload: S3 shape }
 *   TS-6  — unwrap → parse fail → { kind: "done", payload: S1 shape }
 *   TS-14 — 1-arg crash boundary (prefs=undefined throws at prefs.canonicalExtractorEnabled)
 *   FR-7  — malformed-input contract: no defensive prefs ?? {} defaulting
 *   Additional — URL parse fail at entry, non-http protocol, continue path
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../../src/lib/cleaner.js";

const { unwrapAndExtract } = __test__;

// ── Minimal prefs for "continue" path (no honor, canonical enabled by default)
const BASE_PREFS = {
  enabled: true,
  honorCreatorMode: false,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

// ── Prefs for Honor Creator mode
const HONOR_PREFS = {
  ...BASE_PREFS,
  honorCreatorMode: true,
  creatorAllowlist: ["techreviewer.example.com"],
};

// ── A known l.facebook.com wrapper URL — unwrap() can extract destination from it.
// (Awin was retired from the wrapper engine in #684; using l.facebook.com here as
// the canonical extractable-wrapper sample.)
const AWIN_WRAPPER = "https://l.facebook.com/l.php?u=https%3A%2F%2Fmerchant.com%2Fproduct%3Futm_source%3Dfb&h=AT2abc";

// ── A t.co opaque wrapper — detectWrapper() detects it, but unwrap() returns null
const TCO_RAW = "https://t.co/AbcDef123";

// ── canonicalBundle that resolves t.co → example.com
const CANONICAL_BUNDLE = {
  linkCanonical: "https://example.com/product?utm_source=twitter",
  jsonLdId: null,
};

describe("TS-4 — unwrapAndExtract — canonical extractor path", () => {
  test("opaque wrapper with canonicalBundle → kind:continue with canonical destination", () => {
    const result = unwrapAndExtract(TCO_RAW, BASE_PREFS, undefined, CANONICAL_BUNDLE);

    assert.equal(result.kind, "continue", "kind must be 'continue' after canonical extraction");
    assert.ok(result.url instanceof URL, "url must be a URL instance");
    assert.ok(
      result.url.hostname === "example.com",
      "url.hostname must be the canonical destination",
    );
    assert.ok(
      result.rawUrl.includes("example.com"),
      "rawUrl must be updated to the canonical destination",
    );
    assert.equal(typeof result.creatorReferralPreserved, "boolean",
      "creatorReferralPreserved must be a boolean");
  });

  test("canonical extractor disabled → opaque wrapper stays as-is → kind:continue with original url", () => {
    const prefs = { ...BASE_PREFS, canonicalExtractorEnabled: false };
    const result = unwrapAndExtract(TCO_RAW, prefs, undefined, CANONICAL_BUNDLE);

    assert.equal(result.kind, "continue", "kind must be 'continue' when canonical disabled");
    assert.ok(result.url.hostname === "t.co", "url must remain t.co when extractor disabled");
  });

  test("no canonicalBundle supplied → opaque wrapper stays as-is → kind:continue", () => {
    const result = unwrapAndExtract(TCO_RAW, BASE_PREFS, undefined, undefined);

    assert.equal(result.kind, "continue");
    assert.ok(result.url.hostname === "t.co");
  });
});

describe("TS-5 — unwrapAndExtract — honor-creator short-circuit", () => {
  test("honorCreatorMode + referrer match + wrapper URL → kind:done with honored-creator payload", () => {
    // AWIN_WRAPPER is a known Awin wrapper; referrer from an allowlisted creator
    const result = unwrapAndExtract(
      AWIN_WRAPPER,
      HONOR_PREFS,
      "https://techreviewer.example.com/review",
      undefined,
    );

    assert.equal(result.kind, "done", "kind must be 'done' when honor short-circuits");
    assert.equal(result.payload.action, "honored-creator");
    assert.ok(typeof result.payload.network === "string", "payload.network must be a string");
    assert.ok(typeof result.payload.creator === "string", "payload.creator must be a string");
    assert.equal(result.payload.creatorReferralPreserved, false, "S3 shape hardcodes false");
    assert.deepEqual(result.payload.removedTracking, []);
    assert.equal(result.payload.detectedAffiliate, null);
  });
});

describe("TS-6 — unwrapAndExtract — parse fail post-unwrap", () => {
  test("URL parse fail at entry → kind:done with S1 payload (untouched, crp:false)", () => {
    const result = unwrapAndExtract("not-a-valid-url", BASE_PREFS, undefined, undefined);

    assert.equal(result.kind, "done");
    assert.equal(result.payload.action, "untouched");
    assert.equal(result.payload.creatorReferralPreserved, false, "S1 hardcodes false");
    assert.deepEqual(result.payload.removedTracking, []);
    assert.equal(result.payload.junkRemoved, 0);
    assert.equal(result.payload.detectedAffiliate, null);
    assert.equal(result.payload.preservedAffiliate, null);
  });

  test("non-http protocol → kind:done with S1 payload", () => {
    const result = unwrapAndExtract("ftp://files.example.com/data.zip", BASE_PREFS, undefined, undefined);

    assert.equal(result.kind, "done");
    assert.equal(result.payload.action, "untouched");
    assert.equal(result.payload.creatorReferralPreserved, false);
  });
});

describe("TS-14 — unwrapAndExtract — 1-arg crash boundary (FR-7)", () => {
  test("prefs=undefined crashes at prefs.canonicalExtractorEnabled, NOT earlier", () => {
    // This is the malformed-input contract. The crash must come from inside
    // unwrapAndExtract accessing prefs.canonicalExtractorEnabled, not from a
    // new defensive check we add. Callers (dom-link-rewriter*.js) catch this
    // and fall back to inlineCleanUrl.
    assert.throws(
      () => unwrapAndExtract("https://example.com/page", undefined, undefined, undefined),
      /TypeError/,
      "must throw TypeError when prefs is undefined",
    );
  });

  test("the throw comes from prefs access, NOT before URL parsing", () => {
    // We verify it's not an early crash (e.g. rawUrl processing) by confirming
    // a valid URL still triggers the crash when prefs is undefined.
    // If the crash came from URL parsing, it would throw for "not-a-url" too —
    // but "not-a-url" throws in the URL parse catch, before prefs access.
    let threw = false;
    let errorMsg = "";
    try {
      unwrapAndExtract("https://example.com/valid-url", undefined, undefined, undefined);
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert.ok(threw, "must throw for valid URL with undefined prefs");
    // The message should reference prefs property access
    assert.ok(
      errorMsg.includes("Cannot read properties of undefined") ||
      errorMsg.includes("undefined"),
      `error message should indicate prefs access failure, got: ${errorMsg}`,
    );
  });
});

describe("unwrapAndExtract — continue path — wrapper unwrapped", () => {
  test("known wrapper URL without honor → kind:continue with unwrapped destination", () => {
    const result = unwrapAndExtract(AWIN_WRAPPER, BASE_PREFS, undefined, undefined);

    assert.equal(result.kind, "continue");
    assert.ok(result.url instanceof URL, "url must be a URL instance");
    assert.ok(
      result.url.hostname !== "l.facebook.com",
      "url must be the unwrapped merchant, not the wrapper host",
    );
    assert.equal(typeof result.creatorReferralPreserved, "boolean");
  });

  test("plain https URL (not a wrapper) → kind:continue with parsed URL", () => {
    const result = unwrapAndExtract(
      "https://example.com/page?utm_source=test",
      BASE_PREFS,
      undefined,
      undefined,
    );

    assert.equal(result.kind, "continue");
    assert.ok(result.url instanceof URL);
    assert.equal(result.url.hostname, "example.com");
    assert.equal(result.rawUrl, "https://example.com/page?utm_source=test");
  });
});

describe("unwrapAndExtract — Bookshop path-referral detection", () => {
  test("/a/{id}/ Bookshop path → creatorReferralPreserved:true in continue result", () => {
    const result = unwrapAndExtract(
      "https://bookshop.org/a/creator123/some-path",
      BASE_PREFS,
      undefined,
      undefined,
    );

    assert.equal(result.kind, "continue");
    assert.equal(result.creatorReferralPreserved, true,
      "creatorReferralPreserved must be true for /a/ Bookshop path");
  });

  test("/p/ Bookshop product path → creatorReferralPreserved:false", () => {
    const result = unwrapAndExtract(
      "https://bookshop.org/p/books/some-title/123456",
      BASE_PREFS,
      undefined,
      undefined,
    );

    assert.equal(result.kind, "continue");
    assert.equal(result.creatorReferralPreserved, false,
      "creatorReferralPreserved must be false for /p/ Bookshop path");
  });
});
