/**
 * MUGA: rate nudge gate and active-day counter (#1508)
 *
 * The popup's rate nudge used to wait for 200 cleaned URLs. On Chrome the DNR
 * network layer does most of the cleaning and never moves `stats.urlsCleaned`
 * (#1496), so most Chrome users never reached the threshold and the nudge
 * almost never showed. The signal now is sustained use: days on which MUGA
 * actually did something, or on which the user opened the popup.
 *
 * Privacy: only a counter and the last counted day index are stored, never a
 * list of dates or sites. The day index is a plain integer (local days since
 * the epoch), so the stored state cannot be turned into a usage history.
 *
 * Both the gate and the counter live here rather than in popup.js or the
 * service worker because those files are browser-only, and the edges (same
 * day, concurrent writers, spacing between showings) are exactly where a
 * silent regression would hide.
 */

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum distinct active days before the nudge may show. */
export const RATE_NUDGE_MIN_ACTIVE_DAYS = 14;
/** Minimum calendar days since `firstUsed` before the nudge may show. */
export const RATE_NUDGE_MIN_DAYS_SINCE_FIRST_USE = 21;
/** The nudge shows at most this many times, ever. */
export const RATE_NUDGE_MAX_SHOWS = 2;
/** Minimum calendar days between two showings. */
export const RATE_NUDGE_MIN_DAYS_BETWEEN_SHOWS = 14;

const DAY_MS = 86400000;

// ── Active days ──────────────────────────────────────────────────────────────

/**
 * Local calendar day index for a timestamp. Local, not UTC, so "one day" means
 * the user's day: a late-evening session and the next morning are two days.
 * @param {number} ms - Epoch milliseconds.
 * @returns {number} Integer day index.
 */
export function toLocalDayIndex(ms) {
  const offsetMs = new Date(ms).getTimezoneOffset() * 60000;
  return Math.floor((ms - offsetMs) / DAY_MS);
}

/**
 * Computes the storage patch that counts today as an active day, or null when
 * today is already counted. The patch is absolute (not "+1"), which is what
 * makes concurrent writers safe: two contexts that both read yesterday's state
 * both write the same value, and a context that reads after the other wrote
 * sees today and writes nothing.
 * @param {{activeDaysCount?: unknown, activeDaysLastDay?: unknown}} state
 * @param {number} nowMs
 * @returns {{activeDaysCount: number, activeDaysLastDay: number}|null}
 */
export function planActiveDayUpdate(state, nowMs) {
  const today = toLocalDayIndex(nowMs);
  if (state?.activeDaysLastDay === today) return null;
  const stored = state?.activeDaysCount;
  const count = typeof stored === "number" && Number.isInteger(stored) && stored > 0
    ? stored
    : 0;
  return { activeDaysCount: count + 1, activeDaysLastDay: today };
}

/**
 * Whether a cleaner result is MUGA "doing something on a page": any cleaning,
 * unwrap or detection decision, or a creator tag it chose to keep.
 * @param {{action?: string, preservedAffiliate?: unknown, creatorReferralPreserved?: boolean}|null|undefined} result
 * @returns {boolean}
 */
export function isActiveDayDecision(result) {
  if (!result) return false;
  if (result.preservedAffiliate || result.creatorReferralPreserved) return true;
  const action = typeof result.action === "string" ? result.action : "";
  return action !== "" && action !== "untouched" && action !== "error";
}

/**
 * Builds a per-context active-day recorder. It remembers the last day it
 * counted so every later call that day is a free comparison (the service
 * worker calls it from the URL-processing path), and it shares one in-flight
 * write across overlapping callers so a burst of messages costs one read.
 * @param {object} spec
 * @param {() => Promise<{activeDaysCount?: number, activeDaysLastDay?: number|null}>} spec.read
 * @param {(patch: object) => Promise<void>} spec.write
 * @param {() => number} [spec.now]
 * @returns {{record: () => Promise<void>}}
 */
export function createActiveDayRecorder({ read, write, now = () => Date.now() }) {
  let _lastCountedDay = null;
  let _inFlight = null;

  return {
    /**
     * Counts today if it is not counted yet. Best-effort: a storage failure
     * leaves the memo unset so a later call retries; it never throws.
     * @returns {Promise<void>}
     */
    async record() {
      const nowMs = now();
      if (_lastCountedDay === toLocalDayIndex(nowMs)) return;
      if (_inFlight) return _inFlight;

      _inFlight = (async () => {
        try {
          const state = await read();
          const patch = planActiveDayUpdate(state, nowMs);
          if (patch) await write(patch);
          _lastCountedDay = toLocalDayIndex(nowMs);
        } catch (err) {
          console.error("[MUGA] record active day:", err);
        } finally {
          _inFlight = null;
        }
      })();

      return _inFlight;
    },
  };
}

// ── Gate ─────────────────────────────────────────────────────────────────────

/**
 * Decides whether the popup shows the rate nudge on this open. Called only
 * from the popup, so the nudge only ever appears when the user opened MUGA
 * themselves; it is never a toast or notification.
 * @param {object} input
 * @param {boolean} input.enabled - prefs.enabled.
 * @param {boolean} input.onboardingDone - prefs.onboardingDone.
 * @param {number|null} input.firstUsed - Epoch ms of first use (storage.local).
 * @param {number} input.activeDaysCount - Distinct active days so far.
 * @param {boolean} input.nudgeDismissed - Clicked or dismissed: permanent silence.
 * @param {number} input.nudgeShownCount - Times shown so far.
 * @param {number} input.nudgeLastShown - Epoch ms of the last showing, 0 if never.
 * @param {boolean} input.sessionSeen - Already shown during this browser session.
 * @param {number} nowMs
 * @returns {boolean}
 */
export function shouldShowRateNudge(input, nowMs) {
  if (!input?.enabled || !input.onboardingDone) return false;
  if (input.nudgeDismissed || input.sessionSeen) return false;

  const shown = Number(input.nudgeShownCount) || 0;
  if (shown >= RATE_NUDGE_MAX_SHOWS) return false;

  if (typeof input.firstUsed !== "number" || !Number.isFinite(input.firstUsed)) return false;
  if ((nowMs - input.firstUsed) / DAY_MS < RATE_NUDGE_MIN_DAYS_SINCE_FIRST_USE) return false;

  if ((Number(input.activeDaysCount) || 0) < RATE_NUDGE_MIN_ACTIVE_DAYS) return false;

  const lastShown = Number(input.nudgeLastShown) || 0;
  if (lastShown > 0 && (nowMs - lastShown) / DAY_MS < RATE_NUDGE_MIN_DAYS_BETWEEN_SHOWS) return false;

  return true;
}
