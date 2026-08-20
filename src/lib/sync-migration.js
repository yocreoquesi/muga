/**
 * MUGA: Sync → Local Consent Migration (#355)
 *
 * One-shot migration that moves the legacy consent fields
 * (`onboardingDone`, `consentVersion`, `consentDate`) out of
 * `chrome.storage.sync` and into `chrome.storage.local` via the
 * consent-storage module.
 *
 * Idempotent and tolerant of partial state. Safe to call on every
 * service-worker wake. The first call after upgrade does the real
 * work; every subsequent call is a no-op (the legacy keys are gone
 * from sync after the first successful pass).
 *
 * Conflict policy: if BOTH sync and local hold consent state at the
 * time of migration, **local wins**. This handles the edge case of a
 * user who completed onboarding on this device after the migration
 * shipped (writing local) but whose sync still has stale legacy data
 * from another device — the local record represents this user's
 * authoritative consent on this device.
 */

import { getConsent, setConsent, CONSENT_DEFAULTS } from "./consent-storage.js";

const LEGACY_KEYS = ["onboardingDone", "consentVersion", "consentDate"];

/**
 * Reads sync values for the legacy consent keys. Returns an object
 * keyed by `LEGACY_KEYS`. Never throws.
 */
async function readLegacySync() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.sync.get(LEGACY_KEYS, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r || {});
      });
    });
  } catch (err) {
    console.error("[MUGA] sync-migration.readLegacySync:", err);
    return {};
  }
}

/**
 * Removes the legacy keys from sync. Idempotent.
 */
async function removeLegacySync() {
  return await new Promise((resolve, reject) => {
    chrome.storage.sync.remove(LEGACY_KEYS, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/**
 * Returns true if any of the legacy consent fields is present in the
 * given sync read. `undefined` means the key was never set; presence
 * of any other value (including `false` / `null` / `0`) counts as
 * "this user has legacy data we should migrate or clean up".
 */
function syncHasLegacy(sync) {
  return LEGACY_KEYS.some(k => sync[k] !== undefined);
}

/**
 * In-flight migration, shared by concurrent callers (#1216).
 *
 * The service worker calls migrateConsentToLocal() from module scope AND from
 * its startup/install handlers, so on a fresh wake two or three calls overlap
 * by design. The migration is idempotent in its EFFECT, but it was not atomic:
 * read sync, read local, write local, remove sync. Two runs could interleave
 * so that the second reads sync (still holding the legacy keys, because the
 * first has not reached removeLegacySync yet) and local (already written by
 * the first), and therefore reports `copiedToLocal: false` for a copy that did
 * happen.
 *
 * The stored data was always correct; only the report lied, which is why this
 * surfaced as a flaky e2e assertion rather than a user-visible bug. Sharing
 * one promise makes concurrent callers observe the same, accurate report and
 * removes the duplicate storage writes on every wake.
 *
 * Cleared once settled so a later wake can migrate again if it needs to.
 */
let _inFlight = null;

/**
 * Performs the migration. Idempotent, and safe to call concurrently: callers
 * that arrive while a migration is running share its result. Returns a small
 * report describing what happened, useful for tests and diagnostics.
 *
 * @returns {Promise<{ ranWork: boolean, copiedToLocal: boolean, cleanedSync: boolean }>}
 */
export async function migrateConsentToLocal() {
  if (_inFlight) return _inFlight;
  _inFlight = _migrateConsentToLocal();
  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

/** @returns {Promise<{ ranWork: boolean, copiedToLocal: boolean, cleanedSync: boolean }>} */
async function _migrateConsentToLocal() {
  try {
    const sync = await readLegacySync();
    if (!syncHasLegacy(sync)) {
      // Fresh install or already migrated — both paths land here.
      return { ranWork: false, copiedToLocal: false, cleanedSync: false };
    }

    const local = await getConsent();
    const localHasConsent = local.onboardingDone || local.consentVersion !== null;

    let copiedToLocal = false;
    if (!localHasConsent) {
      // Local is empty — copy the sync values into local. Defensive
      // about types: coerce booleans, leave nullable fields as null
      // when sync had `undefined`.
      await setConsent({
        onboardingDone: !!sync.onboardingDone,
        consentVersion: sync.consentVersion ?? CONSENT_DEFAULTS.consentVersion,
        consentDate: typeof sync.consentDate === "number"
          ? sync.consentDate
          : CONSENT_DEFAULTS.consentDate,
      });
      copiedToLocal = true;
    }
    // If local already has consent, we keep local untouched — local
    // represents this device's authoritative state.

    await removeLegacySync();
    return { ranWork: true, copiedToLocal, cleanedSync: true };
  } catch (err) {
    // Migration is best-effort. Errors here must not break extension
    // startup. The next service-worker wake retries.
    console.error("[MUGA] migrateConsentToLocal:", err);
    return { ranWork: false, copiedToLocal: false, cleanedSync: false };
  }
}
