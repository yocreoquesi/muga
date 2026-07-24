/** MUGA: Pure decision logic for the Options page's "Aggressive privacy" UI
 * (referer-beacon-privacy PR 4 — D5 linked-suggestion nudge + D6 mandatory
 * blocklist migration disclosure).
 *
 * Pure module: no chrome/DOM APIs, no side effects. options.js owns all
 * storage reads/writes and DOM mutation — these functions only decide
 * WHETHER to act, mirroring the settings-schema.js precedent (planImport()
 * decides, the caller performs).
 */

/**
 * Whether the affiliate-stripping nudge (linking to the "Aggressive privacy"
 * section) should be revealed.
 *
 * The nudge only reveals on the TRANSITION to checked — never when the
 * checkbox was already checked at page load, and never once the user has
 * dismissed it. It never implies enabling anything else (D5: nudge only,
 * never auto-enables suppressReferer / blockBeacons).
 *
 * @param {{wasChecked: boolean, isChecked: boolean, dismissed: boolean}} state
 * @returns {boolean}
 */
export function shouldRevealAffiliateNudge({ wasChecked, isChecked, dismissed }) {
  return wasChecked !== true && isChecked === true && dismissed !== true;
}

/**
 * Whether the one-time blocklist Referer/beacon migration notice should be
 * shown. Fires ONLY for users who already have a non-empty blocklist AND
 * have not already seen the notice (D2/D6: existing blocklist entries gain
 * header-layer behavior, disclosure is mandatory but shown exactly once).
 *
 * Fail-safe: a malformed/absent blacklist never shows the notice.
 *
 * @param {{blacklist: string[]|undefined, alreadyShown: boolean}} state
 * @returns {boolean}
 */
export function shouldShowBlocklistMigrationNotice({ blacklist, alreadyShown }) {
  return Array.isArray(blacklist) && blacklist.length > 0 && alreadyShown !== true;
}
