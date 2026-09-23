/**
 * MUGA — the Settings report flow ignores superseded checks (#1353)
 *
 * runReportUrlCheck awaits storage, a dynamic import and the remote params
 * before it wires the report button. Two overlapping checks (double click,
 * Enter then click, a second URL before the first finishes) used to both
 * capture the same button node before any await, and the loser could wire a
 * report for the wrong URL. The fix numbers each run and makes a superseded
 * run stop touching the DOM after every await, and re-reads the button by id
 * instead of reusing the node captured before the awaits.
 *
 * options.js is browser-only, so this follows the codebase's source-guard
 * pattern for options wiring (see options-dev-tools-gate.test.mjs).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const optionsJs = readFileSync(new URL("../../src/options/options.js", import.meta.url), "utf8");

function reportCheckBody() {
  const start = optionsJs.indexOf("async function runReportUrlCheck()");
  assert.ok(start !== -1, "runReportUrlCheck must exist");
  const end = optionsJs.indexOf("\n  }\n", start);
  return optionsJs.slice(start, end);
}

describe("#1353 — overlapping report checks do not interleave", () => {
  test("each run takes a fresh number from a counter shared across runs", () => {
    assert.match(optionsJs, /let latestCheck = 0;/);
    assert.match(reportCheckBody(), /const run = \+\+latestCheck;/);
  });

  test("a superseded run bails out after the awaits, before writing results", () => {
    const body = reportCheckBody();
    const staleChecks = body.match(/if \(isStale\(\)\) return;/g) ?? [];
    assert.ok(staleChecks.length >= 2, `expected a staleness check after each await group, found ${staleChecks.length}`);
    assert.ok(
      body.indexOf("if (isStale()) return;") < body.indexOf("cleanEl.textContent"),
      "the first staleness check must come before the result is written"
    );
  });

  test("the report button is re-read by id before it is replaced", () => {
    const body = reportCheckBody();
    const reread = body.lastIndexOf('document.getElementById("report-url-report-btn")');
    const replace = body.indexOf("replaceChild(newBtn");
    assert.ok(reread !== -1 && replace !== -1 && reread < replace);
    assert.match(body, /currentBtn\.parentNode\.replaceChild\(newBtn, currentBtn\)/);
  });
});
