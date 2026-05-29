/**
 * MUGA: Migration Storage
 *
 * Per-device persistence of user responses to migration prompts. Stored in
 * `chrome.storage.local` (intentional — a migration confirms intent on
 * THIS device; inheriting acceptance via sync would defeat the point,
 * mirroring the per-device consent model in the parent PRD #348).
 *
 * Responses are keyed by migration id and take one of three values:
 *   "accept"  — user opted into the proposed change.
 *   "decline" — user explicitly rejected the change.
 *   "dismiss" — user closed the banner without choosing. Pref state stays
 *               unchanged. NOTE: like "decline", a recorded "dismiss" is
 *               terminal for that migration — evaluateMigrations() skips ANY
 *               recorded response, so the banner is not shown again for it.
 *               Cross-version re-prompting is governed by the version-window
 *               gate (fromVersion/toVersion), not the response value (#736).
 */

const STORAGE_KEY = "migrationResponses";

/**
 * Returns the stored response for a migration id, or null if none.
 * @param {string} migrationId
 * @returns {Promise<"accept"|"decline"|"dismiss"|null>}
 */
export async function getResponse(migrationId) {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get({ [STORAGE_KEY]: {} }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r);
      });
    });
    const responses = result[STORAGE_KEY] || {};
    return responses[migrationId] || null;
  } catch (err) {
    console.error("[MUGA] migration-storage.getResponse:", err);
    return null;
  }
}

/**
 * Returns the full map of stored responses.
 * @returns {Promise<Record<string, "accept"|"decline"|"dismiss">>}
 */
export async function getAllResponses() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get({ [STORAGE_KEY]: {} }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r);
      });
    });
    return result[STORAGE_KEY] || {};
  } catch (err) {
    console.error("[MUGA] migration-storage.getAllResponses:", err);
    return {};
  }
}

/**
 * Records a user's response to a migration.
 * @param {string} migrationId
 * @param {"accept"|"decline"|"dismiss"} response
 * @returns {Promise<void>}
 */
export async function recordResponse(migrationId, response) {
  if (!migrationId || !["accept", "decline", "dismiss"].includes(response)) {
    throw new Error(`migration-storage: invalid response ${JSON.stringify({migrationId, response})}`);
  }
  try {
    const current = await getAllResponses();
    const updated = { ...current, [migrationId]: response };
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  } catch (err) {
    console.error("[MUGA] migration-storage.recordResponse:", err);
    throw err;
  }
}

/**
 * Clears all stored responses. Intended for testing and devMode only.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.remove(STORAGE_KEY, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  } catch (err) {
    console.error("[MUGA] migration-storage.clearAll:", err);
    throw err;
  }
}
