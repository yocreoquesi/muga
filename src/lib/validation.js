/**
 * MUGA: Input validation helpers
 *
 * Centralised validation logic shared between the service worker and the
 * options page. Keeping it here prevents the two consumers from silently
 * diverging when entry-format rules change (e.g., new ::variant keys).
 */

import {
  MAX_PARAM_LEN,
  PARAM_FORMAT_RE,
  REMOTE_PARAM_DENYLIST,
  AFFILIATE_PARAM_GUARD,
} from "./remote-rules.js";

/**
 * Validates a blacklist/whitelist entry.
 *
 * Accepted formats:
 *   - "domain.com"                   (strip all params on this domain)
 *   - "domain.com::param::value"     (match a specific affiliate param/value)
 *   - "domain.com::param::*"         (match the param regardless of value)
 *
 * @param {*} entry - Value to validate.
 * @returns {boolean} True if the entry is valid, false otherwise.
 */
export function isValidListEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) return false;
  const parts = entry.split("::");
  if (parts.length > 3) return false;
  if (!parts[0] || !/^[a-zA-Z0-9.-]+$/.test(parts[0])) return false;
  if (parts.length === 2) return false;
  if (parts.length === 3 && (!parts[1] || !parts[2])) return false;
  return true;
}

/**
 * Validates a customParams entry using the canonical remote-rules constants.
 *
 * Rules (mirrors remote-rules validateParams, REQ-VALIDATE-2/3/4/5, #818):
 *   1. Must be a non-empty string.
 *   2. Length ≤ MAX_PARAM_LEN (64) — matches the remote pipeline ceiling.
 *   3. Must match PARAM_FORMAT_RE (alphanumeric + _ . -).
 *   4. Must NOT be in REMOTE_PARAM_DENYLIST (case-insensitive) — protects
 *      navigation/search keys (q, id, token…) from being silently stripped.
 *   5. Must NOT be in AFFILIATE_PARAM_GUARD (case-insensitive) — protects
 *      affiliate attribution keys (tag, campid…): stripping them would break
 *      the product promise of preserving affiliate referrals.
 *
 * @param {*} param - Value to validate.
 * @returns {boolean} True if the param is safe to add to customParams.
 */
export function isValidCustomParam(param) {
  if (typeof param !== "string" || param.length === 0 || param.length > MAX_PARAM_LEN) return false;
  if (!PARAM_FORMAT_RE.test(param)) return false;
  const lower = param.toLowerCase();
  if (REMOTE_PARAM_DENYLIST.has(lower) || AFFILIATE_PARAM_GUARD.has(lower)) return false;
  return true;
}

/**
 * Per-list import caps.
 *
 * These are STORAGE-QUOTA ceilings, not correctness limits: chrome.storage.sync
 * caps each item at ~8 KB, so an unbounded list would fail to persist. Crucially,
 * exceeding a cap is NOT a sign of a corrupt file — a valid MUGA export can
 * legitimately carry more entries than fit (e.g. a user who pasted a large
 * generic tracking-param list). See #911.
 */
export const IMPORT_LIST_CAPS = { blacklist: 500, whitelist: 500, customParams: 200 };

/**
 * Cleans and caps the three user lists from a parsed import payload.
 *
 * Design (graceful degradation — #911, extends #818):
 *   - customParams: invalid entries are filtered out (isValidCustomParam),
 *     THEN the survivors are truncated to the cap. `skippedParams` counts BOTH
 *     invalid and over-cap entries — the honest total the user lost.
 *   - blacklist / whitelist: truncated to their caps. Entry-FORMAT validity is
 *     checked separately by the caller (isValidListEntry), because a malformed
 *     entry signals a corrupt/foreign file (abort), whereas an oversized-but-
 *     well-formed list should import what fits rather than fail wholesale.
 *
 * Pure: no storage/DOM side effects, so it is unit-testable against real
 * exported files. The caller is responsible for the structural muga/array
 * checks before invoking this.
 *
 * @param {{blacklist: string[], whitelist: string[], customParams: string[]}} data
 * @returns {{
 *   blacklist: string[], whitelist: string[], customParams: string[],
 *   droppedBlacklist: number, droppedWhitelist: number, skippedParams: number
 * }}
 */
export function capImportedLists(data) {
  const blacklist = data.blacklist.slice(0, IMPORT_LIST_CAPS.blacklist);
  const whitelist = data.whitelist.slice(0, IMPORT_LIST_CAPS.whitelist);
  const customParams = data.customParams
    .filter(isValidCustomParam)
    .slice(0, IMPORT_LIST_CAPS.customParams);
  return {
    blacklist,
    whitelist,
    customParams,
    droppedBlacklist: data.blacklist.length - blacklist.length,
    droppedWhitelist: data.whitelist.length - whitelist.length,
    skippedParams: data.customParams.length - customParams.length,
  };
}
