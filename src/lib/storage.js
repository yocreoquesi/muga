/**
 * MUGA — Gestión de almacenamiento
 * Usa chrome.storage.sync para que las preferencias se sincronicen
 * entre todos los dispositivos del usuario con la misma cuenta.
 */

const DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  blacklist: [],   // ["amazon.es", "booking.com::aid::123456"]
  whitelist: [],   // ["amazon.es::tag::youtuber-21"]
  stats: {
    trackingRemoved: 0,
    affiliatesInjected: 0,
    foreignDetected: 0,
  },
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

export async function incrementStat(key) {
  const prefs = await getPrefs();
  const stats = prefs.stats || DEFAULTS.stats;
  stats[key] = (stats[key] || 0) + 1;
  await setPrefs({ stats });
}

export async function getStats() {
  const prefs = await getPrefs();
  return prefs.stats || DEFAULTS.stats;
}
