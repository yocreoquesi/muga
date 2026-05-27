/**
 * MUGA — Regression tests for the #705 popup re-render leaks.
 *
 * Two invariants are pinned at the source level:
 *
 * 1. `showUrlPreview` clones `#report-broken` before binding the click
 *    listener. Without this, every re-render (init, enabled-toggle, every
 *    `chrome.storage.onChanged` fire) stacks a fresh listener on the same
 *    DOM node, and a single user click opens N GitHub tabs.
 *
 * 2. `_resetPreviewDom` removes any `.preview-breakdown` nodes from
 *    `#preview` before the next render. Without this, the dynamic
 *    `<details>` element gets appended on every render and a user with
 *    `paramBreakdown=true` who flips the enabled toggle sees 2×, 3×, …
 *    copies of the breakdown stacked.
 *
 * Source-level tests rather than DOM-execution tests: popup.js is loaded
 * directly into a browser context and runs against chrome.* APIs we'd
 * otherwise have to stub. The patterns are simple enough that asserting
 * their presence in source catches the regression at CI time. The e2e
 * suite (tests/e2e/popup.spec.mjs) covers the observable behaviour.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POPUP_SOURCE = readFileSync(
  join(__dirname, "../../src/popup/popup.js"),
  "utf8",
);

describe("#705 — popup re-render leaks", () => {
  test("showUrlPreview clones #report-broken before binding the click listener", () => {
    // The clone must precede the addEventListener call. We assert both
    // that a clone exists and that it lives in the report-broken branch.
    const cloneRe = /getElementById\(\s*["']report-broken["']\s*\)\s*[\s\S]{0,200}?cloneNode\s*\(/;
    assert.ok(
      cloneRe.test(POPUP_SOURCE),
      "popup.js must call cloneNode after looking up #report-broken (drops accumulated click listeners on re-render)",
    );
  });

  test("the cloned #report-broken is reinserted via replaceChild", () => {
    assert.ok(
      /replaceChild\(\s*reportLink\s*,\s*oldLink\s*\)/.test(POPUP_SOURCE) ||
        /replaceChild\(\s*\w+,\s*oldLink\s*\)/.test(POPUP_SOURCE),
      "the fresh #report-broken clone must be reinserted into the DOM via replaceChild — otherwise the listener attaches to a detached node",
    );
  });

  test("_resetPreviewDom removes existing .preview-breakdown nodes", () => {
    // The reset must run a query+remove against .preview-breakdown.
    // Tolerant about exact phrasing; strict about the symbols.
    const resetBlock = POPUP_SOURCE.match(
      /function\s+_resetPreviewDom\s*\([\s\S]*?\n\}/,
    );
    assert.ok(resetBlock, "_resetPreviewDom function must exist in popup.js");
    const body = resetBlock[0];
    assert.ok(
      /querySelectorAll\(\s*["']\.preview-breakdown["']\s*\)/.test(body),
      "_resetPreviewDom must querySelectorAll('.preview-breakdown') to find stale dynamic breakdowns",
    );
    assert.ok(
      /\.remove\(\s*\)/.test(body),
      "_resetPreviewDom must call .remove() on the matched .preview-breakdown nodes",
    );
  });

  test("showUrlPreview does NOT re-bind the click listener without cloning first", () => {
    // Negative assertion: locate the report-broken addEventListener call
    // and assert it lives in a clone-then-bind block. We approximate by
    // checking that any addEventListener on a literal `report-broken`
    // lookup is preceded by a cloneNode within a small window.
    const addRe = /(getElementById\(\s*["']report-broken["']\s*\)[\s\S]{0,400}?addEventListener)/g;
    let match;
    while ((match = addRe.exec(POPUP_SOURCE)) !== null) {
      const window = match[1];
      assert.ok(
        /cloneNode/.test(window),
        "every #report-broken addEventListener path must be preceded by cloneNode — otherwise listeners accumulate across re-renders",
      );
    }
  });
});
