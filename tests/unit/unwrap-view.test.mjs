/**
 * MUGA: popup unwrap-indicator view (#1062 part 3).
 *
 * A host change between the original and cleaned URL means MUGA revealed the
 * real destination behind a redirect wrapper / shortener — the only cleaning
 * action that changes the host. Mirrors web/engine/adapter.js so the extension
 * and muga.app/clean report the same thing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUnwrapView } from "../../src/lib/unwrap-view.js";

test("host change => unwrapped, with the revealed destination host", () => {
  const v = computeUnwrapView("https://t.co/abc123", "https://example.com/article");
  assert.equal(v.unwrapped, true);
  assert.equal(v.destinationHost, "example.com");
});

test("redirect wrapper carrying the destination in a param => unwrapped to that host", () => {
  const v = computeUnwrapView("https://l.example.com/redir?url=https://dest.org/x", "https://dest.org/x");
  assert.equal(v.unwrapped, true);
  assert.equal(v.destinationHost, "dest.org");
});

test("same host, only params stripped => NOT unwrapped", () => {
  const v = computeUnwrapView("https://shop.com/p?utm_source=x", "https://shop.com/p");
  assert.equal(v.unwrapped, false);
  assert.equal(v.destinationHost, null);
});

test("identical URL => not unwrapped", () => {
  const v = computeUnwrapView("https://a.com/x", "https://a.com/x");
  assert.equal(v.unwrapped, false);
});

test("a www difference counts as a host change (mirrors the web tool's raw compare)", () => {
  // Documented parity with web/engine/adapter.js: it compares raw hostnames, so
  // www.a.com -> a.com would read as unwrapped. MUGA never rewrites www during
  // param cleaning, so this does not fire in practice; the test pins the parity.
  const v = computeUnwrapView("https://www.a.com/x", "https://a.com/x");
  assert.equal(v.unwrapped, true);
  assert.equal(v.destinationHost, "a.com");
});

test("unparseable original => no-op (never throws)", () => {
  assert.deepEqual(computeUnwrapView("::::bad", "https://a.com/"), { unwrapped: false, destinationHost: null });
});

test("unparseable clean => no-op", () => {
  assert.deepEqual(computeUnwrapView("https://a.com/", "::::bad"), { unwrapped: false, destinationHost: null });
});

test("non-string inputs are guarded", () => {
  assert.equal(computeUnwrapView(null, "https://a.com/").unwrapped, false);
  assert.equal(computeUnwrapView("https://a.com/", undefined).unwrapped, false);
});
