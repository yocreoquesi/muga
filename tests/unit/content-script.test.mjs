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
import { isValidListEntry } from "../../src/lib/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { getAffiliateDomains } from "../../src/lib/affiliates.js";

// Extract the URL_RE regex from content/cleaner.js source
const contentSource = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"), "utf8"
);

// Replicate the regex used in both files
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

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

// ── Security: sender.id validation in message handlers ───────────────────────

describe("Security: sender.id validation in message handlers", () => {
  test("content script validates sender.id before processing messages", () => {
    assert.ok(
      contentSource.includes("sender.id !== chrome.runtime.id"),
      "content/cleaner.js must validate sender.id in onMessage handler"
    );
  });

  test("service worker validates sender.id before processing messages", () => {
    assert.ok(
      swSource.includes("sender.id !== chrome.runtime.id"),
      "service-worker.js must validate sender.id in onMessage handler"
    );
  });
});

// ── Disabled state: no interception when extension is off ────────────────────

describe("Content script — disabled state guards", () => {
  test("click handler checks _contentPrefs.enabled before preventDefault", () => {
    // The click handler must bail out when the extension is disabled.
    // It checks _contentPrefs?.enabled synchronously before any interception.
    const clickHandler = contentSource.match(
      /document\.addEventListener\("click"[\s\S]*?\}, true\)/
    );
    assert.ok(clickHandler, "click handler with capture phase must exist");
    const handlerBody = clickHandler[0];

    // The enabled check must appear BEFORE e.preventDefault()
    const enabledIdx = handlerBody.indexOf("_contentPrefs?.enabled");
    const preventIdx = handlerBody.indexOf("e.preventDefault()");
    assert.ok(enabledIdx !== -1, "click handler must check _contentPrefs?.enabled");
    assert.ok(preventIdx !== -1, "click handler must call e.preventDefault()");
    assert.ok(enabledIdx < preventIdx,
      "enabled check must come BEFORE e.preventDefault() to avoid intercepting clicks when disabled");
  });

  test("click handler checks _contentPrefs.onboardingDone before preventDefault", () => {
    const clickHandler = contentSource.match(
      /document\.addEventListener\("click"[\s\S]*?\}, true\)/
    );
    const handlerBody = clickHandler[0];
    const onboardingIdx = handlerBody.indexOf("_contentPrefs?.onboardingDone");
    const preventIdx = handlerBody.indexOf("e.preventDefault()");
    assert.ok(onboardingIdx !== -1, "click handler must check _contentPrefs?.onboardingDone");
    assert.ok(onboardingIdx < preventIdx,
      "onboarding check must come BEFORE e.preventDefault()");
  });

  test("copy handler checks _contentPrefs.enabled before preventDefault", () => {
    // The copy handler must bail out when the extension is disabled.
    const copyHandler = contentSource.match(
      /document\.addEventListener\("copy"[\s\S]*?\}\);/
    );
    assert.ok(copyHandler, "copy handler must exist");
    const handlerBody = copyHandler[0];

    const enabledIdx = handlerBody.indexOf("_contentPrefs?.enabled");
    const preventIdx = handlerBody.indexOf("e.preventDefault()");
    assert.ok(enabledIdx !== -1, "copy handler must check _contentPrefs?.enabled");
    assert.ok(preventIdx !== -1, "copy handler must call e.preventDefault()");
    assert.ok(enabledIdx < preventIdx,
      "enabled check must come BEFORE e.preventDefault() in copy handler");
  });

  test("self-clean checks prefs.enabled before replaceState", () => {
    // The self-clean block must not modify the URL when the extension is disabled.
    // It should be wrapped in getContentPrefs().then() with an enabled check.
    assert.ok(
      contentSource.includes("getContentPrefs().then"),
      "self-clean must be wrapped in getContentPrefs().then()"
    );
    // Verify the enabled check is present in the self-clean block
    const selfCleanMatch = contentSource.match(
      /Self-clean[\s\S]*?getContentPrefs\(\)\.then\(\(prefs\) => \{[\s\S]*?prefs\.enabled/
    );
    assert.ok(selfCleanMatch, "self-clean must check prefs.enabled after getContentPrefs()");
  });

  test("prefs are eagerly loaded for synchronous access in click/copy handlers", () => {
    // getContentPrefs() must be called early (before the click handler) so that
    // _contentPrefs is populated by the time the user clicks or copies.
    const earlyLoad = contentSource.indexOf("// Eagerly load prefs");
    const clickHandler = contentSource.indexOf('document.addEventListener("click"');
    assert.ok(earlyLoad !== -1, "eager prefs loading comment must exist");
    assert.ok(earlyLoad < clickHandler,
      "eager prefs loading must happen BEFORE click handler registration");
  });
});

// ── Selective click interception: affiliate domains only ─────────────────────

describe("Content script — affiliate-only click interception", () => {
  test("click handler checks isAffiliateDomain before preventDefault", () => {
    const clickHandler = contentSource.match(
      /document\.addEventListener\("click"[\s\S]*?\}, true\)/
    );
    assert.ok(clickHandler, "click handler must exist");
    const handlerBody = clickHandler[0];

    const affiliateCheckIdx = handlerBody.indexOf("isAffiliateDomain");
    const preventIdx = handlerBody.indexOf("e.preventDefault()");
    assert.ok(affiliateCheckIdx !== -1, "click handler must check isAffiliateDomain()");
    assert.ok(affiliateCheckIdx < preventIdx,
      "affiliate domain check must come BEFORE e.preventDefault()");
  });

  test("isAffiliateDomain helper function exists in content script", () => {
    assert.ok(
      contentSource.includes("function isAffiliateDomain(hostname)"),
      "content script must define isAffiliateDomain helper"
    );
  });

  test("isAffiliateDomain uses _contentPrefs._affiliateDomains", () => {
    assert.ok(
      contentSource.includes("_contentPrefs?._affiliateDomains"),
      "isAffiliateDomain must read domains from cached prefs"
    );
  });

  test("click handler returns early for non-affiliate domains (no preventDefault)", () => {
    // The pattern: if (!isAffiliateDomain(...)) return; must appear before e.preventDefault()
    const clickHandler = contentSource.match(
      /document\.addEventListener\("click"[\s\S]*?\}, true\)/
    )[0];
    assert.ok(
      clickHandler.includes("if (!isAffiliateDomain(url.hostname)) return;"),
      "click handler must return early for non-affiliate domains"
    );
  });
});

// ── getAffiliateDomains helper ──────────────────────────────────────────────

describe("getAffiliateDomains — affiliate domain list", () => {
  // Import the actual function for direct testing
  const affiliatesSource = readFileSync(
    join(__dirname, "../../src/lib/affiliates.js"), "utf8"
  );

  test("getAffiliateDomains is exported from affiliates.js", () => {
    assert.ok(
      affiliatesSource.includes("export function getAffiliateDomains()"),
      "affiliates.js must export getAffiliateDomains"
    );
  });

  test("service worker imports getAffiliateDomains", () => {
    assert.ok(
      swSource.includes("getAffiliateDomains"),
      "service-worker.js must import getAffiliateDomains"
    );
  });

  test("service worker includes _affiliateDomains in getPrefs response", () => {
    assert.ok(
      swSource.includes("_affiliateDomains"),
      "service-worker.js must include _affiliateDomains in prefs response"
    );
  });

  test("getAffiliateDomains returns an array of strings", () => {
    const domains = getAffiliateDomains();
    assert.ok(Array.isArray(domains), "must return an array");
    assert.ok(domains.length > 0, "must have at least one domain");
    assert.ok(domains.every(d => typeof d === "string"), "all entries must be strings");
  });

  test("getAffiliateDomains includes known affiliate stores", () => {
    const domains = getAffiliateDomains();
    assert.ok(domains.includes("amazon.es"), "must include amazon.es");
    assert.ok(domains.includes("amazon.com"), "must include amazon.com");
    assert.ok(domains.includes("booking.com"), "must include booking.com");
  });

  test("getAffiliateDomains strips www. prefix", () => {
    const domains = getAffiliateDomains();
    assert.ok(domains.every(d => !d.startsWith("www.")), "no domain should start with www.");
  });

  test("getAffiliateDomains returns unique values", () => {
    const domains = getAffiliateDomains();
    assert.equal(domains.length, new Set(domains).size, "all domains must be unique");
  });
});

// ── Import entry validation ──────────────────────────────────────────────────

describe("Import file entry validation", () => {
  const isValidEntry = e => typeof e === "string" && e.length > 0 && e.length < 500 && /^[\x20-\x7E]+$/.test(e);

  test("accepts valid domain entries", () => {
    assert.ok(isValidEntry("amazon.es"));
    assert.ok(isValidEntry("amazon.es::tag::youtuber-21"));
  });

  test("accepts valid custom param entries", () => {
    assert.ok(isValidEntry("my_custom_param"));
    assert.ok(isValidEntry("ref_code"));
  });

  test("rejects empty string", () => {
    assert.ok(!isValidEntry(""));
  });

  test("rejects non-string values", () => {
    assert.ok(!isValidEntry(123));
    assert.ok(!isValidEntry(null));
    assert.ok(!isValidEntry(undefined));
  });

  test("rejects entries over 500 chars", () => {
    assert.ok(!isValidEntry("a".repeat(500)));
  });

  test("rejects entries with non-printable ASCII", () => {
    assert.ok(!isValidEntry("amazon.es\x00"));
    assert.ok(!isValidEntry("amazon.es\x01injection"));
    assert.ok(!isValidEntry("domain\ttab"));
  });

  test("rejects entries with Unicode outside printable ASCII", () => {
    assert.ok(!isValidEntry("amazon.es\u200B")); // zero-width space
    assert.ok(!isValidEntry("dominio\u00F1o.com")); // ñ — should use punycode
  });
});
