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
 *   - "domain.com::disabled"         (disable cleaning on this domain)
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
  if (parts.length === 2 && parts[1] !== "disabled") return false;
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
