/**
 * MUGA: URL length-reduction view-model (#1062, popup preview insight)
 *
 * Pure, dependency-free port of the web tool's `computeLengthReduction`
 * (web/ui-view.js). Lives in src/lib/ so the browser-only popup can import
 * it at runtime (popup.js is a plain ES module, not bundled) while the
 * arithmetic stays unit-tested under node:test.
 *
 * A LENGTH-only claim by design: the label is always phrased as "shorter",
 * never "% was tracking" — the honest framing MUGA uses everywhere. A clamp
 * guard (`Math.max(1, ...)`) means a real (if tiny) reduction never renders
 * as 0%; when nothing was removed it short-circuits to `isClean: true` so
 * the caller can pick a positive "already clean" message instead of a 0% bar.
 */

/**
 * @typedef {object} LengthReductionView
 * @property {number} shorterPercent Whole-number percent shorter (0 when isClean).
 * @property {number} keptLen Character length of the cleaned URL.
 * @property {number} removedLen Character length removed (`max(0, original - clean)`).
 * @property {boolean} isClean True when nothing was removed.
 */

/**
 * Computes the length-reduction view-model from the original (pasted or
 * navigated) URL and the cleaned URL. Never throws: non-string inputs
 * collapse to length 0.
 *
 * @param {string} originalUrl The URL before cleaning.
 * @param {string} cleanUrl The URL after cleaning.
 * @returns {LengthReductionView}
 */
export function computeLengthReduction(originalUrl, cleanUrl) {
  const originalLen = typeof originalUrl === "string" ? originalUrl.length : 0;
  const cleanLen = typeof cleanUrl === "string" ? cleanUrl.length : 0;
  const removedLen = Math.max(0, originalLen - cleanLen);
  const isClean = removedLen === 0;
  const shorterPercent = isClean || originalLen === 0
    ? 0
    : Math.max(1, Math.round((removedLen / originalLen) * 100));

  return { shorterPercent, keptLen: cleanLen, removedLen, isClean };
}

/**
 * @typedef {object} LengthBarGeometry
 * @property {number} keptPercent Width % of the kept (useful) segment. Green.
 * @property {number} removedPercent Width % of the removed (trimmed) segment. Red.
 */

/**
 * Turns a {@link LengthReductionView} into the two bar-segment widths the
 * popup / web tool render: kept (green, `--good`) vs removed (red, `--bad`).
 * Mirrors the web tool's inline geometry (web/ui.js) exactly so both
 * surfaces read identically. Shares are of the TOTAL original length
 * (`keptLen + removedLen`), not of the cleaned length, so the two widths
 * always sum to 100 (or 0/0 for an empty input).
 *
 * @param {LengthReductionView} view Output of computeLengthReduction.
 * @returns {LengthBarGeometry}
 */
export function computeLengthBar(view) {
  const keptLen = view && typeof view.keptLen === "number" ? view.keptLen : 0;
  const removedLen = view && typeof view.removedLen === "number" ? view.removedLen : 0;
  const totalLen = keptLen + removedLen;
  const removedPercent = totalLen === 0 ? 0 : (removedLen / totalLen) * 100;
  return { keptPercent: 100 - removedPercent, removedPercent };
}
