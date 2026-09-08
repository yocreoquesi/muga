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

// ── #1229 step 4: the correction loop names its suspects ─────────────────────
//
// A host-anchored fact is admitted on ONE upstream source's word, for a host
// MUGA has no preserve knowledge of. #1229 states the residual risk plainly: a
// param that is functional on one of those hosts would be stripped on AdGuard's
// say-so and nothing in the pipeline would catch it. What closes that is a user
// reporting the site broke — but only if the report says WHICH params came from
// a host-anchored fact.
//
// Without it a maintainer gets a param list with no provenance, and has to
// guess whether the culprit is a built-in that has shipped to everyone for
// months or one of ~630 facts imported last week for that exact host.

describe("#1229 — scopedParamsForHost", () => {
  const FACTS = [
    { param: "_r", hosts: ["tiktok.com"] },
    { param: "igsh", hosts: ["instagram.com", "threads.net"] },
    { param: "ved", hosts: ["google.com"] },
  ];

  test("returns the params anchored to the host", async () => {
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    assert.deepStrictEqual(scopedParamsForHost("tiktok.com", FACTS), ["_r"]);
    assert.deepStrictEqual(scopedParamsForHost("threads.net", FACTS), ["igsh"]);
  });

  test("matches a SUBDOMAIN of the anchor, because the rule does", async () => {
    // A scoped rule's `requestDomains` matches the anchor and its subdomains,
    // so a fact anchored to tiktok.com IS applied on vt.tiktok.com. A report
    // from there that omitted it would point the maintainer away from the
    // actual cause.
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    assert.deepStrictEqual(scopedParamsForHost("vt.tiktok.com", FACTS), ["_r"]);
    assert.deepStrictEqual(scopedParamsForHost("a.b.tiktok.com", FACTS), ["_r"]);
  });

  test("does NOT match a host that merely ends with the anchor's text", async () => {
    // notyoutube.com does not sit under youtube.com. The dot is part of the
    // comparison for the same reason it is in the DNR matcher.
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    assert.deepStrictEqual(scopedParamsForHost("nottiktok.com", FACTS), []);
  });

  test("is case-insensitive on both sides", async () => {
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    assert.deepStrictEqual(scopedParamsForHost("VT.TikTok.COM", FACTS), ["_r"]);
    assert.deepStrictEqual(
      scopedParamsForHost("tiktok.com", [{ param: "_r", hosts: ["TikTok.com"] }]),
      ["_r"],
    );
  });

  test("dedupes and sorts, so the report line is stable", async () => {
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    const result = scopedParamsForHost("shop.example.com", [
      { param: "zz", hosts: ["example.com"] },
      { param: "aa", hosts: ["shop.example.com"] },
      { param: "zz", hosts: ["shop.example.com", "example.com"] },
    ]);
    assert.deepStrictEqual(result, ["aa", "zz"]);
  });

  test("never throws on malformed input, and skips bad facts individually", async () => {
    const { scopedParamsForHost } = await import("../../src/lib/remote-rules.js");
    for (const bad of [undefined, null, "facts", 42, {}]) {
      assert.deepStrictEqual(scopedParamsForHost("example.com", bad), []);
    }
    for (const host of [undefined, null, "", 42]) {
      assert.deepStrictEqual(scopedParamsForHost(host, FACTS), []);
    }
    // One malformed fact must not cost the report the good ones.
    assert.deepStrictEqual(
      scopedParamsForHost("example.com", [
        null,
        { param: 42, hosts: ["example.com"] },
        { param: "ok", hosts: "example.com" },
        { param: "good", hosts: ["example.com"] },
      ]),
      ["good"],
    );
  });
});

describe("#1229 — the report attributes host-scoped params", () => {
  test("the form fields carry a `scoped` entry", async () => {
    const { buildBrokenSiteReportFields } = await import("../../src/lib/broken-site-report.js");
    const fields = buildBrokenSiteReportFields({
      url: "https://tiktok.com/@x/video/1",
      removedParams: ["_r", "utm_source"],
      scopedParams: ["_r"],
    });

    assert.strictEqual(fields.scoped, "_r");
    assert.strictEqual(fields.params, "_r, utm_source");
  });

  test("no scoped params means no `scoped` key at all", async () => {
    // Absent, not empty: a report from a host with no host-anchored facts must
    // read exactly as it did before this existed.
    const { buildBrokenSiteReportFields } = await import("../../src/lib/broken-site-report.js");
    for (const scopedParams of [undefined, [], null, "nope"]) {
      const fields = buildBrokenSiteReportFields({
        url: "https://example.com/",
        removedParams: ["utm_source"],
        scopedParams,
      });
      assert.ok(!("scoped" in fields), `scoped must be omitted for ${JSON.stringify(scopedParams)}`);
    }
  });

  test("the markdown body carries a Host-scoped params line", async () => {
    const { buildBrokenSiteReportBody } = await import("../../src/lib/broken-site-report.js");
    const body = buildBrokenSiteReportBody({
      url: "https://tiktok.com/@x",
      hostname: "tiktok.com",
      removedParams: ["_r"],
      scopedParams: ["_r"],
    });

    assert.match(body, /\*\*Host-scoped params:\*\* _r/);
  });

  test("the body is unchanged when there are no scoped params", async () => {
    const { buildBrokenSiteReportBody } = await import("../../src/lib/broken-site-report.js");
    const base = { url: "https://example.com/", hostname: "example.com", removedParams: ["utm_source"] };

    assert.strictEqual(
      buildBrokenSiteReportBody({ ...base, scopedParams: [] }),
      buildBrokenSiteReportBody(base),
    );
    assert.ok(!buildBrokenSiteReportBody(base).includes("Host-scoped"));
  });

  test("the scoped field id matches the issue template's", async () => {
    // The prefill is by field ID: a rename on either side silently drops the
    // most useful line in the report, with no error anywhere.
    const { readFileSync } = await import("node:fs");
    // Resolved from this file, not the cwd: the assertion must mean the same
    // thing however the runner is invoked.
    const template = readFileSync(
      new URL("../../.github/ISSUE_TEMPLATE/broken-site.yml", import.meta.url),
      "utf8",
    );
    assert.match(template, /id: scoped/);
  });
});
