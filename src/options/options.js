/**
 * MUGA: Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS, buildContextMenuHint } from "../lib/i18n.js";
import { TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { PREF_DEFAULTS, getPrefs, setPrefs, getDevMode, setDevMode } from "../lib/storage.js";
import { isFirefox as detectFirefox, hasCommands } from "../lib/browser-detect.js";
import { isValidListEntry, isValidCustomParam, IMPORT_LIST_CAPS } from "../lib/validation.js";
import { REMOTE_RULES_URL } from "../lib/remote-rules.js";
import { planChangelogView } from "../lib/remote-rules-changelog-view.js";
import {
  addEntry as addCreatorAllowlistEntry,
  removeEntry as removeCreatorAllowlistEntry,
} from "../lib/creator-allowlist.js";
import { GENERIC_SHORTENERS } from "../lib/native-shortener-resolver.js";
import { GUARDED_PREFS } from "../lib/synced-affiliate-pref-guard.js";
import { reconcileOverrideForExplicitChoice } from "../lib/per-device-prefs.js";
import { createMutex, withSyncMutation } from "./sync-mutation.js";
import { snapToastDuration, buildExportPayload, planImport, diffImport } from "../lib/settings-schema.js";
import { buildBrokenSiteReportBody } from "../lib/broken-site-report.js";
import { shouldRevealAffiliateNudge, shouldShowBlocklistMigrationNotice, shouldHideMigrationNoticeOnStorageChange } from "../lib/aggressive-privacy-ui.js";

let _currentLang = "en";

/**
 * Re-renders the "Right-click -> Copy clean link" row hint, appending the
 * Alt+Shift+C shortcut clause only when chrome.commands is actually
 * available. applyTranslations() already writes the shortcut-free base hint
 * to this element via its data-i18n attribute; this call runs immediately
 * after every applyTranslations(_currentLang) call site so a language
 * switch never leaves a stale hint behind (#991).
 * @param {string} lang
 */
function renderContextMenuHint(lang) {
  const el = document.getElementById("row-context-menu-hint");
  if (el) el.textContent = buildContextMenuHint(lang, hasCommands());
}

// ── Toast & confirm helpers ─────────────────────────────────────────────────

let _toastEl = null;
let _toastTimer = null;

/** Shows a temporary toast notification. */
function showToast(msg) {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.className = "toast";
    _toastEl.setAttribute("role", "alert");
    _toastEl.setAttribute("aria-live", "assertive");
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.classList.add("visible");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove("visible"), 2500);
}

/** Shows a modal confirmation dialog, returns Promise<boolean>. */
function showConfirm(msg) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    const box = document.createElement("div");
    box.className = "confirm-box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    const p = document.createElement("p");
    p.id = "confirm-msg";
    p.textContent = msg;

    box.setAttribute("aria-labelledby", "confirm-msg");

    const btns = document.createElement("div");
    btns.className = "confirm-btns";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "confirm-cancel";
    cancelBtn.textContent = t("confirm_cancel", _currentLang);

    const okBtn = document.createElement("button");
    okBtn.className = "confirm-ok";
    okBtn.textContent = t("confirm_ok", _currentLang);

    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(p);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    okBtn.focus();
    const focusable = [cancelBtn, okBtn];
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        const idx = focusable.indexOf(document.activeElement);
        const next = e.shiftKey ? (idx <= 0 ? focusable.length - 1 : idx - 1) : (idx + 1) % focusable.length;
        focusable[next].focus();
        e.preventDefault();
      }
    };
    const close = (val) => { document.removeEventListener("keydown", onKey); overlay.remove(); if (prevFocus) prevFocus.focus(); resolve(val); };
    document.addEventListener("keydown", onKey);
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

/** Cap on rendered entries per added/removed group in a list diff row (#983). */
const IMPORT_DIFF_RENDER_CAP = 20;

/**
 * Renders the localized before/after text for a single scalar diff row.
 * Booleans render as on/off; toastDuration and language show the raw
 * value (toastDuration has no seconds-unit locale key to append, and
 * language is shown as the raw stored code, per #983 scope).
 */
function formatScalarValue(value, lang) {
  if (typeof value === "boolean") return value ? t("import_diff_on", lang) : t("import_diff_off", lang);
  if (value == null) return "";
  return String(value);
}

/**
 * Shows a dry-run diff preview of a Settings import before anything is
 * applied (#983). Clones showConfirm()'s accessibility structure exactly
 * (plain overlay + box, role="alertdialog", aria-modal, aria-labelledby,
 * prevFocus capture/restore, manual Tab focus-trap, Escape/backdrop-click
 * cancel) — see showConfirm() above for the reference implementation.
 *
 * @param {Array} rows - diffImport() output (see settings-schema.js).
 * @param {string} lang - current UI language.
 * @returns {Promise<boolean>} true if the user confirmed, false if cancelled.
 */
function showImportDiff(rows, lang) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    const box = document.createElement("div");
    box.className = "import-diff-box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    const title = document.createElement("p");
    title.id = "import-diff-title";
    title.textContent = t("import_diff_title", lang);
    box.setAttribute("aria-labelledby", "import-diff-title");
    // Associate the change list with the dialog so assistive tech announces the
    // actual diff, not just the title + focused button.
    box.setAttribute("aria-describedby", "import-diff-rows");

    const rowsContainer = document.createElement("div");
    rowsContainer.className = "import-diff-rows";
    rowsContainer.id = "import-diff-rows";
    // Keyboard-focusable so keyboard-only users can scroll the overflow region
    // (the list can exceed its max-height); also joins the Tab focus-trap below.
    rowsContainer.tabIndex = 0;

    for (const row of rows) {
      const label = t(row.labelKey, lang);
      if (row.kind === "scalar") {
        const line = document.createElement("div");
        line.className = "import-diff-row changed";
        line.textContent = `${label}: ${formatScalarValue(row.before, lang)} → ${formatScalarValue(row.after, lang)}`;
        rowsContainer.appendChild(line);
        continue;
      }

      const header = document.createElement("div");
      header.className = "import-diff-row changed";
      header.textContent = label;
      rowsContainer.appendChild(header);

      const added = row.added.slice(0, IMPORT_DIFF_RENDER_CAP);
      for (const entry of added) {
        const line = document.createElement("div");
        line.className = "import-diff-row added";
        line.textContent = `+ ${entry}`;
        rowsContainer.appendChild(line);
      }
      if (row.added.length > IMPORT_DIFF_RENDER_CAP) {
        const more = document.createElement("div");
        more.className = "import-diff-more";
        more.textContent = t("import_diff_more", lang).replace("{n}", String(row.added.length - IMPORT_DIFF_RENDER_CAP));
        rowsContainer.appendChild(more);
      }

      const removed = row.removed.slice(0, IMPORT_DIFF_RENDER_CAP);
      for (const entry of removed) {
        const line = document.createElement("div");
        line.className = "import-diff-row removed";
        line.textContent = `− ${entry}`;
        rowsContainer.appendChild(line);
      }
      if (row.removed.length > IMPORT_DIFF_RENDER_CAP) {
        const more = document.createElement("div");
        more.className = "import-diff-more";
        more.textContent = t("import_diff_more", lang).replace("{n}", String(row.removed.length - IMPORT_DIFF_RENDER_CAP));
        rowsContainer.appendChild(more);
      }
    }

    const btns = document.createElement("div");
    btns.className = "import-diff-btns";

    const cancelBtn = document.createElement("button");
    cancelBtn.id = "import-diff-cancel";
    cancelBtn.textContent = t("confirm_cancel", lang);

    const confirmBtn = document.createElement("button");
    confirmBtn.id = "import-diff-confirm";
    confirmBtn.className = "primary";
    confirmBtn.textContent = t("import_diff_confirm_btn", lang);

    btns.appendChild(cancelBtn);
    btns.appendChild(confirmBtn);
    box.appendChild(title);
    box.appendChild(rowsContainer);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    confirmBtn.focus();
    const focusable = [rowsContainer, cancelBtn, confirmBtn];
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        const idx = focusable.indexOf(document.activeElement);
        const next = e.shiftKey ? (idx <= 0 ? focusable.length - 1 : idx - 1) : (idx + 1) % focusable.length;
        focusable[next].focus();
        e.preventDefault();
      }
    };
    const close = (val) => { document.removeEventListener("keydown", onKey); overlay.remove(); if (prevFocus) prevFocus.focus(); resolve(val); };
    document.addEventListener("keydown", onKey);
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

/**
 * Reports whether the eight shortener host permissions are currently granted.
 * Used by the import path so a config file can never silently ENABLE the
 * permission-gated shortener resolver without the host grant the normal
 * toggle enforces (#964).
 *
 * @returns {Promise<boolean>}
 */
async function hasShortenerPermissions() {
  try {
    return await chrome.permissions.contains({
      origins: GENERIC_SHORTENERS.map((host) => `https://${host}/*`),
    });
  } catch {
    return false;
  }
}

/**
 * True when the optional host permission for the remote-rules endpoint is
 * already granted. Enabling remote rules needs `https://rules.muga.app/*`
 * (optional_host_permissions); a settings import cannot request it (no user
 * gesture survives the async file read), so import may only restore
 * remoteRulesEnabled:true when this grant already exists — otherwise the pref
 * would say ON while the weekly signed fetch stays blocked.
 *
 * As long as the manifest declares `<all_urls>` in host_permissions, this
 * returns true on a fresh install with nothing granted, because
 * `permissions.contains()` reports coverage rather than exact declaration
 * (pinned by tests/e2e/remote-rules-fresh-install.spec.mjs). The check is kept
 * because it becomes load-bearing the moment `<all_urls>` is narrowed, which
 * is the direction Chrome Web Store best practices push. It is a safety net
 * that currently happens to be subsumed, not dead code.
 * @returns {Promise<boolean>}
 */
async function hasRemoteRulesPermission() {
  try {
    return await chrome.permissions.contains({
      origins: ["https://rules.muga.app/*"],
    });
  } catch {
    return false;
  }
}

/** Initializes the options page: loads prefs, binds controls, renders lists. */
async function init() {
  _currentLang = await getStoredLang();
  applyTranslations(_currentLang);
  renderContextMenuHint(_currentLang);

  // Initial toggle state MUST come from the canonical merged prefs (sync +
  // consent + per-device overrides), NOT a raw sync read. A raw sync read
  // ignores per-device overrides (per-device-prefs), so a guarded toggle like
  // remoteRulesEnabled could DISPLAY a value that disagrees with the
  // effective value getPrefs() gives the rest of the extension (#888
  // follow-up).
  let prefs;
  try { prefs = await getPrefs(); } catch (err) { console.error("[MUGA] load prefs:", err); prefs = { ...PREF_DEFAULTS }; }

  // browsewrap Phase 1: Settings is always accessible — no redirect to
  // onboarding. A fresh install already records implicit acceptance (see
  // service-worker.js recordImplicitAcceptOnInstall), so there is no
  // onboardingDone state that would ever legitimately bounce a user here.

  bindToggle("notify", "notifyForeignAffiliate", prefs);
  bindToggle("strip-affiliates", "stripAllAffiliates", prefs);
  // D5 linked-suggestion nudge: reveals when strip-affiliates transitions to
  // checked. Never auto-enables suppressReferer/blockBeacons (nudge only).
  await initAffiliateNudge(prefs);

  bindToggle("dnr-enabled", "dnrEnabled", prefs);
  bindToggle("active-defense-enabled", "activeDefenseEnabled", prefs);
  bindToggle("context-menu-toggle", "contextMenuEnabled", prefs);
  bindToggle("block-pings", "blockPings", prefs);
  bindToggle("amp-redirect", "ampRedirect", prefs);
  bindToggle("unwrap-redirects", "unwrapRedirects", prefs);
  // Hover destination preview (#1028). Plain boolean toggle; not
  // guarded (no per-device override reconciliation needed).
  bindToggle("hover-preview-toggle", "hoverPreviewEnabled", prefs);
  // Honor Creator Mode (#435, B12). Plumbing only: persists the pref so
  // downstream slices (B13/B14) can read it. No behaviour change here.
  bindToggle("honor-creator-mode", "honorCreatorMode", prefs);
  // ADR-0004 phase 5 (#701): mode-label display removed along with Privacy Proxy section.
  // Experimental shape-based param heuristic (#544). Default OFF. Plumbed
  // here as a plain bindToggle — cleaner.js reads the flag through the same
  // prefs object and routes the heuristic accordingly.
  bindToggle("experimental-param-classes", "experimentalParamClassesEnabled", prefs);
  // ADR-0004 phase 5 (#701): useNativeShortenerResolution flag removed — native
  // resolution is now the only path, the toggle is vestigial and has been deleted.

  // #925: surface the seven previously UI-less prefs as Advanced controls
  // (all default ON, matching PREF_DEFAULTS). Booleans use bindToggle; the
  // userCustomRules list uses the shared renderList/removeEntry path below.
  // Privacy group:
  bindToggle("canonical-extractor", "canonicalExtractorEnabled", prefs);
  bindToggle("cross-site-frequency", "crossSiteFrequencyEnabled", prefs);
  bindToggle("attribution-ledger", "attributionLedgerEnabled", prefs);
  // Aggressive privacy (referer-beacon-privacy PR 4): opt-in, off by default.
  // Both toggles are plain booleans — no per-device override reconciliation.
  bindToggle("suppress-referer", "suppressReferer", prefs);
  bindToggle("block-beacons", "blockBeacons", prefs);
  // D2/D6: one-time disclosure for existing users whose blocklist already
  // gains this header-layer behavior. Gated to fire exactly once.
  await initBlocklistMigrationNotice(prefs);
  // Display group:
  bindToggle("param-breakdown", "paramBreakdown", prefs);
  bindToggle("show-report-button", "showReportButton", prefs);
  bindToggle("domain-stats", "domainStats", prefs);
  // Toolbar badge toggle (#910). Default ON; controls the native
  // setBadgeText running-count overlay on the toolbar icon.
  bindToggle("show-badge", "showBadge", prefs);

  // Per-creator allowlist editor (#445, B13). Lives in the Advanced card
  // (dev-mode gated after the #936 reorg), alongside the honor-creator-mode toggle.
  initCreatorAllowlist(prefs.creatorAllowlist || []);

  // Toast duration select
  const durationSelect = document.getElementById("toast-duration-select");
  durationSelect.value = String(snapToastDuration(prefs.toastDuration));
  durationSelect.addEventListener("change", () => {
    const val = snapToastDuration(parseInt(durationSelect.value, 10));
    try { setPrefs({ toastDuration: val }); } catch (err) { console.error("[MUGA] save duration:", err); }
  });

  renderList("custom-params-items", prefs.customParams, "customParams");
  renderList("blacklist-items", prefs.blacklist, "blacklist");
  renderList("whitelist-items", prefs.whitelist, "whitelist");
  // #925: view/remove editor for the popup-populated userCustomRules list.
  // Reuses the generic renderList + removeEntry path (no add box — entries
  // come from the popup's "Strip locally" button).
  renderList("user-custom-rules-items", prefs.userCustomRules || [], "userCustomRules");
  renderCategories(prefs.disabledCategories || []);
  initLanguageSelect();
  bindListButtons();
  initStatsSection();
  initExportImport();

  // devMode is device-local (chrome.storage.local), not sync — bind separately
  const devModeVal = await getDevMode();
  const devModeEl = document.getElementById("dev-mode");
  if (devModeEl) {
    devModeEl.checked = devModeVal;
    devModeEl.addEventListener("change", () => {
      setDevMode(devModeEl.checked).catch(err => console.error("[MUGA] save devMode:", err));
    });
  }
  syncDevTools();
  if (devModeEl) devModeEl.addEventListener("change", syncDevTools);
  initDevTools();

  // Remote rule updates section — feature-detect then wire (REQ-UI-5)
  await initRemoteRules();

  // Follow-shortener-redirects toggle section (ADR-0004 phase 2, #699)
  await initFollowShorteners(prefs);

  // Rate link: point to the correct store
  const rateLink = document.getElementById("rate-store-link");
  if (rateLink) {
    const isFirefox = detectFirefox();
    rateLink.href = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
  }

  // Signal init completion for e2e tests that need to avoid races with
  // async storage reads (e.g. clicking the dev-mode checkbox before the
  // stored value has been applied to the DOM).
  document.body.dataset.mugaReady = "1";

  // Scroll to the section indicated by the session-storage anchor, if any.
  // Called AFTER all prefs and i18n are applied so the section is fully
  // rendered when the scroll fires.
  await readOptionsAnchor();
}

/** Binds a checkbox to a sync storage preference key. */
function bindToggle(id, key, prefs) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = prefs[key];
  el.addEventListener("change", () => {
    try {
      setPrefs({ [key]: el.checked });
      // Guarded prefs (see GUARDED_PREFS: remoteRulesEnabled) may carry a
      // per-device override that getPrefs() overlays LAST. An explicit Settings
      // toggle is this device's authoritative choice, so reconcile the override
      // to match — otherwise a stale onboarding-decline override keeps winning
      // and the toggle silently reverts on reload (#888 follow-up). Membership-
      // gated so non-guarded toggles never touch the override map.
      if (GUARDED_PREFS.includes(key)) {
        reconcileOverrideForExplicitChoice(key, el.checked)
          .catch(err => console.error("[MUGA] reconcile override:", err));
      }
    } catch (err) { console.error("[MUGA] save toggle:", err); }
  });
}

// ── Aggressive privacy: nudge + one-time migration notice (PR 4, D5/D6) ─────
//
// Both functions are thin DOM/storage applicators. The actual show/hide
// DECISIONS live in the pure aggressive-privacy-ui.js helpers so they can be
// unit-tested with zero mocks (Extract-Before-Mock).

/**
 * Wires the affiliate-stripping nudge (D5): reveals a dismissible,
 * aria-live="polite" hint under strip-affiliates the moment it transitions
 * to checked, linking to the "Aggressive privacy" section. Never checks
 * suppressReferer/blockBeacons itself. Dismissal persists in
 * chrome.storage.local so it does not reappear across reloads.
 * @param {object} prefs - Merged preferences object (PREF_DEFAULTS shape)
 */
async function initAffiliateNudge(prefs) {
  const nudge = document.getElementById("strip-affiliates-nudge");
  const checkbox = document.getElementById("strip-affiliates");
  if (!nudge || !checkbox) return;

  let wasChecked = !!prefs.stripAllAffiliates;
  let dismissed = false;
  try {
    ({ aggressivePrivacyNudgeDismissed: dismissed } =
      await chrome.storage.local.get({ aggressivePrivacyNudgeDismissed: false }));
  } catch (err) { console.error("[MUGA] read nudge dismissal:", err); }

  checkbox.addEventListener("change", () => {
    const isChecked = checkbox.checked;
    if (shouldRevealAffiliateNudge({ wasChecked, isChecked, dismissed })) {
      nudge.hidden = false;
    }
    wasChecked = isChecked;
  });

  const dismissBtn = document.getElementById("nudge-aggressive-privacy-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", async () => {
      dismissed = true;
      nudge.hidden = true;
      try { await chrome.storage.local.set({ aggressivePrivacyNudgeDismissed: true }); }
      catch (err) { console.error("[MUGA] save nudge dismissal:", err); }
    });
  }

  const linkBtn = document.getElementById("nudge-aggressive-privacy-link");
  if (linkBtn) {
    linkBtn.addEventListener("click", () => {
      document.getElementById("section-aggressive-privacy")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

/**
 * Wires the one-time blocklist Referer/beacon migration notice (D2/D6
 * accepted condition: existing blocklist entries gain header-layer behavior,
 * disclosure is mandatory but shown exactly once). Gated by a stored flag in
 * chrome.storage.local so it never reappears once shown, regardless of
 * whether the user explicitly dismisses it.
 * @param {object} prefs - Merged preferences object (PREF_DEFAULTS shape)
 */
async function initBlocklistMigrationNotice(prefs) {
  const notice = document.getElementById("blocklist-migration-notice");
  if (!notice) return;

  let alreadyShown = false;
  try {
    ({ referrerBeaconNoticeShown: alreadyShown } =
      await chrome.storage.local.get({ referrerBeaconNoticeShown: false }));
  } catch (err) { console.error("[MUGA] read migration notice flag:", err); return; }

  if (!shouldShowBlocklistMigrationNotice({ blacklist: prefs.blacklist, alreadyShown })) return;

  notice.hidden = false;
  // Marked "seen" immediately on display (not on dismiss-click) so the
  // one-time gate cannot be bypassed by closing the tab before dismissing.
  try { await chrome.storage.local.set({ referrerBeaconNoticeShown: true }); }
  catch (err) { console.error("[MUGA] save migration notice flag:", err); }

  // TOCTOU guard (follow-up): two Options tabs opened at the same time can
  // both read referrerBeaconNoticeShown:false above before either tab's
  // write lands, so both would otherwise keep showing the notice. Added
  // AFTER this tab's own write above resolves, so it only reacts to the
  // flag being flipped to true by ANOTHER tab/context - never to its own.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (shouldHideMigrationNoticeOnStorageChange({
      area,
      change: changes.referrerBeaconNoticeShown,
      noticeVisible: !notice.hidden,
    })) {
      notice.hidden = true;
    }
  });

  document.getElementById("blocklist-migration-notice-dismiss")?.addEventListener("click", () => {
    notice.hidden = true;
  });
  document.getElementById("blocklist-migration-notice-link")?.addEventListener("click", () => {
    document.getElementById("section-aggressive-privacy")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Defense-in-depth cap on user-list rendering (#631 item 3): even if
// chrome.storage.sync somehow returns a malformed list with tens of thousands
// of entries (corrupted sync state, hostile import, …), the DOM stays
// bounded. Silent truncation — the legacy bloat case is too rare to warrant
// a visible warning, and a user who hits the cap legitimately is already
// well past any reasonable workflow.
const RENDER_LIST_MAX_ITEMS = 1000;

/** Renders a blacklist/whitelist/customParams list into its container. */
function renderList(containerId, items, listKey) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("empty_list", _currentLang);
    container.appendChild(p);
    return;
  }
  const cappedItems = items.length > RENDER_LIST_MAX_ITEMS
    ? items.slice(0, RENDER_LIST_MAX_ITEMS)
    : items;
  cappedItems.forEach((entry, i) => {
    const div = document.createElement("div");
    div.className = "list-item";
    const span = document.createElement("span");
    span.textContent = entry;

    const btn = document.createElement("button");
    btn.className = "del-btn";
    btn.dataset.list = listKey;
    btn.dataset.index = i;
    btn.textContent = "×";
    // i18n the aria-label (#742). Reuse the creator-allowlist remove key — same
    // verb, already translated for all SUPPORTED_LANGS — so screen-reader users
    // on es/pt/de/fr/it/ja don't hear an English "Remove" on these lists.
    btn.setAttribute("aria-label", t("creator_allowlist_remove_btn", _currentLang) + " " + entry);

    div.appendChild(span);
    div.appendChild(btn);
    container.appendChild(div);
  });

  // Wire up delete buttons without inline onclick (CSP-safe)
  container.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () =>
      removeEntry(btn.dataset.list, parseInt(btn.dataset.index, 10)));
  });
}

/** Wires add/remove buttons for list management sections. */
function bindListButtons() {
  document.getElementById("cp-add-btn").addEventListener("click", () =>
    addEntry("customParams", "cp-input", "custom-params-items"));
  document.getElementById("bl-add-btn").addEventListener("click", () =>
    addEntry("blacklist", "bl-input", "blacklist-items"));
  document.getElementById("wl-add-btn").addEventListener("click", () =>
    addEntry("whitelist", "wl-input", "whitelist-items"));
}

// ── Creator allowlist editor (#445, B13) ────────────────────────────────────

// Lets the import path refresh the creator-allowlist editor's in-memory list
// and re-render it WITHOUT rebinding its event listeners (#968). Set by
// initCreatorAllowlist; null until the editor is initialised.
let _refreshCreatorAllowlist = null;

/**
 * Initialises the per-creator allowlist editor. Renders the current list,
 * binds the add button + Enter key, and wires per-row remove buttons.
 * Persists to chrome.storage.sync via setPrefs. The pure CRUD logic lives
 * in creator-allowlist.js — this function is the DOM/storage glue.
 *
 * @param {string[]} initial - Initial allowlist (read from PREF_DEFAULTS-merged prefs).
 */
function initCreatorAllowlist(initial) {
  const list = Array.isArray(initial) ? [...initial] : [];
  const containerId = "creator-allowlist-items";
  const errorEl = document.getElementById("cal-error");
  const input   = document.getElementById("cal-input");
  const addBtn  = document.getElementById("cal-add-btn");
  if (!input || !addBtn || !errorEl) return;

  function showError(messageKey) {
    errorEl.textContent = t(messageKey, _currentLang);
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  function render(currentList) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.textContent = "";
    if (currentList.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = t("empty_list", _currentLang);
      container.appendChild(empty);
      return;
    }
    currentList.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "list-item";

      const span = document.createElement("span");
      span.textContent = entry;

      const btn = document.createElement("button");
      btn.className = "del-btn";
      btn.dataset.index = String(i);
      btn.textContent = "×";
      btn.setAttribute("aria-label", t("creator_allowlist_remove_btn", _currentLang) + " " + entry);
      btn.addEventListener("click", () => onRemove(entry));

      row.appendChild(span);
      row.appendChild(btn);
      container.appendChild(row);
    });
  }

  // Serializes allowlist mutations to prevent read-modify-write races
  // (#928: composes with the shared withSyncMutation helper instead of
  // duplicating its own read-mutate-write block).
  const withLock = createMutex();
  // This editor keeps its own in-memory `list` as the source of truth
  // (predates #928) rather than re-reading chrome.storage.sync on every
  // mutation, so the get/set deps below wrap that closure array instead of
  // hitting storage directly — same behaviour as before, now routed through
  // withSyncMutation for consistency + locking with the rest of options.js.
  const syncDeps = {
    get: async () => ({ creatorAllowlist: list }),
    set: async (partial) => {
      list.length = 0;
      list.push(...partial.creatorAllowlist);
      await setPrefs(partial);
    },
  };

  function onAdd() {
    const raw = input.value;
    return withSyncMutation(withLock, "creatorAllowlist", [], (current) => {
      const result = addCreatorAllowlistEntry(current, raw);
      if (result.error === "empty") {
        showError("creator_allowlist_err_empty");
        return undefined;
      }
      if (result.error === "duplicate") {
        showError("creator_allowlist_err_duplicate");
        return undefined;
      }
      if (result.error === "max") {
        showError("creator_allowlist_err_max");
        return undefined;
      }
      return result.list;
    }, syncDeps).then((next) => {
      if (next === undefined) return;
      input.value = "";
      clearError();
      render(list);
    });
  }

  function onRemove(entry) {
    return withSyncMutation(
      withLock,
      "creatorAllowlist",
      [],
      (current) => removeCreatorAllowlistEntry(current, entry),
      syncDeps,
    ).then(() => {
      clearError();
      render(list);
    });
  }

  addBtn.addEventListener("click", onAdd);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd();
    }
  });
  input.addEventListener("input", clearError);

  render(list);

  // Expose a listener-free refresh so the import path can swap the list in
  // and re-render after writing an imported creatorAllowlist to sync (#968).
  _refreshCreatorAllowlist = (newList) => {
    list.length = 0;
    list.push(...(Array.isArray(newList) ? newList : []));
    render(list);
  };
}

// Serializes tracking-category toggle mutations (#928). Independent of the
// list-editor lock (withListLock) and the creator-allowlist lock — none of
// these three groups can race with each other since they touch different
// storage keys, so each gets its own queue.
const withCategoriesLock = createMutex();

/** Renders tracking category toggle cards. */
function renderCategories(disabledCategories) {
  const card = document.getElementById("categories-card");
  card.replaceChildren();
  const disabled = new Set(disabledCategories);

  for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
    const langSuffix = { es: "Es", pt: "Pt", de: "De" }[_currentLang];
    const label = (langSuffix && cat["label" + langSuffix]) || cat.label;
    const desc = (langSuffix && cat["description" + langSuffix]) || cat.description;

    const row = document.createElement("div");
    row.className = "row";

    const labelDiv = document.createElement("div");
    labelDiv.className = "row-label";

    const strong = document.createElement("strong");
    strong.textContent = label;

    const small = document.createElement("small");
    small.textContent = desc;

    labelDiv.appendChild(strong);
    labelDiv.appendChild(small);

    const toggle = document.createElement("label");
    toggle.className = "toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `cat-${key}`;
    input.checked = !disabled.has(key);
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => {
      // #928: previously read-mutated-wrote disabledCategories with no lock,
      // so rapid toggles across categories could race and drop a write.
      // Now routed through withSyncMutation + withCategoriesLock like the
      // other list/allowlist editors.
      withSyncMutation(withCategoriesLock, "disabledCategories", [], (current) => {
        const set = new Set(current);
        if (input.checked) {
          set.delete(key);
        } else {
          set.add(key);
        }
        return [...set];
      });
    });

    const slider = document.createElement("span");
    slider.className = "slider";

    toggle.appendChild(input);
    toggle.appendChild(slider);

    row.appendChild(labelDiv);
    row.appendChild(toggle);
    card.appendChild(row);
  }
}

/** Initializes the language dropdown and binds change handler. */
function initLanguageSelect() {
  const select = document.getElementById("lang-select");
  const communityNote = document.getElementById("lang-community-note");
  // #707: populate <option>s from SUPPORTED_LANGS so every language registered
  // in i18n.js shows up here automatically. Previously hardcoded en/es/pt/de
  // hid fr/it/ja from the picker even though their translations were complete.
  select.replaceChildren(
    ...SUPPORTED_LANGS.map(({ code, label }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      return opt;
    }),
  );
  // Community-maintained languages (#360 / #351 / #707). Visible in the
  // language section so users selecting one of these understand the support
  // level they should expect. PT/DE were the original two; FR/IT/JA join
  // them now that the picker exposes them.
  const COMMUNITY_LANGS = new Set(["pt", "de", "fr", "it", "ja"]);
  function updateCommunityNote(lang) {
    if (communityNote) communityNote.hidden = !COMMUNITY_LANGS.has(lang);
  }
  select.value = _currentLang;
  updateCommunityNote(_currentLang);
  select.addEventListener("change", async () => {
    _currentLang = select.value;
    updateCommunityNote(_currentLang);
    try { await setPrefs({ language: _currentLang }); } catch (err) { console.error("[MUGA] save language:", err); }
    document.documentElement.lang = _currentLang;
    applyTranslations(_currentLang);
    renderContextMenuHint(_currentLang);
    // Re-render dynamic lists with new language
    let prefs;
    try { prefs = await chrome.storage.sync.get(PREF_DEFAULTS); } catch (err) { console.error("[MUGA] reload prefs:", err); prefs = { ...PREF_DEFAULTS }; }
    renderList("custom-params-items", prefs.customParams || [], "customParams");
    renderList("blacklist-items", prefs.blacklist, "blacklist");
    renderList("whitelist-items", prefs.whitelist, "whitelist");
    renderList("user-custom-rules-items", prefs.userCustomRules || [], "userCustomRules");
  });
}

// Serializes list mutations to prevent read-modify-write races. Shared by
// blacklist/whitelist/customParams add + remove (#928) — these three keys
// intentionally queue through ONE lock (not one each) so an add and a
// remove firing back-to-back on the same or different lists never race.
const withListLock = createMutex();

/** Adds a new entry to a list (blacklist/whitelist/customParams). */
function addEntry(listKey, inputId, containerId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  if (listKey === "customParams") {
    // Route the manual Add path through the SAME guard the import path uses
    // (isValidCustomParam → REMOTE_PARAM_DENYLIST + AFFILIATE_PARAM_GUARD, 64-char
    // cap). The old bare regex let a user hand-add an affiliate-attribution key
    // (tag, ascsubtag…) to customParams and strip it globally — violating the
    // never-strip-affiliate promise (ADR-0005 / #815). See audit #1036.
    if (!isValidCustomParam(value)) {
      showToast(t("add_entry_invalid", _currentLang));
      return;
    }
  } else if (!isValidListEntry(value)) {
    showToast(t("add_entry_invalid", _currentLang));
    return;
  }
  return withSyncMutation(withListLock, listKey, [], (list) => {
    if (list.includes(value)) return undefined; // already present — no-op
    // Enforce the same per-list caps the import path applies (#728 item 28).
    // IMPORT_LIST_CAPS is the single source of truth shared with capImportedLists,
    // so the UI add path can never grow a list past what the importer accepts.
    const cap = IMPORT_LIST_CAPS[listKey];
    if (list.length >= cap) {
      showToast(t("list_full", _currentLang));
      return undefined;
    }
    return [...list, value];
  }).then((next) => {
    input.value = "";
    if (next !== undefined) renderList(containerId, next, listKey);
  });
}

/** Removes an entry from a list by index. */
function removeEntry(listKey, index) {
  const containerMap = { blacklist: "blacklist-items", whitelist: "whitelist-items", customParams: "custom-params-items", userCustomRules: "user-custom-rules-items" };
  const containerId = containerMap[listKey] ?? `${listKey}-items`;
  return withSyncMutation(withListLock, listKey, [], (list) => {
    const next = [...list];
    next.splice(index, 1);
    return next;
  }).then((next) => {
    if (next !== undefined) renderList(containerId, next, listKey);
  });
}

/** Initializes the stats display and reset button. */
function initStatsSection() {
  const versionEl = document.getElementById("version-number");
  if (versionEl) {
    versionEl.textContent = chrome.runtime.getManifest().version;
  }

  document.getElementById("reset-stats-btn").addEventListener("click", async () => {
    const ok = await showConfirm(t("stats_reset_confirm", _currentLang));
    if (!ok) return;
    try {
      await chrome.storage.local.set({
        stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
        firstUsed: null,
        domainStats: {},
        // nudgeDismissed and nudgeShownCount intentionally NOT reset:
        // resetting stats must not re-trigger the review nudge.
      });
      showToast(t("stats_reset_done", _currentLang));
    } catch (err) { console.error("[MUGA] reset stats:", err); }
  });

  // #521: clear the per-install dedup list of params that have been
  // reported to the muga issue tracker. Lets the user re-submit the
  // same param after a previous submission was dismissed / fixed.
  const forgetBtn = document.getElementById("forget-reported-params-btn");
  if (forgetBtn) {
    forgetBtn.addEventListener("click", async () => {
      try {
        await chrome.storage.local.set({ submittedParams: {} });
        showToast(t("forget_reported_params_done", _currentLang));
      } catch (err) { console.error("[MUGA] forget reported params:", err); }
    });
  }
}

/** Initializes export/import settings functionality. */
function initExportImport() {
  document.getElementById("export-btn").addEventListener("click", async () => {
    let prefs;
    try { prefs = await chrome.storage.sync.get(PREF_DEFAULTS); } catch (err) { console.error("[MUGA] export prefs:", err); return; }
    // devMode is device-local (not in PREF_DEFAULTS) — read separately
    const devModeLocal = await getDevMode();
    const payload = buildExportPayload(prefs, {
      devMode: devModeLocal,
      appVersion: chrome.runtime.getManifest().version,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "muga-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById("import-file");

  document.getElementById("import-btn").addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 102400) {
      showToast(t("import_error", _currentLang));
      fileInput.value = "";
      return;
    }
    // Parse on its own first: a genuinely unreadable/corrupt file gets a
    // distinct message from a well-formed file that simply isn't a MUGA export.
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showToast(t("import_error_corrupt", _currentLang));
      fileInput.value = "";
      return;
    }
    try {
      // Structural validation, list capping/filtering, boolean-key extraction,
      // disabledCategories/toastDuration/creatorAllowlist/userCustomRules/language
      // handling all live in the pure planImport() (settings-schema.js) — the
      // single source of truth shared with buildExportPayload(). A well-formed
      // file that isn't a MUGA export (missing muga, malformed lists, invalid
      // entries) comes back as { ok: false } and shows the import_error toast.
      const plan = planImport(data);
      if (!plan.ok) throw new Error("invalid");
      const skipped = plan.skipped;

      // #983: everything below this point through the diff preview is
      // READ-ONLY — no chrome.storage write and no chrome.permissions
      // request/mutation may happen before the user confirms in the diff
      // modal. chrome.permissions.contains() is a read, so it is safe here.

      // #964 / browsewrap Phase 2: resolveShortenersOnClick/OnHover are each
      // permission-gated. An import may carry either preference but CANNOT
      // grant the host permissions (no user gesture survives the async file
      // read, and silently prompting on import is surprising). So enable
      // each only when the grant is already present; otherwise force it off.
      // This closes the gate-bypass and keeps the prefs honest — the user
      // re-enables via the toggle, which prompts. planImport is pure and
      // cannot call chrome.permissions itself, so it only reports the
      // request via plan.special (resolveOnClick/HoverProvided = "the file
      // carries a real boolean"; resolveOnClick/HoverRequested = "that
      // boolean is true") and this async gate stays here. As before, each
      // field is written ONLY when the imported file carries it as a
      // boolean — a missing key leaves the stored value untouched instead of
      // silently forcing it off. We branch on plan.special, not raw `data`,
      // so the decision follows any future migrate() transform of the
      // payload. Both share the SAME host-permission grant (the shortener
      // origins).
      const toSave = { ...plan.toSave };
      if (plan.special.resolveOnClickProvided) {
        toSave.resolveShortenersOnClick =
          plan.special.resolveOnClickRequested && (await hasShortenerPermissions());
      }
      if (plan.special.resolveOnHoverProvided) {
        toSave.resolveShortenersOnHover =
          plan.special.resolveOnHoverRequested && (await hasShortenerPermissions());
      }
      // remoteRulesEnabled follows the same permission gate: enabling remote
      // rules needs the rules.muga.app optional host grant, which an import
      // cannot request. Restore true only when the grant already exists;
      // otherwise force it off. Egress stays double-gated by consentVersion in
      // the service worker, so this never starts a fetch without consent.
      if (plan.special.remoteRulesProvided) {
        toSave.remoteRulesEnabled =
          plan.special.remoteRulesRequested && (await hasRemoteRulesPermission());
      }

      // Build the dry-run diff: currentValues from the EFFECTIVE prefs
      // (override-resolved, same source the DOM refresh below uses) plus the
      // current devMode; incomingValues from the fully-resolved toSave
      // (permission gates already applied above) plus the devMode this
      // import would land, if the file carries one.
      const currentValues = { ...(await getPrefs()), devMode: await getDevMode() };
      const incomingValues = { ...toSave };
      if (plan.special.devMode !== undefined) {
        incomingValues.devMode = plan.special.devMode;
      }

      const rows = diffImport(currentValues, incomingValues);
      if (rows.length === 0) {
        showToast(t("import_diff_no_changes", _currentLang));
        fileInput.value = "";
        return;
      }

      const confirmed = await showImportDiff(rows, _currentLang);
      if (!confirmed) {
        showToast(t("import_cancelled", _currentLang));
        fileInput.value = "";
        return;
      }

      // ── Everything above is read-only. Nothing is applied until here. ──

      const saved = await setPrefs(toSave);
      // Do not report success on a failed write (audit #1044): setPrefs resolves
      // false on a storage failure (e.g. quota), so without this the code below
      // would re-read the UNCHANGED prefs, repopulate the UI with the old values,
      // and still show the success toast. Route to the existing import_error path.
      // This runs BEFORE the devMode write so a failed sync import never leaves
      // device-local devMode changed against un-imported sync prefs (#1044).
      if (!saved) throw new Error("import: setPrefs write did not land");

      // devMode from imported file → local storage (only after the sync write landed)
      if (plan.special.devMode !== undefined) {
        await setDevMode(plan.special.devMode);
      }

      // #965: importing a config is an explicit choice for this device.
      // remoteRulesEnabled is guarded (synced-affiliate-pref-guard.js) and
      // permission-gated, so it never enters plan.toSave.
      // Reconcile its per-device override to the value that actually landed
      // (post permission gate) so sync, override, effective, and UI all
      // agree — otherwise a stale onboarding-decline override would keep the
      // extension's effective value at odds with the freshly imported sync
      // value. NOTE: unlike the
      // ENABLE/DISABLE_REMOTE_RULES toggle path, import only writes the pref +
      // override; it deliberately does NOT force an immediate signed fetch (that
      // would start egress from a file import, bypassing the gesture the toggle
      // requires) nor eagerly clear DNR rule 1001. The service worker applies
      // the change on its next wake / weekly cycle.
      if (plan.special.remoteRulesProvided) {
        await reconcileOverrideForExplicitChoice("remoteRulesEnabled", toSave.remoteRulesEnabled);
      }

      // Re-read prefs and update all UI toggles and lists
      const newPrefs = await chrome.storage.sync.get(PREF_DEFAULTS);
      document.getElementById("notify").checked = newPrefs.notifyForeignAffiliate;
      document.getElementById("strip-affiliates").checked = newPrefs.stripAllAffiliates;
      document.getElementById("dnr-enabled").checked = newPrefs.dnrEnabled;
      document.getElementById("active-defense-enabled").checked = newPrefs.activeDefenseEnabled;
      document.getElementById("context-menu-toggle").checked = newPrefs.contextMenuEnabled;
      document.getElementById("block-pings").checked = newPrefs.blockPings;
      document.getElementById("amp-redirect").checked = newPrefs.ampRedirect;
      document.getElementById("unwrap-redirects").checked = newPrefs.unwrapRedirects;
      document.getElementById("hover-preview-toggle").checked = newPrefs.hoverPreviewEnabled;
      // #925: refresh the newly-surfaced privacy + display toggles after import
      document.getElementById("canonical-extractor").checked = newPrefs.canonicalExtractorEnabled;
      document.getElementById("cross-site-frequency").checked = newPrefs.crossSiteFrequencyEnabled;
      document.getElementById("attribution-ledger").checked = newPrefs.attributionLedgerEnabled;
      // referer-beacon-privacy PR 4: reflect the imported Aggressive privacy toggles.
      document.getElementById("suppress-referer").checked = newPrefs.suppressReferer;
      document.getElementById("block-beacons").checked = newPrefs.blockBeacons;
      document.getElementById("param-breakdown").checked = newPrefs.paramBreakdown;
      document.getElementById("show-report-button").checked = newPrefs.showReportButton;
      document.getElementById("domain-stats").checked = newPrefs.domainStats;
      document.getElementById("show-badge").checked = newPrefs.showBadge;
      // #964 / browsewrap Phase 2: reflect the gated result for EACH split
      // toggle — each checkbox must match the pref that actually landed
      // (forced off unless the host grant was already present).
      const resolveOnClickEl = document.getElementById("resolveShortenersOnClick");
      if (resolveOnClickEl) resolveOnClickEl.checked = newPrefs.resolveShortenersOnClick;
      const resolveOnHoverEl = document.getElementById("resolveShortenersOnHover");
      if (resolveOnHoverEl) resolveOnHoverEl.checked = newPrefs.resolveShortenersOnHover;
      // Reflect the gated remote-rules result. remoteRulesEnabled is guarded, so
      // its EFFECTIVE value is the per-device override overlaid on sync
      // (getPrefs), NOT the raw sync value. Reading raw could show ON while an
      // override keeps it effectively OFF — e.g. importing a legacy file that
      // omits the key leaves a prior decline-override in place. Source the
      // checkbox from the merged effective prefs, matching init()/initRemoteRules.
      const effectivePrefs = await getPrefs();
      const remoteRulesToggleEl = document.getElementById("remote-rules-toggle");
      if (remoteRulesToggleEl) remoteRulesToggleEl.checked = effectivePrefs.remoteRulesEnabled;
      // #968: refresh the previously-unrefreshed imported toggles + allowlist.
      const honorCreatorEl = document.getElementById("honor-creator-mode");
      if (honorCreatorEl) honorCreatorEl.checked = newPrefs.honorCreatorMode;
      const experimentalParamEl = document.getElementById("experimental-param-classes");
      if (experimentalParamEl) experimentalParamEl.checked = newPrefs.experimentalParamClassesEnabled;
      if (Array.isArray(toSave.creatorAllowlist)) _refreshCreatorAllowlist?.(newPrefs.creatorAllowlist);
      // devMode is device-local — re-read from local storage after import
      document.getElementById("dev-mode").checked = await getDevMode();
      document.getElementById("toast-duration-select").value = String(snapToastDuration(newPrefs.toastDuration));
      syncDevTools();
      if (toSave.language) {
        _currentLang = toSave.language;
        document.getElementById("lang-select").value = _currentLang;
        applyTranslations(_currentLang);
        renderContextMenuHint(_currentLang);
      }
      renderList("blacklist-items", newPrefs.blacklist, "blacklist");
      renderList("whitelist-items", newPrefs.whitelist, "whitelist");
      renderList("custom-params-items", newPrefs.customParams, "customParams");
      renderList("user-custom-rules-items", newPrefs.userCustomRules || [], "userCustomRules");
      renderCategories(newPrefs.disabledCategories || []);
      if (skipped > 0) {
        showToast(t("import_params_skipped", _currentLang).replace("{n}", String(skipped)));
      } else {
        showToast(t("import_success", _currentLang));
      }
    } catch {
      showToast(t("import_error", _currentLang));
    }
    fileInput.value = "";
  });
}

/** Shows/hides dev tools section based on devMode pref. */
function syncDevTools() {
  const devModeEl = document.getElementById("dev-mode");
  const devToolsCard = document.getElementById("dev-tools-card");
  if (!devModeEl || !devToolsCard) return;
  // #858: visibility driven by CSS class (no inline style — required for CSP style-src without 'unsafe-inline')
  devToolsCard.classList.toggle("dev-tools-hidden", !devModeEl.checked);
}

/** Initializes dev tools: URL tester and preview features. */
function initDevTools() {
  // Preview notification: replicas the real affiliate toast from content/cleaner.js
  const previewBtn = document.getElementById("dev-preview-notify-btn");
  if (!previewBtn) return;
  previewBtn.addEventListener("click", async () => {
    document.getElementById("muga-preview-notice")?.remove();

    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
    const toastDuration = Math.max(5, Math.min(60, prefs.toastDuration || 15)) * 1000;

    const notice = document.createElement("div");
    notice.id = "muga-preview-notice";
    notice.setAttribute("role", "alert");
    notice.setAttribute("aria-live", "assertive");
    notice.style.cssText = [
      "position:fixed", "bottom:20px", "right:20px",
      "background:#1c1c1e", "color:#f0f0f0", "border-radius:10px",
      "padding:12px 16px",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:13px", "line-height:1.5", "max-width:300px",
      "z-index:2147483647", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
      "border:0.5px solid rgba(255,255,255,0.1)",
    ].join(";");

    const btnStyle = "flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer";

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "font-weight:500;margin-bottom:6px;font-size:12px;color:#aaa";
    titleDiv.textContent = t("toast_title", _currentLang);

    const msgDiv = document.createElement("div");
    msgDiv.style.cssText = "margin-bottom:10px;font-size:12px;color:#ddd";
    msgDiv.appendChild(document.createTextNode("amazon.es " + t("toast_tag_msg", _currentLang) + " "));
    const codeEl = document.createElement("code");
    codeEl.style.cssText = "background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px";
    codeEl.textContent = "tag=somestore-21";
    msgDiv.appendChild(codeEl);

    const btnDiv = document.createElement("div");
    btnDiv.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";

    const keepBtn = document.createElement("button");
    keepBtn.style.cssText = btnStyle;
    keepBtn.textContent = t("toast_allow", _currentLang);
    btnDiv.appendChild(keepBtn);

    const removeBtn = document.createElement("button");
    removeBtn.style.cssText = btnStyle;
    removeBtn.textContent = t("toast_block", _currentLang);
    btnDiv.appendChild(removeBtn);

    const dismissBtn = document.createElement("button");
    dismissBtn.style.cssText = "margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer;background:none;border:none;display:block;width:100%";
    dismissBtn.textContent = t("toast_dismiss", _currentLang);

    notice.appendChild(titleDiv);
    notice.appendChild(msgDiv);
    notice.appendChild(btnDiv);
    notice.appendChild(dismissBtn);
    document.body.appendChild(notice);

    const timer = setTimeout(() => notice.remove(), toastDuration);
    notice.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => { clearTimeout(timer); notice.remove(); });
    });
  });

  // Preview rating nudge
  const nudgePreviewBtn = document.getElementById("dev-preview-nudge-btn");
  if (nudgePreviewBtn) {
    nudgePreviewBtn.addEventListener("click", async () => {
      document.getElementById("muga-preview-nudge")?.remove();
      const localData = await chrome.storage.local.get({ nudgeDismissed: false, nudgeShownCount: 0, nudgeLastShown: 0 });
      const notice = document.createElement("div");
      notice.id = "muga-preview-nudge";
      notice.setAttribute("role", "alert");
      notice.setAttribute("aria-live", "assertive");
      notice.style.cssText = [
        "position:fixed", "bottom:20px", "right:20px",
        "background:#1c1c1e", "color:#f0f0f0", "border-radius:10px",
        "padding:12px 16px", "font-family:-apple-system,sans-serif",
        "font-size:13px", "line-height:1.5", "max-width:320px",
        "z-index:2147483647", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
        "border:0.5px solid rgba(255,255,255,0.1)",
      ].join(";");

      const title = document.createElement("div");
      title.style.cssText = "font-weight:600;margin-bottom:8px;font-size:13px";
      title.textContent = t("rate_nudge_btn_short", _currentLang);

      const info = document.createElement("div");
      info.style.cssText = "font-size:11px;color:#aaa;margin-bottom:10px;line-height:1.4";
      info.textContent = t("dev_nudge_status", _currentLang)
        .replace("%s1", localData.nudgeDismissed)
        .replace("%s2", localData.nudgeShownCount)
        .replace("%s3", localData.nudgeLastShown ? new Date(localData.nudgeLastShown).toLocaleDateString() : "never");

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:6px";
      const btnStyle = "flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer";

      const rateBtn = document.createElement("button");
      rateBtn.style.cssText = btnStyle;
      rateBtn.textContent = t("rate_nudge_btn_short", _currentLang);

      const dismissBtn = document.createElement("button");
      dismissBtn.style.cssText = btnStyle + ";color:#9A9A9A";
      dismissBtn.textContent = `${t("dev_nudge_dismiss_btn", _currentLang)} (${localData.nudgeShownCount}/3)`;

      const resetBtn = document.createElement("button");
      resetBtn.style.cssText = btnStyle + ";color:#f59e0b;font-size:10px";
      resetBtn.textContent = t("dev_nudge_reset_btn", _currentLang);

      btnRow.appendChild(rateBtn);
      btnRow.appendChild(dismissBtn);
      btnRow.appendChild(resetBtn);
      notice.appendChild(title);
      notice.appendChild(info);
      notice.appendChild(btnRow);
      document.body.appendChild(notice);

      const timer = setTimeout(() => notice.remove(), 15000);

      rateBtn.addEventListener("click", () => {
        clearTimeout(timer);
        const isFirefox = detectFirefox();
        const storeUrl = isFirefox
          ? "https://addons.mozilla.org/firefox/addon/muga/"
          : "https://chromewebstore.google.com/detail/muga/";
        chrome.tabs.create({ url: storeUrl });
        notice.remove();
      });

      dismissBtn.addEventListener("click", async () => {
        const fresh = await chrome.storage.local.get({ nudgeShownCount: 0 });
        const newCount = fresh.nudgeShownCount + 1;
        if (newCount > 3) {
          await chrome.storage.local.set({ nudgeShownCount: 0, nudgeDismissed: false, nudgeLastShown: 0 });
          info.textContent = t("dev_nudge_reset_fresh", _currentLang);
        } else {
          await chrome.storage.local.set({ nudgeShownCount: newCount, nudgeLastShown: Date.now() });
          info.textContent = t("dev_nudge_status", _currentLang)
            .replace("%s1", "false")
            .replace("%s2", newCount)
            .replace("%s3", "now");
        }
        dismissBtn.textContent = `${t("dev_nudge_dismiss_btn", _currentLang)} (${newCount > 3 ? 0 : newCount}/3)`;
      });

      resetBtn.addEventListener("click", async () => {
        await chrome.storage.local.set({ nudgeShownCount: 0, nudgeDismissed: false, nudgeLastShown: 0 });
        info.textContent = t("dev_nudge_reset_done", _currentLang);
        dismissBtn.textContent = `${t("dev_nudge_dismiss_btn", _currentLang)} (0/3)`;
      });
    });
  }

  // Show onboarding
  document.getElementById("dev-show-onboarding-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  });

  // Export debug log
  document.getElementById("dev-export-log-btn").addEventListener("click", async () => {
    // Warn before exporting: the file contains browser info and extension settings.
    const confirmed = await showConfirm(t("debug_export_confirm", _currentLang));
    if (!confirmed) return;

    const [response, prefs, localData] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_DEBUG_LOG" }),
      chrome.storage.sync.get(PREF_DEFAULTS),
      chrome.storage.local.get({ stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 } }),
    ]);
    const log = response?.log ?? [];
    const manifest = chrome.runtime.getManifest();

    // Reduce UA to "BrowserName MajorVersion" to avoid full fingerprint in exports
    const uaRaw = navigator.userAgent;
    let browserLabel = "Unknown";
    const firefoxMatch = uaRaw.match(/Firefox\/(\d+)/);
    const chromeMatch = uaRaw.match(/Chrome\/(\d+)/);
    const edgeMatch = uaRaw.match(/Edg\/(\d+)/);
    if (firefoxMatch) browserLabel = `Firefox ${firefoxMatch[1]}`;
    else if (edgeMatch) browserLabel = `Edge ${edgeMatch[1]}`;
    else if (chromeMatch) browserLabel = `Chrome ${chromeMatch[1]}`;

    // Strip sensitive/personal list data; keep only config flags needed for debugging
    const safePrefs = { ...prefs };
    delete safePrefs._parsedBlacklist;
    delete safePrefs._parsedWhitelist;
    // blacklist/whitelist contain user-specific domains — omit from export
    delete safePrefs.blacklist;
    delete safePrefs.whitelist;

    const payload = {
      muga_version: manifest.version,
      browser: browserLabel,
      exported_at: new Date().toISOString(),
      settings: safePrefs,
      stats: localData.stats,
      session_log: log,
    };

    let jsonStr = JSON.stringify(payload, null, 2);
    // Enforce 2MB limit: trim oldest log entries if needed
    const MAX_BYTES = 2 * 1024 * 1024;
    while (jsonStr.length > MAX_BYTES && payload.session_log.length > 10) {
      payload.session_log = payload.session_log.slice(0, Math.floor(payload.session_log.length * 0.8));
      payload.session_log_truncated = true;
      jsonStr = JSON.stringify(payload, null, 2);
    }

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `muga-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // URL tester
  document.getElementById("dev-url-test-btn").addEventListener("click", testUrl);
  document.getElementById("dev-url-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") testUrl();
  });

}

/** Tests a URL against the cleaner and displays results. */
async function testUrl() {
  const input = document.getElementById("dev-url-input").value.trim();
  const resultDiv = document.getElementById("dev-url-result");
  const cleanEl = document.getElementById("dev-url-clean");
  const removedEl = document.getElementById("dev-url-removed");
  const reportBtn = document.getElementById("dev-url-report-btn");
  // #858: use hidden attribute instead of inline style (CSP style-src without 'unsafe-inline')
  if (reportBtn) reportBtn.hidden = true;
  // The opt-in full-URL consent is PER-URL: the "I confirm no personal or
  // sensitive data" attestation applies to the URL the user just attested to,
  // not the next one. Reset the row + checkbox on every test so a box left
  // ticked for a previous URL can never silently carry its consent over to a
  // different URL's report.
  const includeUrlRow = document.getElementById("url-report-include-url-row");
  if (includeUrlRow) includeUrlRow.hidden = true;
  const includeUrlCheckbox = document.getElementById("url-report-include-url");
  if (includeUrlCheckbox) includeUrlCheckbox.checked = false;
  if (!input) return;
  try {
    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
    const { processUrl } = await import("../lib/cleaner.js");
    const resp = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    const domainRules = await resp.json();
    // Path-strip and path-affiliate args intentionally omitted — options preview is a non-path surface. Defaulted [] is a no-op (accepted regression per declarative-path-rules design §7).
    const result = processUrl(input, { ...prefs, notifyForeignAffiliate: false }, domainRules);
    cleanEl.textContent = result.cleanUrl;
    if (result.removedTracking?.length > 0) {
      removedEl.textContent = t("dev_url_removed", _currentLang).replace("%s", result.removedTracking.join(", "));
    } else if (result.cleanUrl === input) {
      removedEl.textContent = t("dev_url_clean", _currentLang);
    } else {
      removedEl.textContent = t("dev_url_action", _currentLang).replace("%s", result.action);
    }
    // #858: use hidden attribute to reveal result (no inline style)
    resultDiv.hidden = false;

    // Show report button after results (clone to avoid listener accumulation)
    if (reportBtn) {
      const newBtn = reportBtn.cloneNode(true);
      reportBtn.parentNode.replaceChild(newBtn, reportBtn);
      newBtn.hidden = false;

      // Opt-in full-URL checkbox row (unchecked by default — hostname-only
      // stays the default report contract).
      const includeUrlRow = document.getElementById("url-report-include-url-row");
      if (includeUrlRow) includeUrlRow.hidden = false;

      newBtn.addEventListener("click", () => {
        try {
          const hostname = new URL(input).hostname;
          const includeCheckbox = document.getElementById("url-report-include-url");
          const body = buildBrokenSiteReportBody({
            url: input,
            includeFullUrl: includeCheckbox?.checked === true,
            hostname,
            version: chrome.runtime.getManifest().version,
            browser: navigator.userAgent,
            action: result.action,
            removedParams: result.removedTracking,
          });
          const title = encodeURIComponent(`[URL Report] ${hostname}`);
          window.open(`https://github.com/yocreoquesi/muga/issues/new?title=${title}&body=${encodeURIComponent(body)}`, "_blank", "noopener,noreferrer");
        } catch {
          // Invalid URL, ignore
        }
      });
    }
  } catch (e) {
    cleanEl.textContent = t("dev_url_error", _currentLang) + " " + e.message;
    removedEl.textContent = "";
    // #858: use hidden attribute to reveal result on error
    resultDiv.hidden = false;
  }
}

// ── Error-code → i18n-key map for remote-rules status rendering ──────────────

/** Maps remote-rules error codes to i18n keys (design §5). */
const REMOTE_ERR_KEYS = Object.freeze({
  NETWORK_ERROR:      "optionsRemoteRulesErrNetwork",
  SCHEMA_ERROR:       "optionsRemoteRulesErrSchema",
  VERIFY_FAILED:      "optionsRemoteRulesErrSignature",
  INVALID_FORMAT:     "optionsRemoteRulesErrFormat",
  DENYLIST_HIT:       "optionsRemoteRulesErrDenylist",
  OVER_CAP:           "optionsRemoteRulesErrOverCap",
  VERSION_REGRESSION: "optionsRemoteRulesErrVersion",
  STALE_PAYLOAD:      "optionsRemoteRulesErrStale",
  DNR_ERROR:          "optionsRemoteRulesErrDnr",
});

/**
 * Renders the remote-rules status block with data from the service worker.
 * Uses textContent only — no innerHTML with dynamic data (REQ-SECURITY-1).
 *
 * @param {{ enabled: boolean, fetchedAt: string|null, paramCount: number|null, lastError: string|null, source: string }} status
 */
function renderRemoteRulesStatus(status) {
  const statusBlock = document.getElementById("remote-rules-status");
  const lastFetchEl = document.getElementById("remote-rules-last-fetch");
  const paramCountEl = document.getElementById("remote-rules-param-count");
  const sourceEl = document.getElementById("remote-rules-source");
  const errorEl = document.getElementById("remote-rules-error");

  if (!statusBlock || !lastFetchEl || !paramCountEl || !sourceEl || !errorEl) return;

  if (status.enabled) {
    statusBlock.hidden = false;

    // Last fetch timestamp — localised (REQ-UI-2)
    if (status.fetchedAt) {
      lastFetchEl.textContent = new Date(status.fetchedAt).toLocaleString(_currentLang);
    } else {
      lastFetchEl.textContent = t("optionsRemoteRulesNeverFetched", _currentLang);
    }

    // Param count (integer display)
    paramCountEl.textContent = typeof status.paramCount === "number" ? String(status.paramCount) : "0";

    // Source URL — set href, textContent is already i18n via data-i18n (REQ-UI-2)
    sourceEl.href = status.source || REMOTE_RULES_URL;
  } else {
    statusBlock.hidden = true;
    lastFetchEl.textContent = "";
    paramCountEl.textContent = "";
    sourceEl.href = REMOTE_RULES_URL;
  }

  // Error display — REQ-UI-4
  if (status.lastError) {
    const errKey = REMOTE_ERR_KEYS[status.lastError] || "optionsRemoteRulesErrUnknown";
    errorEl.textContent = t(errKey, _currentLang);
    errorEl.hidden = false;
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  renderRemoteRulesChangelog(status);
}

/**
 * Renders the weekly remote-rules changelog block (#984): "N added / M
 * removed" plus a capped, enumerated diff list of tracking-parameter names
 * MUGA now cleans (added) or no longer cleans (removed).
 *
 * Thin DOM applicator: all framing/branching lives in the pure, unit-tested
 * planChangelogView (src/lib/remote-rules-changelog-view.js). Uses textContent
 * only for dynamic data — no innerHTML (REQ-SECURITY-1).
 *
 * @param {{ enabled: boolean, changelog?: { addedCount:number, removedCount:number, added:string[], removed:string[], fetchedAt:number|null, prevFetchedAt:number|null }|null }} status
 */
function renderRemoteRulesChangelog(status) {
  const details = document.getElementById("remote-rules-changelog");
  const summary = document.getElementById("remote-rules-changelog-summary");
  const emptyEl = document.getElementById("remote-rules-changelog-empty");
  const addedBlock = document.getElementById("remote-rules-changelog-added-block");
  const addedList = document.getElementById("remote-rules-changelog-added");
  const addedMore = document.getElementById("remote-rules-changelog-added-more");
  const removedBlock = document.getElementById("remote-rules-changelog-removed-block");
  const removedList = document.getElementById("remote-rules-changelog-removed");
  const removedMore = document.getElementById("remote-rules-changelog-removed-more");

  if (
    !details || !summary || !emptyEl ||
    !addedBlock || !addedList || !addedMore ||
    !removedBlock || !removedList || !removedMore
  ) return;

  const view = planChangelogView(status, (k) => t(k, _currentLang));

  details.hidden = !view.visible;
  summary.textContent = view.summary;

  // Empty/framing line (initial rule set, no-changes) — mutually exclusive
  // with the added/removed diff lists.
  if (view.empty !== null) {
    emptyEl.textContent = view.empty;
    emptyEl.hidden = false;
  } else {
    emptyEl.textContent = "";
    emptyEl.hidden = true;
  }

  // Added diff list.
  if (view.added !== null) {
    addedBlock.hidden = false;
    addedList.textContent = "";
    for (const name of view.added) {
      const li = document.createElement("li");
      li.textContent = name;
      addedList.appendChild(li);
    }
    if (view.addedMore !== null) {
      addedMore.textContent = view.addedMore;
      addedMore.hidden = false;
    } else {
      addedMore.textContent = "";
      addedMore.hidden = true;
    }
  } else {
    addedBlock.hidden = true;
    addedList.textContent = "";
    addedMore.textContent = "";
    addedMore.hidden = true;
  }

  // Removed diff list.
  if (view.removed !== null) {
    removedBlock.hidden = false;
    removedList.textContent = "";
    for (const name of view.removed) {
      const li = document.createElement("li");
      li.textContent = name;
      removedList.appendChild(li);
    }
    if (view.removedMore !== null) {
      removedMore.textContent = view.removedMore;
      removedMore.hidden = false;
    } else {
      removedMore.textContent = "";
      removedMore.hidden = true;
    }
  } else {
    removedBlock.hidden = true;
    removedList.textContent = "";
    removedMore.textContent = "";
    removedMore.hidden = true;
  }
}

/**
 * Initialises the remote-rules UI section.
 *
 * Sequence (design §4.5, REQ-UI-5):
 * 1. Feature-detect chrome.alarms + chrome.declarativeNetRequest.
 * 2. If unsupported: leave section hidden and return.
 * 3. If supported: show section, query status, render, bind toggle.
 *
 * Firefox MV2 note (design §10, REQ-OPT-4):
 * chrome.permissions.request MUST be the FIRST await in the enable branch of
 * the toggle change handler. Any await before it detaches from the Firefox MV2
 * user-gesture frame and the permission request silently returns false.
 */
async function initRemoteRules() {
  // REQ-UI-5: hide the section entirely on runtimes without DNR. v1.10.1
  // removed the chrome.alarms dependency — the only remaining runtime gate
  // is DNR availability.
  const supportsRemote = typeof chrome.declarativeNetRequest !== "undefined";

  const section = document.getElementById("remote-rules-section");
  if (!section) return;

  if (!supportsRemote) {
    // Leave hidden — already set via the hidden attribute in HTML
    return;
  }

  section.hidden = false;

  // Query current status from the service worker
  let status = { enabled: false, fetchedAt: null, paramCount: 0, lastError: null, source: REMOTE_RULES_URL };
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_REMOTE_RULES_STATUS" });
    if (resp) status = { ...status, ...resp, ...(resp.meta || {}) };
  } catch (err) {
    console.error("[MUGA] GET_REMOTE_RULES_STATUS:", err);
  }

  // Render initial state
  const remoteRulesToggle = document.getElementById("remote-rules-toggle");
  if (!remoteRulesToggle) return;

  remoteRulesToggle.checked = Boolean(status.enabled);
  renderRemoteRulesStatus(status);

  // Toggle change handler (design §10 + REQ-OPT-4)
  remoteRulesToggle.addEventListener("change", async (e) => {
    const errorEl = document.getElementById("remote-rules-error");

    if (!e.target.checked) {
      // Disable path (design §4.4)
      try {
        const resp = await chrome.runtime.sendMessage({ type: "DISABLE_REMOTE_RULES" });
        if (resp?.ok) {
          renderRemoteRulesStatus({ enabled: false, fetchedAt: null, paramCount: 0, lastError: null, source: REMOTE_RULES_URL });
        }
      } catch (err) {
        console.error("[MUGA] DISABLE_REMOTE_RULES:", err);
      }
      return;
    }

    // Enable path — CRITICAL: chrome.permissions.request MUST be the FIRST await.
    // Firefox MV2 requires the permission request to be called synchronously in
    // the same gesture frame. Any await before this call detaches from that frame
    // and the request silently returns false. (design §10, REQ-OPT-4)
    let granted = false;
    try {
      granted = await chrome.permissions.request({
        origins: ["https://rules.muga.app/*"],
      });
    } catch {
      granted = false;
    }

    if (!granted) {
      e.target.checked = false;
      if (errorEl) {
        errorEl.textContent = t("optionsRemoteRulesPermDenied", _currentLang);
        errorEl.hidden = false;
      }
      return;
    }

    // Permission granted — send enable message
    try {
      const resp = await chrome.runtime.sendMessage({ type: "ENABLE_REMOTE_RULES" });
      if (!resp?.ok) {
        e.target.checked = false;
        if (errorEl) {
          const errKey = (resp?.error && REMOTE_ERR_KEYS[resp.error]) || "optionsRemoteRulesErrUnknown";
          errorEl.textContent = t(errKey, _currentLang);
          errorEl.hidden = false;
        }
        return;
      }
      // Re-query status and render updated state
      const statusResp = await chrome.runtime.sendMessage({ type: "GET_REMOTE_RULES_STATUS" });
      if (statusResp) {
        renderRemoteRulesStatus({ source: REMOTE_RULES_URL, ...statusResp, ...(statusResp.meta || {}) });
      }
    } catch (err) {
      console.error("[MUGA] ENABLE_REMOTE_RULES:", err);
      e.target.checked = false;
      if (errorEl) {
        errorEl.textContent = t("optionsRemoteRulesErrUnknown", _currentLang);
        errorEl.hidden = false;
      }
    }
  });

  // "Update now" — forces an immediate fetch, bypassing the 7-day cadence
  // gate. Only visible while #remote-rules-status is shown (i.e. enabled).
  const updateNowBtn = document.getElementById("remote-rules-update-now");
  const updateStatusEl = document.getElementById("remote-rules-update-status");
  if (updateNowBtn) {
    updateNowBtn.addEventListener("click", async () => {
      updateNowBtn.disabled = true;
      if (updateStatusEl) {
        updateStatusEl.textContent = t("optionsRemoteRulesUpdating", _currentLang);
        updateStatusEl.hidden = false;
      }
      try {
        const resp = await chrome.runtime.sendMessage({ type: "FORCE_FETCH_REMOTE_RULES" });
        const statusResp = await chrome.runtime.sendMessage({ type: "GET_REMOTE_RULES_STATUS" });
        if (statusResp) {
          renderRemoteRulesStatus({ source: REMOTE_RULES_URL, ...statusResp, ...(statusResp.meta || {}) });
        }
        if (resp?.ok && !statusResp?.meta?.lastError) {
          showToast(t("optionsRemoteRulesUpdated", _currentLang));
        }
      } catch (err) {
        console.error("[MUGA] FORCE_FETCH_REMOTE_RULES:", err);
      } finally {
        updateNowBtn.disabled = false;
        if (updateStatusEl) {
          updateStatusEl.textContent = "";
          updateStatusEl.hidden = true;
        }
      }
    });
  }
}

/**
 * Requests the optional host permissions for the eight shortener origins.
 * CRITICAL: must be the FIRST await in the enable path (Firefox MV2
 * gesture-frame requirement — mirrors requestProxyPermission). Origins are
 * derived from GENERIC_SHORTENERS so the permission list and the resolver
 * allowlist share a single source of truth.
 *
 * @returns {Promise<boolean>}
 */
async function requestShortenerPermissions() {
  try {
    return await chrome.permissions.request({
      origins: GENERIC_SHORTENERS.map((host) => `https://${host}/*`),
    });
  } catch {
    return false;
  }
}

/**
 * Shows or hides the "new shorteners available, re-enable" notice
 * (shortener-resolver-expansion Slice 1, design D3). Only relevant while
 * EITHER split toggle is ON: GENERIC_SHORTENERS grew from 7 to 13 hosts, so
 * an existing grantee's original 7-origin grant no longer covers every host
 * and hasShortenerPermissions() now returns false for them. The notice's
 * button reuses requestShortenerPermissions() (all origins) — Chrome/Firefox
 * silently no-op already-granted origins and prompt only for the delta.
 *
 * @param {boolean} enabled - true when either resolveShortenersOnClick or
 *   resolveShortenersOnHover is currently checked
 */
async function updateShortenerRegrantNotice(enabled) {
  const notice = document.getElementById("shortener-regrant-notice");
  const btn = document.getElementById("shortener-regrant-btn");
  if (!notice || !btn) return;
  const needsRegrant = enabled && !(await hasShortenerPermissions());
  notice.hidden = !needsRegrant;
  btn.hidden = !needsRegrant;
}

/**
 * Initialises the two shortener-resolution toggles (browsewrap Phase 2,
 * split from the single ADR-0004 phase 2 (#699) "Follow shortener redirects"
 * toggle):
 *   - #resolveShortenersOnClick — click-time resolution, default ON.
 *   - #resolveShortenersOnHover — hover/proactive resolution, default OFF
 *     (opt-in) — pings the shortener host for a link the user only looked
 *     at, a privacy cost click-time resolution doesn't have.
 *
 * Both share the same optional host-permission grant (the eight-plus
 * shortener origins) — enabling EITHER one for the first time requests it.
 * The permission request is the first await in each enable path (Firefox
 * MV2 gesture-frame requirement). Each pref persists to chrome.storage.sync
 * independently, and a denial reverts only the checkbox being toggled.
 *
 * @param {object} prefs - Merged preferences object (PREF_DEFAULTS shape)
 */
async function initFollowShorteners(prefs) {
  const clickCheckbox = document.getElementById("resolveShortenersOnClick");
  const hoverCheckbox = document.getElementById("resolveShortenersOnHover");
  if (!clickCheckbox && !hoverCheckbox) return;

  if (clickCheckbox) clickCheckbox.checked = !!prefs.resolveShortenersOnClick;
  if (hoverCheckbox) hoverCheckbox.checked = !!prefs.resolveShortenersOnHover;

  const anyEnabled = () => !!(clickCheckbox?.checked || hoverCheckbox?.checked);
  await updateShortenerRegrantNotice(anyEnabled());

  /**
   * Wires a single toggle's change handler: request permission on enable,
   * persist the given pref key, then refresh the shared regrant notice.
   */
  function wireToggle(checkbox, prefKey) {
    if (!checkbox) return;
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        // CRITICAL: chrome.permissions.request MUST be the FIRST await in
        // the enable branch (Firefox MV2 gesture-frame requirement).
        const granted = await requestShortenerPermissions();
        if (!granted) {
          checkbox.checked = false;
          showToast(t("shortener_regrant_denied", _currentLang));
          return;
        }
        try { await setPrefs({ [prefKey]: true }); }
        catch (err) { console.error(`[MUGA] save ${prefKey}:`, err); }
      } else {
        try { await setPrefs({ [prefKey]: false }); }
        catch (err) { console.error(`[MUGA] save ${prefKey}:`, err); }
      }
      await updateShortenerRegrantNotice(anyEnabled());
    });
  }

  wireToggle(clickCheckbox, "resolveShortenersOnClick");
  wireToggle(hoverCheckbox, "resolveShortenersOnHover");

  const regrantBtn = document.getElementById("shortener-regrant-btn");
  if (regrantBtn) {
    regrantBtn.addEventListener("click", async () => {
      // CRITICAL: chrome.permissions.request MUST be the FIRST await in this
      // handler (Firefox MV2 gesture-frame requirement) — same rule as each
      // toggle's enable branch above.
      const granted = await requestShortenerPermissions();
      if (granted) {
        await updateShortenerRegrantNotice(true);
      } else {
        showToast(t("shortener_regrant_denied", _currentLang));
      }
    });
  }
}

/**
 * Reads the optionsAnchor key from chrome.storage.session on boot and scrolls
 * the matching element into view. Single-shot: clears the key after reading
 * so a page refresh does not re-jump.
 */
async function readOptionsAnchor() {
  if (typeof chrome.storage?.session === "undefined") return; // MV2 fallback: no-op
  try {
    const data = await chrome.storage.session.get({ optionsAnchor: null });
    if (data.optionsAnchor) {
      // Defer scroll until after DOM is ready and i18n has populated text
      // (so target element exists at full rendered height).
      window.requestAnimationFrame(() => {
        const target = document.getElementById(data.optionsAnchor);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      // Single-shot — clear so refresh does not re-jump.
      void chrome.storage.session.remove("optionsAnchor");
    }
  } catch {
    // best-effort; session storage unavailability is non-fatal
  }
}

document.addEventListener("DOMContentLoaded", init);
