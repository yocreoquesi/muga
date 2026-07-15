/**
 * MUGA — Regression test for #1111 (audit-2026-07 follow-up), Step-5 path.
 *
 * The blacklist-specific-value strip (processUrl Step 5) shared the #1091
 * get()-decides / delete()-removes-all class: with a duplicated `tag`, a
 * blacklist rule matching the FIRST value deleted EVERY occurrence, destroying
 * a non-blacklisted (whitelisted/creator) duplicate. Now decided per-value.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  whitelist: [],
  blacklist: [],
};

describe("#1111 — blacklist-value strip decides per-occurrence (duplicate tags)", () => {
  test("a blacklisted value is stripped while a non-blacklisted duplicate survives", () => {
    const raw = "https://amazon.es/dp/X?tag=evil-20&tag=creator-21";
    const { cleanUrl } = processUrl(raw, { ...PREFS, blacklist: ["amazon.es::tag::evil-20"] }, []);

    const tags = new URL(cleanUrl).searchParams.getAll("tag");
    assert.ok(!tags.includes("evil-20"), "the blacklisted value must be stripped");
    assert.ok(tags.includes("creator-21"), "a non-blacklisted duplicate must survive (not destroyed by a first-match delete)");
  });

  test("all occurrences are stripped when every value matches the blacklist rule", () => {
    const raw = "https://amazon.es/dp/X?tag=evil-20&tag=evil-20";
    const { cleanUrl } = processUrl(raw, { ...PREFS, blacklist: ["amazon.es::tag::evil-20"] }, []);
    assert.equal(new URL(cleanUrl).searchParams.has("tag"), false, "all matching occurrences must be stripped");
  });
});
