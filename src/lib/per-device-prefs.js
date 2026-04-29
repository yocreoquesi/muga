/**
 * MUGA: Per-Device Preference Overrides (#364)
 *
 * Some preferences live in `chrome.storage.sync` because they should
 * follow the user across devices, but a user installing MUGA on a new
 * device may want a different value on **this** device for behaviours
 * that have privacy / monetization consequences (affiliate injection,
 * outbound network requests for remote rule updates).
 *
 * This module owns per-device overrides on top of synced preferences.
 * When a user declines a sync-inherited pref during onboarding, the
 * override is stored here under `chrome.storage.local["mugaPerDevicePrefs"]`.
 * `getPrefs()` overlays the overrides on top of the sync read so the
 * device-local effective value is what the rest of the codebase sees.
 *
 * Currently overridable: `injectOwnAffiliate`, `remoteRulesEnabled`.
 * Adding a new pref requires updating GUARDED_PREFS in
 * `synced-affiliate-pref-guard.js`.
 */

const STORAGE_KEY = "mugaPerDevicePrefs";

/**
 * Reads the per-device overrides map. Returns an empty object if no
 * overrides have ever been set. Never throws.
 *
 * @returns {Promise<Object<string, boolean>>}
 */
export async function getOverrides() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.local.get({ [STORAGE_KEY]: {} }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r[STORAGE_KEY] || {});
      });
    });
  } catch (err) {
    console.error("[MUGA] per-device-prefs.getOverrides:", err);
    return {};
  }
}

/**
 * Sets a per-device override for one or more prefs. Merges against the
 * existing overrides — does not replace.
 *
 * @param {Object<string, boolean>} partial
 * @returns {Promise<void>}
 */
export async function setOverrides(partial) {
  if (!partial || typeof partial !== "object") {
    throw new TypeError("per-device-prefs.setOverrides: partial must be an object");
  }
  const current = await getOverrides();
  const next = { ...current, ...partial };
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/**
 * Removes all per-device overrides. Intended for testing and devMode reset.
 * @returns {Promise<void>}
 */
export async function clearOverrides() {
  return await new Promise((resolve, reject) => {
    chrome.storage.local.remove(STORAGE_KEY, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
