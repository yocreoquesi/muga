/**
 * MUGA — `reconcile-net-change.mjs` tests (#1344 T3.1: steady-state churn guard)
 *
 * Measured directly (scratch worktree, week-1/week-2 repro): once #1344's
 * candidates are relocated, EVERY subsequent weekly run repeats the same
 * cycle — promote re-adds the same 62 params (`noop: false`), then
 * `--prefer-anchors` relocates the same 62 back out (`changed: true`) — while
 * the NET committed content (`params[]`, `scoped[]`, the whole store) stays
 * byte-identical. Only `params.json`'s `version`/`published` moved, and moved
 * TWICE (promote's own bump, then prefer-anchors's own bump on top).
 *
 * `runReconcile` is the step that looks at the run's NET effect against what
 * is actually committed (`HEAD`), rather than any one step's own before/after,
 * and fixes both symptoms: restores the working tree when nothing publishable
 * moved, and collapses a stacked bump to exactly one when something did.
 *
 * All I/O is injectable so these tests never touch the filesystem, `git`, or
 * the real committed store.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeParamsForCompare,
  computeNetChange,
  withVersion,
  runReconcile,
} from "../../tools/rule-ingestion/reconcile-net-change.mjs";

// ── normalizeParamsForCompare ─────────────────────────────────────────

describe("normalizeParamsForCompare", () => {
  test("drops version, published and sig", () => {
    const normalized = normalizeParamsForCompare({
      version: 19,
      published: "2026-09-24T00:00:00.000Z",
      sig: "deadbeef",
      params: ["a", "b"],
      scoped: [{ param: "c", hosts: ["example.com"] }],
    });
    assert.deepEqual(normalized, {
      params: ["a", "b"],
      scoped: [{ param: "c", hosts: ["example.com"] }],
    });
  });

  test("an absent scoped section normalizes to []", () => {
    const normalized = normalizeParamsForCompare({ version: 1, published: "x", params: ["a"] });
    assert.deepEqual(normalized, { params: ["a"], scoped: [] });
  });

  test("an absent scoped section and an explicit empty one compare equal", () => {
    const a = normalizeParamsForCompare({ version: 1, published: "x", params: ["a"] });
    const b = normalizeParamsForCompare({ version: 2, published: "y", params: ["a"], scoped: [] });
    assert.deepEqual(a, b);
  });
});

// ── computeNetChange ───────────────────────────────────────────────────

describe("computeNetChange", () => {
  test("identical params[]/scoped[] and identical store — changed:false even with different version/published", () => {
    const headParamsText = JSON.stringify({ version: 17, published: "2026-09-20T00:00:00.000Z", params: ["a"], scoped: [{ param: "b", hosts: ["x.com"] }] });
    const currentParamsText = JSON.stringify({ version: 19, published: "2026-09-27T00:00:00.000Z", params: ["a"], scoped: [{ param: "b", hosts: ["x.com"] }] });
    const storeText = '{"schemaVersion":1,"entries":[]}\n';

    const result = computeNetChange({
      headParamsText,
      currentParamsText,
      headStoreText: storeText,
      currentStoreText: storeText,
    });

    assert.deepEqual(result, { changed: false });
  });

  test("a genuinely different params[] — changed:true", () => {
    const headParamsText = JSON.stringify({ version: 17, published: "x", params: ["a"] });
    const currentParamsText = JSON.stringify({ version: 18, published: "y", params: ["a", "b"] });
    const storeText = "same\n";

    const result = computeNetChange({
      headParamsText,
      currentParamsText,
      headStoreText: storeText,
      currentStoreText: storeText,
    });

    assert.deepEqual(result, { changed: true });
  });

  test("params[] identical but the store differs — changed:true", () => {
    const paramsText = JSON.stringify({ version: 17, published: "x", params: ["a"] });

    const result = computeNetChange({
      headParamsText: paramsText,
      currentParamsText: paramsText,
      headStoreText: "before\n",
      currentStoreText: "after\n",
    });

    assert.deepEqual(result, { changed: true });
  });
});

// ── withVersion ────────────────────────────────────────────────────────

describe("withVersion", () => {
  test("rewrites the top-level version field, nothing else", () => {
    const text = [
      "{",
      '  "version": 17,',
      '  "published": "2026-09-20T00:00:00.000Z",',
      '  "params": [',
      '    "a"',
      "  ]",
      "}",
      "",
    ].join("\n");

    const next = withVersion(text, 18);

    assert.match(next, /^\s*"version": 18,/m);
    assert.equal(
      next.replace('"version": 18,', '"version": 17,'),
      text,
      "every other byte must be untouched"
    );
  });

  test("does not confuse a scoped fact whose OWN param is literally \"version\"", () => {
    // Real committed shape: {"param":"version","hosts":["tally.so"]} — compact,
    // no space after the colon, and "version" is a VALUE here, not a key.
    const text = [
      "{",
      '  "version": 17,',
      '  "published": "x",',
      '  "params": [],',
      '  "scoped": [',
      '    {"param":"version","hosts":["tally.so"]}',
      "  ]",
      "}",
      "",
    ].join("\n");

    const next = withVersion(text, 18);

    assert.match(next, /^\s*"version": 18,/m);
    assert.match(next, /\{"param":"version","hosts":\["tally\.so"\]\}/, "the scoped fact must survive untouched");
  });

  test("throws when there is no top-level version field to rewrite", () => {
    assert.throws(() => withVersion('{"params":[]}\n', 5), /could not find/);
  });
});

// ── runReconcile ─────────────────────────────────────────────────────────

function harness({ headParamsText, currentParamsText, headStoreText = "s\n", currentStoreText = "s\n" }) {
  const writes = [];
  let restored = false;
  const result = runReconcile({
    paramsPath: "unused-params-path",
    storePath: "unused-store-path",
    readFile: (path) => (path === "unused-params-path" ? currentParamsText : currentStoreText),
    writeFile: (path, text) => writes.push({ path, text }),
    readHead: (relativePath) =>
      relativePath.endsWith("params.json") ? headParamsText : headStoreText,
    restore: () => {
      restored = true;
    },
  });
  return { result, writes, restored };
}

describe("runReconcile", () => {
  test("net-unchanged (the T3.1 steady-state case): restores, writes nothing, reports changed:false", () => {
    // Mirrors the measured week-2 repro exactly: HEAD is v17, the working
    // tree (after promote + land-scoped + --prefer-anchors) is v19 with the
    // SAME params[]/scoped[] content.
    const headParamsText = JSON.stringify({ version: 17, published: "2026-09-20T00:00:00.000Z", params: ["a"], scoped: [{ param: "igsh", hosts: ["instagram.com"] }] });
    const currentParamsText = JSON.stringify({ version: 19, published: "2026-09-27T00:00:00.000Z", params: ["a"], scoped: [{ param: "igsh", hosts: ["instagram.com"] }] });

    const { result, writes, restored } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: false });
    assert.deepEqual(writes, [], "must not write params.json in the net-unchanged case");
    assert.equal(restored, true, "must restore tools/rules-source to HEAD");
  });

  test("net-changed with a STACKED double bump: collapses to exactly HEAD version + 1", () => {
    // Reproduces the measured bug directly: promote bumped 15->16, then
    // --prefer-anchors bumped 16->17 in the SAME run, on top of a genuine
    // content change. The published version must be 16 (15 + 1), not 17.
    const headParamsText = JSON.stringify({ version: 15, published: "2026-09-10T00:00:00.000Z", params: ["a"] });
    // Pretty-printed (null, 2), matching renderParamsFile's real format —
    // withVersion's line-anchored regex targets that shape, not compact JSON.
    const currentParamsText = JSON.stringify(
      { version: 17, published: "2026-09-27T00:00:00.000Z", params: ["a", "b"] },
      null,
      2
    );

    const { result, writes, restored } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restored, false);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "unused-params-path");
    assert.match(writes[0].text, /"version": 16,/);
    assert.match(writes[0].text, /"published": "2026-09-27T00:00:00\.000Z"/, "published is left as the run's own timestamp");
  });

  test("net-changed and already exactly HEAD version + 1: does not rewrite the file at all", () => {
    const headParamsText = JSON.stringify({ version: 15, published: "x", params: ["a"] });
    const currentParamsText = JSON.stringify({ version: 16, published: "y", params: ["a", "b"] });

    const { result, writes, restored } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restored, false);
    assert.deepEqual(writes, [], "already correct — nothing to rewrite");
  });

  test("net-changed via the STORE alone (params[]/scoped[] identical, rules.json differs)", () => {
    const paramsText = JSON.stringify({ version: 15, published: "x", params: ["a"] });

    const { result, restored } = harness({
      headParamsText: paramsText,
      currentParamsText: JSON.stringify({ version: 16, published: "y", params: ["a"] }),
      headStoreText: "before\n",
      currentStoreText: "after\n",
    });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restored, false);
  });
});
