/**
 * MUGA: Onboarding creator-affiliate choice copy (#1503)
 *
 * Every key of the onboarding affiliate choice ships in all supported
 * locales, never uses an em-dash, and says why creator tags are kept.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

// ── Copy ──────────────────────────────────────────────────────────────────

const COPY_KEYS = [
  "ob_affiliate_title",
  "ob_affiliate_desc",
  "ob_affiliate_legend",
  "ob_affiliate_keep_label",
  "ob_affiliate_keep_hint",
  "ob_affiliate_remove_label",
  "ob_affiliate_remove_hint",
  "ob_affiliate_save_error",
];

describe("#1503 — affiliate choice copy", () => {
  for (const key of COPY_KEYS) {
    test(`${key} is translated in every supported locale, without em-dashes`, () => {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `TRANSLATIONS["${key}"] is missing`);
      for (const { code } of SUPPORTED_LANGS) {
        const value = entry[code];
        assert.ok(typeof value === "string" && value.trim().length > 0, `${key}.${code} must be non-empty`);
        assert.ok(!value.includes("—"), `${key}.${code} must not contain an em-dash`);
      }
    });
  }

  test("the description says why tags are kept and that MUGA never adds its own", () => {
    const en = TRANSLATIONS.ob_affiliate_desc.en;
    assert.match(en, /credit/i);
    assert.match(en, /never adds/i);
    assert.match(en, /URL/, "copy keeps the URL-cleaner identity");
  });
});
