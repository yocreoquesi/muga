/**
 * MUGA — Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { processUrl } from "../lib/cleaner.js";
import { getPrefs, sessionStorage } from "../lib/storage.js";

async function init() {
  const lang = await getStoredLang();
  applyTranslations(lang);

  const [prefs, local] = await Promise.all([
    getPrefs(),
    chrome.storage.local.get({
      stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
    }),
  ]);

  document.getElementById("stat-urls").textContent =
    formatStat(local.stats?.urlsCleaned ?? 0);
  document.getElementById("stat-junk").textContent =
    formatStat(local.stats?.junkRemoved ?? 0);
  document.getElementById("stat-referrals").textContent =
    formatStat(local.stats?.referralsSpotted ?? 0);

  const enabledToggle = document.getElementById("enabled-toggle");

  enabledToggle.checked = prefs.enabled;

  enabledToggle.addEventListener("change", () =>
    chrome.storage.sync.set({ enabled: enabledToggle.checked }));

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Clicking the URLs-cleaned stat toggles the history panel (#178)
  const statUrlsWrap = document.getElementById("stat-urls-wrap");
  statUrlsWrap.addEventListener("click", () => {
    const historySection = document.getElementById("history");
    if (historySection.hidden) return; // no history to show
    historySection.open = !historySection.open;
  });
  statUrlsWrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      statUrlsWrap.click();
    }
  });

  await showUrlPreview(prefs, lang);
  await showHistory(lang);
}

async function showUrlPreview(prefs, lang) {
  // Skip on internal browser pages, new tabs, etc.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!url || url.startsWith("chrome://") || url.startsWith("about:") || url.startsWith("moz-extension://") || url.startsWith("chrome-extension://")) return;

  const section = document.getElementById("preview");
  section.hidden = false;

  // Show per-tab badge count (#89)
  if (tab?.id) {
    const key = `tab_${tab.id}`;
    const sessionData = await sessionStorage.get({ [key]: 0 });
    const count = sessionData[key];
    if (count > 0) {
      const badge = document.getElementById("tab-badge");
      badge.textContent = `${count} ${t("tab_badge_label", lang)}`;
      badge.hidden = false;
    }
  }

  if (prefs.enabled === false) {
    const previewClean = document.getElementById("preview-clean");
    previewClean.hidden = false;
    previewClean.textContent = t("muga_disabled", lang);
    previewClean.style.color = "var(--text2)";
    return;
  }

  const result = processUrl(url, { ...prefs, notifyForeignAffiliate: false });

  if (result.cleanUrl === url && result.action === "untouched") {
    // Show original URL as plain reference — no strikethrough, no "after" URL
    const beforeEl = document.getElementById("preview-before");
    beforeEl.textContent = url;
    beforeEl.classList.add("clean-url");
    document.getElementById("preview-after").hidden = true;
  } else {
    document.getElementById("preview-before").textContent = url;
    document.getElementById("preview-after").textContent = result.cleanUrl;

    // Show which params were removed (#85)
    if (result.removedTracking?.length > 0) {
      const removedEl = document.getElementById("preview-removed");
      const MAX = 4;
      const shown = result.removedTracking.slice(0, MAX);
      const extra = result.removedTracking.length - MAX;
      let label = `${t("removed_params_label", lang)} ${shown.join(", ")}`;
      if (extra > 0) label += ` +${extra}`;
      removedEl.textContent = label;
      removedEl.hidden = false;
    }
  }
}

function formatStat(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

async function showHistory(lang) {
  const data = await sessionStorage.get({ history: [] });
  const history = data.history;
  if (!history.length) return;

  const section = document.getElementById("history");
  const list = document.getElementById("history-list");
  section.hidden = false;

  history.forEach(entry => {
    const entryDiv = document.createElement("div");
    entryDiv.className = "history-entry";
    entryDiv.title = t("history_copy_hint", lang);
    entryDiv.setAttribute("role", "button");
    entryDiv.setAttribute("tabindex", "0");

    const beforeDiv = document.createElement("div");
    beforeDiv.className = "history-url before";
    beforeDiv.textContent = entry.original;

    const afterDiv = document.createElement("div");
    afterDiv.className = "history-url after";
    afterDiv.textContent = entry.clean;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "history-actions";

    const copyOrigBtn = document.createElement("button");
    copyOrigBtn.className = "history-copy-btn";
    copyOrigBtn.textContent = t("history_copy_original", lang);
    copyOrigBtn.setAttribute("aria-label", t("history_copy_original", lang));

    actionsDiv.appendChild(copyOrigBtn);
    entryDiv.appendChild(beforeDiv);
    entryDiv.appendChild(afterDiv);
    entryDiv.appendChild(actionsDiv);
    list.appendChild(entryDiv);

    // Keyboard activation for history entries (#127)
    entryDiv.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        entryDiv.click();
      }
    });

    // Click to copy clean URL (#87)
    entryDiv.addEventListener("click", (e) => {
      if (e.target === copyOrigBtn) return; // handled separately
      navigator.clipboard.writeText(entry.clean).then(() => {
        const orig = afterDiv.textContent;
        entryDiv.classList.add("copied");
        afterDiv.textContent = t("history_copied", lang);
        setTimeout(() => {
          entryDiv.classList.remove("copied");
          afterDiv.textContent = orig;
        }, 1200);
      });
    });

    // Copy original URL button (#178)
    copyOrigBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.original).then(() => {
        const origText = copyOrigBtn.textContent;
        copyOrigBtn.textContent = t("history_copied", lang);
        setTimeout(() => { copyOrigBtn.textContent = origText; }, 1200);
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
