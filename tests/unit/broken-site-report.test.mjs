/**
 * MUGA — Unit tests for the broken-site-report module
 * (src/lib/broken-site-report.js)
 *
 * Contract under test:
 *   - Default (includeFullUrl absent/false) → hostname-only, `url` key/line
 *     never appears, matching the pre-existing privacy-preserving behaviour.
 *   - `url` is included ONLY when includeFullUrl === true AND the URL parses
 *     as http(s) AND its length is <= 2000 chars.
 *   - Never throws on null/garbage input.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildBrokenSiteReportFields,
  buildBrokenSiteReportBody,
} from "../../src/lib/broken-site-report.js";

const LONG_URL = `https://example.com/${"a".repeat(2000)}`;

describe("buildBrokenSiteReportFields", () => {
  test("default (includeFullUrl unset) is hostname-only — no url key", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/path?utm_source=x",
      removedParams: ["utm_source"],
      version: "1.0.0",
      browser: "Chrome/1.0",
    });
    assert.equal(fields.hostname, "example.com");
    assert.equal(fields.template, "broken-site.yml");
    assert.equal(fields.title, "[Broken] example.com");
    assert.equal(fields.labels, "broken-site");
    assert.equal(fields.params, "utm_source");
    assert.equal("url" in fields, false);
  });

  test("includeFullUrl: false explicitly is still hostname-only", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/secret-token-abc",
      includeFullUrl: false,
    });
    assert.equal("url" in fields, false);
    assert.equal(fields.hostname, "example.com");
  });

  test("includeFullUrl: true + valid https URL includes url", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/path?a=1",
      includeFullUrl: true,
    });
    assert.equal(fields.url, "https://example.com/path?a=1");
  });

  test("includeFullUrl: true + valid http URL includes url", () => {
    const fields = buildBrokenSiteReportFields({
      url: "http://example.com/path",
      includeFullUrl: true,
    });
    assert.equal(fields.url, "http://example.com/path");
  });

  test("includeFullUrl: true + invalid URL omits url, hostname falls back to \"\"", () => {
    const fields = buildBrokenSiteReportFields({
      url: "not a url at all",
      includeFullUrl: true,
    });
    assert.equal("url" in fields, false);
    assert.equal(fields.hostname, "");
  });

  test("includeFullUrl: true + javascript: scheme omits url", () => {
    const fields = buildBrokenSiteReportFields({
      url: "javascript:alert(1)",
      includeFullUrl: true,
    });
    assert.equal("url" in fields, false);
  });

  test("includeFullUrl: true + data: scheme omits url", () => {
    const fields = buildBrokenSiteReportFields({
      url: "data:text/html,<script>1</script>",
      includeFullUrl: true,
    });
    assert.equal("url" in fields, false);
  });

  test("includeFullUrl: true + mailto: scheme omits url", () => {
    const fields = buildBrokenSiteReportFields({
      url: "mailto:someone@example.com",
      includeFullUrl: true,
    });
    assert.equal("url" in fields, false);
  });

  test("includeFullUrl: true + URL over 2000 chars omits url", () => {
    const fields = buildBrokenSiteReportFields({
      url: LONG_URL,
      includeFullUrl: true,
    });
    assert.ok(LONG_URL.length > 2000);
    assert.equal("url" in fields, false);
    // hostname is still derived even when url is omitted for length.
    assert.equal(fields.hostname, "example.com");
  });

  test("removedParams empty/missing omits params key", () => {
    const noneGiven = buildBrokenSiteReportFields({ url: "https://example.com" });
    assert.equal("params" in noneGiven, false);
    const emptyArray = buildBrokenSiteReportFields({ url: "https://example.com", removedParams: [] });
    assert.equal("params" in emptyArray, false);
  });

  test("never throws on null/undefined/garbage input", () => {
    assert.doesNotThrow(() => buildBrokenSiteReportFields());
    assert.doesNotThrow(() => buildBrokenSiteReportFields(null));
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ url: null, includeFullUrl: true }));
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ url: 12345, includeFullUrl: true }));
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ removedParams: "not-an-array" }));
    const fields = buildBrokenSiteReportFields(undefined);
    assert.equal(fields.hostname, "");
    assert.equal("url" in fields, false);
  });
});

describe("buildBrokenSiteReportBody", () => {
  test("default (includeFullUrl unset) uses **Domain:** line, no Full URL line", () => {
    const body = buildBrokenSiteReportBody({
      url: "https://example.com/secret",
      version: "1.0.0",
      browser: "Chrome/1.0",
      action: "cleaned",
      removedParams: ["utm_source"],
    });
    assert.match(body, /\*\*Domain:\*\* example\.com/);
    assert.doesNotMatch(body, /\*\*Full URL:\*\*/);
  });

  test("includeFullUrl: true + valid http(s) URL includes Full URL line", () => {
    const body = buildBrokenSiteReportBody({
      url: "https://example.com/path?a=1",
      includeFullUrl: true,
    });
    assert.match(body, /\*\*Full URL:\*\* https:\/\/example\.com\/path\?a=1/);
    assert.doesNotMatch(body, /\*\*Domain:\*\*/);
  });

  test("includeFullUrl: true + invalid URL falls back to Domain line", () => {
    const body = buildBrokenSiteReportBody({
      url: "not a url",
      includeFullUrl: true,
      hostname: "",
    });
    assert.doesNotMatch(body, /\*\*Full URL:\*\*/);
    assert.match(body, /\*\*Domain:\*\*/);
  });

  test("includeFullUrl: true + non-http(s) scheme falls back to Domain line", () => {
    const body = buildBrokenSiteReportBody({
      url: "javascript:alert(1)",
      includeFullUrl: true,
    });
    assert.doesNotMatch(body, /\*\*Full URL:\*\*/);
  });

  test("includeFullUrl: true + URL over 2000 chars falls back to Domain line", () => {
    const body = buildBrokenSiteReportBody({
      url: LONG_URL,
      includeFullUrl: true,
    });
    assert.doesNotMatch(body, /\*\*Full URL:\*\*/);
    assert.match(body, /\*\*Domain:\*\* example\.com/);
  });

  test("hostname param is used when provided, without re-deriving from url", () => {
    const body = buildBrokenSiteReportBody({
      url: "https://example.com/secret",
      hostname: "example.com",
    });
    assert.match(body, /\*\*Domain:\*\* example\.com/);
  });

  test("params omitted from body defaults to 'none'", () => {
    const body = buildBrokenSiteReportBody({ url: "https://example.com" });
    assert.match(body, /\*\*Params removed:\*\* none/);
  });

  test("never throws on null/undefined/garbage input", () => {
    assert.doesNotThrow(() => buildBrokenSiteReportBody());
    assert.doesNotThrow(() => buildBrokenSiteReportBody(null));
    assert.doesNotThrow(() => buildBrokenSiteReportBody({ url: null, includeFullUrl: true }));
    assert.doesNotThrow(() => buildBrokenSiteReportBody({ removedParams: "not-an-array" }));
    const body = buildBrokenSiteReportBody(undefined);
    assert.equal(typeof body, "string");
    assert.match(body, /\*\*Domain:\*\*/);
  });
});
