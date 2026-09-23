/**
 * MUGA — Unit tests for planDomainStatsView (src/lib/domain-stats-view.js) (#1350)
 *
 * Run with: npm test
 *
 * Pure view-model for the domain-stats table that used to render inside the
 * popup's `showDomainStats` (popup.js:920-966) and now renders inside
 * Settings' Activity section (ADR-0011 Decision 3). Extracted so the
 * sort/slice/shape branching is unit-testable without a DOM or a
 * chrome.storage stub — options.js/popup.js are browser-only and can't be
 * exercised under node:test, mirroring the precedent set by
 * remote-rules-changelog-view.js and attribution-ledger-view.js.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planDomainStatsView } from "../../src/lib/domain-stats-view.js";

describe("planDomainStatsView — pure view-model for the #1350 Activity domain-stats table", () => {
  test("no stats → empty view, no entries", () => {
    const view = planDomainStatsView({});
    assert.strictEqual(view.empty, true);
    assert.deepStrictEqual(view.entries, []);
  });

  test("null/undefined stats → empty view, never throws", () => {
    assert.deepStrictEqual(planDomainStatsView(null), { empty: true, entries: [] });
    assert.deepStrictEqual(planDomainStatsView(undefined), { empty: true, entries: [] });
  });

  test("sorts entries by params descending", () => {
    const stats = {
      "a.com": { params: 3, urls: 5 },
      "b.com": { params: 9, urls: 2 },
      "c.com": { params: 6, urls: 1 },
    };
    const view = planDomainStatsView(stats);
    assert.strictEqual(view.empty, false);
    assert.deepStrictEqual(view.entries.map((e) => e.domain), ["b.com", "c.com", "a.com"]);
  });

  test("shapes each entry as {domain, params, urls}", () => {
    const view = planDomainStatsView({ "example.com": { params: 4, urls: 2 } });
    assert.deepStrictEqual(view.entries, [{ domain: "example.com", params: 4, urls: 2 }]);
  });

  test("caps at 10 entries by default (top by params)", () => {
    const stats = {};
    for (let i = 1; i <= 15; i++) stats[`d${i}.com`] = { params: i, urls: 1 };
    const view = planDomainStatsView(stats);
    assert.strictEqual(view.entries.length, 10);
    // Highest-params domains kept: d15..d6
    assert.strictEqual(view.entries[0].domain, "d15.com");
    assert.strictEqual(view.entries[9].domain, "d6.com");
  });

  test("respects a custom limit", () => {
    const stats = { "a.com": { params: 1, urls: 1 }, "b.com": { params: 2, urls: 1 }, "c.com": { params: 3, urls: 1 } };
    const view = planDomainStatsView(stats, { limit: 2 });
    assert.strictEqual(view.entries.length, 2);
    assert.deepStrictEqual(view.entries.map((e) => e.domain), ["c.com", "b.com"]);
  });

  test("tolerates malformed per-domain entries without throwing", () => {
    const stats = { "good.com": { params: 2, urls: 1 }, "bad.com": null, "weird.com": "not-an-object" };
    const view = planDomainStatsView(stats);
    assert.deepStrictEqual(view.entries, [{ domain: "good.com", params: 2, urls: 1 }]);
  });
});
