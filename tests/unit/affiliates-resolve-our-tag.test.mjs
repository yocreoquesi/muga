/**
 * #904: resolveOurTag() — the single source of truth for resolving MUGA's
 * own per-marketplace affiliate tag from a pattern's `{ host -> tag }` map.
 *
 * Regression guard: the content-script toast path used to pass the whole
 * `ourTag` map object to `URLSearchParams.set()`, which serialized it to
 * "[object Object]". resolveOurTag must always return a primitive string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOurTag, AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";

const amazon = AFFILIATE_PATTERNS.find((p) => p.id === "amazon-associates");

test("resolveOurTag returns the per-marketplace tag for known hosts", () => {
  assert.equal(resolveOurTag(amazon, "amazon.de"), "muga0f-21");
  assert.equal(resolveOurTag(amazon, "amazon.com"), "muga0b-20");
  assert.equal(resolveOurTag(amazon, "amazon.co.uk"), "muga0a-21");
});

test("resolveOurTag strips a leading www. before lookup", () => {
  assert.equal(resolveOurTag(amazon, "www.amazon.de"), "muga0f-21");
});

test("resolveOurTag returns '' for a host with no configured tag", () => {
  assert.equal(resolveOurTag(amazon, "amazon.co.jp"), "");
});

test("resolveOurTag returns '' for missing/empty pattern, ourTag, or hostname", () => {
  assert.equal(resolveOurTag(null, "amazon.de"), "");
  assert.equal(resolveOurTag(undefined, "amazon.de"), "");
  assert.equal(resolveOurTag({}, "amazon.de"), "");
  assert.equal(resolveOurTag({ ourTag: {} }, "amazon.de"), "");
  assert.equal(resolveOurTag(amazon, ""), "");
});

test("resolveOurTag never returns the serialized map object (the #904 bug)", () => {
  const out = resolveOurTag(amazon, "amazon.de");
  assert.equal(typeof out, "string");
  assert.notEqual(out, "[object Object]");
});
