/**
 * MUGA: Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { processUrl, parseListEntry } from "../lib/cleaner.js";
import { getPrefs, sessionStorage, getDomainStats } from "../lib/storage.js";
import { TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { isFirefox as detectFirefox } from "../lib/browser-detect.js";
import { createMigrationPrompt } from "../lib/migration-prompt.js";
import { getTestFixtures } from "../lib/test-fixtures.js";
import { findSuspiciousParams } from "../lib/entropy-heuristic.js";
import {
  createTracker as createFrequencyTracker,
  createChromeLocalAdapter as createFrequencyAdapter,
  defaultHasher as frequencyHasher,
} from "../lib/cross-site-frequency.js";
import { presentLedger, DEFAULT_LEDGER_CAPACITY } from "../lib/attribution-ledger.js";
import { renderEntries as renderLedgerEntries } from "../lib/attribution-ledger-view.js";

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

/** Builds a reverse index: param name → { category key, label, labelEs, labelPt, labelDe }. Cached as singleton. */
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
        labelPt: catData.labelPt,
        labelDe: catData.labelDe,
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
      ? ({ es: info.labelEs, pt: info.labelPt, de: info.labelDe }[lang] || info.label)
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
  document.documentElement.lang = lang;
  applyTranslations(lang);

  // --- Consent gate: block popup until user accepts ToS in onboarding ---
  const prefsCheck = await getPrefs();
  if (!prefsCheck.onboardingDone) {
    document.body.innerHTML = "";
    const gate = document.createElement("div");
    gate.className = "consent-gate";
    gate.setAttribute("role", "alertdialog");
    gate.setAttribute("aria-label", "MUGA consent required");
    gate.setAttribute("aria-describedby", "consent-gate-msg");
    const logo = document.createElement("div");
    logo.className = "consent-gate-logo";
    logo.textContent = "MUGA";
    const msg = document.createElement("p");
    msg.id = "consent-gate-msg";
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

  enabledToggle.addEventListener("change", async () => {
    try { chrome.storage.sync.set({ enabled: enabledToggle.checked }); } catch (err) { console.error("[MUGA] save enabled:", err); }
    // Optimistic re-render — the storage.onChanged listener below will also fire
    // once the write lands, but we don't want the user to wait for that roundtrip.
    try {
      await showUrlPreview({ ...prefs, enabled: enabledToggle.checked }, lang);
    } catch (err) { console.error("[MUGA] preview re-render:", err); }
  });

  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Footer rate link: always available, passive
  const popupRateLink = document.getElementById("popup-rate-link");
  if (popupRateLink) {
    const isFirefox = detectFirefox();
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
    const rateBtnLabel = rateBtn.querySelector("[data-i18n='rate_muga_short']") || rateBtn;
    rateBtnLabel.textContent = t("rate_nudge_btn_short", lang);
    sessionStorage.set({ nudgeSessionSeen: true }).catch(() => {}); // best-effort; nudge still shows
    chrome.storage.local.set({
      nudgeShownCount: nudgeData.nudgeShownCount + 1,
      nudgeLastShown: Date.now(),
    }).catch(() => {}); // best-effort; count is non-critical
    const isFirefox = detectFirefox();
    const storeUrl = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
    rateBtn.addEventListener("click", () => {
      try { chrome.storage.local.set({ nudgeDismissed: true }); } catch (err) { console.error("[MUGA] save nudge dismiss:", err); }
      chrome.tabs.create({ url: storeUrl });
    });
  }

  shareBtn.addEventListener("click", () => {
    const isFirefox = detectFirefox();
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

    const shareBtnLabel = shareBtn.querySelector("[data-i18n='share_btn']") || shareBtn;
    navigator.clipboard.writeText(text).then(() => {
      shareBtnLabel.textContent = t("share_copied_prefix", lang) + t("share_copied", lang);
      setTimeout(() => { shareBtnLabel.textContent = t("share_copy_prefix", lang) + t("share_btn", lang); }, 1500);
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
  await showSuspiciousParams(prefs, lang);
  await showRecentActivity(lang);

  // Reactivity: re-render the preview when the user flips relevant settings —
  // either from the popup itself (the enabled toggle already calls showUrlPreview
  // optimistically) OR from the Options page opened in another tab. Watch for
  // enabled, blacklist (per-domain disable + aggressive strip), whitelist, and
  // customParams. We refetch full prefs instead of diffing to stay simple.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    if (!changes.enabled && !changes.blacklist && !changes.whitelist && !changes.customParams) return;
    try {
      const fresh = await getPrefs();
      // Keep the popup's own toggle in sync with any external change
      if (changes.enabled && enabledToggle.checked !== fresh.enabled) {
        enabledToggle.checked = fresh.enabled;
      }
      await showUrlPreview(fresh, lang);
    } catch (err) {
      console.error("[MUGA] reactive re-render:", err);
    }
  });

  // --- Migration prompt (#369) ----------------------------------------
  // Wires the migration banner. Today MIGRATIONS is empty, so the
  // banner never renders. When a future release adds a spec entry,
  // refresh() picks it up automatically on the next popup open.
  await wireMigrationPrompt(lang);
}

async function wireMigrationPrompt(lang) {
  const root = document.getElementById("migration-banner");
  if (!root) return; // popup variant without the banner — nothing to do

  // E2E fixtures (#407): null in production. Lets tests inject a
  // fixture migration spec + i18n keys so the dormant banner path
  // can be exercised end-to-end.
  const fixtures = await getTestFixtures();
  const fixtureMigrations = fixtures?.migrations || null;
  const fixtureI18n = fixtures?.i18nOverrides || null;
  const tWithFixtures = fixtureI18n
    ? (key) => (fixtureI18n[key] != null ? fixtureI18n[key] : t(key, lang))
    : (key) => t(key, lang);
  const currentVersionOverride = fixtures?.currentVersion || null;

  const prompt = createMigrationPrompt({
    root,
    titleEl:    document.getElementById("migration-banner-title"),
    bodyEl:     document.getElementById("migration-banner-body"),
    acceptBtn:  document.getElementById("migration-banner-accept"),
    declineBtn: document.getElementById("migration-banner-decline"),
    dismissBtn: document.getElementById("migration-banner-dismiss"),
    counterEl:  document.getElementById("migration-banner-counter"),
    readState: async () => {
      // The MV3 manifest version drives both previousVersion and
      // currentVersion in this minimal wiring. A future enhancement
      // could persist the previous-installed version separately, but
      // that requires a SW write on update which is its own slice.
      const manifest = chrome.runtime.getManifest?.() || {};
      const currentVersion = currentVersionOverride || manifest.version || "0.0.0";
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get({ mugaPrevVersion: currentVersion }, (r) => resolve(r));
      });
      const previousVersion = stored.mugaPrevVersion || currentVersion;
      const prefs = await getPrefs();
      return { previousVersion, currentVersion, prefs };
    },
    applyPrefs: async (proposedValue) => {
      // Migrations affect synced behavioural prefs. Write to sync;
      // existing storage.onChanged listeners will pick the change up.
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set(proposedValue, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    },
    t: tWithFixtures,
    ...(fixtureMigrations ? { migrations: fixtureMigrations } : {}),
  });
  await prompt.refresh();
}

/**
 * Returns true if the current hostname matches a per-domain-disable entry
 * in the blacklist — i.e. the user added an entry like `example.com::disabled`
 * meaning "MUGA does nothing on this domain" (cleaner.js:206).
 */
function isPerDomainDisabled(hostname, blacklist) {
  if (!hostname || !Array.isArray(blacklist)) return false;
  return blacklist.some(raw => {
    const entry = parseListEntry(raw);
    if (!entry || entry.param !== "disabled" || entry.value) return false;
    if (!entry.domain) return false;
    return hostname === entry.domain || hostname.endsWith("." + entry.domain);
  });
}

/** Resets preview-related DOM so repeated renders are idempotent. */
/**
 * Renders the "MUGA removed N trackers" celebration line, the "URL was
 * already clean" positive signal, or nothing — depending on the cleaner
 * result. The number gets wrapped in its own span so CSS can target it for
 * a one-shot pulse animation (gated on prefers-reduced-motion: no-preference).
 *
 * Plurals are picked via Intl.PluralRules so the en/es/pt/de variants stay
 * grammatical without hard-coded count===1 forks.
 */
function renderCountCelebration(result, url, lang) {
  const el = document.getElementById("preview-count");
  if (!el) return;
  const count = result.removedTracking?.length ?? 0;

  if (count > 0) {
    const pr = new Intl.PluralRules(lang || "en");
    const key = pr.select(count) === "one" ? "preview_count_one" : "preview_count_other";
    const template = t(key, lang);
    // Split around {n} and rebuild via text nodes + a number span. Avoids
    // innerHTML so the i18n string can never become an injection vector,
    // and lets CSS animate just the digits.
    el.replaceChildren();
    const [before, after] = template.split("{n}", 2);
    if (before) el.appendChild(document.createTextNode(before));
    const number = document.createElement("span");
    number.className = "preview-count-number";
    number.textContent = String(count);
    el.appendChild(number);
    if (after !== undefined) el.appendChild(document.createTextNode(after));
    // The "one" key has no {n} placeholder — render plain text in that case.
    if (after === undefined) el.textContent = template;
    el.classList.remove("is-clean");
    el.dataset.animating = "true";
    el.hidden = false;
    return;
  }

  // count === 0: only show the "already clean" line when the URL was truly
  // untouched. Path-cleanup / blacklist-only cases leave the URL diff to
  // communicate the change without a count headline.
  if (result.cleanUrl === url && result.action === "untouched") {
    el.textContent = t("preview_count_clean", lang);
    el.classList.add("is-clean");
    el.removeAttribute("data-animating");
    el.hidden = false;
  }
}

function _resetPreviewDom() {
  const el = (id) => document.getElementById(id);
  const previewClean = el("preview-clean");
  if (previewClean) {
    previewClean.hidden = true;
    previewClean.textContent = "";
    previewClean.style.color = "";
  }
  const previewBefore = el("preview-before");
  if (previewBefore) {
    previewBefore.textContent = "";
    previewBefore.classList.remove("clean-url");
  }
  const previewAfter = el("preview-after");
  if (previewAfter) {
    previewAfter.hidden = false;
    previewAfter.textContent = "";
  }
  const previewRemoved = el("preview-removed");
  if (previewRemoved) {
    previewRemoved.hidden = true;
    previewRemoved.textContent = "";
  }
  const previewCount = el("preview-count");
  if (previewCount) {
    previewCount.hidden = true;
    previewCount.textContent = "";
    previewCount.classList.remove("is-clean");
    previewCount.removeAttribute("data-animating");
  }
  const previewPreserved = el("preview-preserved");
  if (previewPreserved) {
    previewPreserved.hidden = true;
    previewPreserved.removeAttribute("title");
    const tag = document.getElementById("preview-preserved-tag");
    if (tag) tag.textContent = "";
  }
  // B14 (#452): honored-creator badge slot. Reset every render so a previous
  // navigation's badge never bleeds into the next.
  const previewHonored = el("preview-honored");
  if (previewHonored) {
    previewHonored.hidden = true;
    previewHonored.textContent = "";
  }
  const reportLink = el("report-broken");
  if (reportLink) reportLink.hidden = true;
  const reportUncleanLink = el("report-unclean");
  if (reportUncleanLink) reportUncleanLink.hidden = true;
}

/** Shows a live preview of URL cleaning for the current tab. Idempotent — callable multiple times. */
async function showUrlPreview(prefs, lang) {
  // Skip on internal browser pages, new tabs, etc.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!url || url.startsWith("chrome://") || url.startsWith("about:") || url.startsWith("moz-extension://") || url.startsWith("chrome-extension://") || url.startsWith("data:") || url.startsWith("blob:")) return;

  const section = document.getElementById("preview");
  section.hidden = false;

  // Reset DOM state so repeated calls (on toggle change / storage change) don't
  // accumulate stale markup from the previous render.
  _resetPreviewDom();

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

  // Per-domain disable: MUGA globally on, but user has opted this domain out
  // via a `domain::disabled` blacklist entry. Show a distinct message so they
  // understand MUGA is active but intentionally skipped for this site.
  const currentHost = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (isPerDomainDisabled(currentHost, prefs.blacklist)) {
    const previewClean = document.getElementById("preview-clean");
    previewClean.hidden = false;
    previewClean.textContent = t("muga_disabled_for_domain", lang);
    previewClean.style.color = "var(--text2)";
    return;
  }

  let domainRules = [];
  try {
    const resp = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    if (resp.ok) domainRules = await resp.json();
  } catch (_) { /* non-critical: preview works without domain rules */ }

  // B14 (#452): fetch the active tab's `document.referrer` from the content
  // script so the cleaner can decide whether to honor the creator chain.
  // Best-effort: missing/silent content scripts (chrome:// pages, popups,
  // first-load before injection completes) collapse to no referrer, which
  // disables honoring entirely — same as background-only contexts.
  let referrer = "";
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_REFERRER" });
      if (resp && typeof resp.referrer === "string") referrer = resp.referrer;
    } catch { /* content script not loaded — ignore */ }
  }

  const result = processUrl(url, { ...prefs, notifyForeignAffiliate: false }, domainRules, undefined, undefined, referrer);

  // B14 (#452): honored-creator badge. Surfaced when the wrapper URL was
  // passed through unmodified to honor a creator referral chain. The
  // template carries {network} and {creator} placeholders sourced from the
  // cleaner result. textContent is used (no innerHTML) so user-controllable
  // creator strings can never become an injection vector.
  if (result.action === "honored-creator") {
    const honoredEl = document.getElementById("preview-honored");
    if (honoredEl) {
      const template = t("popup_badge_honored_creator", lang);
      honoredEl.textContent = template
        .replace("{network}", String(result.network ?? ""))
        .replace("{creator}", String(result.creator ?? ""));
      honoredEl.hidden = false;
    }
  }

  // Wedge feedback: when MUGA preserved a third-party creator's affiliate tag,
  // surface it visibly. This is the core "fair to creators" promise made
  // tangible — fires regardless of whether the URL was otherwise modified.
  if (result.preservedAffiliate) {
    const preservedEl = document.getElementById("preview-preserved");
    if (preservedEl) {
      const tagEl = document.getElementById("preview-preserved-tag");
      if (tagEl) {
        tagEl.textContent = `${result.preservedAffiliate.param}=${result.preservedAffiliate.value}`;
      }
      preservedEl.title = t("preview_preserved_creator_hint", lang);
      preservedEl.hidden = false;
    }
  }

  // Tracker count celebration: surface the value MUGA delivered on this URL.
  // Three states:
  //  - count > 0   → "MUGA removed N trackers" (the dopamine moment).
  //  - count === 0 and the URL was untouched → "URL was already clean".
  //  - count === 0 with path cleanup / blacklist only → no count line; the
  //    visible URL diff already communicates what happened.
  renderCountCelebration(result, url, lang);

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

      // Collaborative report: "MUGA cleaned, but I still see tracking — help us improve".
      // Body intentionally carries hostname only (no full URL, no query string) to keep
      // the privacy contract intact. Distinct label so unclean-url reports feed the
      // remote-rules catalog, not the broken-site triage queue.
      const uncleanLink = document.getElementById("report-unclean");
      uncleanLink.hidden = false;
      uncleanLink.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          const hostname = new URL(url).hostname;
          const version = chrome.runtime.getManifest().version;
          const removed = result.removedTracking?.join(", ") || "none";
          const title = encodeURIComponent(`[Unclean URL] ${hostname}`);
          const body = encodeURIComponent(
            `## Unclean URL report\n\n` +
            `**Domain:** ${hostname}\n` +
            `**MUGA version:** ${version}\n` +
            `**Browser:** ${navigator.userAgent}\n` +
            `**Params MUGA already removed:** ${removed}\n\n` +
            `## What tracking is still in the URL?\n\n` +
            `<!-- Paste the param names you can still see (do NOT paste the full URL or any IDs). -->\n`
          );
          chrome.tabs.create({ url: `https://github.com/yocreoquesi/muga/issues/new?title=${title}&body=${body}&labels=unclean-url` });
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

  if (entries.length === 0) {
    // Show section with empty-state message so users know the panel exists
    section.hidden = false;
    const emptyEl = document.createElement("p");
    emptyEl.className = "domain-stats-empty";
    emptyEl.textContent = t("domain_stats_empty", lang);
    list.appendChild(emptyEl);
    return;
  }

  section.hidden = false;
  const summary = section.querySelector("summary");
  if (summary) summary.setAttribute("aria-label", t("domain_stats_label", lang));

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

/**
 * Renders the "Suspicious params" section combining:
 *   1. Entropy heuristic flags (B15, #436) — params on the CURRENT URL
 *      whose values look like opaque tracking IDs by shape alone.
 *   2. Cross-site frequency flags (B16, #446) — params seen on 3+
 *      first-party domains AND with 3+ distinct values, drawn from the
 *      local frequency tracker store.
 *
 * Both are INFORMATIONAL. Auto-stripping unknown params is exactly what
 * breaks creator referrals (#160), so this section just surfaces the
 * signal — it does NOT modify any URLs on its own.
 *
 * The frequency subgroup is gated on prefs.crossSiteFrequencyEnabled so
 * a privacy-conscious user can hide it without uninstalling the feature.
 */
async function showSuspiciousParams(prefs, lang) {
  const section = document.getElementById("suspicious-params");
  const list = document.getElementById("suspicious-params-list");
  if (!section || !list) return;

  // Reset so repeated calls (storage.onChanged) stay idempotent.
  list.replaceChildren();

  // ── Entropy subgroup: synchronous, scans current tab URL only ──
  let entropyFlags = [];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (
      url &&
      !url.startsWith("chrome://") &&
      !url.startsWith("about:") &&
      !url.startsWith("moz-extension://") &&
      !url.startsWith("chrome-extension://")
    ) {
      entropyFlags = findSuspiciousParams(url);
    }
  } catch { /* tab query may fail in tests; entropy stays empty */ }

  // ── Frequency subgroup: gated on the dedicated pref toggle ──
  let frequencyFlags = [];
  if (prefs.crossSiteFrequencyEnabled !== false) {
    try {
      const adapter = createFrequencyAdapter();
      if (adapter) {
        const tracker = createFrequencyTracker({
          adapter,
          hasher: frequencyHasher,
          enabled: true,
        });
        frequencyFlags = await tracker.getFlagged();
      }
    } catch { /* best-effort; freq subgroup just stays empty */ }
  }

  // Hide the whole section when both subgroups are empty. Fresh installs
  // and clean pages should not get a noise-y empty header.
  if (entropyFlags.length === 0 && frequencyFlags.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  if (entropyFlags.length > 0) {
    const groupLabel = document.createElement("div");
    groupLabel.className = "suspicious-group-label";
    groupLabel.textContent = t("suspicious_params_entropy_group", lang);
    list.appendChild(groupLabel);

    for (const flag of entropyFlags) {
      const row = document.createElement("div");
      row.className = "suspicious-row";

      const nameEl = document.createElement("span");
      nameEl.className = "suspicious-name";
      nameEl.textContent = flag.param;
      row.appendChild(nameEl);

      const detailEl = document.createElement("span");
      detailEl.className = "suspicious-detail";
      // Score gives the user a defensible "why this looks fishy" without
      // forcing them to read the heuristic's reason codes.
      detailEl.textContent = `score ${flag.score}`;
      row.appendChild(detailEl);

      list.appendChild(row);
    }
  }

  if (frequencyFlags.length > 0) {
    const groupLabel = document.createElement("div");
    groupLabel.className = "suspicious-group-label";
    groupLabel.textContent = t("suspicious_params_frequency_group", lang);
    list.appendChild(groupLabel);

    const detailTemplate = t("suspicious_params_freq_detail", lang);
    for (const flag of frequencyFlags) {
      const row = document.createElement("div");
      row.className = "suspicious-row";

      const nameEl = document.createElement("span");
      nameEl.className = "suspicious-name";
      nameEl.textContent = flag.param;
      row.appendChild(nameEl);

      const detailEl = document.createElement("span");
      detailEl.className = "suspicious-detail";
      // Avoid innerHTML — replace placeholders manually so the i18n
      // template can never become an injection vector.
      detailEl.textContent = detailTemplate
        .replace("{domains}", String(flag.domains))
        .replace("{values}", String(flag.values));
      row.appendChild(detailEl);

      list.appendChild(row);
    }
  }
}

/**
 * Renders the Attribution Ledger "Recent activity" section (#460, A2).
 *
 * The SW persists the ledger to `chrome.storage.local["attributionLedger"]`
 * after every processUrl() return so it survives SW restarts. We re-read
 * here on each popup open — re-rendering live via storage.onChanged is
 * deliberately deferred (a popup open is short-lived; the cost of a live
 * subscription rarely pays off, and the section is read-only).
 *
 * Empty state: if the ledger is unset, has no events, or storage read
 * fails, the empty-state paragraph stays visible and the list slot stays
 * empty. The summary still renders so the user can discover the section
 * after their first navigation.
 *
 * Per-row copy button uses navigator.clipboard.writeText. Failures
 * silently restore the icon — clipboard access can be denied in some
 * popup contexts and a clean URL is still visible for manual copy.
 */
async function showRecentActivity(lang) {
  const section = document.getElementById("recent-activity");
  const list = document.getElementById("recent-activity-list");
  const emptyEl = document.getElementById("recent-activity-empty");
  if (!section || !list || !emptyEl) return;

  // Re-render is idempotent: storage.onChanged could fire if a future
  // slice subscribes the popup, and we don't want stale rows to bleed.
  list.replaceChildren();

  let ledger = { events: [], capacity: DEFAULT_LEDGER_CAPACITY };
  try {
    const data = await chrome.storage.local.get({
      attributionLedger: { events: [], capacity: DEFAULT_LEDGER_CAPACITY },
    });
    if (data?.attributionLedger && Array.isArray(data.attributionLedger.events)) {
      ledger = data.attributionLedger;
    }
  } catch (err) {
    console.warn("[MUGA] showRecentActivity: ledger read failed:", err);
    // Fall through with an empty ledger — empty-state still renders.
  }

  const view = presentLedger(ledger);
  const rows = renderLedgerEntries(view, (key, vars) => {
    const template = t(key, lang);
    if (!vars) return template;
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
      // textContent is the final sink, but defensive String() ensures the
      // template never receives a non-string and end up with "undefined".
      out = out.replace(`{${k}}`, String(v));
    }
    return out;
  });

  if (rows.length === 0) {
    // Translate the empty-state message inline so a language switch
    // applied by applyTranslations() lands here too. The data-i18n
    // attribute already covers the boot path; this covers re-renders.
    emptyEl.textContent = t("ledger_empty", lang);
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "recent-activity-row";

    // URL line: truncated for display, full URL kept on the row dataset
    // so the copy button reads the original (clipboard accuracy beats
    // visual fidelity).
    const urlEl = document.createElement("div");
    urlEl.className = "recent-activity-url";
    urlEl.textContent = row.urlDisplay;
    urlEl.title = row.url;
    rowEl.appendChild(urlEl);

    // Meta line: badge + creator credit + network. We keep them on a
    // single line with the badge first so the user's eye lands on the
    // outcome before the attribution detail.
    const metaEl = document.createElement("div");
    metaEl.className = "recent-activity-meta";

    if (row.badgeText) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "recent-activity-badge";
      badgeEl.textContent = row.badgeText;
      metaEl.appendChild(badgeEl);
    }
    if (row.creatorCreditText) {
      const creditEl = document.createElement("span");
      creditEl.className = "recent-activity-creator";
      creditEl.textContent = row.creatorCreditText;
      metaEl.appendChild(creditEl);
    }
    if (row.networkText) {
      const netEl = document.createElement("span");
      netEl.className = "recent-activity-network";
      netEl.textContent = row.networkText;
      metaEl.appendChild(netEl);
    }
    if (metaEl.childNodes.length > 0) rowEl.appendChild(metaEl);

    // Copy button. Per-row so the user can grab any cleaned URL from the
    // ring buffer without hunting through history. Copies the FULL url
    // (not the truncated display).
    const copyBtn = document.createElement("button");
    copyBtn.className = "recent-activity-copy";
    copyBtn.type = "button";
    copyBtn.textContent = t("ledger_copy_btn_label", lang);
    copyBtn.setAttribute("aria-label", t("ledger_copy_btn_label", lang));
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(row.url);
        const orig = copyBtn.textContent;
        copyBtn.textContent = t("ledger_copy_btn_copied", lang);
        setTimeout(() => { copyBtn.textContent = orig; }, 1200);
      } catch {
        // Clipboard API may be denied in some popup contexts. Stay quiet —
        // the URL is still visible for the user to copy manually.
      }
    });
    rowEl.appendChild(copyBtn);

    list.appendChild(rowEl);
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
