/** MUGA: Tests for the benchmark synthetic baseline adapter (#506 phase 2a). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { baselineAdapter, _STRIP } from "../benchmark/competitors/baseline.mjs";

test("baseline — adapter shape matches the contract", () => {
  assert.equal(typeof baselineAdapter.name, "string");
  assert.equal(typeof baselineAdapter.label, "string");
  assert.equal(typeof baselineAdapter.source, "string");
  assert.equal(typeof baselineAdapter.version, "string");
  assert.equal(typeof baselineAdapter.clean, "function");
});

test("baseline — strips utm_source", () => {
  assert.equal(
    baselineAdapter.clean("https://example.com/?utm_source=newsletter"),
    "https://example.com/",
  );
});

test("baseline — strips all 9 UTM params", () => {
  const url = "https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e&utm_id=f&utm_source_platform=g&utm_creative_format=h&utm_marketing_tactic=i";
  assert.equal(baselineAdapter.clean(url), "https://example.com/");
});

test("baseline — strips fbclid, gclid, msclkid, dclid, twclid", () => {
  for (const param of ["fbclid", "gclid", "msclkid", "dclid", "twclid"]) {
    const url = `https://example.com/?${param}=ABC123`;
    assert.equal(
      baselineAdapter.clean(url),
      "https://example.com/",
      `failed to strip ${param}`,
    );
  }
});

test("baseline — preserves non-tracking params", () => {
  assert.equal(
    baselineAdapter.clean("https://example.com/?id=42&utm_source=x"),
    "https://example.com/?id=42",
  );
});

test("baseline — preserves fragment", () => {
  assert.equal(
    baselineAdapter.clean("https://example.com/article?utm_source=x#section"),
    "https://example.com/article#section",
  );
});

test("baseline — returns rawUrl unchanged when no tracking present", () => {
  const url = "https://example.com/article?id=42&page=3";
  assert.equal(baselineAdapter.clean(url), url);
});

test("baseline — returns rawUrl unchanged for malformed URL (no throw)", () => {
  const malformed = "not a url";
  assert.equal(baselineAdapter.clean(malformed), malformed);
});

test("baseline — returns rawUrl unchanged for non-http(s) protocol", () => {
  for (const url of ["javascript:alert(1)", "data:text/plain,hi", "mailto:foo@bar.com", "file:///etc/passwd"]) {
    assert.equal(baselineAdapter.clean(url), url, `should not touch ${url}`);
  }
});

test("baseline — case-insensitive on param keys", () => {
  // Param names in URLs are case-sensitive per spec, but tracker params
  // are lowercase by convention. Adapters typically normalize.
  assert.equal(
    baselineAdapter.clean("https://example.com/?UTM_SOURCE=newsletter"),
    "https://example.com/",
  );
});

test("baseline — does NOT strip params outside the floor list (no scope creep)", () => {
  // The whole point of baseline is to be the FLOOR. If it accidentally
  // strips things ClearURLs-and-friends do but the bare minimum doesn't,
  // the comparison loses meaning.
  const beyondFloor = ["mc_eid", "_hsenc", "mkt_tok", "ref", "campid", "tag"];
  for (const param of beyondFloor) {
    const url = `https://example.com/?${param}=value`;
    assert.equal(
      baselineAdapter.clean(url),
      url,
      `baseline must NOT strip ${param} — only UTM + common click IDs`,
    );
  }
});

test("baseline — STRIP set has expected size (sanity check on coverage list)", () => {
  // 9 UTM + 10 click IDs (fbclid, gclid, gclsrc, dclid, msclkid, twclid,
  // yclid, gbraid, wbraid, _gl) = 19. If this assertion changes, update
  // the docblock + this comment so future readers know what shifted.
  assert.equal(_STRIP.size, 19);
});
