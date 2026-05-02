/** MUGA: Unit tests for the benchmark runner-core pure helpers. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareEntry,
  buildReport,
  exitCodeFromReport,
  validateCorpusFile,
} from "../benchmark/lib/runner-core.mjs";

test("compareEntry — action-only match returns ok", () => {
  const r = compareEntry(
    { url: "https://example.com/", category: "clean-urls", expectedAction: "untouched" },
    { action: "untouched", cleanUrl: "https://example.com/" },
  );
  assert.equal(r.ok, true);
});

test("compareEntry — action mismatch returns diff", () => {
  const r = compareEntry(
    { url: "https://example.com/?utm_source=x", category: "utm", expectedAction: "cleaned" },
    { action: "untouched", cleanUrl: "https://example.com/?utm_source=x" },
  );
  assert.equal(r.ok, false);
  assert.match(r.diff, /action: expected "cleaned", got "untouched"/);
});

test("compareEntry — expectedClean enforced when present", () => {
  const r = compareEntry(
    {
      url: "https://example.com/?utm_source=x",
      category: "utm",
      expectedAction: "cleaned",
      expectedClean: "https://example.com/",
    },
    { action: "cleaned", cleanUrl: "https://example.com/?utm_source=x" },
  );
  assert.equal(r.ok, false);
  assert.match(r.diff, /cleanUrl/);
});

test("compareEntry — expectedClean ignored when absent", () => {
  const r = compareEntry(
    { url: "https://example.com/", category: "utm", expectedAction: "cleaned" },
    { action: "cleaned", cleanUrl: "https://anything-different.com/" },
  );
  assert.equal(r.ok, true);
});

test("buildReport — empty corpus", () => {
  const report = buildReport({ corpus: [], results: [], generatedAt: "2026-05-02T00:00:00Z" });
  assert.equal(report.totalEntries, 0);
  assert.equal(report.matched, 0);
  assert.equal(report.mismatched, 0);
  assert.deepEqual(report.byCategory, {});
  assert.deepEqual(report.mismatches, []);
});

test("buildReport — all matched", () => {
  const corpus = [
    { url: "u1", category: "utm", expectedAction: "cleaned" },
    { url: "u2", category: "utm", expectedAction: "cleaned" },
    { url: "c1", category: "clean-urls", expectedAction: "untouched" },
  ];
  const results = corpus.map(() => ({ ok: true, expected: {}, actual: {} }));
  const report = buildReport({ corpus, results, generatedAt: "2026-05-02T00:00:00Z" });
  assert.equal(report.totalEntries, 3);
  assert.equal(report.matched, 3);
  assert.equal(report.mismatched, 0);
  assert.equal(report.byCategory.utm.total, 2);
  assert.equal(report.byCategory.utm.matched, 2);
  assert.equal(report.byCategory["clean-urls"].matched, 1);
  assert.deepEqual(report.mismatches, []);
});

test("buildReport — captures mismatches with url/category/diff", () => {
  const corpus = [
    { url: "https://example.com/?utm_source=x", category: "utm", expectedAction: "cleaned" },
    { url: "https://example.com/", category: "clean-urls", expectedAction: "untouched" },
  ];
  const results = [
    { ok: false, expected: { action: "cleaned" }, actual: { action: "untouched" }, diff: 'action: expected "cleaned", got "untouched"' },
    { ok: true, expected: {}, actual: {} },
  ];
  const report = buildReport({ corpus, results });
  assert.equal(report.matched, 1);
  assert.equal(report.mismatched, 1);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].url, "https://example.com/?utm_source=x");
  assert.equal(report.mismatches[0].category, "utm");
  assert.match(report.mismatches[0].diff, /cleaned/);
});

test("buildReport — corpus/results length mismatch throws", () => {
  assert.throws(() => buildReport({ corpus: [{ url: "a", category: "utm", expectedAction: "cleaned" }], results: [] }));
});

test("buildReport — matchRate is a percentage (0..100, one decimal)", () => {
  const corpus = [
    { url: "u1", category: "utm", expectedAction: "cleaned" },
    { url: "u2", category: "utm", expectedAction: "cleaned" },
    { url: "u3", category: "utm", expectedAction: "cleaned" },
    { url: "u4", category: "utm", expectedAction: "cleaned" },
  ];
  const results = [
    { ok: true, expected: {}, actual: {} },
    { ok: true, expected: {}, actual: {} },
    { ok: true, expected: {}, actual: {} },
    { ok: false, expected: {}, actual: {}, diff: "x" },
  ];
  const report = buildReport({ corpus, results });
  assert.equal(report.matchRate, 75);
  assert.equal(report.byCategory.utm.matchRate, 75);
});

test("buildReport — matchRate rounds to one decimal place", () => {
  const corpus = Array.from({ length: 7 }, (_, i) => ({
    url: `u${i}`,
    category: "utm",
    expectedAction: "cleaned",
  }));
  const results = corpus.map((_, i) => ({ ok: i < 5, expected: {}, actual: {}, diff: i < 5 ? undefined : "x" }));
  const report = buildReport({ corpus, results });
  // 5/7 = 0.71428... → 71.4% (one decimal)
  assert.equal(report.matchRate, 71.4);
  assert.equal(report.byCategory.utm.matchRate, 71.4);
});

test("buildReport — empty corpus gives matchRate 0 (no NaN)", () => {
  const report = buildReport({ corpus: [], results: [], generatedAt: "2026-05-02T00:00:00Z" });
  assert.equal(report.matchRate, 0);
});

test("buildReport — perfect run gives matchRate 100", () => {
  const corpus = [
    { url: "u1", category: "utm", expectedAction: "cleaned" },
    { url: "u2", category: "clean-urls", expectedAction: "untouched" },
  ];
  const results = corpus.map(() => ({ ok: true, expected: {}, actual: {} }));
  const report = buildReport({ corpus, results });
  assert.equal(report.matchRate, 100);
  assert.equal(report.byCategory.utm.matchRate, 100);
  assert.equal(report.byCategory["clean-urls"].matchRate, 100);
});

test("exitCodeFromReport — 0 when all matched", () => {
  assert.equal(exitCodeFromReport({ mismatched: 0 }), 0);
});

test("exitCodeFromReport — 1 when any mismatched", () => {
  assert.equal(exitCodeFromReport({ mismatched: 1 }), 1);
  assert.equal(exitCodeFromReport({ mismatched: 42 }), 1);
});

test("validateCorpusFile — rejects unknown category", () => {
  const v = validateCorpusFile({ category: "nonsense", entries: [] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("unknown category")));
});

test("validateCorpusFile — rejects entries without url", () => {
  const v = validateCorpusFile({ category: "utm", entries: [{ expectedAction: "cleaned" }] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("missing url")));
});

test("validateCorpusFile — rejects unknown expectedAction", () => {
  const v = validateCorpusFile({ category: "utm", entries: [{ url: "u", expectedAction: "destroyed" }] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("unknown expectedAction")));
});

test("validateCorpusFile — accepts entry with optional expectedClean", () => {
  const v = validateCorpusFile({
    category: "utm",
    entries: [{ url: "u", expectedAction: "cleaned", expectedClean: "u-clean" }],
  });
  assert.equal(v.ok, true);
});

test("validateCorpusFile — rejects non-string expectedClean", () => {
  const v = validateCorpusFile({
    category: "utm",
    entries: [{ url: "u", expectedAction: "cleaned", expectedClean: 42 }],
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("expectedClean")));
});
