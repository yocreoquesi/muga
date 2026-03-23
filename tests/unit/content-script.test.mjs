/**
 * MUGA — Tests for content script patterns and input validation
 *
 * Tests URL regex matching, list entry validation, and edge cases
 * that affect content script behavior without requiring a browser.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Extract the URL_RE regex from content/cleaner.js source
const contentSource = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"), "utf8"
);

// Replicate the regex used in both files
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

// Replicate isValidListEntry from service-worker.js
function isValidListEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) return false;
  const parts = entry.split("::");
  if (parts.length > 3) return false;
  if (!parts[0] || !/^[a-zA-Z0-9.-]+$/.test(parts[0])) return false;
  if (parts.length === 2 && parts[1] !== "disabled") return false;
  if (parts.length === 3 && (!parts[1] || !parts[2])) return false;
  return true;
}

// ── URL regex tests ──────────────────────────────────────────────────────────

describe("URL_RE — URL matching regex", () => {
  test("matches a simple HTTP URL", () => {
    const matches = [...("Visit http://example.com today").matchAll(URL_RE)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][0], "http://example.com");
  });

  test("matches HTTPS URL with path and query", () => {
    const matches = [...("Go to https://example.com/page?q=hello").matchAll(URL_RE)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][0], "https://example.com/page?q=hello");
  });

  test("matches multiple URLs in text", () => {
    const text = "Check https://a.com and https://b.com/path for details";
    const matches = [...text.matchAll(URL_RE)];
    assert.equal(matches.length, 2);
  });

  test("does not match non-URL text", () => {
    const matches = [...("no urls here, just text").matchAll(URL_RE)];
    assert.equal(matches.length, 0);
  });

  test("stops at whitespace", () => {
    const matches = [...("https://example.com/path next word").matchAll(URL_RE)];
    assert.equal(matches[0][0], "https://example.com/path");
  });

  test("stops at angle brackets", () => {
    const matches = [...("<https://example.com>").matchAll(URL_RE)];
    assert.equal(matches[0][0], "https://example.com");
  });

  test("stops at quotes", () => {
    const matches = [...(`"https://example.com"`).matchAll(URL_RE)];
    assert.equal(matches[0][0], "https://example.com");
  });

  test("limits match to 2000 chars", () => {
    const longPath = "a".repeat(2500);
    const url = `https://example.com/${longPath}`;
    const matches = [...url.matchAll(URL_RE)];
    assert.ok(matches[0][0].length <= 2008); // "https://example.com/" = 20 + 2000
  });

  test("matches URL with tracking params (real-world Amazon)", () => {
    const url = "https://www.amazon.es/dp/B08N5WRWNW?utm_source=google&gclid=EAIaIQ&tag=youtuber-21";
    const matches = [...url.matchAll(URL_RE)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][0], url);
  });

  test("matches URL with fragment", () => {
    const matches = [...("https://example.com/page#section").matchAll(URL_RE)];
    assert.equal(matches[0][0], "https://example.com/page#section");
  });
});

// ── URL regex consistency ────────────────────────────────────────────────────

describe("URL_RE — consistency between content script and service worker", () => {
  test("content/cleaner.js uses the 2000-char limited regex", () => {
    assert.ok(contentSource.includes("{1,2000}"), "content/cleaner.js should use {1,2000} length limit");
  });

  test("service-worker.js uses the 2000-char limited regex", () => {
    assert.ok(swSource.includes("{1,2000}"), "service-worker.js should use {1,2000} length limit");
  });

  test("service-worker.js uses replaceAll (not split/join)", () => {
    assert.ok(!swSource.includes(".split(candidate).join("), "service-worker.js should use replaceAll, not split().join()");
  });
});

// ── isValidListEntry tests ───────────────────────────────────────────────────

describe("isValidListEntry — whitelist/blacklist entry validation", () => {
  // Valid entries
  test("accepts bare domain", () => {
    assert.ok(isValidListEntry("amazon.es"));
  });

  test("accepts domain with subdomain", () => {
    assert.ok(isValidListEntry("www.amazon.es"));
  });

  test("accepts domain::disabled", () => {
    assert.ok(isValidListEntry("amazon.es::disabled"));
  });

  test("accepts domain::param::value", () => {
    assert.ok(isValidListEntry("amazon.es::tag::youtuber-21"));
  });

  test("accepts domain with many subdomains", () => {
    assert.ok(isValidListEntry("a.b.c.example.com"));
  });

  // Invalid entries
  test("rejects empty string", () => {
    assert.ok(!isValidListEntry(""));
  });

  test("rejects non-string", () => {
    assert.ok(!isValidListEntry(42));
    assert.ok(!isValidListEntry(null));
    assert.ok(!isValidListEntry(undefined));
  });

  test("rejects string over 500 chars", () => {
    assert.ok(!isValidListEntry("a".repeat(501)));
  });

  test("rejects domain with spaces", () => {
    assert.ok(!isValidListEntry("amazon .es"));
  });

  test("rejects domain with special chars", () => {
    assert.ok(!isValidListEntry("amazon<script>.es"));
    assert.ok(!isValidListEntry("amazon/es"));
    assert.ok(!isValidListEntry("amazon:es"));
  });

  test("rejects 4+ parts (too many ::)", () => {
    assert.ok(!isValidListEntry("a::b::c::d"));
  });

  test("rejects 2 parts where second is not 'disabled'", () => {
    assert.ok(!isValidListEntry("amazon.es::tag"));
    assert.ok(!isValidListEntry("amazon.es::something"));
  });

  test("rejects 3 parts with empty param", () => {
    assert.ok(!isValidListEntry("amazon.es::::value"));
  });

  test("rejects 3 parts with empty value", () => {
    assert.ok(!isValidListEntry("amazon.es::tag::"));
  });

  test("rejects empty domain with valid parts", () => {
    assert.ok(!isValidListEntry("::tag::value"));
  });

  test("rejects null bytes", () => {
    assert.ok(!isValidListEntry("amazon\x00.es"));
  });
});

// ── Trailing punctuation stripping ───────────────────────────────────────────

describe("Trailing punctuation stripping pattern", () => {
  const stripTrailing = (url) => url.replace(/[.,;:!?)\]]+$/, "");

  test("strips trailing period", () => {
    assert.equal(stripTrailing("https://example.com."), "https://example.com");
  });

  test("strips trailing comma", () => {
    assert.equal(stripTrailing("https://example.com,"), "https://example.com");
  });

  test("strips trailing exclamation", () => {
    assert.equal(stripTrailing("https://example.com!"), "https://example.com");
  });

  test("strips multiple trailing punctuation", () => {
    assert.equal(stripTrailing("https://example.com)."), "https://example.com");
  });

  test("preserves query params", () => {
    assert.equal(stripTrailing("https://example.com?q=hello"), "https://example.com?q=hello");
  });

  test("preserves path with dots", () => {
    assert.equal(stripTrailing("https://example.com/file.html"), "https://example.com/file.html");
  });
});

// ── Custom params DNR validation ─────────────────────────────────────────────

describe("Custom params validation for DNR rules", () => {
  const isValidParam = (p) => /^[a-zA-Z0-9_.-]+$/.test(p.trim());

  test("accepts standard param names", () => {
    assert.ok(isValidParam("utm_source"));
    assert.ok(isValidParam("fbclid"));
    assert.ok(isValidParam("ref_code"));
  });

  test("accepts params with dots and hyphens", () => {
    assert.ok(isValidParam("my.param"));
    assert.ok(isValidParam("my-param"));
  });

  test("rejects params with special characters", () => {
    assert.ok(!isValidParam("param<script>"));
    assert.ok(!isValidParam("param=value"));
    assert.ok(!isValidParam("param&other"));
    assert.ok(!isValidParam("param space"));
  });

  test("rejects empty param", () => {
    assert.ok(!isValidParam(""));
  });
});
