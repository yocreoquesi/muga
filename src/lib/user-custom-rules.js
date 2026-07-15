/**
 * MUGA — Pure add-logic for prefs.userCustomRules (#1099 fix).
 *
 * The popup's "Strip locally" button (#536) promotes a flagged suspicious
 * param straight into prefs.userCustomRules (chrome.storage.sync). Before
 * this fix, the click-handler appended to that array with NO cap at all,
 * while every other write path that touches a synced list — options.js's
 * manual "Add" button and the settings-import path in settings-schema.js —
 * already enforces IMPORT_LIST_CAPS.customParams (200 entries). An
 * uncapped list can exceed chrome.storage.sync's ~8 KB per-item quota and
 * fail to persist, silently, the very next time the popup tries to save it.
 *
 * This module extracts the same cap + dedupe contract into a small, pure,
 * DOM/chrome-free function so the popup's click-handler (and any future
 * caller) shares exactly one source of truth — mirrors creator-allowlist.js's
 * addEntry() shape ({ list, error }).
 */

import { IMPORT_LIST_CAPS } from "./validation.js";

/**
 * Adds `paramName` to `list` (prefs.userCustomRules), enforcing:
 *   - case-insensitive de-duplication (adding an already-present param is a
 *     no-op, reported as `error: "duplicate"`)
 *   - the same cap every other userCustomRules write path already applies
 *     (IMPORT_LIST_CAPS.customParams, 200 entries), reported as
 *     `error: "max"` when the list is already full
 *
 * The list is never mutated; on every path the returned `list` is safe to
 * write back to storage unconditionally.
 *
 * @param {string[]} list       Current userCustomRules list (immutable).
 * @param {string}   paramName  Raw param name to add (original case
 *                              preserved when actually inserted).
 * @returns {{ list: string[], error?: "duplicate"|"max" }}
 */
export function addUserCustomRule(list, paramName) {
  const current = Array.isArray(list) ? list.slice() : [];
  if (typeof paramName !== "string" || paramName.length === 0) {
    return { list: current, error: "duplicate" };
  }
  const lower = paramName.toLowerCase();
  if (current.some((p) => typeof p === "string" && p.toLowerCase() === lower)) {
    return { list: current, error: "duplicate" };
  }
  if (current.length >= IMPORT_LIST_CAPS.customParams) {
    return { list: current, error: "max" };
  }
  return { list: [...current, paramName] };
}
