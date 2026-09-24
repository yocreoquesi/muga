/**
 * MUGA: Popup
 * Loads preferences, displays stats, and manages the toggle switches.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { isSiteFullyExempt, isDomainAllowlisted, setDomainAllowlisted } from "../lib/cleaner.js";
import { loadCleaningContext, cleanForPreview } from "../lib/cleaning-context.js";
import { getPrefs, sessionStorage } from "../lib/storage.js";
import { TRACKING_PARAM_CATEGORIES, isAutoInjectedTagPresent } from "../lib/affiliates.js";
import { getRateUrl } from "../lib/store-links.js";
import { createMigrationPrompt } from "../lib/migration-prompt.js";
import { getTestFixtures } from "../lib/test-fixtures.js";
import { findSuspiciousParams } from "../lib/entropy-heuristic.js";
import { buildParamBreakdownView, buildParamIndex } from "../lib/param-breakdown-view.js";
import { computeLengthReduction, computeLengthBar } from "../lib/length-reduction.js";
import { computeUnwrapView } from "../lib/unwrap-view.js";
import { isFreshInstall } from "../lib/stats-zero-state.js";

// #1352: the clipboard helpers that used to live here (_createClipboardSvg,
// _setClipboardIcon, copyToClipboard, copyWithFeedback, getCopySafeCleanUrl)
// existed ONLY for the "This session" / "Recent activity" ledgers, which
// moved to Settings' unified Activity ledger panel — see options.js, which
// now owns these helpers.

// ── Param breakdown ───────────────────────────────────────────────────────────

/**
 * Reverse index: param name → category info. Built once per popup open by
 * the shared pure builder (#1445), not per render.
 */
let _paramIndex = null;
function _buildParamIndex() {
  if (!_paramIndex) _paramIndex = buildParamIndex(TRACKING_PARAM_CATEGORIES);
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

  // #1417: the suspicious-params list is read-only; acting on a param
  // (Custom tracking params, Report a problem) happens in Settings.
  document.getElementById("suspicious-open-settings")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Footer rate link: always available, passive
  const popupRateLink = document.getElementById("popup-rate-link");
  if (popupRateLink) {
    popupRateLink.href = getRateUrl();
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
    const storeUrl = getRateUrl();
    rateBtn.addEventListener("click", () => {
      // Async rejection can't be caught by a sync try/catch — use .catch (#728 item 27).
      chrome.storage.local.set({ nudgeDismissed: true }).catch((err) => console.error("[MUGA] save nudge dismiss:", err));
      chrome.tabs.create({ url: storeUrl });
    });
  }

  // #1352: the URLs-cleaned stat no longer toggles anything — the "This
  // session" ledger it used to reveal moved to Settings' unified Activity
  // ledger panel, alongside "Recent activity" (see options.js). #stat-urls
  // is now a plain stat tile, same as #stat-junk beside it.

  await showUrlPreview(prefs, lang);
  // Domain-stats panel moved to Settings' Activity section (#1350). Both
  // ledgers ("This session", "Recent activity") moved to the same section's
  // unified Activity ledger panel (#1352).
  await showSuspiciousParams(lang);

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

    // #1417: an unscaled score means nothing at a glance, so it no longer
    // prints; it stays available as a tooltip for the curious.
    row.title = t("entropy_score_label", lang).replace("{score}", String(flag.score));

    list.appendChild(row);
  }
}

// #1352: the "Recent activity" and "This session" ledger renderers moved to
// Settings' unified Activity ledger panel — see options.js's
// renderActivityLedgerPanel.

document.addEventListener("DOMContentLoaded", init);
