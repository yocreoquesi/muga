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
globalThis.chrome = {
  storage: {
    sync: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
    },
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
    },
    session: undefined,
  },
  runtime: {
    lastError: null,
    onSuspend: { addListener: () => {} },
  },
};

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
