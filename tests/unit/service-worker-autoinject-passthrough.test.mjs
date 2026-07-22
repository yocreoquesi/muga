/**
 * MUGA — service-worker.js passes `autoInjected` through the response
 * payload (affiliate-autoinject-notice, task 2.3).
 *
 * `handleProcessUrl`'s success path returns the `processUrl()` result
 * directly, so it already carries `result.autoInjected` once cleaner.js
 * attaches it (see cleaner-autoinject-signal.test.mjs). The only extra
 * wiring needed here is every EARLY-RETURN literal response shape, which
 * builds its own object instead of calling `processUrl` — those must add
 * `autoInjected: null` alongside the existing `detectedAffiliate: null`
 * field so the shape stays consistent across every response the caller
 * might receive (mirrors the pattern already used for `detectedAffiliate`).
 *
 * Structural (source-string) test: service-worker.js is a Chrome
 * extension background script that cannot be imported standalone in Node
 * (AGENTS.md testing conventions — "Structural tests via readFileSync for
 * modules that cannot be imported in Node").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, "../../src/background/service-worker.js"), "utf8");

test("every literal response containing detectedAffiliate: null also carries autoInjected: null", () => {
  const re = /\{[^{}]*detectedAffiliate:\s*null[^{}]*\}/g;
  const matches = src.match(re) || [];
  assert.ok(matches.length >= 5, `expected at least 5 detectedAffiliate: null response literals, found ${matches.length}`);
  for (const literal of matches) {
    assert.ok(
      /autoInjected:\s*null/.test(literal),
      `response literal missing "autoInjected: null" alongside "detectedAffiliate: null": ${literal}`,
    );
  }
});
