/**
 * MUGA: landing Worker cache-control policy guard.
 *
 * The landing page and the inlined /clean tool load unhashed JS/CSS/JSON
 * modules by fixed name, so a stale cached module against fresh HTML breaks the
 * tool for up to the asset's max-age after a deploy. `cacheControlFor` forces
 * those contract assets to revalidate every load (no-cache + ETag => 304),
 * closing the stale-window. This asserts the classification stays correct; the
 * fetch() handler itself needs the Cloudflare runtime and is not unit-tested.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheControlFor } from "../../landing-worker/worker.js";

test("HTML documents (root, trailing slash, .html) revalidate", () => {
  for (const p of ["/", "/index.html", "/clean/", "/clean/index.html"]) {
    assert.equal(cacheControlFor(p), "no-cache", p);
  }
});

test("every /clean tool module (js/mjs/css/json) revalidates", () => {
  for (const p of [
    "/clean/ui.js",
    "/clean/ui-view.js",
    "/clean/param-insight.js",
    "/clean/engine/cleaner-bundle.js",
    "/clean/engine/adapter.js",
    "/clean/engine/domain-rules.gen.mjs",
    "/clean/engine/domain-rules.json",
    "/clean/engine/path-strip-rules.gen.mjs",
  ]) {
    assert.equal(cacheControlFor(p), "no-cache", p);
  }
});

test("non-contract assets keep the Static Assets default (null)", () => {
  for (const p of ["/favicon.ico", "/img/logo.png", "/fonts/inter.woff2", "/robots.txt"]) {
    assert.equal(cacheControlFor(p), null, p);
  }
});

test("non-string input is guarded", () => {
  assert.equal(cacheControlFor(undefined), null);
  assert.equal(cacheControlFor(null), null);
});
