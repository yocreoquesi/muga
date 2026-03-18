/**
 * MUGA — Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

async function init() {
  const prefs = await chrome.storage.sync.get({
    enabled: true,
    injectOwnAffiliate: true,
    notifyForeignAffiliate: false,
    stats: { trackingRemoved: 0, affiliatesInjected: 0, foreignDetected: 0 },
  });

  // Estadísticas
  document.getElementById("stat-tracking").textContent =
    formatStat(prefs.stats?.trackingRemoved ?? 0);
  document.getElementById("stat-injected").textContent =
    formatStat(prefs.stats?.affiliatesInjected ?? 0);
  document.getElementById("stat-foreign").textContent =
    formatStat(prefs.stats?.foreignDetected ?? 0);

  // Toggles
  const enabledToggle = document.getElementById("enabled-toggle");
  const injectToggle = document.getElementById("inject-toggle");
  const notifyToggle = document.getElementById("notify-toggle");

  enabledToggle.checked = prefs.enabled;
  injectToggle.checked = prefs.injectOwnAffiliate;
  notifyToggle.checked = prefs.notifyForeignAffiliate;

  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  injectToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ injectOwnAffiliate: injectToggle.checked });
  });

  notifyToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ notifyForeignAffiliate: notifyToggle.checked });
  });

  // Abrir página de opciones
  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function formatStat(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

document.addEventListener("DOMContentLoaded", init);
