/**
 * MUGA: Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { processUrl } from "../lib/cleaner.js";
import { getPrefs, sessionStorage, getDomainStats } from "../lib/storage.js";
import { TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";

/** Creates a clipboard SVG icon (12x12) via createElementNS. */
function _createClipboardSvg() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const rect = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: "5", y: "5", width: "9", height: "10", rx: "1.5", stroke: "currentColor", "stroke-width": "1.5", fill: "none" })) rect.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-7A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H4");
  for (const [k, v] of Object.entries({ stroke: "currentColor", "stroke-width": "1.5", fill: "none", "stroke-linecap": "round" })) path.setAttribute(k, v);
  svg.appendChild(rect);
  svg.appendChild(path);
  return svg;
}

/** Replaces element content with a fresh clipboard SVG icon. */
function _setClipboardIcon(el) {
  el.textContent = "";
  el.appendChild(_createClipboardSvg());
}

// ── Param breakdown ───────────────────────────────────────────────────────────

/** Builds a reverse index: param name → { category key, label, labelEs }. Cached as singleton. */
let _paramIndex = null;
function _buildParamIndex() {
  if (_paramIndex) return _paramIndex;
  _paramIndex = new Map();
  for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
    for (const param of catData.params) {
      _paramIndex.set(param.toLowerCase(), {
        categoryKey: catKey,
        label: catData.label,
        labelEs: catData.labelEs,
      });
    }
  }
  return _paramIndex;
}

/** Renders a param breakdown section showing removed params grouped by category. */
function _renderParamBreakdown(removedTracking, lang) {
  const index = _buildParamIndex();
  // Group params by category
  const groups = new Map();
  for (const param of removedTracking) {
    const info = index.get(param.toLowerCase());
    const catKey = info ? info.categoryKey : "other";
    const label = info
      ? (lang === "es" ? info.labelEs : info.label)
      : t("param_category_other", lang);
    if (!groups.has(catKey)) groups.set(catKey, { label, params: [] });
    groups.get(catKey).params.push(param);
  }

  const container = document.createElement("div");
  container.className = "param-breakdown";

  for (const [, group] of groups) {
    const row = document.createElement("div");
    row.className = "breakdown-row";

    const catEl = document.createElement("span");
    catEl.className = "breakdown-cat";
    catEl.textContent = group.label;

    const paramsEl = document.createElement("span");
    paramsEl.className = "breakdown-params";
    paramsEl.textContent = group.params.join(", ");

    row.appendChild(catEl);
    row.appendChild(paramsEl);
    container.appendChild(row);
  }

  return container;
}

/** Initializes popup: loads prefs/stats, renders UI, binds event handlers. */
async function init() {
  const lang = await getStoredLang();
  applyTranslations(lang);

  // --- Consent gate: block popup until user accepts ToS in onboarding ---
  const prefsCheck = await getPrefs();
  if (!prefsCheck.onboardingDone) {
    document.body.innerHTML = "";
    const gate = document.createElement("div");
    gate.className = "consent-gate";
    gate.setAttribute("role", "alertdialog");
    gate.setAttribute("aria-label", "MUGA consent required");
    const logo = document.createElement("div");
    logo.className = "consent-gate-logo";
    logo.textContent = "MUGA";
    const msg = document.createElement("p");
    msg.className = "consent-gate-msg";
    msg.setAttribute("data-i18n", "consent_gate_msg");
    msg.textContent = t("consent_gate_msg", lang);
    const btn = document.createElement("button");
    btn.className = "consent-gate-btn";
    btn.setAttribute("data-i18n", "consent_gate_btn");
    btn.textContent = t("consent_gate_btn", lang);
    gate.appendChild(logo);
    gate.appendChild(msg);
    gate.appendChild(btn);
    document.body.appendChild(gate);
    btn.focus();
    btn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
      window.close();
    });
    return;
  }

  const [prefs, local] = await Promise.all([
    Promise.resolve(prefsCheck),
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

  enabledToggle.addEventListener("change", () => {
    try { chrome.storage.sync.set({ enabled: enabledToggle.checked }); } catch (err) { console.error("[MUGA] save enabled:", err); }
  });

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Footer rate link: always available, passive
  const popupRateLink = document.getElementById("popup-rate-link");
  if (popupRateLink) {
    const isFirefox = navigator.userAgent.includes("Firefox");
    popupRateLink.href = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
    popupRateLink.target = "_blank";
    popupRateLink.rel = "noopener noreferrer";
  }

  // Growth features
  const growthBar = document.getElementById("growth-bar");
  const rateBtn = document.getElementById("rate-btn");
  const shareBtn = document.getElementById("share-btn");
  const urlsCleaned = local.stats?.urlsCleaned ?? 0;

  // Easter eggs: milestone titles on the logo
  const logoEl = document.getElementById("logo-text");
  if (logoEl && urlsCleaned > 0) {
    const milestones = [
      [10000, t("milestone_10000", lang)],
      [5000,  t("milestone_5000", lang)],
      [1000,  t("milestone_1000", lang)],
      [500,   t("milestone_500", lang)],
      [100,   t("milestone_100", lang)],
      [10,    t("milestone_10", lang)],
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
    sessionStorage.set({ nudgeSessionSeen: true }).catch(() => {}); // best-effort; nudge still shows
    chrome.storage.local.set({
      nudgeShownCount: nudgeData.nudgeShownCount + 1,
      nudgeLastShown: Date.now(),
    }).catch(() => {}); // best-effort; count is non-critical
    const isFirefox = navigator.userAgent.includes("Firefox");
    const storeUrl = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
    rateBtn.addEventListener("click", () => {
      try { chrome.storage.local.set({ nudgeDismissed: true }); } catch (err) { console.error("[MUGA] save nudge dismiss:", err); }
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
    const seasonalKeys = {
      "01-01": "share_seasonal_0101",
      "02-14": "share_seasonal_0214",
      "03-14": "share_seasonal_0314",
      "04-01": "share_seasonal_0401",
      "05-04": "share_seasonal_0504",
      "10-31": "share_seasonal_1031",
      "12-25": "share_seasonal_1225",
      "12-31": "share_seasonal_1231",
    };
    const seasonal = Object.fromEntries(
      Object.entries(seasonalKeys).map(([date, key]) => [date, t(key, lang)])
    );

    // Fun phrases: rotated randomly, with backronym hooks
    const phraseReplace = (s) => s.replace("%junk%", junk).replace("%cleaned%", cleaned);
    const phrases = [
      phraseReplace(t("share_phrase_1", lang)),
      phraseReplace(t("share_phrase_2", lang)),
      phraseReplace(t("share_phrase_3", lang)),
      phraseReplace(t("share_phrase_4", lang)),
      phraseReplace(t("share_phrase_5", lang)),
      phraseReplace(t("share_phrase_6", lang)),
      phraseReplace(t("share_phrase_7", lang)),
      phraseReplace(t("share_phrase_8", lang)),
      phraseReplace(t("share_phrase_9", lang)),
    ];

    const pick = seasonal[mmdd] || phrases[Math.floor(Math.random() * phrases.length)];
    const text = `${pick}\n\n${storeUrl}`;

    navigator.clipboard.writeText(text).then(() => {
      shareBtn.textContent = t("share_copied_prefix", lang) + t("share_copied", lang);
      setTimeout(() => { shareBtn.textContent = t("share_copy_prefix", lang) + t("share_btn", lang); }, 1500);
    }).catch(() => {}); // clipboard may fail in restricted contexts; share is non-critical
  });

  // Clicking the URLs-cleaned stat always toggles the history panel (#178, #237)
  const statUrlsWrap = document.getElementById("stat-urls-wrap");
  statUrlsWrap.setAttribute("aria-expanded", "false");
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
  await showHistory(prefs, lang);
  await showDomainStats(prefs, lang);
}

/** Shows a live preview of URL cleaning for the current tab. */
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
  } catch (_) { /* non-critical: preview works without domain rules */ }

  const result = processUrl(url, { ...prefs, notifyForeignAffiliate: false }, domainRules);

  if (result.cleanUrl === url && result.action === "untouched") {
    // Show original URL as plain reference. No strikethrough, no "after" URL
    const beforeEl = document.getElementById("preview-before");
    beforeEl.textContent = url;
    beforeEl.classList.add("clean-url");
    document.getElementById("preview-after").hidden = true;
  } else {
    document.getElementById("preview-before").textContent = url;
    document.getElementById("preview-after").textContent = result.cleanUrl;

    // Show which params were removed: full cleaning receipt
    if (result.removedTracking?.length > 0) {
      const removedEl = document.getElementById("preview-removed");
      removedEl.textContent = `${t("removed_params_label", lang)} ${result.removedTracking.join(", ")}`;
      removedEl.hidden = false;
    }

    // Report broken site: visible to all users when URL was modified and feature flag is on
    if (prefs.showReportButton) {
      const reportLink = document.getElementById("report-broken");
      reportLink.hidden = false;
      reportLink.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          const hostname = new URL(url).hostname;
          const version = chrome.runtime.getManifest().version;
          const removed = result.removedTracking?.join(", ") || "none";
          const action = result.action || "none";
          const features = [
            prefs.dnrEnabled && "DNR",
            prefs.blockPings && "ping-blocking",
            prefs.ampRedirect && "AMP-redirect",
            prefs.unwrapRedirects && "redirect-unwrap",
          ].filter(Boolean).join(", ") || "default";
          const title = encodeURIComponent(`[Report] ${hostname}`);
          const body = encodeURIComponent(
            `## Broken site report\n\n` +
            `**Domain:** ${hostname}\n` +
            `**MUGA version:** ${version}\n` +
            `**Browser:** ${navigator.userAgent}\n` +
            `**Action:** ${action}\n` +
            `**Params removed:** ${removed}\n` +
            `**Features active:** ${features}\n\n` +
            `## What broke?\n\n` +
            `<!-- Describe what stopped working after MUGA cleaned the URL -->\n`
          );
          chrome.tabs.create({ url: `https://github.com/yocreoquesi/muga/issues/new?title=${title}&body=${body}&labels=broken-site` });
        } catch { /* invalid URL */ }
      });
    }

    // Param breakdown: show removed params grouped by category when feature is on
    if (prefs.paramBreakdown === true && result.removedTracking?.length > 0) {
      const previewSection = document.getElementById("preview");
      const details = document.createElement("details");
      details.className = "preview-breakdown";
      const summary = document.createElement("summary");
      summary.textContent = t("param_breakdown_label", lang);
      details.appendChild(summary);
      details.appendChild(_renderParamBreakdown(result.removedTracking, lang));
      previewSection.appendChild(details);
    }
  }
}

/** Formats a number with locale-appropriate thousand separators. */
function formatStat(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Renders the per-domain tracker stats panel. */
async function showDomainStats(prefs, lang) {
  if (!prefs.domainStats) return;

  const section = document.getElementById("domain-stats");
  const list = document.getElementById("domain-stats-list");

  const allStats = await getDomainStats();
  const entries = Object.entries(allStats)
    .sort((a, b) => b[1].params - a[1].params)
    .slice(0, 10);

  section.hidden = false;
  const summary = section.querySelector("summary");
  if (summary) summary.setAttribute("aria-label", t("domain_stats_label", lang));

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "domain-stats-empty";
    empty.textContent = t("domain_stats_empty", lang);
    list.appendChild(empty);
    return;
  }

  for (const [domain, data] of entries) {
    const row = document.createElement("div");
    row.className = "domain-stats-row";

    const nameEl = document.createElement("span");
    nameEl.className = "domain-stats-name";
    nameEl.textContent = domain;

    const paramsEl = document.createElement("span");
    paramsEl.className = "domain-stats-params";
    paramsEl.textContent = `${data.params} ${t("domain_stats_params", lang)}`;

    const urlsEl = document.createElement("span");
    urlsEl.className = "domain-stats-urls";
    urlsEl.textContent = `${data.urls} ${t("domain_stats_urls", lang)}`;

    row.appendChild(nameEl);
    row.appendChild(paramsEl);
    row.appendChild(urlsEl);
    list.appendChild(row);
  }
}

/** Renders the recent URL cleaning history list. */
async function showHistory(prefs, lang) {
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
    _setClipboardIcon(copyCleanBtn);

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

    // Param breakdown: show removed params per history entry when feature is on
    if (prefs.paramBreakdown === true && entry.removedTracking?.length > 0) {
      const details = document.createElement("details");
      details.className = "history-breakdown";
      const summary = document.createElement("summary");
      summary.setAttribute("aria-label", `${entry.removedTracking.length} ${t("param_breakdown_label", lang)}`);
      summary.textContent = t("param_breakdown_label", lang);
      details.appendChild(summary);
      details.appendChild(_renderParamBreakdown(entry.removedTracking, lang));
      entryDiv.appendChild(details);
    }

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
      const orig = afterDiv.textContent;
      navigator.clipboard.writeText(entry.clean).then(() => {
        entryDiv.classList.add("copied");
        afterDiv.textContent = t("history_copied", lang);
        setTimeout(() => {
          entryDiv.classList.remove("copied");
          afterDiv.textContent = orig;
        }, 1200);
      }).catch(() => {
        afterDiv.textContent = "✗";
        setTimeout(() => { afterDiv.textContent = orig; }, 1200);
      });
    });

    // Copy clean URL icon button
    copyCleanBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.clean).then(() => {
        copyCleanBtn.textContent = "✓";
        copyCleanBtn.style.fontSize = "11px";
        setTimeout(() => {
          _setClipboardIcon(copyCleanBtn);
          copyCleanBtn.style.fontSize = "";
        }, 1200);
      }).catch(() => {
        copyCleanBtn.textContent = "✗";
        copyCleanBtn.style.fontSize = "11px";
        setTimeout(() => {
          _setClipboardIcon(copyCleanBtn);
          copyCleanBtn.style.fontSize = "";
        }, 1200);
      });
    });

    // Copy original URL button (#178)
    copyOrigBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const origText = copyOrigBtn.textContent;
      navigator.clipboard.writeText(entry.original).then(() => {
        copyOrigBtn.textContent = t("history_copied", lang);
        setTimeout(() => { copyOrigBtn.textContent = origText; }, 1200);
      }).catch(() => {
        copyOrigBtn.textContent = "✗";
        setTimeout(() => { copyOrigBtn.textContent = origText; }, 1200);
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
