/**
 * MUGA — Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { processUrl } from "../lib/cleaner.js";
import { getPrefs } from "../lib/storage.js";
import { getSupportedStores } from "../lib/affiliates.js";

const NUDGE_URL_THRESHOLD = 150;
const NUDGE_DAY_THRESHOLD = 10;
const MS_PER_DAY          = 86_400_000;

async function init() {
  const lang = await getStoredLang();
  applyTranslations(lang);

  const [prefs, local] = await Promise.all([
    getPrefs(),
    chrome.storage.local.get({
      stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
      firstUsed: null,
      nudgeDismissed: false,
    }),
  ]);

  document.getElementById("stat-urls").textContent =
    formatStat(local.stats?.urlsCleaned ?? 0);
  document.getElementById("stat-junk").textContent =
    formatStat(local.stats?.junkRemoved ?? 0);
  document.getElementById("stat-referrals").textContent =
    formatStat(local.stats?.referralsSpotted ?? 0);

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

  // Hide the inject toggle row when no affiliate accounts are active.
  // The feature does nothing without a configured ourTag, so showing it
  // only adds confusion.
  const hasActiveStores = getSupportedStores().some(s => s.ourTag && s.ourTag.trim() !== "");
  if (!hasActiveStores) {
    const injectRow = injectToggle.closest("label.option-row");
    if (injectRow) injectRow.hidden = true;
  }

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  maybeShowNudge({ ...prefs, ...local }, lang);
  await showUrlPreview(prefs, lang);
  await showHistory();
  initTabs(lang);
}

async function showUrlPreview(prefs, lang) {
  // Skip on internal browser pages, new tabs, etc.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!url || url.startsWith("chrome://") || url.startsWith("about:") || url.startsWith("moz-extension://") || url.startsWith("chrome-extension://")) return;

  const section = document.getElementById("preview");
  section.hidden = false;

  if (prefs.enabled === false) {
    const previewClean = document.getElementById("preview-clean");
    previewClean.hidden = false;
    previewClean.textContent = t("muga_disabled", lang);
    previewClean.style.color = "var(--text2)";
    return;
  }

  const result = processUrl(url, { ...prefs, notifyForeignAffiliate: false });

  if (result.cleanUrl === url && result.action === "untouched") {
    document.getElementById("preview-clean").hidden = false;
    document.getElementById("preview-clean").textContent = t("preview_clean", lang);
  } else {
    document.getElementById("preview-before").textContent = url;
    document.getElementById("preview-after").textContent = result.cleanUrl;
  }
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
    chrome.storage.local.set({ nudgeDismissed: true });
  });
}

function formatStat(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

async function showHistory() {
  const data = await chrome.storage.session.get({ history: [] });
  const history = data.history;
  if (!history.length) return;

  const section = document.getElementById("history");
  const list = document.getElementById("history-list");
  section.hidden = false;

  history.forEach(entry => {
    const entryDiv = document.createElement("div");
    entryDiv.className = "history-entry";

    const beforeDiv = document.createElement("div");
    beforeDiv.className = "history-url before";
    beforeDiv.textContent = entry.original;

    const afterDiv = document.createElement("div");
    afterDiv.className = "history-url after";
    afterDiv.textContent = entry.clean;

    entryDiv.appendChild(beforeDiv);
    entryDiv.appendChild(afterDiv);
    list.appendChild(entryDiv);
  });
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function initTabs(lang) {
  const tabCurrent = document.getElementById("tab-current");
  const tabBatch   = document.getElementById("tab-batch");
  const panelCurrent = document.getElementById("current-panel");
  const panelBatch   = document.getElementById("batch-panel");

  function switchTab(active) {
    const isBatch = active === "batch";
    tabCurrent.classList.toggle("active", !isBatch);
    tabBatch.classList.toggle("active", isBatch);
    tabCurrent.setAttribute("aria-selected", String(!isBatch));
    tabBatch.setAttribute("aria-selected", String(isBatch));
    panelCurrent.hidden = isBatch;
    panelBatch.hidden   = !isBatch;
  }

  tabCurrent.addEventListener("click", () => switchTab("current"));
  tabBatch.addEventListener("click",   () => switchTab("batch"));
  initBatchPanel(lang);
}

// ---------------------------------------------------------------------------
// Batch URL cleaner
// ---------------------------------------------------------------------------
async function batchClean(rawText) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const prefs = await getPrefs();
  const results = lines.map(line => {
    try {
      const r = processUrl(line, { ...prefs, notifyForeignAffiliate: false, injectOwnAffiliate: false });
      return r.cleanUrl || line;
    } catch (e) {
      return line; // Return original if parsing fails
    }
  });
  return results;
}

function initBatchPanel(lang) {
  const cleanBtn  = document.getElementById("batch-clean-btn");
  const copyBtn   = document.getElementById("batch-copy-all");
  const inputArea = document.getElementById("batch-input");
  const outputArea = document.getElementById("batch-output");
  const resultsDiv = document.getElementById("batch-results");
  const countSpan  = document.getElementById("batch-count");

  cleanBtn.addEventListener("click", async () => {
    const raw = inputArea.value;
    if (!raw.trim()) return;
    const cleaned = await batchClean(raw);
    outputArea.value = cleaned.join("\n");
    countSpan.textContent = `${cleaned.length} ${t("batch_result_count", lang)}`;
    resultsDiv.hidden = false;
  });

  copyBtn.addEventListener("click", () => {
    if (!outputArea.value) return;
    navigator.clipboard.writeText(outputArea.value).catch(() => {
      outputArea.select();
      document.execCommand("copy");
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
