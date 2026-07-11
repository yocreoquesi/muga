/** MUGA: Web-cleaner-tool param insight (sdd/web-cleaning-insight, Slice 1)
 *
 * Pure module: builds the per-parameter what/why breakdown shown below
 * the length-reduction bar, grouping removed tracking params by category
 * (spec "Per-parameter what/why breakdown"). Reuses the SAME grouping
 * logic the popup uses (buildParamBreakdownView, mirrored byte-for-byte
 * from src/lib/param-breakdown-view.js into
 * web/engine/param-breakdown-view.gen.mjs by `npm run build:web`) against
 * the generated web/engine/param-categories.gen.mjs taxonomy mirror
 * (design D1/D2/D3, sdd/web-cleaning-insight/design).
 *
 * Does NOT mirror popup.js's `_buildParamIndex` (browser-only, untestable
 * under node:test) — the reverse-index build here is a small pure
 * function so this whole module stays unit-tested. web/index.html is
 * English-only (`lang="en"`), so `translateOther` never needs real i18n:
 * it always returns the English "Other" label.
 *
 * No DOM access, no imports from src/ (only the two generated .gen.mjs
 * mirrors), never throws.
 */

import { TRACKING_PARAM_CATEGORIES } from "./engine/param-categories.gen.mjs";
import { buildParamBreakdownView } from "./engine/param-breakdown-view.gen.mjs";

/** English-only "other" bucket label; web/index.html has no i18n. */
function translateOther() {
  return "Other";
}

let _paramIndex = null;

/**
 * Builds (and caches) the reverse param-index: lowercase param name ->
 * category info, mirroring popup.js's `_buildParamIndex` shape so
 * `buildParamBreakdownView` (shared, mirrored module) can consume it
 * unchanged.
 *
 * @returns {Map<string, object>}
 */
export function buildParamIndex() {
  if (_paramIndex) return _paramIndex;
  _paramIndex = new Map();
  for (const [categoryKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
    for (const param of catData.params) {
      _paramIndex.set(param.toLowerCase(), {
        categoryKey,
        label: catData.label,
        description: catData.description ?? null,
      });
    }
  }
  return _paramIndex;
}

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
  return buildParamBreakdownView(removed, "en", buildParamIndex(), translateOther);
}
