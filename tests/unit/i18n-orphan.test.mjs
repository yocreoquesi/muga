/**
 * MUGA — i18n orphan-key regression tests (Finding 5)
 *
 * Verifies that:
 * 1. opts_subtitle and ob_tagline have distinct translations for all locales
 *    (not identical English strings for every locale).
 * 2. Every key in TRANSLATIONS is referenced by at least one data-i18n
 *    attribute in HTML or one t("key", ...) / data-i18n-html call in JS/HTML.
 *    This catches future orphaned keys before they accumulate.
 * 3. Specific removed orphan keys are no longer present.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

// ── Brand tagline translations ──────────────────────────────────────────────

describe("Brand taglines are translated for all locales", () => {
  const taglineKeys = ["opts_subtitle", "ob_tagline"];

  for (const key of taglineKeys) {
    test(`"${key}" exists in TRANSLATIONS`, () => {
      assert.ok(TRANSLATIONS[key], `Missing key: ${key}`);
    });

    const locales = ["en", "es", "pt", "de"];
    // All four must be non-empty
    for (const locale of locales) {
      test(`"${key}" has "${locale}" translation`, () => {
        assert.ok(TRANSLATIONS[key][locale], `Missing ${locale} for ${key}`);
      });
    }

    // ES/PT/DE must differ from EN (they are now real translations)
    test(`"${key}" ES translation differs from EN`, () => {
      assert.notEqual(
        TRANSLATIONS[key].es,
        TRANSLATIONS[key].en,
        `${key}.es still equals EN — the tagline should be translated`
      );
    });
    test(`"${key}" PT translation differs from EN`, () => {
      assert.notEqual(
        TRANSLATIONS[key].pt,
        TRANSLATIONS[key].en,
        `${key}.pt still equals EN — the tagline should be translated`
      );
    });
    test(`"${key}" DE translation differs from EN`, () => {
      assert.notEqual(
        TRANSLATIONS[key].de,
        TRANSLATIONS[key].en,
        `${key}.de still equals EN — the tagline should be translated`
      );
    });
  }
});

// ── Removed orphan keys are gone ───────────────────────────────────────────

describe("Orphaned section_* keys removed from TRANSLATIONS", () => {
  const removed = ["section_url_cleaning", "section_privacy", "section_redirects"];

  for (const key of removed) {
    test(`"${key}" is no longer in TRANSLATIONS`, () => {
      assert.ok(
        !TRANSLATIONS[key],
        `"${key}" is still defined but has no DOM reference — it should have been removed`
      );
    });
  }
});

// ── All TRANSLATIONS keys are referenced ───────────────────────────────────

describe("All TRANSLATIONS keys are referenced in HTML or JS", () => {
  // Gather all source files to search
  const srcDir = join(ROOT, "src");
  const extensions = [".html", ".js"];

  function getAllFiles(dir) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...getAllFiles(full));
      else if (extensions.some(ext => entry.name.endsWith(ext)) && !entry.name.includes("browser-polyfill")) {
        results.push(full);
      }
    }
    return results;
  }

  const allSource = getAllFiles(srcDir).map(f => readFileSync(f, "utf8")).join("\n");

  // param_category_* keys (except "other") are kept in TRANSLATIONS as a reference
  // mirror of affiliates.js label values. The breakdown in popup.js reads labelEs/labelPt/labelDe
  // directly from TRACKING_PARAM_CATEGORIES for performance; the i18n keys exist so contributors
  // have one canonical place to update translations. They are verified by param-categories.test.mjs.
  const REFERENCE_ONLY = new Set([
    "param_category_analytics",
    "param_category_social",
    "param_category_advertising",
    "param_category_email",
    "param_category_affiliate",
    "param_category_marketplace",
    "param_category_ecommerce",
  ]);

  for (const key of Object.keys(TRANSLATIONS)) {
    // Skip reference-only keys that are documented as mirror translations
    if (REFERENCE_ONLY.has(key)) continue;

    test(`"${key}" is referenced in source`, () => {
      const hasDataI18n      = allSource.includes(`data-i18n="${key}"`);
      const hasDataI18nHtml  = allSource.includes(`data-i18n-html="${key}"`);
      const hasTCall         = allSource.includes(`t("${key}"`);
      const hasTCallSingle   = allSource.includes(`t('${key}'`);
      const hasStringLiteral = allSource.includes(`"${key}"`); // covers share_seasonal_MMDD, milestone_N etc.

      assert.ok(
        hasDataI18n || hasDataI18nHtml || hasTCall || hasTCallSingle || hasStringLiteral,
        `Key "${key}" is defined in TRANSLATIONS but never referenced in any HTML data-i18n or JS t() call — remove it or wire it`
      );
    });
  }
});
