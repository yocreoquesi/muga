/**
 * MUGA — Storage helpers
 * Uses chrome.storage.sync so preferences are synced across
 * all devices signed into the same account.
 */

const DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],   // e.g. ["amazon.es", "booking.com::aid::123456"]
  whitelist: [],   // e.g. ["amazon.es::tag::youtuber-21"]
  stats: {
    urlsCleaned: 0,
    junkRemoved: 0,
    referralsSpotted: 0,
  },
  firstUsed: null,
  nudgeDismissed: false,
};

export async function getPrefs() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, result => resolve(result));
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
    prefs.blacklist.push(entry);
    await setPrefs({ blacklist: prefs.blacklist });
  }
}

export async function removeFromBlacklist(entry) {
  const prefs = await getPrefs();
  await setPrefs({ blacklist: prefs.blacklist.filter(e => e !== entry) });
}

export async function addToWhitelist(entry) {
  const prefs = await getPrefs();
  if (!prefs.whitelist.includes(entry)) {
    prefs.whitelist.push(entry);
    await setPrefs({ whitelist: prefs.whitelist });
  }
}

export async function removeFromWhitelist(entry) {
  const prefs = await getPrefs();
  await setPrefs({ whitelist: prefs.whitelist.filter(e => e !== entry) });
}

export async function incrementStat(key, amount = 1) {
  const prefs = await getPrefs();
  const stats = prefs.stats || DEFAULTS.stats;
  stats[key] = (stats[key] || 0) + amount;
  await setPrefs({ stats });
}

export async function getStats() {
  const prefs = await getPrefs();
  return prefs.stats || DEFAULTS.stats;
}
