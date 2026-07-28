/**
 * MUGA: Synced Affiliate Pref Guard (#364)
 *
 * Pure function. Given the current sync prefs, the local consent
 * record, and any per-device overrides already recorded, returns the
 * list of prefs that arrived enabled via sync but have not yet been
 * confirmed on this device.
 *
 * Intended for a caller (e.g. the onboarding page) to decide which
 * "your other device has X enabled, do you want it here?" prompts to
 * render. A confirm/decline response would be recorded as a per-device
 * override (see per-device-prefs.js), after which the pref would no
 * longer show up in pendingConfirmations.
 *
 * drop-affiliate-injection (PR 1b): the onboarding page no longer calls
 * this function — its only caller was the injectOwnAffiliate
 * confirmation step, deleted along with the retired pref.
 * remoteRulesEnabled has never had onboarding UI wired to it either
 * (a pre-existing gap), so this module currently has no production
 * caller. The guard architecture itself is intentionally kept: this
 * stays the single source of truth for "which guarded prefs are
 * pending confirmation" if/when remoteRulesEnabled onboarding UI is
 * built.
 *
 * The set of guarded prefs is closed and small. Adding a new one
 * requires updating GUARDED_PREFS here AND adding the matching
 * onboarding UI + i18n keys.
 */

/**
 * Prefs that require explicit per-device confirmation when they
 * arrive via sync as `true` on a device that has not yet completed
 * onboarding (or has not yet recorded an override decision for them).
 */
export const GUARDED_PREFS = Object.freeze([
  "remoteRulesEnabled",
]);

/**
 * Returns the list of pref keys that need confirmation on this device.
 *
 * Rules:
 *   - Onboarding must not yet be completed locally (otherwise the
 *     existing onboarding flow already covered the disclosure).
 *   - The pref is in GUARDED_PREFS.
 *   - Sync says the pref is `true`.
 *   - No per-device override has been recorded for this pref yet.
 *
 * @param {object} args
 * @param {object} args.syncPrefs - Result of reading chrome.storage.sync.
 * @param {object} args.localConsent - Result of consent-storage.getConsent().
 * @param {object} args.overrides - Result of per-device-prefs.getOverrides().
 * @returns {string[]} Pref keys that need confirmation, in GUARDED_PREFS order.
 */
export function pendingConfirmations({ syncPrefs = {}, localConsent = {}, overrides = {} }) {
  // If onboarding was already completed on this device, the user has
  // already seen the disclosures for whatever prefs were enabled at
  // that time. New per-version disclosures are slice #370 territory,
  // not this guard's responsibility.
  if (localConsent.onboardingDone) return [];

  const pending = [];
  for (const key of GUARDED_PREFS) {
    if (syncPrefs[key] !== true) continue;
    if (key in overrides) continue;
    pending.push(key);
  }
  return pending;
}
