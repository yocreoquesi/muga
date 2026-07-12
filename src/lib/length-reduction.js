/** MUGA: Pure length-reduction math for the popup "% shorter" line and bar (#1062) */
//
// Ported from web/ui-view.js's computeLengthReduction so the popup surfaces the
// same honest LENGTH-only claim the web tool does — a "this link is N% shorter"
// statement, never framed as "N% of the URL was tracking". Pure module: no DOM,
// no imports, no clock. popup.js is the thin renderer that applies these values
// to the preview slots (#preview-shorter and the kept/removed bar).

/**
 * @typedef {object} LengthReductionView
 * @property {number} shorterPercent Whole-number percent shorter (0 when isClean).
 * @property {string} label Length-only headline text.
 * @property {number} keptLen Character length of the cleaned URL.
 * @property {number} removedLen Characters removed (max(0, original - clean)).
 * @property {boolean} isClean True when nothing was removed.
 */

/**
 * Computes the length-reduction view-model from the original (pasted) URL and
 * the cleaned URL. A pure LENGTH claim, never a "% was tracking" claim. Never
 * reports 0% while a real reduction happened: a nonzero reduction is clamped up
 * to at least 1% so a genuine change is never rendered as "0% shorter".
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

  return {
    shorterPercent,
    label: isClean ? "Already clean, nothing to remove" : `This link is ${shorterPercent}% shorter`,
    keptLen: cleanLen,
    removedLen,
    isClean,
  };
}

/**
 * @typedef {object} LengthBarView
 * @property {number} keptPercent Width percent for the kept (green) segment.
 * @property {number} removedPercent Width percent for the removed (red) segment.
 */

/**
 * Computes the kept/removed bar geometry from a LengthReductionView. The two
 * widths always sum to 100. Mirrors the inline bar math in web/ui.js so the
 * popup bar matches the web tool. Guards against a zero-length total (returns a
 * fully-kept bar rather than dividing by zero).
 *
 * @param {LengthReductionView} view
 * @returns {LengthBarView}
 */
export function computeLengthBar(view) {
  const keptLen = view && typeof view.keptLen === "number" ? view.keptLen : 0;
  const removedLen = view && typeof view.removedLen === "number" ? view.removedLen : 0;
  const totalLen = keptLen + removedLen;
  const removedPercent = totalLen === 0 ? 0 : (removedLen / totalLen) * 100;
  return {
    keptPercent: 100 - removedPercent,
    removedPercent,
  };
}
