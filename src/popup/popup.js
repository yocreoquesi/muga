/**
 * MUGA: Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { isSiteFullyExempt, isDomainAllowlisted, setDomainAllowlisted } from "../lib/cleaner.js";
import { loadCleaningContext, cleanForPreview } from "../lib/cleaning-context.js";
import { getPrefs, sessionStorage } from "../lib/storage.js";
import { TRACKING_PARAM_CATEGORIES, isAutoInjectedTagPresent } from "../lib/affiliates.js";
import { isFirefox as detectFirefox } from "../lib/browser-detect.js";
import { createMigrationPrompt } from "../lib/migration-prompt.js";
import { getTestFixtures } from "../lib/test-fixtures.js";
import { findSuspiciousParams } from "../lib/entropy-heuristic.js";
import { presentLedger, DEFAULT_LEDGER_CAPACITY } from "../lib/attribution-ledger.js";
import { renderEntries as renderLedgerEntries } from "../lib/attribution-ledger-view.js";
import { buildParamBreakdownView } from "../lib/param-breakdown-view.js";
import { computeLengthReduction, computeLengthBar } from "../lib/length-reduction.js";
import { computeUnwrapView } from "../lib/unwrap-view.js";
import { writeToClipboard } from "../lib/clipboard.js";
import { isFreshInstall } from "../lib/stats-zero-state.js";

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

/**
 * Writes `text` to the clipboard via the Clipboard API, falling back to the
 * legacy `document.execCommand("copy")` path (mirrors src/content/cleaner.js's
 * copyToClipboard()) when the Clipboard API is unavailable, blocked, or
 * rejects. Some Android WebExtension popup contexts restrict
 * navigator.clipboard, so without this fallback copy silently fails there
 * and every caller shows the "✗" failure state even though the legacy
 * execCommand path would have worked (#991).
 *
 * #1098: navigator.clipboard can be `undefined` in those same restricted
 * contexts, and accessing writeText on `undefined` throws SYNCHRONOUSLY
 * instead of rejecting a Promise — calling it inline and chaining .catch()
 * on the result never reaches that catch in that case, so the execCommand
 * fallback below never ran and the caller got no feedback at all.
 * writeToClipboard() (imported from
 * ../lib/clipboard.js, unit-tested in tests/unit/clipboard.test.mjs since
 * popup.js itself has no exports) guards both "API absent" and "API
 * present but throws synchronously" so they route through the same
 * fallback as an ordinary rejection.
 *
 * @param {string} text
 * @returns {Promise<void>} Resolves if either copy path succeeded, rejects if both failed.
 */
function copyToClipboard(text) {
  return writeToClipboard(navigator.clipboard, text, () => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    el.focus();
    el.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* legacy fallback unsupported in this context — treated as failure below */ }
    el.remove();
    if (!ok) throw new Error("clipboard fallback failed");
  });
}

/**
 * Writes `text` to the clipboard, then shows one-shot visual feedback that
 * reverts after 1200ms. Centralizes the try/writeText/timeout pattern shared
 * by the history-entry click-to-copy, the copy-clean icon button, and the
 * copy-original button (#935) — each call site plugs in its own success/error
 * rendering via the callbacks since they differ (label swap, icon swap,
 * classList toggle) while the clipboard write + revert-after-1200ms plumbing
 * stays identical.
 *
 * @param {string}   text       Text to write to the clipboard.
 * @param {object}   handlers
 * @param {Function} handlers.onSuccess Called after a successful write; render the "copied" feedback state.
 * @param {Function} handlers.onError   Called after a failed write; render the "✗" failure state.
 * @param {Function} handlers.onRevert  Called 1200ms after either outcome; restore the pre-copy state.
 */
function copyWithFeedback(text, { onSuccess, onError, onRevert }) {
  copyToClipboard(text).then(() => {
    onSuccess();
    setTimeout(onRevert, 1200);
  }).catch(() => {
    onError();
    setTimeout(onRevert, 1200);
  });
}

/**
 * Reprocesses `originalUrl` through the copy-safe pipeline (#946) instead of
 * copying the value stored at navigation time, so a copy of a History entry
 * re-cleans it rather than reusing the nav-time value verbatim. Reusing the
 * existing PROCESS_URL message with `skipNotify: true` mirrors the same
 * effectivePrefs branch background/service-worker.js#handleProcessUrl already
 * applies for keyboard-shortcut/context-menu copy (notifyForeignAffiliate
 * forced off) — single source of truth instead of a second nav-time value.
 * `skipSideEffects: true` (#966) additionally prevents this reprocessing
 * from re-counting stats, duplicating session history, or pushing a
 * duplicate ledger event for an already-recorded URL.
 *
 * drop-affiliate-injection (PR 1a): the original rationale here ("copying
 * verbatim would put MUGA's own affiliate tag on the clipboard for an
 * `injected` entry") no longer applies — MUGA never injects its own tag
 * anymore, so there is nothing to leak on that front. The stat-dedup
 * (skipSideEffects) and toast-suppression (skipNotify) purposes of this
 * reprocessing still hold and are preserved as-is.
 *
 * Degraded fallback (#946): if the service worker is unreachable, return
 * `originalUrl` — the pre-navigation URL. It may still carry third-party
 * tracking noise in this rare path, which is an acceptable degrade.
 *
 * @param {string} originalUrl
 * @returns {Promise<string>}
 */
async function getCopySafeCleanUrl(originalUrl) {
  try {
    // #966: skipSideEffects — this is a copy of an already-processed history
    // entry, so it must NOT re-count stats, duplicate the session history, or
    // push another ledger event. skipNotify alone left those side effects on.
    const response = await chrome.runtime.sendMessage({ type: "PROCESS_URL", url: originalUrl, skipNotify: true, skipSideEffects: true });
    if (response && typeof response.cleanUrl === "string" && response.cleanUrl) {
      return response.cleanUrl;
    }
  } catch {
    // SW unreachable (e.g. cold-killed mid-popup-session) — degrade to the
    // tag-free original rather than failing the copy or leaking MUGA's tag.
  }
  return originalUrl;
}

// ── Param breakdown ───────────────────────────────────────────────────────────

/**
 * Builds a reverse index: param name → { category key, label*, description* }.
 * Cached as singleton (rebuilt across popup sessions only, not per render —
 * the history list can render this for many entries in a single popup open).
 */
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
        description: catData.description,
        descriptionEs: catData.descriptionEs,
        descriptionPt: catData.descriptionPt,
        descriptionDe: catData.descriptionDe,
      });
    }
  }
  return _paramIndex;
}

/**
 * Renders a param breakdown section showing removed params grouped by
 * category, plus a "why was this cleaned?" description per category (#986).
 * All grouping / lang-resolution logic lives in the pure, unit-tested
 * buildParamBreakdownView() — this function is a thin DOM shell.
 */
function _renderParamBreakdown(removedTracking, lang) {
  const index = _buildParamIndex();
  const rows = buildParamBreakdownView(removedTracking, lang, index, t);

  const container = document.createElement("div");
  container.className = "param-breakdown";

  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "breakdown-row";

    const catEl = document.createElement("span");
    catEl.className = "breakdown-cat";
    catEl.textContent = row.label;

    const paramsEl = document.createElement("span");
    paramsEl.className = "breakdown-params";
    paramsEl.textContent = row.params.join(", ");

    rowEl.appendChild(catEl);
    rowEl.appendChild(paramsEl);

    if (row.description) {
      const descEl = document.createElement("span");
      descEl.className = "breakdown-desc";
      descEl.textContent = row.description;
      rowEl.appendChild(descEl);
    }

    container.appendChild(rowEl);
  }

  return container;
}

/** Initializes popup: loads prefs/stats, renders UI, binds event handlers. */
async function init() {
  const lang = await getStoredLang();
  document.documentElement.lang = lang;
  applyTranslations(lang);

  // browsewrap Phase 1: the popup no longer blocks on onboardingDone. A
  // fresh install already records implicit acceptance (see service-worker.js
  // recordImplicitAcceptOnInstall), so the popup renders its normal UI from
  // the very first open, with no blocking overlay of any kind.
  const prefsCheck = await getPrefs();

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

  // A fresh install shows bare zeros and nothing else, which reads as broken
  // rather than new (#1260). The ledger below already explains its own empty
  // state; this gives the counters the same courtesy, and only while they are
  // all still zero.
  const statsEmpty = document.getElementById("stats-empty");
  if (statsEmpty) statsEmpty.hidden = !isFreshInstall(local.stats);

  const enabledToggle = document.getElementById("enabled-toggle");
  enabledToggle.checked = prefs.enabled;

  enabledToggle.addEventListener("change", async () => {
    // storage.sync.set returns a Promise in MV3 — a sync try/catch can't catch
    // its async rejection, so surface failures via .catch (#728 item 27).
    chrome.storage.sync.set({ enabled: enabledToggle.checked }).catch((err) => console.error("[MUGA] save enabled:", err));
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
    growthBar.hidden = false;
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
      // Async rejection can't be caught by a sync try/catch — use .catch (#728 item 27).
      chrome.storage.local.set({ nudgeDismissed: true }).catch((err) => console.error("[MUGA] save nudge dismiss:", err));
      chrome.tabs.create({ url: storeUrl });
    });
  }

  // Clicking the URLs-cleaned stat always toggles the history panel (#178, #237)
  const statUrlsWrap = document.getElementById("stat-urls-wrap");
  const historySection = document.getElementById("history");
  statUrlsWrap.setAttribute("aria-controls", "history");
  statUrlsWrap.setAttribute("aria-expanded", "false");
  statUrlsWrap.addEventListener("click", () => {
    historySection.hidden = false;
    historySection.open = !historySection.open;
    statUrlsWrap.setAttribute("aria-expanded", String(historySection.open));
  });
  // The stat is not the only way `open` changes — the panel is a native
  // <details>, so its own <summary> toggles it too. Resync aria-expanded on
  // every toggle so a screen reader never announces a stale state (audit #1042).
  historySection.addEventListener("toggle", () => {
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
  // Domain-stats panel moved to Settings' Activity section (#1350).
  await showSuspiciousParams(lang);
  await showRecentActivity(lang);

  // Reactivity: re-render the preview when the user flips relevant settings —
  // either from the popup itself (the enabled toggle already calls showUrlPreview
  // optimistically) OR from the Options page opened in another tab. Watch for
  // enabled, blacklist (per-domain disable + aggressive strip), whitelist, and
  // customParams. We refetch full prefs instead of diffing to stay simple.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    if (!changes.enabled && !changes.blacklist && !changes.whitelist && !changes.customParams && !changes.userCustomRules) return;
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
 * Renders the per-site pause control in the preview section (#980, repointed
 * to the allowlist in #1053). Visible only when MUGA is globally enabled and
 * the tab is a real http(s) page. The button toggles a bare domain-only
 * whitelist entry (the same mechanism as Settings > Allowlist) so the user
 * can pause or resume URL cleaning for the current site without opening
 * Settings. A domain is exempted ONLY via this allowlist entry now - the
 * legacy `<host>::disabled` blacklist syntax has been removed entirely
 * (see isSiteFullyExempt). Re-render is optimistic; the storage.onChanged
 * listener also refreshes once the write lands.
 */
function renderPauseControl(url, prefs, lang) {
  const wrap = document.getElementById("preview-site-control");
  const btn = document.getElementById("pause-site-btn");
  if (!wrap || !btn) return;
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch { /* not a web page — leave host empty */ }
  if (!host || prefs.enabled === false) {
    wrap.hidden = true;
    return;
  }
  const paused = isDomainAllowlisted(host, prefs.whitelist);
  // Changing-label button (WAI-ARIA plain-button idiom): the label states the
  // action, so no aria-pressed (which would contradict the label). Paused state
  // is conveyed visually via the `.paused` class.
  btn.textContent = t(paused ? "resume_site_btn" : "pause_site_btn", lang);
  btn.classList.toggle("paused", paused);
  wrap.hidden = false;
  btn.onclick = () => {
    const nextWhitelist = setDomainAllowlisted(prefs.whitelist, host, !paused);
    chrome.storage.sync.set({ whitelist: nextWhitelist }).catch((err) => console.error("[MUGA] save pause-site:", err));
    showUrlPreview({ ...prefs, whitelist: nextWhitelist }, lang).catch((err) => console.error("[MUGA] preview re-render:", err));
  };
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
    // The "one" key has no {n} placeholder — render plain text only in that
    // case so the span-build path never runs and gets clobbered (bug #819).
    el.replaceChildren();
    const [before, after] = template.split("{n}", 2);
    if (after === undefined) {
      // No {n} placeholder (e.g. preview_count_one): plain text only.
      el.textContent = template;
    } else {
      if (before) el.appendChild(document.createTextNode(before));
      const number = document.createElement("span");
      number.className = "preview-count-number";
      number.textContent = String(count);
      el.appendChild(number);
      el.appendChild(document.createTextNode(after));
    }
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
  // #1062 slice 1: length-reduction "% shorter" line + green/red bar. Reset
  // every render (idempotent, same rationale as the other preview slots
  // above) so a prior navigation's percentage/widths never bleed into a
  // render where the URL turned out to already be clean.
  const previewShorter = el("preview-shorter");
  if (previewShorter) {
    previewShorter.hidden = true;
    previewShorter.textContent = "";
  }
  const previewLengthBar = el("preview-length-bar");
  if (previewLengthBar) previewLengthBar.hidden = true;
  // #1062 part 3: unwrap indicator, reset every render like the slots above so
  // a prior navigation's revealed host never bleeds into a param-only clean.
  const previewUnwrap = el("preview-unwrap");
  if (previewUnwrap) {
    previewUnwrap.hidden = true;
    previewUnwrap.textContent = "";
  }
  const previewLengthKept = el("preview-length-kept");
  if (previewLengthKept) previewLengthKept.style.width = "";
  const previewLengthRemoved = el("preview-length-removed");
  if (previewLengthRemoved) previewLengthRemoved.style.width = "";
  const previewPreserved = el("preview-preserved");
  if (previewPreserved) {
    previewPreserved.hidden = true;
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
  // affiliate-autoinject-notice: passive badge slot. Reset every render so a
  // prior navigation's badge never bleeds into a landing with no detection.
  const previewAutoinject = el("preview-autoinject");
  if (previewAutoinject) {
    previewAutoinject.hidden = true;
    previewAutoinject.textContent = "";
  }
  // #728 item 26: reset the per-tab badge (#89) too. It is only re-shown when
  // the new render has count > 0, so without this a prior tab's badge would
  // bleed into a later render with no count — breaking the idempotent-render
  // invariant every other slot above upholds.
  const tabBadge = el("tab-badge");
  if (tabBadge) {
    tabBadge.hidden = true;
    tabBadge.textContent = "";
  }
  // #1355/#1354: the popup's own report-broken link + opt-in full-URL row
  // are retired along with showReportButton — reporting moved to Settings.
  // #705 fix: remove any `.preview-breakdown` <details> appended by a
  // prior render. The breakdown is dynamic (per-URL), so the
  // reset path must clear it the same way it clears the static slots
  // above — otherwise repeated re-renders stack 2×, 3×, … copies.
  const preview = el("preview");
  if (preview) {
    preview.querySelectorAll(".preview-breakdown").forEach((node) => node.remove());
  }
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

  // Per-site pause control (#980) — shown for real web pages before the
  // disabled/paused early returns so the user can always toggle it.
  renderPauseControl(url, prefs, lang);

  if (prefs.enabled === false) {
    const previewClean = document.getElementById("preview-clean");
    previewClean.hidden = false;
    previewClean.textContent = t("muga_disabled", lang);
    previewClean.style.color = "var(--text2)";
    return;
  }

  // Per-domain disable: MUGA globally on, but user has opted this domain out
  // via a domain-only allowlist entry. Show a distinct message so they
  // understand MUGA is active but intentionally skipped for this site.
  const currentHost = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (isSiteFullyExempt(currentHost, prefs)) {
    const previewClean = document.getElementById("preview-clean");
    previewClean.hidden = false;
    previewClean.textContent = t("muga_disabled_for_domain", lang);
    previewClean.style.color = "var(--text2)";
    return;
  }

  // #1255: the whole context, not just the domain rules. This used to fetch
  // domain-rules.json alone and hand processUrl a six-argument list, so the
  // preview was computed without the path rules and could show a URL the
  // extension would not produce -- on the surface whose only job is to show
  // what it will produce.
  const cleaningContext = await loadCleaningContext();

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

  const result = cleanForPreview(url, prefs, cleaningContext, { referrer });

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

  // affiliate-autoinject-notice: passive popup badge (ADR-c). Renders
  // whenever the dual-key predicate flagged this landing, REGARDLESS of
  // notifyForeignAffiliate — the badge only appears when the user opens the
  // popup themselves, so it carries none of the toast's interruption cost
  // and is safe to show unconditionally. textContent only (no innerHTML);
  // {platform} is the only placeholder and it's sourced from MUGA's own
  // curated AUTOINJECTOR_PATTERNS table, never user input.
  //
  // LOW-2: also require the flagged param=value to STILL be present in the
  // cleaned URL. `result.autoInjected` is computed on the incoming landing
  // params (before stripping), so it outlives the tag when the tag was
  // actually removed — e.g. under stripAllAffiliates (action "cleaned") or on
  // a post-Remove re-navigation where the scoped blacklist already stripped
  // it. Gating on presence keeps the badge honest: it only shows when the tag
  // survived in cleanUrl.
  if (result.autoInjected &&
      isAutoInjectedTagPresent(result.cleanUrl, result.autoInjected.param, result.autoInjected.value)) {
    const autoinjectEl = document.getElementById("preview-autoinject");
    if (autoinjectEl) {
      const template = t("autoinject_badge", lang);
      autoinjectEl.textContent = template.replace("{platform}", String(result.autoInjected.platform ?? ""));
      autoinjectEl.hidden = false;
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

  // #1062 slice 1: honest length-reduction insight. A LENGTH-only claim
  // (never "N% of trackers") — see src/lib/length-reduction.js. Rendered
  // whenever the cleaner actually removed characters, independent of the
  // "untouched" action check below (e.g. path-cleanup-only URLs still get
  // an honest bar even though they don't hit the tracker-count branch).
  const lengthView = computeLengthReduction(url, result.cleanUrl);
  if (!lengthView.isClean) {
    const bar = computeLengthBar(lengthView);
    const shorterEl = document.getElementById("preview-shorter");
    if (shorterEl) {
      const template = t("preview_shorter", lang);
      shorterEl.textContent = template.replace("{n}", String(lengthView.shorterPercent));
      shorterEl.hidden = false;
    }
    const lengthBarEl = document.getElementById("preview-length-bar");
    const lengthKeptEl = document.getElementById("preview-length-kept");
    const lengthRemovedEl = document.getElementById("preview-length-removed");
    if (lengthBarEl && lengthKeptEl && lengthRemovedEl) {
      lengthKeptEl.style.width = `${bar.keptPercent}%`;
      lengthRemovedEl.style.width = `${bar.removedPercent}%`;
      lengthBarEl.hidden = false;
    }
  }

  // #1062 part 3: unwrap indicator. A host change means MUGA revealed the real
  // destination behind a redirect wrapper / shortener (param cleaning never
  // touches the host) — surface WHERE the link really goes. Mirrors the web
  // tool's unwrap callout (src/lib/unwrap-view.js).
  const unwrapView = computeUnwrapView(url, result.cleanUrl);
  const unwrapEl = document.getElementById("preview-unwrap");
  if (unwrapEl && unwrapView.unwrapped) {
    unwrapEl.textContent = t("preview_unwrapped", lang).replace("{host}", unwrapView.destinationHost);
    unwrapEl.hidden = false;
  }

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

    // #1355/#1354: the popup's own "report broken site" flow (showReportButton)
    // is retired. Reporting a problem now lives in Settings (#1353,
    // section-report), reachable by every user.

    // Param breakdown: show removed params grouped by category (#1355/#1354,
    // ADR-0011 Decision 1 — this IS the popup glance, so it always renders
    // when there is something to show; no pref gate).
    if (result.removedTracking?.length > 0) {
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

/**
 * Renders the "Suspicious params" section — ENTROPY heuristic flags only
 * (B15, #436): params on the CURRENT page's URL whose values look like
 * opaque tracking IDs by shape alone.
 *
 * READ-ONLY (2026-09-24 maintainer decision on #1351): no action here
 * promotes a param to a permanent strip rule. That action, together with
 * the cross-site frequency subgroup this section used to sit next to,
 * moved to Settings' Activity section (ADR-0011 Decision 3) — writing
 * `prefs.userCustomRules` is the single most consequential action MUGA
 * offers, and does not belong on a two-second surface. This subgroup stays
 * in the popup specifically because it is tied to THIS page's URL, a fact
 * Settings — opened in its own tab, with no notion of "the current page" —
 * has no way to reproduce.
 *
 * INFORMATIONAL, as before: this does NOT modify any URLs on its own.
 */
async function showSuspiciousParams(lang) {
  const section = document.getElementById("suspicious-params");
  const list = document.getElementById("suspicious-params-list");
  if (!section || !list) return;

  // Reset so repeated calls (storage.onChanged) stay idempotent.
  list.replaceChildren();

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

  // Hide the section when there's nothing to show. Fresh installs and
  // clean pages should not get a noise-y empty header.
  if (entropyFlags.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

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
    detailEl.textContent = t("entropy_score_label", lang).replace("{score}", String(flag.score));
    row.appendChild(detailEl);

    list.appendChild(row);
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
 * Per-row copy button uses copyToClipboard() (Clipboard API with the
 * document.execCommand("copy") legacy fallback, #991). Failures silently
 * restore the icon — clipboard access can be denied in some popup contexts
 * and a clean URL is still visible for manual copy.
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
        await copyToClipboard(row.url);
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

    // Param breakdown: show removed params per history entry (#1355/#1354,
    // ADR-0011 Decision 1 — always renders when there is something to show).
    if (entry.removedTracking?.length > 0) {
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

    // Click to copy clean URL (#87). Reprocessed copy-safe (#946) — see
    // getCopySafeCleanUrl for why this doesn't just copy entry.clean.
    entryDiv.addEventListener("click", (e) => {
      if (e.target === copyOrigBtn || copyCleanBtn.contains(e.target)) return; // handled separately
      const orig = afterDiv.textContent;
      getCopySafeCleanUrl(entry.original).then((safeUrl) => {
        copyWithFeedback(safeUrl, {
          onSuccess: () => {
            entryDiv.classList.add("copied");
            afterDiv.textContent = t("history_copied", lang);
          },
          onError: () => { afterDiv.textContent = "✗"; },
          onRevert: () => {
            entryDiv.classList.remove("copied");
            afterDiv.textContent = orig;
          },
        });
      });
    });

    // Copy clean URL icon button. Reprocessed copy-safe (#946).
    copyCleanBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      getCopySafeCleanUrl(entry.original).then((safeUrl) => {
        copyWithFeedback(safeUrl, {
          onSuccess: () => {
            copyCleanBtn.textContent = "✓";
            copyCleanBtn.style.fontSize = "11px";
          },
          onError: () => {
            copyCleanBtn.textContent = "✗";
            copyCleanBtn.style.fontSize = "11px";
          },
          onRevert: () => {
            _setClipboardIcon(copyCleanBtn);
            copyCleanBtn.style.fontSize = "";
          },
        });
      });
    });

    // Copy original URL button (#178)
    copyOrigBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const origText = copyOrigBtn.textContent;
      copyWithFeedback(entry.original, {
        onSuccess: () => { copyOrigBtn.textContent = t("history_copied", lang); },
        onError: () => { copyOrigBtn.textContent = "✗"; },
        onRevert: () => { copyOrigBtn.textContent = origText; },
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
