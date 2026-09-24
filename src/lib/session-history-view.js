/**
 * MUGA — Session-history view-model (#1352, ADR-0011 Decision 3).
 *
 * Pure validate/shape logic for the "This session" ledger. Previously
 * inlined inside the popup's `showHistory` (popup.js, now removed) as part
 * of merging both popup ledgers into ONE Activity panel in Settings (#1352,
 * maintainer decision on the issue) behind a scope control
 * (`activity-scope-view.js`).
 *
 * Why a separate module from the options glue: options.js/popup.js are
 * browser-only (top-level chrome.* / document.* references) and cannot be
 * exercised under node:test, so this shaping logic lived untested.
 * Extracting it here mirrors the precedent set by domain-stats-view.js
 * (#1350) and attribution-ledger-view.js.
 *
 * The raw entries come from `sessionStorage.get({history: []})`
 * (src/lib/storage.js) and are already capped at HISTORY_MAX (10) by the
 * writer (src/background/service-worker.js's appendHistory), so `limit`
 * here is a defensive re-cap, not the primary bound.
 *
 * @param {Array<{original?: string, clean?: string, ts?: number, removedTracking?: string[]}>|null|undefined} history
 *   The raw `history` array from chrome.storage.session (or its in-memory
 *   fallback). Malformed entries (missing `original`/`clean`, non-object,
 *   null) are dropped rather than throwing.
 * @param {{limit?: number}} [options]
 * @returns {{empty: boolean, entries: Array<{original: string, clean: string, ts?: number, removedTracking: string[]}>}}
 */
export function planSessionHistoryView(history, { limit = 10 } = {}) {
  const list = Array.isArray(history) ? history : [];

  const entries = list
    .filter((entry) => entry && typeof entry === "object" && typeof entry.original === "string" && typeof entry.clean === "string")
    .map((entry) => ({
      original: entry.original,
      clean: entry.clean,
      ts: typeof entry.ts === "number" ? entry.ts : undefined,
      removedTracking: Array.isArray(entry.removedTracking) ? entry.removedTracking : [],
    }))
    .slice(0, limit);

  return { empty: entries.length === 0, entries };
}
