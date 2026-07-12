/**
 * MUGA: reclean-target guard — fragment-safe address-bar rewrite decision.
 *
 * `__mugaReclean` (content/cleaner.js) rewrites the address bar via
 * history.replaceState whenever the local cleaner produces a cleanUrl that
 * differs from the live URL. The OLD guard was a raw string compare, so ANY
 * cosmetic difference — most importantly a normalized URL fragment — fired a
 * rewrite. On a `hashchange` (carousel arrows, hash routers, in-page tabs)
 * that rewrite stomped the fragment the page had just set, silently breaking
 * in-page navigation across the whole web (repro: amazon.es feed carousel).
 *
 * The invariant this module enforces:
 *   1. Rewrite ONLY when origin+path+query actually changed (real tracking
 *      removed, or our affiliate tag injected). A fragment-only difference —
 *      or no difference — returns null (do not touch the URL).
 *   2. On a legitimate rewrite, PRESERVE the exact live fragment, including a
 *      bare "#". The URL `hash` setter normalizes an empty fragment away, so
 *      the fragment is spliced by string, not via the URL API.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRecleanTarget } from "../../src/lib/reclean-target.js";

test("fragment-only change (hash router / carousel) => null, never rewrites", () => {
  // Same query, page only advanced the fragment. Must NOT rewrite.
  const cur = "https://www.amazon.es/?tag=muga0b-21#feed";
  const clean = "https://www.amazon.es/?tag=muga0b-21";
  assert.equal(computeRecleanTarget(cur, clean), null);
});

test("bare trailing '#' (the amazon.es carousel case) => null", () => {
  // The exact reported URL: a bare '#' the arrow appended. cleanUrl drops it
  // via URL normalization, but query is identical => no rewrite, '#' survives.
  const cur = "https://www.amazon.es/?tag=muga0b-21#";
  const clean = "https://www.amazon.es/?tag=muga0b-21";
  assert.equal(computeRecleanTarget(cur, clean), null);
});

test("identical URLs => null", () => {
  const u = "https://example.com/p?a=1";
  assert.equal(computeRecleanTarget(u, u), null);
});

test("query changed (tracking removed) => rewrites, preserving the live fragment", () => {
  const cur = "https://example.com/p?utm_source=x&a=1#section";
  const clean = "https://example.com/p?a=1#section";
  assert.equal(computeRecleanTarget(cur, clean), "https://example.com/p?a=1#section");
});

test("query changed but cleanUrl lost the fragment => live fragment is re-attached", () => {
  // cleanUrl came back WITHOUT the fragment (common: processUrl re-serializes);
  // we must graft the live fragment back on so the page's hash state survives.
  const cur = "https://example.com/p?utm_source=x#section";
  const clean = "https://example.com/p"; // no query, no fragment
  assert.equal(computeRecleanTarget(cur, clean), "https://example.com/p#section");
});

test("tag injection on a fragmentless page => rewrites with no spurious '#'", () => {
  const cur = "https://www.amazon.es/";
  const clean = "https://www.amazon.es/?tag=muga0b-21";
  assert.equal(computeRecleanTarget(cur, clean), "https://www.amazon.es/?tag=muga0b-21");
});

test("query changed AND live URL has a bare '#' => rewrite keeps the bare '#'", () => {
  const cur = "https://example.com/p?utm_source=x#";
  const clean = "https://example.com/p";
  assert.equal(computeRecleanTarget(cur, clean), "https://example.com/p#");
});

test("path changed (path-strip rule) with a fragment => rewrites, fragment preserved", () => {
  const cur = "https://www.amazon.es/dp/B00/ref=sr_1_1#reviews";
  const clean = "https://www.amazon.es/dp/B00#reviews";
  assert.equal(computeRecleanTarget(cur, clean), "https://www.amazon.es/dp/B00#reviews");
});

test("unparseable current href => null (never throws)", () => {
  assert.equal(computeRecleanTarget("::::not a url::::", "https://example.com/"), null);
});

test("a relative cleanUrl is resolved against the live URL (SPA routers push relative)", () => {
  // cleanUrl may be relative; it resolves against currentHref just like the
  // reclean caller does. Query differs => rewrite, fragment ("" here) preserved.
  const cur = "https://example.com/old?utm_source=x";
  const clean = "/new?a=1";
  assert.equal(computeRecleanTarget(cur, clean), "https://example.com/new?a=1");
});

test("an absolute but invalid cleanUrl => null (never throws)", () => {
  // Space in the authority makes this an invalid ABSOLUTE URL, so it hits the
  // catch branch instead of being treated as relative.
  assert.equal(computeRecleanTarget("https://example.com/", "https://exa mple.com/"), null);
});

test("non-string inputs are guarded", () => {
  assert.equal(computeRecleanTarget(null, "https://example.com/"), null);
  assert.equal(computeRecleanTarget("https://example.com/", undefined), null);
});
