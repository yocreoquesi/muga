/**
 * MUGA — Unit tests for buildParamBreakdownView (src/lib/param-breakdown-view.js) (#986)
 *
 * Run with: node --test tests/unit/param-breakdown-view.test.mjs
 *
 * Locks the grouping + lang-resolution logic for the popup's "why was this
 * cleaned?" category breakdown, extracted out of the browser-only
 * _renderParamBreakdown() in src/popup/popup.js so it can be unit-tested.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildParamBreakdownView } from "../../src/lib/param-breakdown-view.js";

/** Fake reverse index mirroring what popup.js's _buildParamIndex() builds. */
const INDEX = new Map([
  ["utm_source", {
    categoryKey: "utm",
    label: "UTM / Campaign",
    labelEs: "UTM / Campaña",
    labelPt: "UTM / Campanha",
    labelDe: "UTM / Kampagne",
    description: "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
    descriptionEs: "Parámetros UTM de Google Analytics",
    descriptionPt: "Parâmetros UTM do Google Analytics",
    descriptionDe: "Google Analytics UTM-Parameter",
  }],
  ["utm_medium", {
    categoryKey: "utm",
    label: "UTM / Campaign",
    labelEs: "UTM / Campaña",
    labelPt: "UTM / Campanha",
    labelDe: "UTM / Kampagne",
    description: "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
    descriptionEs: "Parámetros UTM de Google Analytics",
    descriptionPt: "Parâmetros UTM do Google Analytics",
    descriptionDe: "Google Analytics UTM-Parameter",
  }],
  ["fbclid", {
    categoryKey: "ads_click_ids",
    label: "Paid Ads Clicks",
    labelEs: "Clics de publicidad",
    labelPt: "Cliques de anúncios",
    labelDe: "Bezahlte Werbeklicks",
    description: "Click IDs from Google Ads, Facebook, TikTok, LinkedIn, Microsoft, Twitter, etc.",
    descriptionEs: "IDs de clic de Google Ads, Facebook, TikTok, etc.",
    descriptionPt: "IDs de clique do Google Ads, Facebook, TikTok, etc.",
    descriptionDe: "Klick-IDs von Google Ads, Facebook, TikTok, etc.",
  }],
]);

/** Fake t()-shaped translator for the "other" category label. */
function translateOther(key, lang) {
  const table = {
    en: "Other tracking",
    es: "Otro rastreo",
  };
  return table[lang] || table.en;
}

describe("buildParamBreakdownView — pure view-model for the #986 param breakdown", () => {
  test("empty input → empty array", () => {
    assert.deepEqual(buildParamBreakdownView([], "en", INDEX, translateOther), []);
    assert.deepEqual(buildParamBreakdownView(undefined, "en", INDEX, translateOther), []);
  });

  test("correct grouping: params from the same category collapse into one row", () => {
    const rows = buildParamBreakdownView(["utm_source", "utm_medium"], "en", INDEX, translateOther);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].categoryKey, "utm");
    assert.strictEqual(rows[0].label, "UTM / Campaign");
    assert.deepEqual(rows[0].params, ["utm_source", "utm_medium"]);
  });

  test("distinct categories produce distinct rows, in first-seen order", () => {
    const rows = buildParamBreakdownView(["fbclid", "utm_source"], "en", INDEX, translateOther);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].categoryKey, "ads_click_ids");
    assert.strictEqual(rows[1].categoryKey, "utm");
  });

  test("lang resolution: es returns descriptionEs and labelEs", () => {
    const rows = buildParamBreakdownView(["utm_source"], "es", INDEX, translateOther);
    assert.strictEqual(rows[0].label, "UTM / Campaña");
    assert.strictEqual(rows[0].description, "Parámetros UTM de Google Analytics");
  });

  test("lang resolution: pt and de also resolve to their localized description", () => {
    const pt = buildParamBreakdownView(["fbclid"], "pt", INDEX, translateOther);
    assert.strictEqual(pt[0].description, "IDs de clique do Google Ads, Facebook, TikTok, etc.");

    const de = buildParamBreakdownView(["fbclid"], "de", INDEX, translateOther);
    assert.strictEqual(de[0].description, "Klick-IDs von Google Ads, Facebook, TikTok, etc.");
  });

  test("unknown lang (e.g. fr/it/ja) falls back to the English description", () => {
    for (const lang of ["fr", "it", "ja", "xx"]) {
      const rows = buildParamBreakdownView(["utm_source"], lang, INDEX, translateOther);
      assert.strictEqual(rows[0].label, "UTM / Campaign", `label fallback for ${lang}`);
      assert.strictEqual(
        rows[0].description,
        "Google Analytics UTM parameters (utm_source, utm_medium, etc.)",
        `description fallback for ${lang}`
      );
    }
  });

  test("unknown param → 'other' category, translated label, no description", () => {
    const rows = buildParamBreakdownView(["some_mystery_param"], "en", INDEX, translateOther);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].categoryKey, "other");
    assert.strictEqual(rows[0].label, "Other tracking");
    assert.strictEqual(rows[0].description, null);
    assert.deepEqual(rows[0].params, ["some_mystery_param"]);
  });

  test("unknown param label is also localized via the translate callback (es)", () => {
    const rows = buildParamBreakdownView(["some_mystery_param"], "es", INDEX, translateOther);
    assert.strictEqual(rows[0].label, "Otro rastreo");
    assert.strictEqual(rows[0].description, null);
  });

  test("param lookup is case-insensitive", () => {
    const rows = buildParamBreakdownView(["UTM_SOURCE"], "en", INDEX, translateOther);
    assert.strictEqual(rows[0].categoryKey, "utm");
    assert.deepEqual(rows[0].params, ["UTM_SOURCE"], "original casing is preserved in the displayed param list");
  });

  test("known params without a localized field fall back to the English description", () => {
    const indexNoEs = new Map([
      ["x_param", {
        categoryKey: "misc",
        label: "Misc",
        description: "English only description.",
      }],
    ]);
    const rows = buildParamBreakdownView(["x_param"], "es", indexNoEs, translateOther);
    assert.strictEqual(rows[0].description, "English only description.");
  });
});
