/**
 * MUGA — Regression tests for #1091.
 *
 * Bug: the affiliate strip decision in handleAffiliatePipeline's Step 4b
 * (stripAllAffiliates path) reads the FIRST occurrence of a repeated query
 * param via `searchParams.get()`, but the removal call
 * `searchParams.delete()` removes EVERY occurrence. When a param is
 * duplicated (`?tag=evil-20&tag=creator-21`), the decision and the removal
 * disagree — a value that should have survived (whitelisted, or our own
 * injected tag) gets wiped out along with the foreign one because the
 * decision was made on a DIFFERENT occurrence's value.
 *
 * Fix: decide per-occurrence (iterate every value via `getAll()`) instead of
 * deciding once from `get()` and blowing away every occurrence with
 * `delete()`.
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

describe("#1091 — repeated affiliate params break whitelist-always-wins (get vs delete)", () => {
  test("Scenario A — whitelisted creator tag survives stripAllAffiliates even hidden behind a foreign duplicate", () => {
    const raw = "https://www.amazon.com/dp/X?tag=evil-20&tag=creator-21";
    const prefs = {
      ...PREFS,
      stripAllAffiliates: true,
      whitelist: ["amazon.com::tag::creator-21"],
    };

    const { cleanUrl } = processUrl(raw, prefs, domainRules);
    const u = new URL(cleanUrl);

    assert.deepEqual(
      u.searchParams.getAll("tag"),
      ["creator-21"],
      "the whitelisted creator tag must survive and the foreign duplicate must be removed",
    );
  });

  test("Scenario B — with no whitelist entry, BOTH duplicate values are stripped under stripAllAffiliates (drop-affiliate-injection: no more 'our own tag' exemption)", () => {
    // Pre-PR-1a this value ("muga0b-20") was MUGA's own injected tag and was
    // exempted from stripAllAffiliates. OUR_TAGS is now removed, so there is
    // no more "our own tag" concept — under stripAllAffiliates, neither
    // duplicate value is whitelisted, so both are stripped.
    const raw = "https://www.amazon.com/dp/X?tag=muga0b-20&tag=evil-20";
    const prefs = {
      ...PREFS,
      stripAllAffiliates: true,
      injectOwnAffiliate: true,
    };

    const { cleanUrl } = processUrl(raw, prefs, domainRules);
    const u = new URL(cleanUrl);

    assert.deepEqual(
      u.searchParams.getAll("tag"),
      [],
      "with no whitelist entry, every duplicate value is stripped under stripAllAffiliates",
    );
  });

  test("Scenario B (whitelisted) — a foreign duplicate hidden behind a whitelisted value must still be stripped", () => {
    // Same #1091 per-occurrence decision guard, exercised without relying on
    // the now-removed 'our own tag' concept: whitelist a specific value and
    // confirm the OTHER duplicate occurrence is still stripped, not both
    // kept or both removed.
    const raw = "https://www.amazon.com/dp/X?tag=trusted-21&tag=evil-20";
    const prefs = {
      ...PREFS,
      stripAllAffiliates: true,
      whitelist: ["amazon.com::tag::trusted-21"],
    };

    const { cleanUrl } = processUrl(raw, prefs, domainRules);
    const u = new URL(cleanUrl);

    assert.deepEqual(
      u.searchParams.getAll("tag"),
      ["trusted-21"],
      "the whitelisted value must survive and the foreign duplicate must be removed",
    );
  });
});
