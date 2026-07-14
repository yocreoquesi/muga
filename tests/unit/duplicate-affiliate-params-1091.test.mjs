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

  test("Scenario B — a foreign tag hidden behind our own first-position tag must still be stripped", () => {
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
      ["muga0b-20"],
      "our own tag must survive and the foreign duplicate hiding behind it must be removed",
    );
  });
});
