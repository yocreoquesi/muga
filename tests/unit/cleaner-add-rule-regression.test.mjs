/**
 * MUGA — Auto-generated regression tests for params added via
 * `npm run add-rule` (#335).
 *
 * Each entry asserts that processUrl strips the listed param on a
 * synthetic URL with no other context. The file is the audit trail of
 * every param ever landed via the script — keep it append-only so the
 * coverage history is preserved.
 *
 * If a param needs broader coverage (per-domain rules, preserve set,
 * bounded-scope), the maintainer should write a richer test in
 * tests/unit/cleaner.test.mjs and remove the entry here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

const PREFS = {
  enabled: true,
  onboardingDone: true,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  disabledCategories: [],
  stripAllAffiliates: false,
  notifyForeignAffiliate: false,
  injectOwnAffiliate: false,
};

function assertStrips(paramName, source) {
  const url = `https://example.test/?${paramName}=foo&keep=bar`;
  const { cleanUrl, action } = processUrl(url, PREFS, []);
  const u = new URL(cleanUrl);
  assert.ok(!u.searchParams.has(paramName),
    `${paramName} should be stripped on a generic URL (source: ${source || "n/a"})`);
  assert.equal(u.searchParams.get("keep"), "bar",
    `non-tracking params must survive the strip`);
  assert.equal(action, "cleaned");
}

test(`link_source — added via add-rule`, () => {
  assertStrips("link_source", "AdGuard filter 17 generic — Telegram Ads click tracking");
});

