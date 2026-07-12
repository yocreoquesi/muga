/**
 * MUGA: same-document navigation guard for the affiliate click interceptor.
 *
 * The interceptor preventDefault+navigate()s clicks on affiliate domains. An
 * in-page fragment click (`<a href="#">` carousel arrow, tab, hash router) must
 * be recognised as same-document so it is NOT hijacked — otherwise the page
 * reloads instead of the control advancing (repro: amazon.es feed carousel).
 * The old `anchor.href.startsWith("#")` guard failed because `anchor.href`
 * resolves "#" to an absolute URL; this predicate compares origin+path+query.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameDocumentNavigation } from "../../src/lib/same-document-nav.js";

test("bare '#' arrow (resolved to absolute) is same-document", () => {
  // This is the exact carousel case: anchor.href resolves href="#" to the
  // full page URL WITH a trailing '#'. Must be recognised as in-page nav.
  const cur = "https://www.amazon.es/?tag=muga0b-21";
  const target = "https://www.amazon.es/?tag=muga0b-21#";
  assert.equal(isSameDocumentNavigation(cur, target), true);
});

test("'#section' anchor is same-document", () => {
  const cur = "https://www.amazon.es/?tag=muga0b-21";
  const target = "https://www.amazon.es/?tag=muga0b-21#section";
  assert.equal(isSameDocumentNavigation(cur, target), true);
});

test("a relative bare '#' href resolves to same-document", () => {
  assert.equal(isSameDocumentNavigation("https://www.amazon.es/?tag=x", "#"), true);
});

test("identical URL (no fragment either) is same-document", () => {
  const u = "https://www.amazon.es/dp/B00";
  assert.equal(isSameDocumentNavigation(u, u), true);
});

test("different PATH is NOT same-document (real product link => intercept)", () => {
  const cur = "https://www.amazon.es/";
  const target = "https://www.amazon.es/dp/B00?tag=foreign-21";
  assert.equal(isSameDocumentNavigation(cur, target), false);
});

test("different QUERY on same path is NOT same-document (real navigation)", () => {
  const cur = "https://www.amazon.es/s?k=a";
  const target = "https://www.amazon.es/s?k=b";
  assert.equal(isSameDocumentNavigation(cur, target), false);
});

test("different ORIGIN is NOT same-document", () => {
  const cur = "https://www.amazon.es/";
  const target = "https://www.amazon.de/#x";
  assert.equal(isSameDocumentNavigation(cur, target), false);
});

test("unparseable current href => false (fail toward interception)", () => {
  assert.equal(isSameDocumentNavigation("::::bad", "https://www.amazon.es/#x"), false);
});

test("unparseable absolute target => false", () => {
  assert.equal(isSameDocumentNavigation("https://www.amazon.es/", "https://exa mple.com/#x"), false);
});

test("non-string inputs are guarded", () => {
  assert.equal(isSameDocumentNavigation(null, "https://www.amazon.es/"), false);
  assert.equal(isSameDocumentNavigation("https://www.amazon.es/", undefined), false);
});
