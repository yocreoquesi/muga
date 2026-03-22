/**
 * MUGA — Storage helpers
 *
 * Two buckets:
 *   chrome.storage.sync  — user preferences (synced across devices, 100KB quota)
 *   chrome.storage.local — stats and ephemeral state (device-only, 10MB quota)
 */

// ── Sync: user preferences ──────────────────────────────────────────────────

export const PREF_DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: false,  // set to true only if user opts in during onboarding (#224)
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
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
  consentVersion: null,   // e.g. "1.0" — bump to re-trigger onboarding on ToS changes
  consentDate: null,      // Unix timestamp (ms) of when the user accepted
  disabledCategories: [],  // e.g. ["utm", "ads"] — params in these categories are not stripped
};

export async function getPrefs() {
  return new Promise(resolve => {
    chrome.storage.sync.get(PREF_DEFAULTS, resolve);
  });
}

export async function setPrefs(partial) {
  return new Promise(resolve => {
    chrome.storage.sync.set(partial, resolve);
  });
}

export async function addToBlacklist(entry) {
  const prefs = await getPrefs();
  if (!prefs.blacklist.includes(entry)) {
    await setPrefs({ blacklist: [...prefs.blacklist, entry] });
  }
}

export async function removeFromBlacklist(entry) {
  const prefs = await getPrefs();
  await setPrefs({ blacklist: prefs.blacklist.filter(e => e !== entry) });
}

export async function addToWhitelist(entry) {
  const prefs = await getPrefs();
  if (!prefs.whitelist.includes(entry)) {
    await setPrefs({ whitelist: [...prefs.whitelist, entry] });
  }
}

export async function removeFromWhitelist(entry) {
  const prefs = await getPrefs();
  await setPrefs({ whitelist: prefs.whitelist.filter(e => e !== entry) });
}

// ── Local: stats and nudge state ─────────────────────────────────────────────

const STAT_DEFAULTS = {
  stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
  firstUsed: null,
  nudgeDismissed: false,
};

export async function getStats() {
  return new Promise(resolve => {
    chrome.storage.local.get(STAT_DEFAULTS, resolve);
  });
}

export async function setStats(partial) {
  return new Promise(resolve => {
    chrome.storage.local.set(partial, resolve);
  });
}

// ── incrementStat — batch-write pattern to prevent count loss under concurrency ─
//
// Problem: the naive read-modify-write pattern loses increments when two calls
// race — both read the same value before either writes.
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

  const local = await getStats();
  const stats = { ...(local.stats || STAT_DEFAULTS.stats) };
  for (const [key, delta] of Object.entries(toFlush)) {
    stats[key] = (stats[key] || 0) + delta;
  }
  await setStats({ stats });
}

export function incrementStat(key, amount = 1) {
  _pendingStats[key] = (_pendingStats[key] || 0) + amount;
  if (!_statsFlushTimer) {
    _statsFlushTimer = setTimeout(_flushStats, 100);
  }
}

// ── Session storage ponyfill — Firefox MV2 compat (#184) ─────────────────────
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

/**
 * One-time migration: moves stats out of chrome.storage.sync into
 * chrome.storage.local. Safe to call on every startup — exits immediately
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
