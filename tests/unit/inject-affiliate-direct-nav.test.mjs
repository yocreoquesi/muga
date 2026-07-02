/**
 * MUGA — Contract tests for direct-navigation affiliate injection (#905).
 *
 * Direct navigations (address bar / bookmark / external app) to an Amazon
 * product URL already get MUGA's own tag injected on Chrome today: the
 * content-script self-clean in `src/content/cleaner.js` runs on every load
 * (its `!_hasDNR` guard never skips, because `chrome.declarativeNetRequest`
 * is not exposed to content scripts) and calls `processUrl()`, whose Step 6
 * injects our tag when `injectOwnAffiliate` is on and the URL carries no tag.
 *
 * The self-clean applies its result via `history.replaceState` only when
 * `processUrl` reports it changed the URL, and Step 6 reports
 * `action === "injected"`. So this suite pins the `processUrl` action + tag
 * contract that direct-nav injection depends on — a future change to Step 6's
 * `action` value or its honor-creator guard would silently break injection
 * (or, worse, start clobbering a creator's existing tag) and this catches it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// Injection enabled — mirrors the content-script gate (injectOwnAffiliate on,
// stripAllAffiliates off). onboardingDone/enabled true so nothing short-circuits.
const INJECT_PREFS = {
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
  disabledCategories: [],
};

// The tag MUGA injects for amazon.com (OUR_TAGS["amazon-associates"]["amazon.com"]).
const OUR_AMAZON_COM_TAG = "muga0b-20";

describe("#905 direct-nav injection — processUrl action contract", () => {
  test('untagged Amazon product URL => action "injected", our tag added', () => {
    const r = processUrl("https://www.amazon.com/dp/B00X", INJECT_PREFS, domainRules);
    assert.equal(r.action, "injected", "untagged affiliate URL must inject");
    const url = new URL(r.cleanUrl);
    assert.equal(url.searchParams.get("tag"), OUR_AMAZON_COM_TAG);
  });

  test('untagged Amazon URL with junk => action "injected" (junk-stripping does not suppress the inject gate)', () => {
    const r = processUrl(
      "https://www.amazon.com/dp/B00X?utm_source=x&ref=y",
      INJECT_PREFS,
      domainRules,
    );
    // On Chrome the junk is already gone (DNR) before this runs; even when it
    // is present, the combined strip+inject outcome must still surface as
    // "injected" so the content-script gate fires.
    assert.equal(r.action, "injected");
    assert.equal(new URL(r.cleanUrl).searchParams.get("tag"), OUR_AMAZON_COM_TAG);
  });

  test("foreign (creator) tag is preserved and NOT reported as injected — honor-creator", () => {
    const r = processUrl(
      "https://www.amazon.com/dp/B00X?tag=creator-21",
      INJECT_PREFS,
      domainRules,
    );
    assert.notEqual(
      r.action,
      "injected",
      "a URL already carrying a tag must never be reported as injected",
    );
    assert.equal(
      new URL(r.cleanUrl).searchParams.get("tag"),
      "creator-21",
      "the creator's tag must survive untouched",
    );
  });

  test("our own tag already present => not injected (idempotent, replaceState no-op)", () => {
    const url = `https://www.amazon.com/dp/B00X?tag=${OUR_AMAZON_COM_TAG}`;
    const r = processUrl(url, INJECT_PREFS, domainRules);
    assert.notEqual(r.action, "injected");
    assert.equal(new URL(r.cleanUrl).searchParams.get("tag"), OUR_AMAZON_COM_TAG);
  });

  test("injection is suppressed when stripAllAffiliates is on", () => {
    const r = processUrl(
      "https://www.amazon.com/dp/B00X",
      { ...INJECT_PREFS, stripAllAffiliates: true },
      domainRules,
    );
    assert.notEqual(r.action, "injected");
  });

  test("injection is suppressed when injectOwnAffiliate is off", () => {
    const r = processUrl(
      "https://www.amazon.com/dp/B00X",
      { ...INJECT_PREFS, injectOwnAffiliate: false },
      domainRules,
    );
    assert.notEqual(r.action, "injected");
  });
});
