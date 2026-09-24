/** MUGA: Web-cleaner-tool param insight (sdd/web-cleaning-insight, Slice 1)
 *
 * Pure module: builds the per-parameter what/why breakdown shown below
 * the length-reduction bar, grouping removed tracking params by category
 * (spec "Per-parameter what/why breakdown"). Reuses the SAME index builder
 * and grouping logic the extension uses (buildParamIndex +
 * buildParamBreakdownView, mirrored byte-for-byte from
 * src/lib/param-breakdown-view.js into
 * web/engine/param-breakdown-view.gen.mjs by `npm run build:web`, #1445)
 * against the generated web/engine/param-categories.gen.mjs taxonomy mirror
 * (design D1/D2/D3, sdd/web-cleaning-insight/design).
 *
 * web/index.html is English-only (`lang="en"`), so `translate` knows no
 * locale keys: category rows fall back to the taxonomy's English
 * label/description, and the "other" bucket is always "Other".
 *
 * No DOM access, no imports from src/ (only the two generated .gen.mjs
 * mirrors), never throws.
 */

import { TRACKING_PARAM_CATEGORIES } from "./engine/param-categories.gen.mjs";
import { buildParamBreakdownView, buildParamIndex } from "./engine/param-breakdown-view.gen.mjs";

/** English-only translator; web/index.html has no i18n. */
function translate(key) {
  return key === "param_category_other" ? "Other" : undefined;
}

let _paramIndex = null;

/**
 * Groups removed tracking-param names into the what/why breakdown rows.
 * Known params (present in the mirrored taxonomy) carry a non-null label
 * and description; unknown params fall into an "other" bucket with a
 * label only (`description: null`).
 *
 * @param {string[]} removed Tracking param names removed from the URL.
 * @returns {{ categoryKey: string, label: string, description: string|null, params: string[] }[]}
 */
export function buildParamInsight(removed) {
  if (!Array.isArray(removed) || removed.length === 0) return [];
  if (!_paramIndex) _paramIndex = buildParamIndex(TRACKING_PARAM_CATEGORIES);
  return buildParamBreakdownView(removed, "en", _paramIndex, translate);
}
