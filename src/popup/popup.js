/**
 * MUGA — Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { processUrl } from "../lib/cleaner.js";
import { getPrefs, sessionStorage } from "../lib/storage.js";

const CLIPBOARD_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-7A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;

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
  enabledToggle.setAttribute("aria-label", t("toggle_enabled", lang));
  enabledToggle.closest(".toggle").setAttribute("title", t("toggle_title", lang));

  enabledToggle.checked = prefs.enabled;

  enabledToggle.addEventListener("change", () =>
    chrome.storage.sync.set({ enabled: enabledToggle.checked }));

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Footer rate link — always available, passive
  const popupRateLink = document.getElementById("popup-rate-link");
  if (popupRateLink) {
    const isFirefox = navigator.userAgent.includes("Firefox");
    popupRateLink.href = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
    popupRateLink.target = "_blank";
  }

  // Growth features
  const growthBar = document.getElementById("growth-bar");
  const rateBtn = document.getElementById("rate-btn");
  const shareBtn = document.getElementById("share-btn");
  const urlsCleaned = local.stats?.urlsCleaned ?? 0;

  // Easter eggs — milestone titles on the logo
  const logoEl = document.getElementById("logo-text");
  if (logoEl && urlsCleaned > 0) {
    const milestones = [
      [10000, "MUGA — Legendary URL cleaner"],
      [5000,  "MUGA — Master of Clean URLs"],
      [1000,  "MUGA — Tracking Terminator"],
      [500,   "MUGA — Drain the Swamp Pro"],
      [100,   "MUGA — Making URLs Great Again"],
      [10,    "MUGA — First steps to clean URLs"],
    ];
    const milestone = milestones.find(([threshold]) => urlsCleaned >= threshold);
    if (milestone) logoEl.title = milestone[1];
  }

  growthBar.hidden = false;

  // Rate nudge: 200+ URLs AND 7+ days since install, max 3 nudges,
  // at least 3 days apart, then permanent silence.
  const nudgeData = await chrome.storage.local.get({
    firstUsed: null, nudgeDismissed: false, nudgeShownCount: 0, nudgeLastShown: 0,
  });
  const nudgeSession = await sessionStorage.get({ nudgeSessionSeen: false });
  const daysSinceFirst = nudgeData.firstUsed ? (Date.now() - nudgeData.firstUsed) / 86400000 : 0;
  const daysSinceLastNudge = nudgeData.nudgeLastShown ? (Date.now() - nudgeData.nudgeLastShown) / 86400000 : 999;

  const shouldNudge = urlsCleaned >= 200
    && daysSinceFirst >= 7
    && daysSinceLastNudge >= 3
    && !nudgeData.nudgeDismissed
    && nudgeData.nudgeShownCount < 3
    && !nudgeSession.nudgeSessionSeen;

  if (shouldNudge) {
    rateBtn.hidden = false;
    rateBtn.textContent = t("rate_nudge_btn_short", lang);
    sessionStorage.set({ nudgeSessionSeen: true }).catch(() => {});
    chrome.storage.local.set({
      nudgeShownCount: nudgeData.nudgeShownCount + 1,
      nudgeLastShown: Date.now(),
    }).catch(() => {});
    const isFirefox = navigator.userAgent.includes("Firefox");
    const storeUrl = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
    rateBtn.addEventListener("click", () => {
      chrome.storage.local.set({ nudgeDismissed: true });
      chrome.tabs.create({ url: storeUrl });
    });
  }

  shareBtn.addEventListener("click", () => {
    const isFirefox = navigator.userAgent.includes("Firefox");
    const storeUrl = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";

    const junk = local.stats?.junkRemoved ?? 0;
    const cleaned = local.stats?.urlsCleaned ?? 0;

    // Seasonal easter eggs
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const seasonal = {
      "01-01": "New year, new URLs. Still no tracking.",
      "02-14": "Roses are red, trackers are dead. MUGA cleaned my URLs instead.",
      "03-14": "Happy Pi Day! 3.14159 reasons to clean your URLs.",
      "04-01": "This is not a joke: your URLs had tracking params. Had.",
      "05-04": "May the clean URLs be with you.",
      "10-31": "The scariest thing on the internet? Unclean URLs. Not anymore.",
      "12-25": "All I want for Christmas is clean URLs. Done.",
      "12-31": "My URLs are cleaner than my New Year's resolutions.",
    };

    // Fun phrases — rotated randomly
    const phrases = [
      `I've cleaned ${cleaned} URLs and stripped ${junk} trackers. My browser is basically a spa now.`,
      `${junk} tracking params eliminated. Nothing happened behind my back. You're welcome, privacy.`,
      `MUGA just cleaned ${cleaned} URLs for me. The trackers never saw it coming.`,
      `My URLs used to be 400 characters of garbage. Now they're clean, honest, and short.`,
      `${junk} trackers stripped. No accounts. No servers. No BS. Just clean URLs.`,
      `I installed MUGA and it already cleaned ${cleaned} URLs. This is what browsers should do by default.`,
      `Every link I click gets cleaned before it loads. ${junk} trackers gone. It's free and open source.`,
      `Drain the tracking swamp. ${junk} params removed and counting.`,
    ];

    const pick = seasonal[mmdd] || phrases[Math.floor(Math.random() * phrases.length)];
    const text = `${pick}\n\n${storeUrl}`;

    navigator.clipboard.writeText(text).then(() => {
      shareBtn.textContent = "✓ Copied!";
      setTimeout(() => { shareBtn.textContent = "📋 Share"; }, 1500);
    }).catch(() => {});
  });

  // Clicking the URLs-cleaned stat always toggles the history panel (#178, #237)
  const statUrlsWrap = document.getElementById("stat-urls-wrap");
  statUrlsWrap.addEventListener("click", () => {
    const historySection = document.getElementById("history");
    historySection.hidden = false;
    historySection.open = !historySection.open;
    statUrlsWrap.setAttribute("aria-expanded", String(historySection.open));
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
  if (!url || url.startsWith("chrome://") || url.startsWith("about:") || url.startsWith("moz-extension://") || url.startsWith("chrome-extension://") || url.startsWith("data:") || url.startsWith("blob:")) return;

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

  let domainRules = [];
  try {
    const resp = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    if (resp.ok) domainRules = await resp.json();
  } catch (_) {}

  const result = processUrl(url, { ...prefs, notifyForeignAffiliate: false }, domainRules);

  if (result.cleanUrl === url && result.action === "untouched") {
    // Show original URL as plain reference — no strikethrough, no "after" URL
    const beforeEl = document.getElementById("preview-before");
    beforeEl.textContent = url;
    beforeEl.classList.add("clean-url");
    document.getElementById("preview-after").hidden = true;
  } else {
    document.getElementById("preview-before").textContent = url;
    document.getElementById("preview-after").textContent = result.cleanUrl;

    // Show which params were removed — full cleaning receipt
    if (result.removedTracking?.length > 0) {
      const removedEl = document.getElementById("preview-removed");
      removedEl.textContent = `${t("removed_params_label", lang)} ${result.removedTracking.join(", ")}`;
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

  const section = document.getElementById("history");
  const list = document.getElementById("history-list");

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = t("history_empty", lang);
    list.appendChild(empty);
    return;
  }

  history.forEach(entry => {
    const entryDiv = document.createElement("div");
    entryDiv.className = "history-entry";
    entryDiv.title = t("history_copy_hint", lang);
    entryDiv.setAttribute("role", "button");
    entryDiv.setAttribute("tabindex", "0");

    const beforeDiv = document.createElement("div");
    beforeDiv.className = "history-url before";
    beforeDiv.textContent = entry.original;

    const afterRow = document.createElement("div");
    afterRow.className = "history-after-row";

    const afterDiv = document.createElement("div");
    afterDiv.className = "history-url after";
    afterDiv.textContent = entry.clean;

    const copyCleanBtn = document.createElement("button");
    copyCleanBtn.className = "history-copy-clean-btn";
    copyCleanBtn.setAttribute("aria-label", t("history_copy_hint", lang));
    copyCleanBtn.innerHTML = CLIPBOARD_SVG;

    afterRow.appendChild(afterDiv);
    afterRow.appendChild(copyCleanBtn);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "history-actions";

    const copyOrigBtn = document.createElement("button");
    copyOrigBtn.className = "history-copy-btn";
    copyOrigBtn.textContent = t("history_copy_original", lang);
    copyOrigBtn.setAttribute("aria-label", t("history_copy_original", lang));

    actionsDiv.appendChild(copyOrigBtn);
    entryDiv.appendChild(beforeDiv);
    entryDiv.appendChild(afterRow);
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
      if (e.target === copyOrigBtn || copyCleanBtn.contains(e.target)) return; // handled separately
      navigator.clipboard.writeText(entry.clean).then(() => {
        const orig = afterDiv.textContent;
        entryDiv.classList.add("copied");
        afterDiv.textContent = t("history_copied", lang);
        setTimeout(() => {
          entryDiv.classList.remove("copied");
          afterDiv.textContent = orig;
        }, 1200);
      }).catch(() => {});
    });

    // Copy clean URL icon button
    copyCleanBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.clean).then(() => {
        copyCleanBtn.innerHTML = "✓";
        copyCleanBtn.style.fontSize = "11px";
        setTimeout(() => {
          copyCleanBtn.innerHTML = CLIPBOARD_SVG;
          copyCleanBtn.style.fontSize = "";
        }, 1200);
      }).catch(() => {});
    });

    // Copy original URL button (#178)
    copyOrigBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.original).then(() => {
        const origText = copyOrigBtn.textContent;
        copyOrigBtn.textContent = t("history_copied", lang);
        setTimeout(() => { copyOrigBtn.textContent = origText; }, 1200);
      }).catch(() => {});
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
