/**
 * MUGA — "has anything happened yet?" for the popup's counters (#1260)
 *
 * The popup opens on tiles reading 0 for a fresh install, with no copy anywhere
 * near them. Bare zeros do not read as "nothing has happened yet", they read as
 * "this is not working" — and the ledger directly below already gets an empty
 * state that says so in words.
 *
 * A one-line predicate lives here rather than inside popup.js because the
 * question it answers is not obvious at the edges: a missing stats object, a
 * partially-written one, and counters that a reset put back to zero all have to
 * mean the same thing, and popup.js is browser-only so nothing there can be
 * asserted directly.
 */

/**
 * The counters the popup renders, in the shape storage.local holds.
 *
 * `referralsSpotted` was here and is not any more (#1339). Its tile could only
 * ever read 0: the branch that increments it sits behind `notifyForeignAffiliate`,
 * which defaults to false, so for anyone who has never opened Settings it never
 * ran. A hidden counter must not decide a visible message either, which is the
 * other reason it cannot stay in this list now that its tile is gone: a user who
 * HAD turned that setting on would have a non-zero value suppressing the zero
 * state for two tiles that genuinely are zero.
 *
 * The stat is still collected and still written to storage. Only the display
 * and this predicate stopped reading it.
 */
const COUNTERS = ["urlsCleaned", "junkRemoved"];

/**
 * Is every counter still at zero?
 *
 * TRUE for a missing or malformed stats object, deliberately: the state the
 * message describes is "nothing to show", and a popup that cannot read its
 * counters has exactly nothing to show. The alternative — treating unreadable
 * as established use — hides the explanation from the only user who needs it.
 *
 * A non-numeric or negative value counts as "not zero" so a corrupted store
 * cannot produce a zero state that contradicts the numbers rendered next to it.
 *
 * @param {{urlsCleaned?: number, junkRemoved?: number}|null|undefined} stats
 * @returns {boolean}
 */
export function isFreshInstall(stats) {
  if (stats === null || typeof stats !== "object" || Array.isArray(stats)) return true;

  return COUNTERS.every((key) => {
    const value = stats[key];
    if (value === undefined || value === null) return true;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    return value === 0;
  });
}
