/** MUGA: Web-cleaner-tool UI view-model (#1029, Phase 4)
 *
 * Pure formatting layer between web/engine/adapter.js's `cleanUrl()`
 * result and the DOM. No DOM access here, no imports of web/engine/*.
 * web/ui.js (browser-only, DOM wiring) applies this view-model to
 * elements via `textContent` / `createElement` and cannot be unit tested
 * under node:test; this module carries the branching that decides WHAT
 * to render so it stays covered by tests/unit/web-ui-view.test.mjs.
 * Mirrors the precedent set by src/lib/remote-rules-changelog-view.js.
 *
 * Copy constraints (spec "Copy Style Constraints"): messages never use
 * an em-dash or "--", and never describe injecting an affiliate tag (the
 * web tool is a pure cleaner, Scenario A + preservation only).
 */

/**
 * @typedef {object} CleanResultView
 * @property {"empty"|"error"|"clean"} state
 * @property {string} message Friendly, render-ready summary text.
 * @property {string|null} cleanUrl
 * @property {number} removedCount
 * @property {string[]} removedList
 * @property {boolean} unwrapped
 * @property {string|null} destinationHost
 * @property {boolean} affiliatePreserved
 * @property {boolean} noChanges
 */

/**
 * The view shown before the user has cleaned anything yet.
 * @returns {CleanResultView}
 */
export function emptyStateView() {
  return {
    state: "empty",
    message: "Paste a URL above and press Clean to see what changes.",
    cleanUrl: null,
    removedCount: 0,
    removedList: [],
    unwrapped: false,
    destinationHost: null,
    affiliatePreserved: false,
    noChanges: false,
  };
}

/**
 * Builds the "N tracking parameters removed[, redirect wrapper unwrapped]."
 * change summary, or the no-changes sentence when nothing happened.
 *
 * @param {string[]} removedList
 * @param {boolean} unwrapped
 * @returns {string}
 */
function buildChangeSummary(removedList, unwrapped) {
  const parts = [];
  if (removedList.length > 0) {
    const noun = removedList.length === 1 ? "parameter" : "parameters";
    parts.push(`${removedList.length} tracking ${noun} removed`);
  }
  if (unwrapped) {
    parts.push("redirect wrapper unwrapped");
  }
  if (parts.length === 0) {
    return "No tracking parameters or redirect wrappers found. This URL is already clean.";
  }
  return `${parts.join(", ")}.`;
}

/**
 * Formats a web/engine/adapter.js `cleanUrl()` result into a render-ready
 * view-model. Never throws: a missing/malformed result degrades to the
 * "error" state with a generic message, same as the adapter's own
 * never-throw contract.
 *
 * @param {{
 *   ok?: boolean,
 *   cleanUrl?: string,
 *   removed?: string[],
 *   unwrapped?: boolean,
 *   destinationHost?: string|null,
 *   affiliatePreserved?: boolean,
 *   action?: string,
 *   error?: string,
 * }|null|undefined} result
 * @returns {CleanResultView}
 */
export function formatCleanResult(result) {
  if (!result || !result.ok) {
    const message = result && typeof result.error === "string" && result.error.length > 0
      ? result.error
      : "Something went wrong while cleaning that URL.";
    return {
      state: "error",
      message,
      cleanUrl: null,
      removedCount: 0,
      removedList: [],
      unwrapped: false,
      destinationHost: null,
      affiliatePreserved: false,
      noChanges: false,
    };
  }

  const removedList = Array.isArray(result.removed) ? result.removed : [];
  const unwrapped = !!result.unwrapped;
  const noChanges = removedList.length === 0 && !unwrapped;

  return {
    state: "clean",
    message: buildChangeSummary(removedList, unwrapped),
    cleanUrl: typeof result.cleanUrl === "string" ? result.cleanUrl : null,
    removedCount: removedList.length,
    removedList,
    unwrapped,
    destinationHost: result.destinationHost ?? null,
    affiliatePreserved: !!result.affiliatePreserved,
    noChanges,
  };
}
