/**
 * MUGA — Unit tests for planChangelogView (src/lib/remote-rules-changelog-view.js) (#984)
 *
 * Run with: npm test
 *
 * Locks the framing logic for the weekly remote-rules changelog block that
 * Settings renders. The most important case is the FIRST fetch: it must NOT
 * show a "(+N / -M)" suffix (that would misleadingly read as "1400 params
 * added this week") — see the F1 regression test below.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planChangelogView } from "../../src/lib/remote-rules-changelog-view.js";

const LABEL = "optionsRemoteRulesChangelogLabel";
const NO_CHANGES = "optionsRemoteRulesChangelogNoChanges";

/**
 * Fake translator: returns interpolatable templates (with {n} intact) for the
 * initial/more keys so interpolation is observable, and the key itself for the
 * static keys (label, no-changes).
 */
function translate(key) {
  if (key === "optionsRemoteRulesChangelogInitial") return "initial {n} params";
  if (key === "optionsRemoteRulesChangelogMore") return "and {n} more";
  return key;
}

describe("planChangelogView — pure view-model for the #984 changelog block", () => {
  test("disabled → not visible, everything null, summary is the label", () => {
    const view = planChangelogView({ enabled: false }, translate);
    assert.strictEqual(view.visible, false);
    assert.strictEqual(view.summary, LABEL);
    assert.strictEqual(view.empty, null);
    assert.strictEqual(view.added, null);
    assert.strictEqual(view.addedMore, null);
    assert.strictEqual(view.removed, null);
    assert.strictEqual(view.removedMore, null);
  });

  test("enabled but changelog null → not visible", () => {
    const view = planChangelogView({ enabled: true, changelog: null }, translate);
    assert.strictEqual(view.visible, false);
    assert.strictEqual(view.summary, LABEL);
    assert.strictEqual(view.empty, null);
    assert.strictEqual(view.added, null);
    assert.strictEqual(view.removed, null);
  });

  test("first fetch with addedCount>0 → NO '(+' suffix, initial copy interpolated (F1 regression)", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: null, addedCount: 1400, added: ["a", "b"], removedCount: 0, removed: [] },
    }, translate);
    assert.strictEqual(view.visible, true);
    assert.strictEqual(view.summary, LABEL, "first fetch summary must be the bare label, no (+N / -M) suffix");
    assert.ok(!view.summary.includes("(+"), "first fetch summary must NOT contain a '(+' suffix");
    assert.strictEqual(view.empty, "initial 1400 params");
    assert.strictEqual(view.added, null);
    assert.strictEqual(view.addedMore, null);
    assert.strictEqual(view.removed, null);
    assert.strictEqual(view.removedMore, null);
  });

  test("first fetch that dedupes to empty (addedCount 0) → no-changes copy, no suffix (F6)", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: null, addedCount: 0, added: [], removedCount: 0, removed: [] },
    }, translate);
    assert.strictEqual(view.visible, true);
    assert.strictEqual(view.summary, LABEL);
    assert.ok(!view.summary.includes("(+"));
    assert.strictEqual(view.empty, NO_CHANGES);
    assert.strictEqual(view.added, null);
    assert.strictEqual(view.removed, null);
  });

  test("no-change fetch (prevFetchedAt set, both counts 0) → no-changes copy, blocks null", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: 123, addedCount: 0, added: [], removedCount: 0, removed: [] },
    }, translate);
    assert.strictEqual(view.visible, true);
    assert.strictEqual(view.summary, LABEL);
    assert.ok(!view.summary.includes("(+"));
    assert.strictEqual(view.empty, NO_CHANGES);
    assert.strictEqual(view.added, null);
    assert.strictEqual(view.addedMore, null);
    assert.strictEqual(view.removed, null);
    assert.strictEqual(view.removedMore, null);
  });

  test("has-changes both sides, counts <= array length → suffix + arrays, no 'more'", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: 123, addedCount: 2, added: ["a", "b"], removedCount: 1, removed: ["x"] },
    }, translate);
    assert.strictEqual(view.visible, true);
    assert.strictEqual(view.summary, LABEL + " (+2 / -1)");
    assert.strictEqual(view.empty, null);
    assert.deepEqual(view.added, ["a", "b"]);
    assert.strictEqual(view.addedMore, null);
    assert.deepEqual(view.removed, ["x"]);
    assert.strictEqual(view.removedMore, null);
  });

  test("has-changes with cap overflow → interpolated 'more' string on both sides", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: 123, addedCount: 5, added: ["a", "b"], removedCount: 4, removed: ["x"] },
    }, translate);
    assert.strictEqual(view.summary, LABEL + " (+5 / -4)");
    assert.deepEqual(view.added, ["a", "b"]);
    assert.strictEqual(view.addedMore, "and 3 more", "5 total - 2 shown = 3 more");
    assert.deepEqual(view.removed, ["x"]);
    assert.strictEqual(view.removedMore, "and 3 more", "4 total - 1 shown = 3 more");
  });

  test("has-changes one side only (added>0, removed===0) → added non-null, removed null, suffix shows -0", () => {
    const view = planChangelogView({
      enabled: true,
      changelog: { prevFetchedAt: 123, addedCount: 2, added: ["a", "b"], removedCount: 0, removed: [] },
    }, translate);
    assert.strictEqual(view.summary, LABEL + " (+2 / -0)");
    assert.deepEqual(view.added, ["a", "b"]);
    assert.strictEqual(view.addedMore, null);
    assert.strictEqual(view.removed, null);
    assert.strictEqual(view.removedMore, null);
  });
});
