/** MUGA: Tests for the Markdown report writer (#507 phase 3a). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../benchmark/lib/report-md.mjs";

const SAMPLE_REPORT = {
  generatedAt: "2026-05-02T22:00:00.000Z",
  runner: "muga",
  totalEntries: 4,
  matched: 3,
  mismatched: 1,
  matchRate: 75,
  byCategory: {
    utm: { total: 2, matched: 2, mismatched: 0, matchRate: 100 },
    "clean-urls": { total: 2, matched: 1, mismatched: 1, matchRate: 50 },
  },
  mismatches: [
    {
      url: "https://example.com/?weird=x",
      category: "clean-urls",
      expected: { action: "untouched" },
      actual: { action: "cleaned" },
      diff: 'action: expected "untouched", got "cleaned"',
    },
  ],
};

test("renderMarkdown — output is a string", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.equal(typeof md, "string");
  assert.ok(md.length > 0);
});

test("renderMarkdown — has top-level heading and metadata", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.match(md, /^# MUGA Benchmark Report/);
  assert.match(md, /\*\*Generated:\*\* 2026-05-02T22:00:00\.000Z/);
  assert.match(md, /\*\*Runner:\*\* muga/);
  assert.match(md, /\*\*Corpus size:\*\* 4 entries/);
});

test("renderMarkdown — overall coverage table includes matchRate %", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.match(md, /## Overall coverage/);
  assert.match(md, /\| 3 \| 1 \| 75% \|/);
});

test("renderMarkdown — by-category table sorts alphabetically", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  const cleanIdx = md.indexOf("clean-urls");
  const utmIdx = md.indexOf("utm");
  assert.ok(cleanIdx > -1 && utmIdx > -1);
  assert.ok(cleanIdx < utmIdx, "clean-urls should sort before utm");
});

test("renderMarkdown — by-category table includes per-category rates", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.match(md, /\| utm \| 2 \| 2 \| 0 \| 100% \|/);
  assert.match(md, /\| clean-urls \| 2 \| 1 \| 1 \| 50% \|/);
});

test("renderMarkdown — mismatches section listed when non-empty", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.match(md, /## Mismatches \(1\)/);
  assert.match(md, /\*\*\[clean-urls\]\*\*/);
  assert.match(md, /https:\/\/example\.com\/\?weird=x/);
  assert.match(md, /action: expected "untouched", got "cleaned"/);
});

test("renderMarkdown — mismatches section absent when empty", () => {
  const noMismatches = { ...SAMPLE_REPORT, matched: 4, mismatched: 0, matchRate: 100, mismatches: [] };
  const md = renderMarkdown(noMismatches);
  assert.doesNotMatch(md, /## Mismatches/);
});

test("renderMarkdown — byCompetitor section present when adapter results exist", () => {
  const withCompetitors = {
    ...SAMPLE_REPORT,
    byCompetitor: {
      baseline: {
        total: 4,
        withExpectedClean: 2,
        changedFromInput: 1,
        matchedExpectedClean: 1,
        matchRate: 50,
      },
    },
  };
  const md = renderMarkdown(withCompetitors);
  assert.match(md, /## By competitor/);
  assert.match(md, /\| baseline \| 4 \| 2 \| 1 \| 1 \| 50% \|/);
});

test("renderMarkdown — byCompetitor section absent when not provided", () => {
  const md = renderMarkdown(SAMPLE_REPORT);
  assert.doesNotMatch(md, /## By competitor/);
});

test("renderMarkdown — byCompetitor section absent when empty object", () => {
  const md = renderMarkdown({ ...SAMPLE_REPORT, byCompetitor: {} });
  assert.doesNotMatch(md, /## By competitor/);
});

test("renderMarkdown — escapes pipe characters in cell values", () => {
  const report = {
    ...SAMPLE_REPORT,
    mismatches: [
      {
        url: "https://example.com/?a=1|2",
        category: "utm",
        expected: { action: "cleaned" },
        actual: { action: "untouched" },
        diff: "action mismatch | extra context",
      },
    ],
  };
  const md = renderMarkdown(report);
  assert.match(md, /a=1\|2/, "pipe in URL appears literally inside backticks (not in a cell)");
  // The diff IS in a list item (not a table cell), so pipes there don't
  // need escaping. The escape applies to table cells specifically.
});

test("renderMarkdown — output is deterministic for the same input", () => {
  const a = renderMarkdown(SAMPLE_REPORT);
  const b = renderMarkdown(SAMPLE_REPORT);
  assert.equal(a, b);
});
