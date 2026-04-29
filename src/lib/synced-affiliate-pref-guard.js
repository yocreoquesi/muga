/**
 * MUGA: Synced Affiliate Pref Guard (#364)
 *
 * Pure function. Given the current sync prefs, the local consent
 * record, and any per-device overrides already recorded, returns the
 * list of prefs that arrived enabled via sync but have not yet been
 * confirmed on this device.
 *
 * Used by the onboarding page to decide which "your other device has
 * X enabled, do you want it here?" prompts to render. Once the user
 * confirms or declines via onboarding, the response is recorded as a
 * per-device override (see per-device-prefs.js) and the pref no
 * longer shows up in pendingConfirmations.
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
  "injectOwnAffiliate",
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
