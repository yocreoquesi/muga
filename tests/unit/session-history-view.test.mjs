/**
 * MUGA — Session-history view-model (#1352).
 *
 * Pure validate/shape logic for the "This session" ledger, extracted from
 * the popup's showHistory (src/popup/popup.js, now removed) as part of
 * moving both ledgers into Settings' Activity section behind a scope
 * control. Mirrors the precedent set by domain-stats-view.js (#1350):
 * options.js/popup.js are browser-only and cannot be exercised under
 * node:test, so this shaping logic needs a separate, pure module to be
 * testable at all.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planSessionHistoryView } from "../../src/lib/session-history-view.js";

describe("planSessionHistoryView", () => {
  test("empty/missing history yields empty:true, entries:[]", () => {
    assert.deepStrictEqual(planSessionHistoryView([]), { empty: true, entries: [] });
    assert.deepStrictEqual(planSessionHistoryView(null), { empty: true, entries: [] });
    assert.deepStrictEqual(planSessionHistoryView(undefined), { empty: true, entries: [] });
  });

  test("passes through well-formed entries in order (most recent first, as written)", () => {
    const history = [
      { original: "https://a.example/?utm_source=x", clean: "https://a.example/", ts: 200, removedTracking: ["utm_source"] },
      { original: "https://b.example/?fbclid=y", clean: "https://b.example/", ts: 100, removedTracking: ["fbclid"] },
    ];
    const { empty, entries } = planSessionHistoryView(history);
    assert.strictEqual(empty, false);
    assert.deepStrictEqual(entries, history);
  });

  test("defensively drops malformed entries (missing original/clean) rather than throwing", () => {
    const history = [
      { original: "https://a.example/", clean: "https://a.example/" },
      null,
      { clean: "https://b.example/" },
      { original: "https://c.example/" },
      "not-an-object",
      { original: "https://d.example/", clean: "https://d.example/", removedTracking: ["x"] },
    ];
    const { empty, entries } = planSessionHistoryView(history);
    assert.strictEqual(empty, false);
    assert.deepStrictEqual(entries.map((e) => e.original), ["https://a.example/", "https://d.example/"]);
  });

  test("normalizes a missing/non-array removedTracking to []", () => {
    const { entries } = planSessionHistoryView([
      { original: "https://a.example/", clean: "https://a.example/" },
      { original: "https://b.example/", clean: "https://b.example/", removedTracking: "not-an-array" },
    ]);
    assert.deepStrictEqual(entries[0].removedTracking, []);
    assert.deepStrictEqual(entries[1].removedTracking, []);
  });

  test("respects an optional limit, defaulting to 10 (matching HISTORY_MAX)", () => {
    const history = Array.from({ length: 15 }, (_, i) => ({ original: `https://${i}.example/`, clean: `https://${i}.example/` }));
    assert.strictEqual(planSessionHistoryView(history).entries.length, 10);
    assert.strictEqual(planSessionHistoryView(history, { limit: 3 }).entries.length, 3);
  });

  test("non-array input is treated as empty", () => {
    assert.deepStrictEqual(planSessionHistoryView("nope"), { empty: true, entries: [] });
    assert.deepStrictEqual(planSessionHistoryView({}), { empty: true, entries: [] });
  });
});

// #1352 native review hardening: malformed stored data degrades, never
// leaks through to the renderer.
describe("planSessionHistoryView — defensive input handling (#1352)", () => {
  const row = (i) => ({ original: `https://a.example/?u=${i}`, clean: "https://a.example/", ts: i });

  test("a negative, NaN or non-numeric limit falls back to the default cap", () => {
    const history = Array.from({ length: 15 }, (_, i) => row(i));
    for (const limit of [-3, NaN, "5", Infinity]) {
      assert.equal(planSessionHistoryView(history, { limit }).entries.length, 10, `limit=${String(limit)}`);
    }
    assert.equal(planSessionHistoryView(history, { limit: 3 }).entries.length, 3);
  });

  test("removedTracking keeps only string elements and is a copy, not the stored array", () => {
    const stored = ["utm_source", null, 42, { x: 1 }, "fbclid"];
    const [entry] = planSessionHistoryView([{ ...row(1), removedTracking: stored }]).entries;
    assert.deepStrictEqual(entry.removedTracking, ["utm_source", "fbclid"]);
    assert.notStrictEqual(entry.removedTracking, stored);
  });

  test("an entry without a numeric ts has no ts key at all", () => {
    const [entry] = planSessionHistoryView([{ original: "https://a.example/?x=1", clean: "https://a.example/" }]).entries;
    assert.equal(Object.hasOwn(entry, "ts"), false);
  });
});
