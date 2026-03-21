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
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],     // e.g. ["amazon.es", "booking.com::aid::123456"]
  whitelist: [],     // e.g. ["amazon.es::tag::youtuber-21"]
  customParams: [],  // e.g. ["ref_code", "promo_id"]
  dnrEnabled: true,
  blockPings: true,
  ampRedirect: true,
  unwrapRedirects: true,
  language: "en",
  onboardingDone: false,
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

export async function incrementStat(key, amount = 1) {
  const local = await getStats();
  const stats = local.stats || STAT_DEFAULTS.stats;
  stats[key] = (stats[key] || 0) + amount;
  await setStats({ stats });
}

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
