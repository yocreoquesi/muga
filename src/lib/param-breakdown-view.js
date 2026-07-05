/**
 * MUGA — Param breakdown view-model (#986).
 *
 * Pure view-model for the popup's "why was this cleaned?" tracking-param
 * breakdown. Groups the removed tracking-param names by category and resolves
 * each category's localized label + description, reusing the description*
 * fields TRACKING_PARAM_CATEGORIES already carries (src/lib/affiliates-data.js)
 * but that the popup left unused until now.
 *
 * Why a separate module from the popup glue: popup.js is browser-only (DOM,
 * chrome.*) and cannot be exercised under node:test, so the grouping / lang
 * resolution logic that used to live inline in _renderParamBreakdown was
 * untested. Extracting it here mirrors the precedent set by
 * remote-rules-changelog-view.js (#984) and attribution-ledger-view.js:
 * popup.js's _renderParamBreakdown is now a thin DOM shell that only consumes
 * the rows this function returns.
 *
 * fr/it/ja have no description{Fr,It,Ja} fields in affiliates-data.js yet, so
 * they gracefully fall back to the English `description`. Fast-follow: add
 * native descriptions for those locales once translated copy exists.
 *
 * @param {string[]} removedTracking - Tracking param names removed from the URL.
 * @param {string} lang - "es" | "pt" | "de" | "fr" | "it" | "ja" | "en"
 * @param {Map<string, {
 *   categoryKey: string,
 *   label: string, labelEs?: string, labelPt?: string, labelDe?: string,
 *   description?: string, descriptionEs?: string, descriptionPt?: string, descriptionDe?: string,
 * }>} paramIndex - Reverse index (lowercase param -> category info), as built by popup.js's _buildParamIndex().
 * @param {(key: string, lang: string) => string} translateOther - i18n t()-shaped function used to label the
 *   "other" bucket for params not found in paramIndex (defaults to src/lib/i18n.js's `t`).
 * @returns {{ categoryKey: string, label: string, description: string|null, params: string[] }[]}
 */
export function buildParamBreakdownView(removedTracking, lang, paramIndex, translateOther) {
  if (!Array.isArray(removedTracking) || removedTracking.length === 0) return [];

  const groups = new Map(); // categoryKey -> { categoryKey, label, description, params }

  for (const param of removedTracking) {
    const info = paramIndex.get(param.toLowerCase());
    const catKey = info ? info.categoryKey : "other";

    if (!groups.has(catKey)) {
      const label = info
        ? ({ es: info.labelEs, pt: info.labelPt, de: info.labelDe }[lang] || info.label)
        : translateOther("param_category_other", lang);
      // Unknown params have no category data at all, so no description exists
      // to show — "other" rows render label + params only.
      const description = info
        ? ({ es: info.descriptionEs, pt: info.descriptionPt, de: info.descriptionDe }[lang] || info.description || null)
        : null;
      groups.set(catKey, { categoryKey: catKey, label, description, params: [] });
    }
    groups.get(catKey).params.push(param);
  }

  return [...groups.values()];
}
