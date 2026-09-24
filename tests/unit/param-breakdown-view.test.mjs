/**
 * MUGA — Unit tests for src/lib/param-breakdown-view.js (#986, #1400, #1445)
 *
 * Run with: node --test tests/unit/param-breakdown-view.test.mjs
 *
 * Locks the grouping + lang-resolution logic behind the "why was this
 * cleaned?" category breakdown (popup, Settings Activity, web tool) and the
 * Settings "Tracking categories" rows. Category names and descriptions live
 * in the locale files (#1400), so every UI language resolves through the
 * same path and the locale key-parity tests enforce completeness; before,
 * only es/pt/de had translations and fr/it/ja showed English. The reverse
 * index is built by ONE pure function here (#1445) instead of three copies.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildParamBreakdownView,
  buildParamIndex,
  resolveCategoryText,
} from "../../src/lib/param-breakdown-view.js";
import { TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";
import { t, TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const LANGS = SUPPORTED_LANGS.map(({ code }) => code);
const INDEX = buildParamIndex(TRACKING_PARAM_CATEGORIES);

describe("buildParamIndex — one pure reverse index for every surface (#1445)", () => {
  test("maps every category param (lowercased) to its category", () => {
    for (const [categoryKey, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      for (const param of cat.params) {
        assert.equal(INDEX.get(param.toLowerCase())?.categoryKey, categoryKey, param);
      }
    }
  });

  test("tolerates a missing or empty taxonomy", () => {
    assert.equal(buildParamIndex(undefined).size, 0);
    assert.equal(buildParamIndex({}).size, 0);
  });
});

describe("category names are translated in every UI language (#1400)", () => {
  test("every category names its label and description keys", () => {
    for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      assert.equal(typeof cat.labelKey, "string", `${key}.labelKey`);
      assert.equal(typeof cat.descriptionKey, "string", `${key}.descriptionKey`);
    }
  });

  for (const lang of LANGS) {
    test(`${lang}: every category resolves to that locale's own strings`, () => {
      for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
        const { label, description } = resolveCategoryText(cat, lang, t);
        assert.equal(label, TRANSLATIONS[cat.labelKey][lang], `${key} label in ${lang}`);
        assert.equal(description, TRANSLATIONS[cat.descriptionKey][lang], `${key} description in ${lang}`);
      }
    });
  }

  for (const lang of ["fr", "it", "ja"]) {
    test(`${lang}: category names are no longer the English ones`, () => {
      for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
        const { description } = resolveCategoryText(cat, lang, t);
        assert.notEqual(description, TRANSLATIONS[cat.descriptionKey].en, `${key} description in ${lang}`);
      }
    });
  }

  test("the per-language fields are gone from the data (locale files own the copy)", () => {
    for (const cat of Object.values(TRACKING_PARAM_CATEGORIES)) {
      for (const field of ["labelEs", "labelPt", "labelDe", "descriptionEs", "descriptionPt", "descriptionDe"]) {
        assert.equal(cat[field], undefined, field);
      }
    }
  });

  test("the English data strings equal the en locale (single meaning, English fallback)", () => {
    for (const cat of Object.values(TRACKING_PARAM_CATEGORIES)) {
      assert.equal(cat.label, TRANSLATIONS[cat.labelKey].en);
      assert.equal(cat.description, TRANSLATIONS[cat.descriptionKey].en);
    }
  });

  test("the retired, never-read param_category_* keys are gone", () => {
    for (const key of ["analytics", "social", "advertising", "email", "affiliate", "marketplace", "ecommerce"]) {
      assert.equal(TRANSLATIONS[`param_category_${key}`], undefined, key);
    }
    assert.ok(TRANSLATIONS.param_category_other, "param_category_other is still used for unknown params");
  });
});

describe("buildParamBreakdownView — grouping and resolution", () => {
  test("empty input → empty array", () => {
    assert.deepEqual(buildParamBreakdownView([], "en", INDEX, t), []);
    assert.deepEqual(buildParamBreakdownView(undefined, "en", INDEX, t), []);
  });

  test("params from the same category collapse into one row", () => {
    const rows = buildParamBreakdownView(["utm_source", "utm_medium"], "en", INDEX, t);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].categoryKey, "utm");
    assert.equal(rows[0].label, "UTM / Campaign");
    assert.deepEqual(rows[0].params, ["utm_source", "utm_medium"]);
  });

  test("distinct categories produce distinct rows, in first-seen order", () => {
    const rows = buildParamBreakdownView(["fbclid", "utm_source"], "en", INDEX, t);
    assert.deepEqual(rows.map((r) => r.categoryKey), ["ads", "utm"]);
  });

  test("fr resolves the row label and description from the fr locale", () => {
    const [row] = buildParamBreakdownView(["utm_source"], "fr", INDEX, t);
    assert.equal(row.label, TRANSLATIONS.category_utm_label.fr);
    assert.equal(row.description, TRANSLATIONS.category_utm_desc.fr);
  });

  test("unknown param → 'other' row, translated label, no description", () => {
    const [row] = buildParamBreakdownView(["some_mystery_param"], "es", INDEX, t);
    assert.equal(row.categoryKey, "other");
    assert.equal(row.label, TRANSLATIONS.param_category_other.es);
    assert.equal(row.description, null);
  });

  test("param lookup is case-insensitive and keeps the original casing", () => {
    const [row] = buildParamBreakdownView(["UTM_SOURCE"], "en", INDEX, t);
    assert.equal(row.categoryKey, "utm");
    assert.deepEqual(row.params, ["UTM_SOURCE"]);
  });

  test("a translator that knows no category keys falls back to the English data (web tool)", () => {
    const englishOnly = (key) => (key === "param_category_other" ? "Other" : undefined);
    const rows = buildParamBreakdownView(["utm_source", "zzz"], "en", INDEX, englishOnly);
    assert.equal(rows[0].label, TRACKING_PARAM_CATEGORIES.utm.label);
    assert.equal(rows[0].description, TRACKING_PARAM_CATEGORIES.utm.description);
    assert.equal(rows[1].label, "Other");
  });

  test("a translator that echoes a missing key back (like t()) also falls back", () => {
    const echo = (key) => key;
    const [row] = buildParamBreakdownView(["utm_source"], "en", INDEX, echo);
    assert.equal(row.label, TRACKING_PARAM_CATEGORIES.utm.label);
  });
});
