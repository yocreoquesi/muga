/**
 * MUGA: Consent Storage
 *
 * Per-device persistence of user consent state. Lives in
 * `chrome.storage.local` (intentional — see ADR-0001). No code outside
 * this module references `chrome.storage.local` for the consent fields.
 *
 * Stored shape (under a single namespaced key to keep the surface tight):
 *
 *   chrome.storage.local["mugaConsent"] = {
 *     onboardingDone:  boolean,
 *     consentVersion:  string | null,
 *     consentDate:     number  | null  // unix ms
 *   }
 *
 * The shape mirrors the legacy fields previously stored in
 * `chrome.storage.sync` (see PREF_DEFAULTS in storage.js for the
 * pre-#355 location). The migration in `sync-migration.js` copies
 * legacy values into this shape on first run.
 */

export const CONSENT_STORAGE_KEY = "mugaConsent";

/**
 * Version of the Terms text that was current when acceptance was recorded.
 *
 * Provenance only. Nothing reads this to decide anything: MUGA follows the
 * uBlock Origin model, where the Terms are available and linked, acceptance
 * is by use, and updating them never re-prompts or re-gates an existing user.
 * The versioned-consent policy engine that used to compare this against a
 * required version (consent-policy / consent-version-manifest / consent-clauses)
 * was removed. Bump this when the Terms text changes so the stored record says
 * which wording the user was shown; that is its whole job.
 *
 * It MUST equal the version printed in src/privacy/tos.html (and its docs/
 * mirror). It had drifted — code said 1.2 while the shipped document said 1.4
 * and the docs copy said 1.3 — which made the stored provenance meaningless,
 * since it named a wording no user was ever shown. tos-version-sync.test.mjs
 * now fails the build if the three ever disagree again.
 */
export const TERMS_VERSION = "1.5";

/** Default record returned when nothing is stored yet. */
export const CONSENT_DEFAULTS = Object.freeze({
  onboardingDone: false,
  consentVersion: null,
  consentDate: null,
});

/**
 * Reads the current consent record from `chrome.storage.local`. Falls
 * back to CONSENT_DEFAULTS when nothing is stored. Never throws — on
 * any error returns the defaults so callers can render the
 * never-onboarded state safely.
 *
 * @returns {Promise<{onboardingDone:boolean, consentVersion:string|null, consentDate:number|null}>}
 */
export async function getConsent() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.local.get({ [CONSENT_STORAGE_KEY]: { ...CONSENT_DEFAULTS } }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r[CONSENT_STORAGE_KEY] || { ...CONSENT_DEFAULTS });
      });
    });
  } catch (err) {
    console.error("[MUGA] consent-storage.getConsent:", err);
    return { ...CONSENT_DEFAULTS };
  }
}

/**
 * Writes a partial consent record. Unlisted fields stay at whatever
 * value they had previously — partial updates merge against the stored
 * record, not the defaults. Throws on chrome.runtime errors so the
 * caller (typically onboarding) can surface a save failure.
 *
 * @param {{onboardingDone?:boolean, consentVersion?:string|null, consentDate?:number|null}} partial
 * @returns {Promise<void>}
 */
export async function setConsent(partial) {
  if (!partial || typeof partial !== "object") {
    throw new TypeError("consent-storage.setConsent: partial must be an object");
  }
  const current = await getConsent();
  const next = { ...current, ...partial };
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CONSENT_STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/**
 * Removes the consent record entirely. Intended for testing and devMode
 * reset; production code should not normally call this. After clearAll,
 * `getConsent()` returns CONSENT_DEFAULTS.
 *
 * @returns {Promise<void>}
 */
export async function clearConsent() {
  return await new Promise((resolve, reject) => {
    chrome.storage.local.remove(CONSENT_STORAGE_KEY, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
