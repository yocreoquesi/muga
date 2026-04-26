/**
 * Tests for report button feature flag and i18n key.
 *
 * T2-1: Flag `showReportButton` exists in PREF_DEFAULTS and defaults to true
 * T2-4: popup.js source does NOT gate #report-broken visibility on prefs.devMode
 * T2-5: TRANSLATIONS has `report_dirty_url` key with both `en` and `es`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ── Import source modules ────────────────────────────────────────────────────

// storage.js uses chrome.* APIs at module level (the shim IIFE and the
// onSuspend listener). Provide a minimal stub so the module can be imported
// in a Node.js test environment without crashing.
import { makeChromeMock } from "./helpers/chrome-stub.mjs";
// Promise shape, session explicitly absent (undefined) — matches original behaviour
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
const { TRANSLATIONS } = await import("../../src/lib/i18n.js");

// ── T2-1: showReportButton flag ──────────────────────────────────────────────

test("T2-1: PREF_DEFAULTS has showReportButton defaulting to true", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "showReportButton"),
    "PREF_DEFAULTS must have a showReportButton key"
  );
  assert.strictEqual(
    PREF_DEFAULTS.showReportButton,
    true,
    "showReportButton must default to true"
  );
});

// ── T2-4: popup.js source must not gate report-broken on prefs.devMode ───────

test("T2-4: popup.js does not gate #report-broken visibility on prefs.devMode", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  // The only acceptable devMode reference is unrelated to the report button.
  // We look for the specific pattern that would gate report visibility on devMode.
  // Pattern: prefs.devMode inside a block that also references report-broken or reportLink.
  // Simplest static check: the string `prefs.devMode` must not appear in proximity
  // to `report-broken` or `reportLink` (within 300 chars of each other).

  const devModeIdx = popupSrc.indexOf("prefs.devMode");
  if (devModeIdx === -1) {
    // No devMode gating at all — test passes
    return;
  }

  // Check all occurrences of prefs.devMode
  let searchFrom = 0;
  while (true) {
    const idx = popupSrc.indexOf("prefs.devMode", searchFrom);
    if (idx === -1) break;

    // Extract a window of 300 chars around the occurrence
    const window = popupSrc.slice(Math.max(0, idx - 150), idx + 150);
    assert.ok(
      !window.includes("report-broken") && !window.includes("reportLink"),
      `prefs.devMode must not gate the report button. Found proximity at char ${idx}:\n${window}`
    );
    searchFrom = idx + 1;
  }
});

// ── T2-5: TRANSLATIONS has report_dirty_url with en and es ──────────────────

test("T2-5: TRANSLATIONS has report_dirty_url key with en and es", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_dirty_url"),
    "TRANSLATIONS must have a report_dirty_url key"
  );
  assert.ok(
    typeof TRANSLATIONS.report_dirty_url.en === "string" && TRANSLATIONS.report_dirty_url.en.length > 0,
    "report_dirty_url must have a non-empty `en` translation"
  );
  assert.ok(
    typeof TRANSLATIONS.report_dirty_url.es === "string" && TRANSLATIONS.report_dirty_url.es.length > 0,
    "report_dirty_url must have a non-empty `es` translation"
  );
});

// ── Unclean URL collaborative report (#271) ──────────────────────────────────

test("U-1: TRANSLATIONS has report_unclean_url key with en and es", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_unclean_url"),
    "TRANSLATIONS must have a report_unclean_url key"
  );
  assert.ok(
    typeof TRANSLATIONS.report_unclean_url.en === "string" && TRANSLATIONS.report_unclean_url.en.length > 0,
    "report_unclean_url must have a non-empty `en` translation"
  );
  assert.ok(
    typeof TRANSLATIONS.report_unclean_url.es === "string" && TRANSLATIONS.report_unclean_url.es.length > 0,
    "report_unclean_url must have a non-empty `es` translation"
  );
});

test("U-2: popup.html exposes #report-unclean inside #preview", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  // The link must exist in the document
  assert.match(
    html,
    /id="report-unclean"/,
    "popup.html must contain an element with id report-unclean"
  );
  // It must declare the i18n key so labels stay localized
  assert.match(
    html,
    /id="report-unclean"[^>]*data-i18n="report_unclean_url"/,
    "#report-unclean must use data-i18n=\"report_unclean_url\""
  );
  // It must live inside the #preview section so it inherits the same gating surface
  // as #report-broken. We do a coarse check: the closing </section> for preview
  // must come AFTER the #report-unclean opening tag.
  const previewOpenIdx = html.indexOf('id="preview"');
  const reportIdx = html.indexOf('id="report-unclean"');
  const previewCloseIdx = html.indexOf("</section>", previewOpenIdx);
  assert.ok(
    previewOpenIdx !== -1 && reportIdx !== -1 && previewCloseIdx !== -1,
    "preview section and report-unclean must both exist"
  );
  assert.ok(
    reportIdx > previewOpenIdx && reportIdx < previewCloseIdx,
    "#report-unclean must live inside the #preview section"
  );
});

test("U-3: popup.js builds an unclean-url GitHub issue with hostname only", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  // The new label must be wired
  assert.ok(
    popupSrc.includes("labels=unclean-url"),
    "popup.js must open a GitHub issue with labels=unclean-url"
  );

  // Anchor on a literal unique to the unclean-url handler so we do not pick up
  // unrelated occurrences elsewhere in the file (e.g. the reset helper).
  const titleAnchor = popupSrc.indexOf("[Unclean URL]");
  assert.ok(titleAnchor !== -1, "popup.js must build a [Unclean URL] issue title");
  const labelIdx = popupSrc.indexOf("labels=unclean-url", titleAnchor);
  assert.ok(labelIdx !== -1, "labels=unclean-url must follow the [Unclean URL] title");
  const handlerSlice = popupSrc.slice(titleAnchor, labelIdx + 50);

  // The body must NOT serialize the full URL — only the hostname.
  // We assert that the slice does not push `url` (the raw tab URL) into the body
  // and does not push `result.cleanUrl` either.
  // The handler IS allowed to call new URL(url).hostname — that is fine. The forbidden
  // pattern is interpolating the bare `url` variable into the issue body or title.
  assert.ok(
    !/\$\{url\}/.test(handlerSlice),
    "unclean-url handler must not interpolate the full URL (${url}) into the issue payload"
  );
  assert.ok(
    !/result\.cleanUrl/.test(handlerSlice),
    "unclean-url handler must not include result.cleanUrl in the issue payload"
  );
});

test("U-4: _resetPreviewDom hides #report-unclean", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  const fnIdx = popupSrc.indexOf("function _resetPreviewDom");
  assert.ok(fnIdx !== -1, "popup.js must define _resetPreviewDom");

  // The function body ends at the next top-level closing brace at column 0.
  // Coarse check: take a 2000-char window and assert the reset clears report-unclean.
  const slice = popupSrc.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    slice.includes("report-unclean"),
    "_resetPreviewDom must reset the #report-unclean link to hidden"
  );
});
