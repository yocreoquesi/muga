/**
 * Tests for the retirement of the popup report button + showReportButton
 * pref (#1355, #1354; ADR-0011 internal-with-a-default).
 *
 * Reporting a problem now lives in Settings (#1353, section-report), which
 * every user can reach. The popup's own report flow — a display sub-toggle
 * for one button, hidden behind a pref most users never set — is retired
 * entirely: no #report-broken link, no #report-include-url-row, no
 * showReportButton pref, no report_dirty_url i18n key.
 *
 * Formerly (superseded by this file, kept as history):
 *   T2-1: Flag `showReportButton` exists in PREF_DEFAULTS and defaults to true
 *   T2-4: popup.js source does NOT gate #report-broken visibility on prefs.devMode
 *   T2-5: TRANSLATIONS has `report_dirty_url` key with both `en` and `es`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

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
const { planImport } = await import("../../src/lib/settings-schema.js");

const popupJs = readFileSync(join(root, "src/popup/popup.js"), "utf8");
const popupHtml = readFileSync(join(root, "src/popup/popup.html"), "utf8");

// ── PREF_DEFAULTS ─────────────────────────────────────────────────────────────

test("showReportButton is retired: not in PREF_DEFAULTS", () => {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "showReportButton"),
    "PREF_DEFAULTS must not have a showReportButton key"
  );
});

// ── popup markup + source ────────────────────────────────────────────────────

test("popup.html has no #report-broken link", () => {
  assert.ok(!popupHtml.includes('id="report-broken"'));
});

test("popup.html has no #report-include-url-row", () => {
  assert.ok(!popupHtml.includes('id="report-include-url-row"'));
});

test("popup.js no longer references prefs.showReportButton", () => {
  assert.ok(!popupJs.includes("prefs.showReportButton"));
});

test("popup.js no longer references the retired report-broken DOM id", () => {
  assert.ok(!popupJs.includes('"report-broken"'));
});

// ── i18n ─────────────────────────────────────────────────────────────────────

test("report_dirty_url i18n key is retired (it named only the removed popup link)", () => {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_dirty_url"),
    "TRANSLATIONS must not have report_dirty_url — it was only used by the retired popup report link"
  );
});

test("report_include_full_url_label/hint survive (still used by the Settings/dev report flow)", () => {
  assert.ok(Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_include_full_url_label"));
  assert.ok(Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_include_full_url_hint"));
});

// ── import tolerance ─────────────────────────────────────────────────────────

test("a legacy export carrying showReportButton imports cleanly (key ignored, no throw)", () => {
  const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [], showReportButton: true });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.toSave.showReportButton, undefined);
});
