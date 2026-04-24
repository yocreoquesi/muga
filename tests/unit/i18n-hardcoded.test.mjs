/**
 * MUGA — i18n hardcoded-string regression tests (Finding 3)
 *
 * Verifies that:
 * 1. Previously hardcoded English strings are replaced with i18n keys.
 * 2. All new i18n keys exist in all 4 locales.
 * 3. share_btn and rate_muga_short are the accessible names for growth buttons
 *    (not hardcoded in HTML).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

const LOCALES = ["en", "es", "pt", "de"];

// ── New keys must exist in all 4 locales ───────────────────────────────────

describe("New i18n keys exist in all 4 locales", () => {
  const newKeys = [
    "ob_save_error",
    "dev_url_error",
    "share_btn_label",
    "dev_nudge_dismiss_btn",
    "dev_nudge_reset_btn",
    "dev_nudge_status",
    "dev_nudge_reset_done",
    "dev_nudge_reset_fresh",
    "rate_muga_short",
  ];

  for (const key of newKeys) {
    test(`"${key}" exists in TRANSLATIONS`, () => {
      assert.ok(TRANSLATIONS[key], `Missing key: ${key}`);
    });

    for (const locale of LOCALES) {
      test(`"${key}" has "${locale}" translation`, () => {
        assert.ok(
          TRANSLATIONS[key]?.[locale],
          `Missing ${locale} translation for key "${key}"`
        );
      });
    }
  }
});

// ── Previously hardcoded strings must NOT appear in source ─────────────────

describe("Previously hardcoded English strings are gone from source", () => {
  const checks = [
    {
      file:    "src/onboarding/onboarding.js",
      literal: "Error — please try again",
      note:    "ob_save_error key must be used instead",
    },
    {
      file:    "src/options/options.js",
      literal: '"Error: "',
      note:    "dev_url_error key must be used instead",
    },
    {
      file:    "src/options/options.js",
      literal: '"Reset counters"',
      note:    "dev_nudge_reset_btn key must be used instead",
    },
    {
      file:    "src/options/options.js",
      literal: '"All nudge counters reset. Ready for testing."',
      note:    "dev_nudge_reset_done key must be used instead",
    },
    {
      file:    "src/options/options.js",
      literal: '"Counters reset to 0. Ready for fresh testing."',
      note:    "dev_nudge_reset_fresh key must be used instead",
    },
    {
      file:    "src/options/options.js",
      literal: '"Dismiss (0/3)"',
      note:    "dev_nudge_dismiss_btn key must be used instead",
    },
  ];

  for (const { file, literal, note } of checks) {
    test(`${file}: does not contain hardcoded "${literal.slice(0, 40)}"`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.ok(
        !source.includes(literal),
        `${file} still contains hardcoded ${literal} — ${note}`
      );
    });
  }
});

// ── Share button: no hardcoded aria-label in HTML ──────────────────────────

describe("Share / rate buttons use data-i18n, not hardcoded text", () => {
  const popupHtml = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");

  test('popup.html: share-btn has no hardcoded aria-label="Share MUGA"', () => {
    assert.ok(
      !popupHtml.includes('id="share-btn" aria-label='),
      'share-btn must not have a hardcoded aria-label — visible text via data-i18n is the accessible name'
    );
  });

  test('popup.html: share-btn has data-i18n="share_btn"', () => {
    assert.ok(
      popupHtml.includes('data-i18n="share_btn"'),
      'share_btn key must be wired with data-i18n on the share button'
    );
  });

  test('popup.html: share emoji is in an aria-hidden span', () => {
    assert.ok(
      popupHtml.includes('aria-hidden="true">📋'),
      'The 📋 emoji must be in an aria-hidden span so screen readers skip it'
    );
  });

  test('popup.html: rate-btn has data-i18n="rate_muga_short"', () => {
    assert.ok(
      popupHtml.includes('data-i18n="rate_muga_short"'),
      'rate_muga_short key must be wired with data-i18n on the rate button'
    );
  });
});
