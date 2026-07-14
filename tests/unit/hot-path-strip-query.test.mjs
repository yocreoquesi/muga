/**
 * MUGA — Unit tests for stripHotPathQuery (audit-2026-07 S3).
 *
 * The five synchronous content-script cleanUrl copies used to rebuild the
 * query with URLSearchParams.toString(), which re-encodes EVERY surviving
 * param and can corrupt a neighbouring signature/token computed over exact
 * bytes. stripHotPathQuery does a raw-string splice instead: it removes only
 * the tracking pairs and leaves every other byte untouched.
 *
 * This is the source-of-truth algorithm; the content-script copies mirror it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stripHotPathQuery, HOT_PATH_STRIP } from "../../src/lib/hot-path-strip.js";

describe("stripHotPathQuery — removes tracking params", () => {
  test("strips a single utm param", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=x"),
      "https://example.com/p"
    );
  });

  test("strips tracking params but keeps real ones in original order", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?a=1&utm_source=x&b=2&gclid=z"),
      "https://example.com/p?a=1&b=2"
    );
  });

  test("returns the original string when nothing is stripped", () => {
    const url = "https://example.com/p?id=42&keep=1";
    assert.equal(stripHotPathQuery(url), url);
  });

  test("drops the '?' when every param was tracking", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=x&gclid=y"),
      "https://example.com/p"
    );
  });
});

describe("stripHotPathQuery — preserves surviving param bytes (the S3 fix)", () => {
  test("does NOT turn %20 into '+'", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/?sig=ab%20cd&utm_source=x"),
      "https://example.com/?sig=ab%20cd"
    );
  });

  test("does NOT percent-encode !()~* in a surviving param", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/?tok=a!b(c)~d*e&utm_medium=x"),
      "https://example.com/?tok=a!b(c)~d*e"
    );
  });

  test("preserves a '+' that the caller sent literally", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/?q=a+b&fbclid=z"),
      "https://example.com/?q=a+b"
    );
  });

  test("preserves an already-encoded signature verbatim while stripping a neighbour", () => {
    const sig = "sig=YWJjZA%3D%3D";
    assert.equal(
      stripHotPathQuery(`https://example.com/callback?${sig}&utm_campaign=x`),
      `https://example.com/callback?${sig}`
    );
  });
});

describe("stripHotPathQuery — shape and fragment preservation", () => {
  test("keeps a relative URL relative", () => {
    assert.equal(stripHotPathQuery("/a/b?id=7&gclid=z"), "/a/b?id=7");
  });

  test("keeps the fragment and does not treat it as query", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=x#section"),
      "https://example.com/p#section"
    );
  });

  test("keeps a fragment that itself contains a '?'", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=x#/route?a=1"),
      "https://example.com/p#/route?a=1"
    );
  });

  test("does not add a trailing slash or otherwise normalize", () => {
    // Pure splice: no URL normalization, unlike new URL().toString().
    assert.equal(stripHotPathQuery("https://example.com?utm_source=x"), "https://example.com");
  });
});

describe("stripHotPathQuery — edge cases", () => {
  test("no query → returned unchanged", () => {
    assert.equal(stripHotPathQuery("https://example.com/p"), "https://example.com/p");
  });

  test("valueless tracking key is stripped", () => {
    assert.equal(stripHotPathQuery("https://example.com/p?utm_source&id=1"), "https://example.com/p?id=1");
  });

  test("valueless non-tracking key is preserved", () => {
    assert.equal(stripHotPathQuery("https://example.com/p?flag&utm_source=x"), "https://example.com/p?flag");
  });

  test("repeated tracking param: all occurrences removed", () => {
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=a&keep=1&utm_source=b"),
      "https://example.com/p?keep=1"
    );
  });

  test("non-string / empty input returned as-is", () => {
    assert.equal(stripHotPathQuery(""), "");
    assert.equal(stripHotPathQuery(null), null);
    assert.equal(stripHotPathQuery(undefined), undefined);
  });

  test("works with the plain-object STRIP shape the content scripts inline", () => {
    const STRIP = { utm_source: 1, gclid: 1 };
    assert.equal(
      stripHotPathQuery("https://example.com/p?utm_source=x&id=1", STRIP),
      "https://example.com/p?id=1"
    );
  });

  test("uses the real HOT_PATH_STRIP set by default", () => {
    // Sanity: a member of the canonical set is stripped.
    assert.ok(HOT_PATH_STRIP.has("fbclid"));
    assert.equal(stripHotPathQuery("https://example.com/?fbclid=z"), "https://example.com/");
  });
});
