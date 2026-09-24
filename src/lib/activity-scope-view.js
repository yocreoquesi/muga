/**
 * MUGA — Activity ledger scope-filtering view-model (#1352, maintainer
 * decision on the issue: merge the popup's two ledgers into ONE Activity
 * panel in Settings, with a scope control to switch between "the current
 * session" and "recent activity" rather than two separate panels).
 *
 * Pure logic only: given a requested scope, decide which of the two
 * sub-panels (session history / recent activity) is hidden. Kept separate
 * from options.js because options.js is browser-only and cannot be
 * exercised under node:test (same reasoning as every other Activity-panel
 * pure module: domain-stats-view.js, suspicious-params-view.js,
 * session-history-view.js).
 *
 * Deliberately does NOT merge the two ledgers' row data into one shape —
 * the maintainer's decision was one panel with a scope control that
 * switches between two views, not one unified list. Their underlying data
 * differs too much to merge meaningfully: session history carries a
 * before/after URL pair and a removed-tracking breakdown; recent activity
 * carries badge/creator/network attribution and no "before" value.
 */

/** The two scopes the Activity ledger panel can show. */
export const ACTIVITY_SCOPES = Object.freeze({
  SESSION: "session",
  RECENT: "recent",
});

/**
 * Default scope shown when Settings opens. Assumption (#1352 feature doc):
 * "session" — matches the popup's original panel order (history rendered
 * before recent-activity) and is the narrower, more immediately relevant
 * view. Not persisted across reloads (see feature doc assumptions).
 */
export const DEFAULT_ACTIVITY_SCOPE = ACTIVITY_SCOPES.SESSION;

/**
 * @param {unknown} value
 * @returns {value is "session"|"recent"} true iff value is one of
 *   ACTIVITY_SCOPES' values.
 */
export function isValidActivityScope(value) {
  return value === ACTIVITY_SCOPES.SESSION || value === ACTIVITY_SCOPES.RECENT;
}

/**
 * Decides which sub-panel is hidden for a given scope. An invalid/missing
 * scope (e.g. a radio group that somehow ends up with neither input
 * checked) falls back to DEFAULT_ACTIVITY_SCOPE rather than hiding both
 * panels, so the Activity ledger panel is never left blank.
 *
 * @param {unknown} scope
 * @returns {{scope: string, sessionPanelHidden: boolean, recentPanelHidden: boolean}}
 */
export function planActivityScopeView(scope) {
  const resolved = isValidActivityScope(scope) ? scope : DEFAULT_ACTIVITY_SCOPE;
  return {
    scope: resolved,
    sessionPanelHidden: resolved !== ACTIVITY_SCOPES.SESSION,
    recentPanelHidden: resolved !== ACTIVITY_SCOPES.RECENT,
  };
}
