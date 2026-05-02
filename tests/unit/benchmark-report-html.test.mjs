/** MUGA: Tests for the HTML report writer (#507 phase 3b). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderHtml } from "../benchmark/lib/report-html.mjs";

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

test("renderHtml — output is a string", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.equal(typeof html, "string");
  assert.ok(html.length > 0);
});

test("renderHtml — well-formed doctype + html structure", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport"/);
});

test("renderHtml — title carries generatedAt for tab disambiguation", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /<title>MUGA Benchmark Report — 2026-05-02T22:00:00\.000Z<\/title>/);
});

test("renderHtml — heading + meta paragraph rendered", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /<h1>MUGA Benchmark Report<\/h1>/);
  assert.match(html, /Generated: 2026-05-02T22:00:00\.000Z/);
  assert.match(html, /Runner: muga/);
  assert.match(html, /Corpus: 4 entries/);
});

test("renderHtml — overall coverage table rendered with matchRate %", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /<h2>Overall coverage<\/h2>/);
  assert.match(html, /<td>3<\/td><td>1<\/td><td>75%<\/td>/);
});

test("renderHtml — by-category table sorted alphabetically", () => {
  const html = renderHtml(SAMPLE_REPORT);
  const cleanIdx = html.indexOf("<td>clean-urls</td>");
  const utmIdx = html.indexOf("<td>utm</td>");
  assert.ok(cleanIdx > -1 && utmIdx > -1);
  assert.ok(cleanIdx < utmIdx, "clean-urls should sort before utm");
});

test("renderHtml — mismatches details/summary rendered when non-empty", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /<details open><summary>Mismatches \(1\)<\/summary>/);
  assert.match(html, /<strong>\[clean-urls\]<\/strong>/);
  assert.match(html, /<code>https:\/\/example\.com\/\?weird=x<\/code>/);
  assert.match(html, /action: expected &quot;untouched&quot;, got &quot;cleaned&quot;/);
});

test("renderHtml — mismatches section absent when empty", () => {
  const noMismatches = { ...SAMPLE_REPORT, matched: 4, mismatched: 0, matchRate: 100, mismatches: [] };
  const html = renderHtml(noMismatches);
  assert.doesNotMatch(html, /<details/);
});

test("renderHtml — byCompetitor section present when adapter results exist", () => {
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
  const html = renderHtml(withCompetitors);
  assert.match(html, /<h2>By competitor<\/h2>/);
  assert.match(html, /<td>baseline<\/td>/);
  assert.match(html, /<td>50%<\/td>/);
});

test("renderHtml — byCompetitor section absent when not provided", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.doesNotMatch(html, /<h2>By competitor<\/h2>/);
});

test("renderHtml — escapes HTML special chars in cell values (XSS guard)", () => {
  const evil = {
    ...SAMPLE_REPORT,
    mismatches: [
      {
        url: "https://example.com/?x=<script>alert(1)</script>&y=\"a\"",
        category: "utm",
        expected: { action: "cleaned" },
        actual: { action: "untouched" },
        diff: "<img onerror=alert(1)>",
      },
    ],
  };
  const html = renderHtml(evil);
  // Raw <script> must NOT appear unescaped in the body
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  // Should appear escaped instead
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;a&quot;/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
});

test("renderHtml — output is deterministic for the same input", () => {
  const a = renderHtml(SAMPLE_REPORT);
  const b = renderHtml(SAMPLE_REPORT);
  assert.equal(a, b);
});

test("renderHtml — inlines CSS (no external stylesheet links)", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
});

test("renderHtml — supports prefers-color-scheme dark mode in inlined CSS", () => {
  const html = renderHtml(SAMPLE_REPORT);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});
