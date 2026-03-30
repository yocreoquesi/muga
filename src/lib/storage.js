/**
 * MUGA: Storage helpers
 *
 * Two buckets:
 *   chrome.storage.sync:  user preferences (synced across devices, 100KB quota)
 *   chrome.storage.local: stats and ephemeral state (device-only, 10MB quota)
 */

// ── Sync: user preferences ──────────────────────────────────────────────────

export const PREF_DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: false,  // set to true only if user opts in during onboarding (#224)
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],     // e.g. ["amazon.es", "booking.com::aid::123456"]
  whitelist: [],     // e.g. ["amazon.es::tag::youtuber-21"]
  customParams: [],  // e.g. ["ref_code", "promo_id"]
  dnrEnabled: true,
  contextMenuEnabled: true,
  blockPings: true,
  ampRedirect: true,
  unwrapRedirects: true,
  language: "en",
  onboardingDone: false,
  consentVersion: null,   // e.g. "1.0". Bump to re-trigger onboarding on ToS changes.
  consentDate: null,      // Unix timestamp (ms) of when the user accepted
  disabledCategories: [],  // e.g. ["utm", "ads"]. Params in these categories are not stripped.
  // TODO(C8): devMode should migrate to chrome.storage.local. It is device-specific
  //           and does not need to sync across devices. Left here for now to avoid
  //           breaking options.js which reads it via getPrefs(). (#259)
  toastDuration: 15,  // seconds: how long the affiliate notification stays visible
  devMode: false,
};

export async function getPrefs() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.sync.get(PREF_DEFAULTS, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  } catch (err) {
    console.error("[MUGA] getPrefs failed:", err);
    return { ...PREF_DEFAULTS };
  }
}

export async function setPrefs(partial) {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.sync.set(partial, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  } catch (err) {
    console.error("[MUGA] setPrefs failed:", err);
  }
}

// ── Local: stats and nudge state ─────────────────────────────────────────────

const STAT_DEFAULTS = {
  stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
  firstUsed: null,
  nudgeDismissed: false,
};

export async function getStats() {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.local.get(STAT_DEFAULTS, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  } catch (err) {
    console.error("[MUGA] getStats failed:", err);
    return { ...STAT_DEFAULTS };
  }
}

export async function setStats(partial) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(partial, () => {
      if (chrome.runtime.lastError) {
        console.error("[MUGA] setStats failed:", chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// ── incrementStat: batch-write pattern to prevent count loss under concurrency ──
//
// Problem: the naive read-modify-write pattern loses increments when two calls
// race: both read the same value before either writes.
//
// Solution: accumulate deltas in a pending map and flush them in a single
// read-modify-write after a short timer (~100 ms).  All increments that arrive
// before the flush are coalesced, so only one storage round-trip is needed
// regardless of how many concurrent callers fire.

let _pendingStats = {};
let _statsFlushTimer = null;

async function _flushStats() {
  _statsFlushTimer = null;
  if (Object.keys(_pendingStats).length === 0) return;
  const toFlush = _pendingStats;
  _pendingStats = {};

  try {
    const local = await getStats();
    const stats = { ...(local.stats || STAT_DEFAULTS.stats) };
    for (const [key, delta] of Object.entries(toFlush)) {
      stats[key] = (stats[key] || 0) + delta;
    }
    await setStats({ stats });
  } catch {
    // Restore pending stats so they aren't lost on write failure
    for (const [key, delta] of Object.entries(toFlush)) {
      _pendingStats[key] = (_pendingStats[key] || 0) + delta;
    }
  }
}

export function incrementStat(key, amount = 1) {
  _pendingStats[key] = (_pendingStats[key] || 0) + amount;
  if (!_statsFlushTimer) {
    // MV3 service workers can be terminated at any time without firing onSuspend,
    // so a microtask is not reliable -- the worker may be killed before the
    // microtask queue drains. A short setTimeout gives the JS engine a chance to
    // finish the current task first while still batching rapid calls together.
    // Trade-off: a ~50ms window remains where a sudden termination can still lose
    // the pending increment, but this is acceptable for non-critical counters.
    _statsFlushTimer = setTimeout(_flushStats, 50);
  }
}

// C13: flush pending stats immediately when the service worker is about to suspend (MV2 only)
if (typeof chrome !== "undefined" && chrome.runtime?.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    if (Object.keys(_pendingStats).length > 0) {
      _flushStats();
    }
  });
}

// ── Session storage ponyfill: Firefox MV2 compat (#184) ──────────────────────
//
// chrome.storage.session is MV3-only (Chrome 102+). Firefox ships MUGA as MV2
// and does not expose this API, causing crashes in the service worker and popup.
// This ponyfill falls back to an in-memory Map when the API is unavailable.
// The Map is cleared on extension reload/restart, matching session semantics.

const _memStore = new Map();

export const sessionStorage = {
  get: (keys) => {
    if (chrome.storage.session) return chrome.storage.session.get(keys);
    const result = {};
    const ks = Array.isArray(keys)
      ? keys
      : typeof keys === "string"
      ? [keys]
      : Object.keys(keys);
    ks.forEach(k => {
      if (_memStore.has(k)) {
        result[k] = _memStore.get(k);
      } else if (keys !== null && typeof keys === "object" && !Array.isArray(keys)) {
        // Return default value when provided via object form { key: default }
        result[k] = keys[k];
      }
    });
    return Promise.resolve(result);
  },
  set: (items) => {
    if (chrome.storage.session) return chrome.storage.session.set(items);
    Object.entries(items).forEach(([k, v]) => _memStore.set(k, v));
    return Promise.resolve();
  },
  remove: (keys) => {
    if (chrome.storage.session) return chrome.storage.session.remove(keys);
    const ks = Array.isArray(keys) ? keys : [keys];
    ks.forEach(k => _memStore.delete(k));
    return Promise.resolve();
  },
};

// NOTE: Both URL history and debug logs are intentionally session-only.
// Debug logs contain domains, paths, and cleaned URLs — persisting them would
// create a de facto browsing history, the same privacy concern that rules out
// persistent URL history. Evaluated and rejected 2026-03-30.

/**
 * One-time migration: moves stats out of chrome.storage.sync into
 * chrome.storage.local. Safe to call on every startup. Exits immediately
 * if migration already done or no old data exists.
 */
export async function migrateStatsToLocal() {
  const syncData = await new Promise(resolve =>
    chrome.storage.sync.get({ stats: null, firstUsed: null, nudgeDismissed: null }, resolve)
  );

  const hasOldStats =
    syncData.stats !== null ||
    syncData.firstUsed !== null ||
    syncData.nudgeDismissed !== null;

  if (!hasOldStats) return;

  // Copy to local (only if local doesn't already have data)
  const localData = await getStats();
  const merged = {
    stats: syncData.stats ?? localData.stats,
    firstUsed: syncData.firstUsed ?? localData.firstUsed,
    nudgeDismissed: syncData.nudgeDismissed ?? localData.nudgeDismissed,
  };
  await setStats(merged);

  // Remove from sync
  await new Promise(resolve =>
    chrome.storage.sync.remove(["stats", "firstUsed", "nudgeDismissed"], resolve)
  );
}
