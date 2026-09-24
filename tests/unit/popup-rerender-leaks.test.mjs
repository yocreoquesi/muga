/**
 * MUGA — Regression tests for the #705 popup re-render leaks.
 *
 * `_resetPreviewDom` removes any `.preview-breakdown` nodes from `#preview`
 * before the next render. Without this, the dynamic `<details>` element gets
 * appended on every render and a user who flips the enabled toggle sees
 * 2x, 3x, ... copies of the breakdown stacked.
 *
 * (#1355/#1354: the #705 original also pinned a clone-before-bind pattern
 * for the popup's #report-broken link, which retired along with
 * showReportButton — reporting now lives in Settings. See
 * tests/unit/report-button.test.mjs for the retirement coverage.)
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

  // #1355/#1354: the #report-broken clone-before-bind regression guard
  // retired along with the popup report button itself — see
  // tests/unit/report-button.test.mjs for the retirement coverage, which
  // asserts popup.js no longer references "report-broken" at all.
});

describe("#728 P3 — popup robustness (items 26/27)", () => {
  test("_resetPreviewDom resets #tab-badge so a prior count does not bleed across renders (item 26)", () => {
    const resetBlock = POPUP_SOURCE.match(/function\s+_resetPreviewDom\s*\([\s\S]*?\n\}/);
    assert.ok(resetBlock, "_resetPreviewDom function must exist in popup.js");
    const body = resetBlock[0];
    assert.ok(
      /el\(\s*["']tab-badge["']\s*\)|getElementById\(\s*["']tab-badge["']\s*\)/.test(body),
      "_resetPreviewDom must look up #tab-badge",
    );
    assert.ok(
      /tabBadge\.hidden\s*=\s*true/.test(body),
      "_resetPreviewDom must hide #tab-badge on reset (idempotent-render invariant)",
    );
  });

  test("storage.set writes surface async rejection via .catch, not a sync try/catch (item 27)", () => {
    assert.ok(
      /storage\.sync\.set\(\{ enabled[\s\S]{0,80}?\}\)\.catch\(/.test(POPUP_SOURCE),
      "the enabled-toggle write must chain .catch on the storage.set Promise",
    );
    assert.ok(
      /storage\.local\.set\(\{ nudgeDismissed[\s\S]{0,40}?\}\)\.catch\(/.test(POPUP_SOURCE),
      "the nudge-dismiss write must chain .catch on the storage.set Promise",
    );
    // Neither write may sit inside the old inline `try { chrome.storage.*.set(...) }` —
    // a synchronous try/catch cannot observe the Promise rejection.
    assert.ok(
      !/try\s*\{\s*chrome\.storage\.(?:sync|local)\.set\(/.test(POPUP_SOURCE),
      "no storage.set call may be wrapped in a synchronous try/catch (cannot catch async rejection)",
    );
  });
});
