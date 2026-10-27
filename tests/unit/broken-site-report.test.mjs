/**
 * MUGA: Unit tests for the broken-site-report module
 * (src/lib/broken-site-report.js)
 *
 * Contract under test (#1507, maintainer decision 2026-10-15):
 *   - The report is a link-out to the broken-site.yml issue form. The full
 *     tab URL is prefilled in its own `url` field whenever it parses as
 *     http(s) and is <= 2000 chars; the consent step is the form's required
 *     privacy checkbox on GitHub, not a checkbox in MUGA.
 *   - Any other URL (malformed, non-http(s), oversized) omits the `url` key.
 *   - The prefilled link stays under GitHub's practical length, truncating
 *     the settings snapshot before anything else.
 *   - Never throws on null/garbage input.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBrokenSiteReportFields,
  buildBrokenSiteReportUrl,
  buildBrokenSiteReportBody,
  isReportableUrl,
  MAX_REPORT_LINK_LENGTH,
  REPORT_ISSUE_BASE,
} from "../../src/lib/broken-site-report.js";

const LONG_URL = `https://example.com/${"a".repeat(2000)}`;

// Resolved from this file, not the cwd, so the assertion means the same thing
// however the runner is invoked.
const TEMPLATE = readFileSync(
  new URL("../../.github/ISSUE_TEMPLATE/broken-site.yml", import.meta.url),
  "utf8",
);
const TEMPLATE_IDS = [...TEMPLATE.matchAll(/^\s+id:\s*([\w-]+)\s*$/gm)].map((m) => m[1]);

describe("buildBrokenSiteReportFields", () => {
  test("targets the broken-site form with the page's hostname, version and browser", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/path?utm_source=x",
      removedParams: ["utm_source"],
      version: "1.0.0",
      browser: "Chrome/1.0",
    });
    assert.equal(fields.template, "broken-site.yml");
    assert.equal(fields.hostname, "example.com");
    assert.equal(fields.title, "[Broken] example.com");
    assert.equal(fields.params, "utm_source");
    assert.equal(fields.version, "1.0.0");
    assert.equal(fields.browser, "Chrome/1.0");
  });

  test("passes exactly the template's labels, so needs-triage is never dropped (#1502)", () => {
    const labelsLine = TEMPLATE.match(/^labels:\s*\[(.*)\]\s*$/m);
    assert.ok(labelsLine, "broken-site.yml declares labels");
    const templateLabels = labelsLine[1].split(",").map((l) => l.trim().replace(/^"|"$/g, ""));
    assert.deepEqual(buildBrokenSiteReportFields({ url: "https://example.com/" }).labels.split(","), templateLabels);
    assert.ok(templateLabels.includes("needs-triage"));
  });

  test("prefills the full https URL in its own url field, no opt-in needed", () => {
    const fields = buildBrokenSiteReportFields({ url: "https://example.com/path?a=1" });
    assert.equal(fields.url, "https://example.com/path?a=1");
  });

  test("prefills a full http URL too", () => {
    const fields = buildBrokenSiteReportFields({ url: "http://example.com/path" });
    assert.equal(fields.url, "http://example.com/path");
  });

  test("a stale includeFullUrl: false no longer withholds the URL", () => {
    const fields = buildBrokenSiteReportFields({ url: "https://example.com/p", includeFullUrl: false });
    assert.equal(fields.url, "https://example.com/p");
  });

  test("invalid URL omits url and hostname falls back to \"\"", () => {
    const fields = buildBrokenSiteReportFields({ url: "not a url at all" });
    assert.equal("url" in fields, false);
    assert.equal(fields.hostname, "");
  });

  test("non-http(s) schemes omit url", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "mailto:someone@example.com"]) {
      assert.equal("url" in buildBrokenSiteReportFields({ url }), false, url);
    }
  });

  test("URL over 2000 chars omits url but keeps the hostname", () => {
    const fields = buildBrokenSiteReportFields({ url: LONG_URL });
    assert.ok(LONG_URL.length > 2000);
    assert.equal("url" in fields, false);
    assert.equal(fields.hostname, "example.com");
  });

  test("carries the action taken and the settings snapshot when given", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/",
      action: "cleaned",
      settings: "Remote rules: on, payload version 16",
    });
    assert.equal(fields.action, "cleaned");
    assert.equal(fields.settings, "Remote rules: on, payload version 16");
  });

  test("action and settings are omitted when absent", () => {
    const fields = buildBrokenSiteReportFields({ url: "https://example.com/", action: "", settings: "" });
    assert.equal("action" in fields, false);
    assert.equal("settings" in fields, false);
  });

  test("every prefilled form field exists in broken-site.yml (prefill is by field id)", () => {
    const fields = buildBrokenSiteReportFields({
      url: "https://example.com/?a=1",
      action: "cleaned",
      removedParams: ["a"],
      scopedParams: ["a"],
      version: "1",
      browser: "x",
      settings: "s",
    });
    const QUERY_ONLY = new Set(["template", "title", "labels"]);
    for (const key of Object.keys(fields)) {
      if (QUERY_ONLY.has(key)) continue;
      assert.ok(TEMPLATE_IDS.includes(key), `broken-site.yml has no field id "${key}"`);
    }
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
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ url: null }));
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ url: 12345 }));
    assert.doesNotThrow(() => buildBrokenSiteReportFields({ removedParams: "not-an-array" }));
    const fields = buildBrokenSiteReportFields(undefined);
    assert.equal(fields.hostname, "");
    assert.equal("url" in fields, false);
  });
});

describe("#1507 broken-site.yml: the URL field carries the privacy hint", () => {
  test("the url field's description asks the reporter to check it for personal data", () => {
    const urlBlock = TEMPLATE.slice(TEMPLATE.indexOf("id: url"), TEMPLATE.indexOf("id: privacy-ack"));
    assert.match(urlBlock, /Check this URL has no personal data before submitting/);
  });

  test("the privacy acknowledgement stays required", () => {
    const ack = TEMPLATE.slice(TEMPLATE.indexOf("id: privacy-ack"));
    assert.match(ack, /required: true/);
  });
});

describe("#1507 buildBrokenSiteReportUrl", () => {
  const BASE_INPUT = {
    url: "https://shop.example.com/item?utm_source=x&id=7",
    action: "cleaned",
    removedParams: ["utm_source"],
    scopedParams: [],
    version: "3.2.0",
    browser: "Mozilla/5.0 Test",
    settings: "Remote rules: on, payload version 16\nChanged from defaults: none",
  };

  test("opens the issue form with template= and every field as a query param", () => {
    const link = buildBrokenSiteReportUrl(BASE_INPUT);
    assert.ok(link.startsWith(`${REPORT_ISSUE_BASE}?`));
    const q = new URL(link).searchParams;
    assert.equal(q.get("template"), "broken-site.yml");
    assert.equal(q.get("url"), BASE_INPUT.url);
    assert.equal(q.get("hostname"), "shop.example.com");
    assert.equal(q.get("action"), "cleaned");
    assert.equal(q.get("settings"), BASE_INPUT.settings);
    assert.match(q.get("labels"), /needs-triage/);
  });

  test("stays within the cap and truncates the snapshot before anything else", () => {
    const settings = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
    const link = buildBrokenSiteReportUrl({ ...BASE_INPUT, settings });
    assert.ok(link.length <= MAX_REPORT_LINK_LENGTH, `${link.length} > ${MAX_REPORT_LINK_LENGTH}`);
    const q = new URL(link).searchParams;
    assert.equal(q.get("url"), BASE_INPUT.url, "the URL survives while the snapshot is trimmed");
    assert.equal(q.get("params"), "utm_source");
    assert.ok(q.get("settings").startsWith("line 0 "), "the head of the snapshot is kept");
    assert.ok(q.get("settings").endsWith("(truncated)"));
  });

  test("a full 2000-char URL plus a huge snapshot still fits, URL intact", () => {
    const url = `https://example.com/?q=${"%E2%9C%93".repeat(200)}${"z".repeat(2000 - 23 - 9 * 200)}`;
    assert.equal(url.length, 2000);
    const link = buildBrokenSiteReportUrl({ ...BASE_INPUT, url, settings: "s".repeat(20000) });
    assert.ok(link.length <= MAX_REPORT_LINK_LENGTH);
    assert.equal(new URL(link).searchParams.get("url"), url);
  });

  test("a short snapshot is passed through untouched", () => {
    const link = buildBrokenSiteReportUrl(BASE_INPUT);
    assert.ok(!new URL(link).searchParams.get("settings").includes("(truncated)"));
  });

  test("never throws on garbage and always returns the form link", () => {
    for (const bad of [undefined, null, {}, { url: 42 }]) {
      assert.doesNotThrow(() => buildBrokenSiteReportUrl(bad));
      assert.ok(buildBrokenSiteReportUrl(bad).startsWith(REPORT_ISSUE_BASE));
    }
  });
});

// ── #1353 — public validation gate for the Settings-reachable report flow ──
//
// Settings has no "current tab" context the way the popup does: a user
// pastes the URL they had trouble with. Before this existed the only
// feedback on a malformed URL was whatever exception message the cleaning
// pipeline happened to throw (dev_url_error). isReportableUrl exposes the
// SAME http(s)-only gate the module already enforces privately
// (_parseReportUrl), so the new UI can show a friendly inline validation
// message before ever invoking the cleaner.
describe("isReportableUrl", () => {
  test("true for a valid https URL", () => {
    assert.equal(isReportableUrl("https://example.com/path?a=1"), true);
  });

  test("true for a valid http URL", () => {
    assert.equal(isReportableUrl("http://example.com/"), true);
  });

  test("false for a non-http(s) scheme", () => {
    assert.equal(isReportableUrl("javascript:alert(1)"), false);
    assert.equal(isReportableUrl("data:text/html,<script>1</script>"), false);
    assert.equal(isReportableUrl("mailto:someone@example.com"), false);
  });

  test("false for malformed input", () => {
    assert.equal(isReportableUrl("not a url at all"), false);
  });

  test("false for empty string, null, undefined, or non-string input", () => {
    assert.equal(isReportableUrl(""), false);
    assert.equal(isReportableUrl(null), false);
    assert.equal(isReportableUrl(undefined), false);
    assert.equal(isReportableUrl(12345), false);
  });

  test("never throws on garbage input", () => {
    assert.doesNotThrow(() => isReportableUrl());
    assert.doesNotThrow(() => isReportableUrl({}));
    assert.doesNotThrow(() => isReportableUrl([]));
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
