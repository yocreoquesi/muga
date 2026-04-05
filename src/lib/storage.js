/**
 * MUGA: Storage helpers
 *
 * Two buckets:
 *   chrome.storage.sync:  user preferences (synced across devices, 100KB quota)
 *   chrome.storage.local: stats and ephemeral state (device-only, 10MB quota)
 */

// ── Firefox MV2 compat: chrome.* APIs must return Promises ──────────────────
//
// In Chrome MV3, chrome.* APIs return Promises when called without a callback.
// In Firefox MV2, chrome.* is callback-only -- calling without a callback
// returns undefined. This shim wraps callback-based methods so the rest of the
// codebase can use `await chrome.storage.sync.get(...)` etc. without changes.
// The shim is a no-op in Chrome MV3 (APIs already return Promises).

(function shimChromePromises() {
  if (typeof chrome === "undefined") return;

  // Detect once whether chrome.* APIs natively return Promises (Chrome MV3).
  // In Firefox MV2 they are callback-only and return undefined.
  // We probe with a safe, side-effect-free call (storage.sync.get).
  let _nativePromises = false;
  try {
    const probe = chrome.storage?.sync?.get?.({});
    _nativePromises = !!(probe && typeof probe.then === "function");
  } catch { /* assume callback-only */ }

  function wrapMethod(obj, method) {
    if (!obj || !obj[method]) return;
    const original = obj[method].bind(obj);
    obj[method] = function (...args) {
      // If last arg is a callback, pass through to original
      if (typeof args[args.length - 1] === "function") {
        return original(...args);
      }
      // Chrome MV3: APIs already return Promises, pass through
      if (_nativePromises) return original(...args);
      // Firefox MV2 (callback-only): wrap in Promise without probing,
      // because probing side-effectful methods (tabs.create, tabs.remove)
      // would execute the action twice.
      return new Promise((resolve, reject) => {
        original(...args, (res) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(res);
        });
      });
    };
  }

  // chrome.storage.sync / local
  for (const area of [chrome.storage?.sync, chrome.storage?.local]) {
    if (!area) continue;
    for (const m of ["get", "set", "remove", "clear"]) wrapMethod(area, m);
  }

  // chrome.tabs
  if (chrome.tabs) {
    for (const m of ["query", "create", "sendMessage", "remove"]) wrapMethod(chrome.tabs, m);
  }

  // chrome.contextMenus
  if (chrome.contextMenus) {
    wrapMethod(chrome.contextMenus, "removeAll");
  }
})();

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

/**
 * Reads all user preferences from chrome.storage.sync with defaults.
 * @returns {Promise<object>} Preferences merged with PREF_DEFAULTS.
 */
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

/**
 * Writes a partial preferences object to chrome.storage.sync.
 * @param {object} partial - Key/value pairs to merge into stored prefs.
 * @returns {Promise<void>}
 */
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

/**
 * Reads stats and nudge state from chrome.storage.local with defaults.
 * @returns {Promise<object>} Stats merged with STAT_DEFAULTS.
 */
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

/**
 * Writes a partial stats object to chrome.storage.local.
 * @param {object} partial - Key/value pairs to merge into stored stats.
 * @returns {Promise<void>}
 */
export async function setStats(partial) {
  try {
    return await new Promise((resolve, reject) => {
      chrome.storage.local.set(partial, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  } catch (err) {
    console.error("[MUGA] setStats failed:", err);
  }
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

// Detect usable chrome.storage.session: must exist AND return a Promise from get().
// Firefox MV2 may expose chrome.storage.session as a stub that is callback-only
// or non-functional, so a simple truthiness check is not enough.
const _hasSessionStorage = (() => {
  try {
    if (!chrome.storage?.session?.get) return false;
    const probe = chrome.storage.session.get({});
    return probe && typeof probe.then === "function";
  } catch { return false; }
})();

export const sessionStorage = {
  get: (keys) => {
    if (_hasSessionStorage) return chrome.storage.session.get(keys);
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
    if (_hasSessionStorage) return chrome.storage.session.set(items);
    Object.entries(items).forEach(([k, v]) => _memStore.set(k, v));
    return Promise.resolve();
  },
  remove: (keys) => {
    if (_hasSessionStorage) return chrome.storage.session.remove(keys);
    const ks = Array.isArray(keys) ? keys : [keys];
    ks.forEach(k => _memStore.delete(k));
    return Promise.resolve();
  },
};

// NOTE: Both URL history and debug logs are intentionally session-only.
// Debug logs contain domains, paths, and cleaned URLs -- persisting them would
// create a de facto browsing history, the same privacy concern that rules out
// persistent URL history. Evaluated and rejected 2026-03-30.

/**
 * One-time migration: moves stats out of chrome.storage.sync into
 * chrome.storage.local. Safe to call on every startup. Exits immediately
 * if migration already done or no old data exists.
 */
export async function migrateStatsToLocal() {
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
  const localData = await getStats();
  const merged = {
    stats: syncData.stats ?? localData.stats,
    firstUsed: syncData.firstUsed ?? localData.firstUsed,
    nudgeDismissed: syncData.nudgeDismissed ?? localData.nudgeDismissed,
  };
  await setStats(merged);

  // Remove from sync
  await new Promise((resolve, reject) =>
    chrome.storage.sync.remove(["stats", "firstUsed", "nudgeDismissed"], () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    })
  ).catch(() => {}); // best-effort: old keys already migrated, removal is non-critical
}
