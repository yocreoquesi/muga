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

const normalized = optionsJs.replace(/\r\n/g, "\n");

function bodyOf(signature, terminator) {
  const start = normalized.indexOf(signature);
  assert.ok(start !== -1, `${signature} must exist`);
  const end = normalized.indexOf(terminator, start);
  return normalized.slice(start, end);
}
const reportCheckBody = () => bodyOf("async function runReportUrlCheck()", "\n  }\n");
// #1444: both URL checks share the clean + render step and the report binding.
const sharedCheckBody = () => bodyOf("async function checkPastedUrl(", "\n}\n");
const wireButtonBody = () => bodyOf("function wireReportButton(", "\n}\n");

describe("#1353 — overlapping report checks do not interleave", () => {
  test("each run takes a fresh number from a counter shared across runs", () => {
    assert.match(optionsJs, /let latestCheck = 0;/);
    assert.match(reportCheckBody(), /const run = \+\+latestCheck;/);
  });

  test("the report card hands its staleness check to the shared step, and stops on a stale run", () => {
    const body = reportCheckBody();
    assert.match(body, /await checkPastedUrl\(url, \{ cleanEl, removedEl \}, isStale\)/);
    assert.ok(
      body.indexOf("if (!checked) return;") < body.indexOf("wireReportButton("),
      "a superseded run must not wire the report button"
    );
  });

  test("the shared step bails out after its awaits, before writing results", () => {
    const body = sharedCheckBody();
    const stale = body.indexOf("if (isStale()) return null;");
    assert.ok(stale !== -1, "checkPastedUrl must check staleness after its awaits");
    assert.ok(stale > body.lastIndexOf("await "), "the check must follow the last await");
    assert.ok(stale < body.indexOf("cleanEl.textContent"), "and come before the result is written");
  });

  test("the report button is re-read by id before it is replaced", () => {
    const body = wireButtonBody();
    const reread = body.indexOf("document.getElementById(buttonId)");
    const replace = body.indexOf("replaceChild(newBtn");
    assert.ok(reread !== -1 && replace !== -1 && reread < replace);
    assert.match(body, /currentBtn\.parentNode\.replaceChild\(newBtn, currentBtn\)/);
  });
});

describe("#1442 — both Settings URL checks read the effective prefs", () => {
  test("the shared step uses getPrefs(), not a raw chrome.storage.sync read", () => {
    const body = sharedCheckBody();
    assert.match(body, /await getPrefs\(\)/);
    assert.doesNotMatch(body, /chrome\.storage\.sync\.get/);
  });
});
