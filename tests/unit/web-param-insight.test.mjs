/**
 * MUGA — Unit tests for web/param-insight.js (sdd/web-cleaning-insight,
 * Slice 1: per-parameter what/why breakdown).
 *
 * web/param-insight.js is a pure module: it builds a reverse param-index
 * from the generated web/engine/param-categories.gen.mjs mirror and calls
 * the mirrored web/engine/param-breakdown-view.gen.mjs's
 * buildParamBreakdownView(), with an English-only translateOther (the
 * page is lang="en" only, design D3). No DOM access, fully unit-testable.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildParamInsight } from "../../web/param-insight.js";

describe("buildParamInsight() (spec: Per-parameter what/why breakdown)", () => {
  test("groups a known tracking param under a non-null label and description", () => {
    const groups = buildParamInsight(["utm_source"]);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(typeof group.label, "string");
    assert.ok(group.label.length > 0);
    assert.equal(typeof group.description, "string");
    assert.ok(group.description.length > 0);
    assert.deepEqual(group.params, ["utm_source"]);
  });

  test("groups an unknown param under 'other' with a null description", () => {
    const groups = buildParamInsight(["totally_unknown_param_xyz"]);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(group.categoryKey, "other");
    assert.equal(group.description, null);
    assert.deepEqual(group.params, ["totally_unknown_param_xyz"]);
  });

  test("returns an empty list for an empty removed array", () => {
    assert.deepEqual(buildParamInsight([]), []);
  });
});
