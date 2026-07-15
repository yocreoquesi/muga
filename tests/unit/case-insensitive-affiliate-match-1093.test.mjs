/**
 * MUGA — Regression tests for #1093.
 *
 * Bug: affiliate-param PRESERVATION is case-insensitive (stripTrackingParams
 * lower-cases every key before checking `affiliateParamSet`), but foreign
 * DETECTION, OWN-TAG INJECTION, and blacklist/whitelist matching all compare
 * against the URL's query keys case-SENSITIVELY via
 * `searchParams.get(pattern.param)` / `.has(pattern.param)`, where
 * `pattern.param` is always the canonical lowercase form (e.g. "tag").
 *
 * A real-world URL using `?TAG=creator-21` (uppercase key — valid, browsers
 * pass it through unchanged) is invisible to `.get("tag")` / `.has("tag")`.
 * That let MUGA inject its OWN tag under the lowercase key ALONGSIDE the
 * existing uppercase-keyed creator tag — two "tag" params stacked on the
 * same URL, violating the non-superposition invariant — and let
 * blacklist/whitelist entries silently fail to match an uppercase param.
 *
 * Fix: a case-insensitive key lookup used everywhere an affiliate/blacklist/
 * whitelist param name is looked up against the URL's actual query keys.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

describe("#1093 — case-insensitive preserve but case-sensitive detect/inject", () => {
  test("does NOT inject own tag on top of an uppercase-keyed creator tag (non-superposition)", () => {
    const raw = "https://www.amazon.com/dp/X?TAG=creator-21";
    const { cleanUrl, action } = processUrl(
      raw,
      { ...PREFS, injectOwnAffiliate: true },
      domainRules,
    );

    const u = new URL(cleanUrl);
    assert.notEqual(action, "injected", "must not inject when a same-name param already exists, regardless of case");
    assert.equal(u.searchParams.get("TAG"), "creator-21", "the uppercase creator tag must survive untouched");
    assert.equal(u.searchParams.has("tag"), false, "must not add a second lowercase 'tag' param alongside the uppercase one");
  });

  test("blacklist entry matches an uppercase-keyed param", () => {
    const raw = "https://www.amazon.com/dp/X?TAG=creator-21";
    const { cleanUrl } = processUrl(
      raw,
      { ...PREFS, blacklist: ["amazon.com::tag::creator-21"] },
      domainRules,
    );

    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.has("TAG"), false, "blacklisted value must be removed even though the URL key is uppercase");
  });

  test("whitelist entry matches an uppercase-keyed param (not flagged as foreign)", () => {
    const raw = "https://www.amazon.com/dp/X?TAG=creator-21";
    const { action } = processUrl(
      raw,
      {
        ...PREFS,
        notifyForeignAffiliate: true,
        whitelist: ["amazon.com::tag::creator-21"],
      },
      domainRules,
    );

    assert.notEqual(action, "detected_foreign", "whitelisted value must match despite the uppercase URL key");
  });

  test("preservedAffiliate signal recognizes an uppercase-keyed creator tag", () => {
    const raw = "https://www.amazon.com/dp/X?TAG=creator-21";
    const { preservedAffiliate } = processUrl(raw, { ...PREFS }, domainRules);

    assert.ok(preservedAffiliate, "preservedAffiliate must be populated for an uppercase-keyed creator tag");
    assert.equal(preservedAffiliate.value, "creator-21");
  });
});
