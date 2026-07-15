/**
 * MUGA — #1099: the popup's "Strip locally" button appended straight to
 * prefs.userCustomRules with NO cap, while every other write path
 * (options.js's manual Add button, the settings-import path in
 * settings-schema.js) already enforces IMPORT_LIST_CAPS.customParams (200).
 * An uncapped list can exceed chrome.storage.sync's ~8 KB per-item quota
 * and fail to persist, silently.
 *
 * addUserCustomRule() extracts the pure cap + dedupe decision so it can be
 * shared and unit-tested directly, without chrome/DOM.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { addUserCustomRule } from "../../src/lib/user-custom-rules.js";
import { IMPORT_LIST_CAPS } from "../../src/lib/validation.js";

describe("#1099 — addUserCustomRule enforces the 200-entry cap and dedupes", () => {
  test("adds a new param to an empty list", () => {
    const { list, error } = addUserCustomRule([], "mytrackingparam");
    assert.deepEqual(list, ["mytrackingparam"]);
    assert.equal(error, undefined);
  });

  test("adds a new param to a non-empty list, preserving existing entries and order", () => {
    const { list, error } = addUserCustomRule(["a", "b"], "c");
    assert.deepEqual(list, ["a", "b", "c"]);
    assert.equal(error, undefined);
  });

  test("does not mutate the input list", () => {
    const input = ["a"];
    addUserCustomRule(input, "b");
    assert.deepEqual(input, ["a"], "input list must remain unchanged");
  });

  test("duplicate (case-insensitive): does not grow the list, reports error 'duplicate'", () => {
    const { list, error } = addUserCustomRule(["mytrackingparam"], "MyTrackingParam");
    assert.deepEqual(list, ["mytrackingparam"]);
    assert.equal(error, "duplicate");
  });

  test("exact-case duplicate: does not grow the list, reports error 'duplicate'", () => {
    const { list, error } = addUserCustomRule(["foo", "bar"], "foo");
    assert.deepEqual(list, ["foo", "bar"]);
    assert.equal(error, "duplicate");
  });

  test(`at the cap (${IMPORT_LIST_CAPS.customParams} entries): rejects a new param with error 'max'`, () => {
    const full = Array.from({ length: IMPORT_LIST_CAPS.customParams }, (_, i) => `param${i}`);
    const { list, error } = addUserCustomRule(full, "one-too-many");
    assert.equal(list.length, IMPORT_LIST_CAPS.customParams, "list must not grow past the cap");
    assert.equal(error, "max");
    assert.ok(!list.includes("one-too-many"), "the rejected param must not appear in the returned list");
  });

  test("just below the cap: still accepts one more param", () => {
    const almostFull = Array.from({ length: IMPORT_LIST_CAPS.customParams - 1 }, (_, i) => `param${i}`);
    const { list, error } = addUserCustomRule(almostFull, "last-one");
    assert.equal(list.length, IMPORT_LIST_CAPS.customParams);
    assert.equal(error, undefined);
    assert.ok(list.includes("last-one"));
  });

  test("a param already in a full list is reported as 'duplicate', not 'max'", () => {
    const full = Array.from({ length: IMPORT_LIST_CAPS.customParams }, (_, i) => `param${i}`);
    const { list, error } = addUserCustomRule(full, "param0");
    assert.equal(list.length, IMPORT_LIST_CAPS.customParams);
    assert.equal(error, "duplicate");
  });

  test("non-array input is treated as an empty list", () => {
    const { list, error } = addUserCustomRule(undefined, "foo");
    assert.deepEqual(list, ["foo"]);
    assert.equal(error, undefined);
  });
});
