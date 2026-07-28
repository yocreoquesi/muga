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
 * Currently overridable: `remoteRulesEnabled`.
 * Adding a new pref requires updating GUARDED_PREFS in
 * `synced-affiliate-pref-guard.js`.
 */

import { GUARDED_PREFS } from "./synced-affiliate-pref-guard.js";

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
  // Enforce the documented {Object<string, boolean>} shape (#728 item 24): only
  // GUARDED_PREFS keys, only boolean values. Silently merging arbitrary keys or
  // non-boolean values would smuggle junk into the local overrides map that
  // getPrefs() later overlays on top of the synced prefs.
  for (const [key, value] of Object.entries(partial)) {
    if (!GUARDED_PREFS.includes(key)) {
      throw new TypeError(`per-device-prefs.setOverrides: unknown override key "${key}"`);
    }
    if (typeof value !== "boolean") {
      throw new TypeError(`per-device-prefs.setOverrides: override "${key}" must be a boolean`);
    }
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
 * Reconciles a per-device override after an EXPLICIT Settings toggle of a
 * guarded pref (#888 follow-up, write path).
 *
 * An explicit toggle in Settings is this device's authoritative current choice.
 * Because getPrefs() overlays per-device overrides LAST, a stale override
 * (e.g. a `false` recorded when the user declined a sync-inherited onboarding
 * prompt) would keep winning over the fresh setPrefs() write — the toggle would
 * silently revert on reload and the behaviour would never change. Recording the
 * override to match the chosen value makes getPrefs() return it, so the choice
 * sticks. Precedence note: this deliberately pins the pref to the device-local
 * choice, consistent with the guard's intent (#364) that these privacy-
 * sensitive prefs must not silently flip from sync without explicit local
 * confirmation.
 *
 * No-op for non-guarded keys — only GUARDED_PREFS carry per-device overrides,
 * so a blanket clear/write is neither needed nor allowed for other toggles.
 *
 * @param {string} key - Pref key from an explicit Settings action.
 * @param {boolean} value - The chosen value.
 * @returns {Promise<void>}
 */
export async function reconcileOverrideForExplicitChoice(key, value) {
  if (!GUARDED_PREFS.includes(key)) return;
  await setOverrides({ [key]: !!value });
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
