/**
 * MUGA — Param breakdown view-model (#986, #1400, #1445).
 *
 * Pure view-model for the "why was this cleaned?" tracking-param breakdown
 * (popup glance, Settings Activity ledger, web tool) and for the category
 * rows in Settings > Tracking categories. Groups the removed tracking-param
 * names by category and resolves each category's localized label and
 * description.
 *
 * Why a separate module: popup.js and options.js are browser-only (DOM,
 * chrome.*) and cannot be exercised under node:test, so the grouping and
 * lang-resolution logic lives here, where it is unit-tested, and the pages
 * keep only a thin DOM shell. Precedent: remote-rules-changelog-view.js
 * (#984) and attribution-ledger-view.js.
 *
 * #1400: category names and descriptions live in the locale files. Each
 * TRACKING_PARAM_CATEGORIES entry names its `labelKey` / `descriptionKey`
 * and keeps its English `label` / `description` only as the fallback for a
 * translator that does not know the key (the English-only web tool). Every
 * UI language resolves through the same path, so the locale key-parity
 * tests enforce completeness; before, only es/pt/de had translations.
 *
 * #1445: the reverse index is built here, once, instead of by three
 * hand-copied loops (popup.js, options.js, web/param-insight.js). It takes
 * the taxonomy as an argument so this module keeps ZERO imports: it is
 * byte-mirrored into web/engine/param-breakdown-view.gen.mjs by
 * `npm run build:web`.
 */

/**
 * @typedef {{
 *   label: string, description?: string,
 *   labelKey?: string, descriptionKey?: string,
 *   params?: string[],
 * }} CategoryData
 *
 * @typedef {{
 *   categoryKey: string, label: string, description: string|null,
 *   labelKey?: string, descriptionKey?: string,
 * }} ParamIndexEntry
 *
 * @typedef {(key: string, lang: string) => (string|undefined)} Translate
 */

/**
 * Builds the reverse index: lowercase param name -> category info.
 *
 * @param {Record<string, CategoryData>|undefined} categories - TRACKING_PARAM_CATEGORIES.
 * @returns {Map<string, ParamIndexEntry>}
 */
export function buildParamIndex(categories) {
  const index = new Map();
  for (const [categoryKey, cat] of Object.entries(categories || {})) {
    for (const param of cat.params || []) {
      index.set(param.toLowerCase(), {
        categoryKey,
        label: cat.label,
        description: cat.description ?? null,
        labelKey: cat.labelKey,
        descriptionKey: cat.descriptionKey,
      });
    }
  }
  return index;
}

/**
 * A translation, or null when the translator does not know the key
 * (returns nothing, an empty string, or the key itself the way t() does).
 *
 * @param {Translate|undefined} translate
 * @param {string|undefined} key
 * @param {string} lang
 * @returns {string|null}
 */
function lookup(translate, key, lang) {
  if (!key || typeof translate !== "function") return null;
  const value = translate(key, lang);
  return typeof value === "string" && value !== "" && value !== key ? value : null;
}

/**
 * Localized label + description of one category, with the English data as
 * the fallback.
 *
 * @param {{ label: string, description?: string|null, labelKey?: string, descriptionKey?: string }} cat
 * @param {string} lang
 * @param {Translate} [translate] - i18n t()-shaped function.
 * @returns {{ label: string, description: string|null }}
 */
export function resolveCategoryText(cat, lang, translate) {
  return {
    label: lookup(translate, cat.labelKey, lang) || cat.label,
    description: lookup(translate, cat.descriptionKey, lang) || cat.description || null,
  };
}

/**
 * @param {string[]} removedTracking - Tracking param names removed from the URL.
 * @param {string} lang - "es" | "pt" | "de" | "fr" | "it" | "ja" | "en"
 * @param {Map<string, ParamIndexEntry>} paramIndex - as built by buildParamIndex().
 * @param {Translate} translate - i18n t()-shaped function. Resolves the
 *   category keys and labels the "other" bucket (`param_category_other`)
 *   for params not found in paramIndex.
 * @returns {{ categoryKey: string, label: string, description: string|null, params: string[] }[]}
 */
export function buildParamBreakdownView(removedTracking, lang, paramIndex, translate) {
  if (!Array.isArray(removedTracking) || removedTracking.length === 0) return [];

  const groups = new Map(); // categoryKey -> { categoryKey, label, description, params }

  for (const param of removedTracking) {
    const info = paramIndex.get(param.toLowerCase());
    const catKey = info ? info.categoryKey : "other";

    if (!groups.has(catKey)) {
      // Unknown params have no category data at all, so no description exists
      // to show: "other" rows render label + params only.
      const { label, description } = info
        ? resolveCategoryText(info, lang, translate)
        : { label: lookup(translate, "param_category_other", lang) || "Other", description: null };
      groups.set(catKey, { categoryKey: catKey, label, description, params: [] });
    }
    groups.get(catKey).params.push(param);
  }

  return [...groups.values()];
}
