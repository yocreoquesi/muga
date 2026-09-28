/**
 * MUGA — Structural guard: popup.js wiring for the #1496 DNR-visibility
 * feature actually calls the pure view-model functions it depends on.
 *
 * Run with: npm test
 *
 * popup.js is browser-only (uses `document`, `chrome.tabs`, `chrome.storage`)
 * and cannot be exercised under node:test, and opening it in Playwright as a
 * plain tab does not grant `activeTab` for a real content tab the way the
 * native extension-action popup does (chrome.tabs.query({active:true})
 * resolves to the popup's OWN chrome-extension:// tab in that harness, which
 * popup.js's own guard excludes — see showUrlPreview's early return and the
 * existing e2e test "preview section is hidden on blank popup"). There is no
 * way to simulate the real activeTab grant this feature depends on in
 * Playwright today, and the module cannot be imported in Node (top-level
 * `document`/`chrome.tabs` access) — the #824 source-grep ratchet's own
 * documented exemption criteria (see BASELINE entry in
 * source-grep-ratchet.test.mjs).
 *
 * All DECISION LOGIC this file's assertions lean on is fully behaviorally
 * tested in dnr-visibility-view.test.mjs (planDnrVisibilityView,
 * planTabBadgeView, shouldShowStatsDnrNote — including the JS-over-DNR
 * priority and the linkCleaned/cleaned distinction this file only confirms
 * is WIRED, not re-verifying the logic itself). Kept intentionally small —
 * one assertion per acceptance criterion, not one per implementation detail
 * — to keep the #824 footprint minimal.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
const cleanerSrc = readFileSync(resolve(root, "src/content/cleaner.js"), "utf8");

describe("#1496 popup wiring (structural — see file doc for why)", () => {
  test("the tab-badge chip's JS-vs-DNR source priority is delegated to planTabBadgeView(), not reimplemented inline", () => {
    assert.match(
      popupSrc,
      /planTabBadgeView\(\s*sessionData\[key\]\s*,\s*dnrView\s*\)/,
      "showUrlPreview must call planTabBadgeView(sessionData[key], dnrView) for the tab-badge chip"
    );
  });

  test("preview_dnr_cleaned is gated on dnrView?.linkCleaned specifically, not the broader cleaned/count", () => {
    const fnIdx = popupSrc.indexOf("function renderCountCelebration");
    const nextFnIdx = popupSrc.indexOf("\nfunction ", fnIdx + 10);
    const fnBody = popupSrc.slice(fnIdx, nextFnIdx === -1 ? fnIdx + 6000 : nextFnIdx);
    const ternary = fnBody.match(/el\.textContent\s*=\s*dnrView\?\.(\w+)[\s\S]{0,80}?preview_dnr_cleaned/);
    assert.ok(ternary, "expected `dnrView?.<field> ? preview_dnr_cleaned : ...` inside renderCountCelebration");
    assert.strictEqual(ternary[1], "linkCleaned", "must test dnrView?.linkCleaned — a regression to dnrView?.cleaned would re-open the review finding");
  });

  test("getDnrVisibilityView requires a numeric minTimeStamp and forwards it to getMatchedRules", () => {
    assert.match(
      popupSrc,
      /getMatchedRules\(\s*\{\s*tabId\s*,\s*minTimeStamp\s*\}\s*\)/,
      "must call getMatchedRules({ tabId, minTimeStamp }), not { tabId } alone"
    );
  });

  test("the stats-dnr-note visibility is delegated to shouldShowStatsDnrNote(), not reimplemented inline", () => {
    assert.match(
      popupSrc,
      /shouldShowStatsDnrNote\(\s*\{\s*hasDnrMatching:\s*hasChromeDnrMatching\s*,\s*isFresh:\s*isFreshInstall\(local\.stats\)\s*\}\s*\)/,
      "init() must call shouldShowStatsDnrNote({ hasDnrMatching, isFresh }) for #stats-dnr-note"
    );
  });

  test("the content script's GET_REFERRER reply carries performance.timeOrigin, which getDnrVisibilityView needs", () => {
    const idx = cleanerSrc.indexOf('message.type === "GET_REFERRER"');
    assert.ok(idx >= 0, "cleaner.js must still handle GET_REFERRER");
    assert.match(cleanerSrc.slice(idx, idx + 400), /timeOrigin:\s*performance\.timeOrigin/);
  });
});
