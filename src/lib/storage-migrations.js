/**
 * MUGA: One-time storage migrations
 *
 * Extracted from storage.js (#826 PR2) — pure relocation, zero behaviour change.
 *
 * Design rule: this module must NOT import from storage.js to avoid circularity.
 * The two helpers below need local-storage reads/writes that would normally go
 * through getStats/setStats — instead they call chrome.storage.local directly,
 * keeping the module dependency-free from its sibling.
 */

// ── One-time migration ────────────────────────────────────────────────────────

/**
 * One-time migration: moves stats out of chrome.storage.sync into
 * chrome.storage.local. Safe to call on every startup. Exits immediately
 * if migration already done or no old data exists.
 */
export async function migrateStatsToLocal() {
  const STAT_DEFAULTS = {
    stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
    firstUsed: null,
    nudgeDismissed: false,
  };

  const syncData = await new Promise((resolve, reject) =>
    chrome.storage.sync.get({ stats: null, firstUsed: null, nudgeDismissed: null }, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    })
  ).catch(() => ({ stats: null, firstUsed: null, nudgeDismissed: null }));

  const hasOldStats =
    syncData.stats !== null ||
    syncData.firstUsed !== null ||
    syncData.nudgeDismissed !== null;

  if (!hasOldStats) return;

  // Copy to local (only if local doesn't already have data)
  const localData = await new Promise((resolve, reject) =>
    chrome.storage.local.get(STAT_DEFAULTS, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    })
  ).catch(() => ({ ...STAT_DEFAULTS }));

  const merged = {
    stats: syncData.stats ?? localData.stats,
    firstUsed: syncData.firstUsed ?? localData.firstUsed,
    nudgeDismissed: syncData.nudgeDismissed ?? localData.nudgeDismissed,
  };

  await new Promise((resolve, reject) =>
    chrome.storage.local.set(merged, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    })
  );

  // Remove from sync
  await new Promise((resolve, reject) =>
    chrome.storage.sync.remove(["stats", "firstUsed", "nudgeDismissed"], () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    })
  ).catch(() => {}); // best-effort: old keys already migrated, removal is non-critical
}

/**
 * One-time migration (ADR-0004 phase 5, #701): renames `privacyProxyEnabled` →
 * `followShortenersEnabled` in chrome.storage.sync. Safe to call on every
 * startup. Exits immediately if the old key is absent.
 *
 * If the user had `privacyProxyEnabled = true` they were using native shortener
 * resolution (the default since phase 4 / 2.2.0-beta.1), so we preserve their
 * intent by setting `followShortenersEnabled = true`. A false value needs no
 * migration because `followShortenersEnabled` already defaults to false.
 */
export async function migrateLegacyProxyPref() {
  try {
    const data = await new Promise((resolve, reject) =>
      chrome.storage.sync.get({ privacyProxyEnabled: null }, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      })
    ).catch(() => ({ privacyProxyEnabled: null }));

    if (data.privacyProxyEnabled === null) return; // key absent — nothing to do

    const updates = {};
    if (data.privacyProxyEnabled === true) {
      // Preserve user's intent: they had the feature enabled.
      updates.followShortenersEnabled = true;
    }
    // Write followShortenersEnabled only when migrating a `true` value; a false
    // or absent old value needs no write (the new key already defaults to false).
    // The old key is removed unconditionally below regardless.
    if (Object.keys(updates).length > 0) {
      await new Promise((resolve, reject) =>
        chrome.storage.sync.set(updates, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        })
      );
    }
    // Remove the deprecated key.
    await new Promise((resolve) =>
      chrome.storage.sync.remove("privacyProxyEnabled", () => {
        void chrome.runtime.lastError; // non-critical
        resolve();
      })
    );
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}
