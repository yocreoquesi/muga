/** MUGA: Unit tests for the benchmark runner-core pure helpers. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareEntry,
  buildReport,
  exitCodeFromReport,
  validateCorpusFile,
  runCompetitors,
} from "../benchmark/lib/runner-core.mjs";
import { identityAdapter } from "../benchmark/competitors/identity.mjs";

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

// ── A6 phase 2 (#506) — competitor adapter contract ──────────────────

test("runCompetitors — empty adapters list returns empty record", () => {
  const out = runCompetitors({ url: "https://example.com/" }, []);
  assert.deepEqual(out, {});
});

test("runCompetitors — null/undefined adapters list returns empty record", () => {
  assert.deepEqual(runCompetitors({ url: "https://example.com/" }, null), {});
  assert.deepEqual(runCompetitors({ url: "https://example.com/" }, undefined), {});
});

test("runCompetitors — identity adapter returns rawUrl unchanged", () => {
  const out = runCompetitors({ url: "https://example.com/?utm_source=x" }, [identityAdapter]);
  assert.deepEqual(out, { identity: { cleanUrl: "https://example.com/?utm_source=x" } });
});

test("runCompetitors — adapter throw is caught; cleanUrl falls back to input", () => {
  const buggyAdapter = {
    name: "buggy",
    label: "Buggy fixture",
    source: "n/a",
    clean() { throw new Error("oops"); },
  };
  const out = runCompetitors({ url: "https://example.com/" }, [buggyAdapter]);
  assert.deepEqual(out, { buggy: { cleanUrl: "https://example.com/" } });
});

test("runCompetitors — non-string adapter return falls back to input", () => {
  const badReturnAdapter = {
    name: "bad-return",
    label: "Returns null",
    source: "n/a",
    clean() { return null; },
  };
  const out = runCompetitors({ url: "https://example.com/" }, [badReturnAdapter]);
  assert.deepEqual(out, { "bad-return": { cleanUrl: "https://example.com/" } });
});

test("runCompetitors — skips malformed adapter entries (no name, no clean)", () => {
  const out = runCompetitors({ url: "https://example.com/" }, [
    null,
    {},
    { name: "no-clean" },
    { clean: () => "x" }, // no name
    identityAdapter,
  ]);
  assert.deepEqual(out, { identity: { cleanUrl: "https://example.com/" } });
});

test("buildReport — competitorResults absent → no byCompetitor in report", () => {
  const corpus = [{ url: "u", category: "utm", expectedAction: "cleaned" }];
  const results = [{ ok: true, expected: {}, actual: {} }];
  const report = buildReport({ corpus, results });
  assert.equal(report.byCompetitor, undefined);
});

test("buildReport — competitorResults present → byCompetitor summary", () => {
  const corpus = [
    { url: "https://example.com/?utm_source=x", category: "utm", expectedAction: "cleaned", expectedClean: "https://example.com/" },
    { url: "https://example.com/article", category: "clean-urls", expectedAction: "untouched" },
  ];
  const results = [
    { ok: true, expected: {}, actual: {} },
    { ok: true, expected: {}, actual: {} },
  ];
  const competitorResults = [
    // First entry: identity returns input unchanged (didn't strip utm_source)
    { identity: { cleanUrl: "https://example.com/?utm_source=x" } },
    // Second entry: identity returns input unchanged (correct — already clean)
    { identity: { cleanUrl: "https://example.com/article" } },
  ];
  const report = buildReport({ corpus, results, competitorResults });
  assert.ok(report.byCompetitor);
  assert.equal(report.byCompetitor.identity.total, 2);
  assert.equal(report.byCompetitor.identity.changedFromInput, 0); // identity never changes
  assert.equal(report.byCompetitor.identity.matchedExpectedClean, 0); // first entry has expectedClean but identity didn't match it
  assert.equal(report.byCompetitor.identity.matchRate, 0);
});

test("buildReport — byCompetitor matchRate counts entries WITH expectedClean only", () => {
  const corpus = [
    { url: "https://a.com/?utm=x", category: "utm", expectedAction: "cleaned", expectedClean: "https://a.com/" },
    { url: "https://b.com/?utm=y", category: "utm", expectedAction: "cleaned", expectedClean: "https://b.com/" },
  ];
  const results = corpus.map(() => ({ ok: true, expected: {}, actual: {} }));
  const competitorResults = [
    // Adapter "perfect" produces the expectedClean for both
    { perfect: { cleanUrl: "https://a.com/" } },
    { perfect: { cleanUrl: "https://b.com/" } },
  ];
  const report = buildReport({ corpus, results, competitorResults });
  assert.equal(report.byCompetitor.perfect.matchedExpectedClean, 2);
  assert.equal(report.byCompetitor.perfect.matchRate, 100);
});
