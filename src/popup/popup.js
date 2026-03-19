/**
 * MUGA — Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";

const NUDGE_URL_THRESHOLD = 150;
const NUDGE_DAY_THRESHOLD = 10;
const MS_PER_DAY          = 86_400_000;

async function init() {
  const lang = await getStoredLang();
  applyTranslations(lang);

  const prefs = await chrome.storage.sync.get({
    enabled: true,
    injectOwnAffiliate: true,
    notifyForeignAffiliate: false,
    stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
    firstUsed: null,
    nudgeDismissed: false,
  });

  document.getElementById("stat-urls").textContent =
    formatStat(prefs.stats?.urlsCleaned ?? 0);
  document.getElementById("stat-junk").textContent =
    formatStat(prefs.stats?.junkRemoved ?? 0);
  document.getElementById("stat-referrals").textContent =
    formatStat(prefs.stats?.referralsSpotted ?? 0);

  const enabledToggle = document.getElementById("enabled-toggle");
  const injectToggle  = document.getElementById("inject-toggle");
  const notifyToggle  = document.getElementById("notify-toggle");

  enabledToggle.checked = prefs.enabled;
  injectToggle.checked  = prefs.injectOwnAffiliate;
  notifyToggle.checked  = prefs.notifyForeignAffiliate;

  enabledToggle.addEventListener("change", () =>
    chrome.storage.sync.set({ enabled: enabledToggle.checked }));
  injectToggle.addEventListener("change", () =>
    chrome.storage.sync.set({ injectOwnAffiliate: injectToggle.checked }));
  notifyToggle.addEventListener("change", () =>
    chrome.storage.sync.set({ notifyForeignAffiliate: notifyToggle.checked }));

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  maybeShowNudge(prefs, lang);
}

function maybeShowNudge(prefs, lang) {
  if (prefs.nudgeDismissed) return;
  const urlsCleaned   = prefs.stats?.urlsCleaned ?? 0;
  const firstUsed     = prefs.firstUsed;
  if (!firstUsed) return;
  const daysInstalled = (Date.now() - firstUsed) / MS_PER_DAY;
  if (urlsCleaned < NUDGE_URL_THRESHOLD || daysInstalled < NUDGE_DAY_THRESHOLD) return;

  const nudge = document.getElementById("nudge");
  document.getElementById("nudge-text").textContent =
    t("nudge_text", lang).replace("{n}", formatStat(urlsCleaned));

  const reviewUrl = typeof browser !== "undefined"
    ? "https://addons.mozilla.org/firefox/addon/muga-make-urls-great-again/"
    : "https://chromewebstore.google.com/detail/muga-make-urls-great-again/";
  document.getElementById("nudge-review").href = reviewUrl;

  nudge.hidden = false;

  document.getElementById("nudge-dismiss").addEventListener("click", () => {
    nudge.hidden = true;
    chrome.storage.sync.set({ nudgeDismissed: true });
  });
}

function formatStat(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

document.addEventListener("DOMContentLoaded", init);
