/**
 * MUGA — Unit tests for diffRemoteParams (src/lib/remote-rules.js) (#984)
 *
 * Run with: npm test
 *
 * Covers the pure set-difference helper that powers the weekly remote-rules
 * changelog surfaced in Settings ("N parameters added / M removed").
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { diffRemoteParams, CHANGELOG_CAP } from "../../src/lib/remote-rules.js";

describe("diffRemoteParams — pure set-difference of two remote-param lists", () => {
  test("added-only: new params not present before", () => {
    const result = diffRemoteParams(["a", "b"], ["a", "b", "c", "d"]);
    assert.deepEqual(result.added, ["c", "d"]);
    assert.strictEqual(result.addedCount, 2);
    assert.deepEqual(result.removed, []);
    assert.strictEqual(result.removedCount, 0);
  });

  test("removed-only: old params dropped from the new list", () => {
    const result = diffRemoteParams(["a", "b", "c"], ["a"]);
    assert.deepEqual(result.added, []);
    assert.strictEqual(result.addedCount, 0);
    assert.deepEqual(result.removed, ["b", "c"]);
    assert.strictEqual(result.removedCount, 2);
  });

  test("both added and removed in the same diff", () => {
    const result = diffRemoteParams(["a", "b"], ["b", "c"]);
    assert.deepEqual(result.added, ["c"]);
    assert.deepEqual(result.removed, ["a"]);
    assert.strictEqual(result.addedCount, 1);
    assert.strictEqual(result.removedCount, 1);
  });

  test("no-change: identical lists produce empty added/removed", () => {
    const result = diffRemoteParams(["a", "b", "c"], ["a", "b", "c"]);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
    assert.strictEqual(result.addedCount, 0);
    assert.strictEqual(result.removedCount, 0);
  });

  test("first-fetch: old=[] means everything in newParams is added", () => {
    const result = diffRemoteParams([], ["a", "b", "c"]);
    assert.deepEqual(result.added, ["a", "b", "c"]);
    assert.strictEqual(result.addedCount, 3);
    assert.deepEqual(result.removed, []);
    assert.strictEqual(result.removedCount, 0);
  });

  test("cap behavior: array truncated to cap but *Count carries the full total", () => {
    const oldParams = [];
    const newParams = Array.from({ length: 120 }, (_, i) => `p${i}`);
    const result = diffRemoteParams(oldParams, newParams);
    assert.strictEqual(result.added.length, CHANGELOG_CAP);
    assert.strictEqual(result.addedCount, 120);
    assert.deepEqual(result.added, newParams.slice(0, CHANGELOG_CAP));
  });

  test("cap behavior applies independently to removed as well", () => {
    const oldParams = Array.from({ length: 80 }, (_, i) => `q${i}`);
    const result = diffRemoteParams(oldParams, []);
    assert.strictEqual(result.removed.length, CHANGELOG_CAP);
    assert.strictEqual(result.removedCount, 80);
  });

  test("custom cap override is respected", () => {
    const newParams = ["a", "b", "c", "d"];
    const result = diffRemoteParams([], newParams, 2);
    assert.strictEqual(result.added.length, 2);
    assert.strictEqual(result.addedCount, 4);
  });

  test("order preservation: added/removed follow the input array order", () => {
    const result = diffRemoteParams(["z"], ["z", "m", "a", "b"]);
    assert.deepEqual(result.added, ["m", "a", "b"], "must preserve input order, not sort alphabetically");
  });

  test("non-array inputs (null/undefined) are handled gracefully", () => {
    assert.deepEqual(diffRemoteParams(null, ["a", "b"]), {
      addedCount: 2, removedCount: 0, added: ["a", "b"], removed: [],
    });
    assert.deepEqual(diffRemoteParams(undefined, ["a"]), {
      addedCount: 1, removedCount: 0, added: ["a"], removed: [],
    });
    assert.deepEqual(diffRemoteParams(["a"], null), {
      addedCount: 0, removedCount: 1, added: [], removed: ["a"],
    });
    assert.deepEqual(diffRemoteParams(undefined, undefined), {
      addedCount: 0, removedCount: 0, added: [], removed: [],
    });
  });

  test("dedup: duplicate entries in the input lists do not inflate counts", () => {
    const result = diffRemoteParams(["a", "a", "b"], ["a", "b", "b", "c", "c", "c"]);
    assert.deepEqual(result.added, ["c"]);
    assert.strictEqual(result.addedCount, 1);
    assert.deepEqual(result.removed, []);
    assert.strictEqual(result.removedCount, 0);
  });
});
