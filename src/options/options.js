/**
 * MUGA: Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS } from "../lib/i18n.js";
import { getSupportedStores, TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { PREF_DEFAULTS, getPrefs, setPrefs, getDevMode, setDevMode, getShortenerStats } from "../lib/storage.js";
import { getConsent } from "../lib/consent-storage.js";
import { isFirefox as detectFirefox } from "../lib/browser-detect.js";
import { isValidListEntry, isValidCustomParam, capImportedLists, IMPORT_LIST_CAPS } from "../lib/validation.js";
import { REMOTE_RULES_URL } from "../lib/remote-rules.js";
import {
  addEntry as addCreatorAllowlistEntry,
  removeEntry as removeCreatorAllowlistEntry,
} from "../lib/creator-allowlist.js";
import { GENERIC_SHORTENERS } from "../lib/native-shortener-resolver.js";
import { createMutex, withSyncMutation } from "./sync-mutation.js";

let _currentLang = "en";

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

/** Initializes the options page: loads prefs, binds controls, renders lists. */
async function init() {
  _currentLang = await getStoredLang();
  applyTranslations(_currentLang);

  // Initial toggle state MUST come from the canonical merged prefs (sync +
  // consent + per-device overrides), NOT a raw sync read. A raw sync read
  // ignores per-device overrides (per-device-prefs), so a toggle like
  // injectOwnAffiliate or remoteRulesEnabled could DISPLAY a value that
  // disagrees with the effective value getPrefs() gives the rest of the
  // extension (#888 follow-up).
  let prefs;
  try { prefs = await getPrefs(); } catch (err) { console.error("[MUGA] load prefs:", err); prefs = { ...PREF_DEFAULTS }; }

  // --- Consent gate: redirect to onboarding if user hasn't accepted ToS ---
  // Consent fields moved out of chrome.storage.sync into chrome.storage.local
  // in #355 (ADR-0001). Reading onboardingDone from sync silently returns
  // the PREF_DEFAULTS false and bounced everyone back to onboarding even
  // after a successful acceptance. Use the dedicated consent-storage read
  // so the gate matches the popup + service-worker source of truth.
  const consent = await getConsent();
  if (!consent.onboardingDone) {
    window.location.href = chrome.runtime.getURL("onboarding/onboarding.html");
    return;
  }

  bindToggle("inject", "injectOwnAffiliate", prefs);
  bindToggle("notify", "notifyForeignAffiliate", prefs);
  bindToggle("strip-affiliates", "stripAllAffiliates", prefs);

  bindToggle("dnr-enabled", "dnrEnabled", prefs);
  bindToggle("context-menu-toggle", "contextMenuEnabled", prefs);
  bindToggle("block-pings", "blockPings", prefs);
  bindToggle("amp-redirect", "ampRedirect", prefs);
  bindToggle("unwrap-redirects", "unwrapRedirects", prefs);
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
  durationSelect.value = String(prefs.toastDuration || 15);
  durationSelect.addEventListener("change", () => {
    const val = Math.max(5, Math.min(60, parseInt(durationSelect.value, 10) || 15));
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
  renderStores();
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
    try { setPrefs({ [key]: el.checked }); } catch (err) { console.error("[MUGA] save toggle:", err); }
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

/** Renders the supported affiliate stores grid. */
function renderStores() {
  // #523 phase 3: each program has a `{ host -> tag }` map for ourTag.
  // Active = at least one host has a non-empty tag. We expand each
  // program into per-marketplace "store" rows so the UI looks the same
  // post-consolidation as it did when the legacy AFFILIATE_PATTERNS
  // array carried one entry per marketplace.
  const allPrograms = getSupportedStores();
  const activePrograms = allPrograms.filter(
    (p) => Object.values(p.ourTag).some((tag) => tag && tag.trim() !== ""),
  );

  const grid = document.getElementById("stores-grid");
  const hintEl = document.getElementById("stores-hint");
  grid.replaceChildren();

  if (activePrograms.length === 0) {
    grid.hidden = true;
    if (hintEl) hintEl.hidden = true;
    const placeholder = document.createElement("p");
    placeholder.className = "empty stores-empty";
    placeholder.textContent = t("no_active_stores", _currentLang);
    grid.parentNode.insertBefore(placeholder, grid);
    const countEl = document.getElementById("stores-count");
    if (countEl) countEl.textContent = "";
    return;
  }

  grid.hidden = false;
  if (hintEl) hintEl.hidden = false;

  // Group programs by display brand. Today caps-spec programs have a
  // 1:1 relationship with display groups, but we keep the grouping so
  // a future caps-spec change (e.g. Amazon Vendor Central as a separate
  // entry sharing the "Amazon" brand) reuses the same UI shape.
  const groups = new Map();
  for (const p of activePrograms) {
    const key = p.group || p.name;
    if (!groups.has(key)) groups.set(key, []);
    // Expand each program into one row per (host, tag) pair so the
    // marketplace-level detail surfaces in the UI.
    for (const [host, tag] of Object.entries(p.ourTag)) {
      if (!tag || tag.trim() === "") continue;
      groups.get(key).push({ name: host, param: p.param, ourTag: tag });
    }
  }

  for (const [groupName, stores] of groups) {
    const isSingle = stores.length === 1;

    const chip = document.createElement("div");
    chip.className = "store-chip" + (isSingle ? "" : " store-group");

    const dot = document.createElement("div");
    dot.className = "store-dot active";

    const info = document.createElement("div");
    info.className = "store-info";

    const header = document.createElement("div");
    header.className = "store-header";

    const nameEl = document.createElement("span");
    nameEl.className = "store-name";
    nameEl.textContent = groupName;
    header.appendChild(nameEl);

    if (!isSingle) {
      const countBadge = document.createElement("span");
      countBadge.className = "store-count";
      countBadge.textContent = `(${stores.length})`;
      header.appendChild(countBadge);

      const arrow = document.createElement("span");
      arrow.className = "store-arrow";
      arrow.textContent = "›";
      header.appendChild(arrow);
    }

    info.appendChild(header);

    if (isSingle) {
      const paramEl = document.createElement("div");
      paramEl.className = "store-param";
      paramEl.textContent = `${stores[0].param}=${stores[0].ourTag}`;
      info.appendChild(paramEl);
    } else {
      const detail = document.createElement("div");
      detail.className = "store-detail";
      detail.hidden = true;

      for (const s of stores) {
        const row = document.createElement("div");
        row.className = "store-detail-row";

        const rowDot = document.createElement("div");
        rowDot.className = "store-dot active";

        const rowInfo = document.createElement("div");

        const rowName = document.createElement("div");
        rowName.className = "store-name";
        rowName.textContent = s.name;

        const rowParam = document.createElement("div");
        rowParam.className = "store-param";
        rowParam.textContent = `${s.param}=${s.ourTag}`;

        rowInfo.appendChild(rowName);
        rowInfo.appendChild(rowParam);
        row.appendChild(rowDot);
        row.appendChild(rowInfo);
        detail.appendChild(row);
      }

      info.appendChild(detail);

      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-label", t("store_group_toggle", _currentLang).replace("{name}", groupName));
      chip.setAttribute("aria-expanded", "false");
      chip.addEventListener("click", () => {
        const wasOpen = !detail.hidden;
        detail.hidden = wasOpen;
        chip.setAttribute("aria-expanded", String(!wasOpen));
        chip.classList.toggle("open", !wasOpen);
      });
      chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chip.click(); } });
    }

    chip.appendChild(dot);
    chip.appendChild(info);
    grid.appendChild(chip);
  }

  const countEl = document.getElementById("stores-count");
  if (countEl) {
    const brandCount = groups.size;
    countEl.textContent = `(${brandCount})`;
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
    if (!/^[a-zA-Z0-9_.\-]+$/.test(value)) {
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
    const payload = {
      muga: true,
      version: chrome.runtime.getManifest().version,
      enabled: prefs.enabled,
      injectOwnAffiliate: prefs.injectOwnAffiliate,
      notifyForeignAffiliate: prefs.notifyForeignAffiliate,
      stripAllAffiliates: prefs.stripAllAffiliates,
      dnrEnabled: prefs.dnrEnabled,
      blockPings: prefs.blockPings,
      ampRedirect: prefs.ampRedirect,
      unwrapRedirects: prefs.unwrapRedirects,
      blacklist: prefs.blacklist,
      whitelist: prefs.whitelist,
      customParams: prefs.customParams,
      contextMenuEnabled: prefs.contextMenuEnabled,
      disabledCategories: prefs.disabledCategories,
      toastDuration: prefs.toastDuration,
      language: prefs.language,
      devMode: devModeLocal,
      paramBreakdown: prefs.paramBreakdown,
      showReportButton: prefs.showReportButton,
      domainStats: prefs.domainStats,
      showBadge: prefs.showBadge,
      followShortenersEnabled: prefs.followShortenersEnabled,
      // #925: privacy booleans are now user-controllable, so round-trip them.
      canonicalExtractorEnabled: prefs.canonicalExtractorEnabled,
      crossSiteFrequencyEnabled: prefs.crossSiteFrequencyEnabled,
      attributionLedgerEnabled: prefs.attributionLedgerEnabled,
      // #925: the popup-populated custom strip rules, handled like the other sync arrays.
      userCustomRules: prefs.userCustomRules,
    };
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
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.muga || !Array.isArray(data.blacklist) || !Array.isArray(data.whitelist) || !Array.isArray(data.customParams)) {
        throw new Error("invalid");
      }
      // Structural integrity only: a malformed blacklist/whitelist ENTRY signals a
      // corrupt or foreign file, so abort. Exceeding a size cap does NOT — a valid
      // MUGA export can legitimately be larger than fits in chrome.storage.sync.
      if (!data.blacklist.every(isValidListEntry) || !data.whitelist.every(isValidListEntry)) {
        throw new Error("invalid");
      }
      // Filter (#818) + cap (#911) the three lists via the canonical helper.
      // Oversized lists are TRUNCATED rather than rejected wholesale, and the
      // user is told how many entries were dropped — silently discarding data,
      // or failing a valid-but-large file with a misleading "not a MUGA file"
      // error, is not acceptable.
      const { blacklist, whitelist, customParams, droppedBlacklist, droppedWhitelist, skippedParams } = capImportedLists(data);
      const skipped = skippedParams + droppedBlacklist + droppedWhitelist;
      // devMode is device-local — exclude from sync BOOL_KEYS and handle separately
      const BOOL_KEYS = ["enabled", "injectOwnAffiliate", "notifyForeignAffiliate", "stripAllAffiliates", "dnrEnabled", "blockPings", "ampRedirect", "unwrapRedirects", "contextMenuEnabled", "paramBreakdown", "showReportButton", "domainStats", "showBadge", "followShortenersEnabled", "canonicalExtractorEnabled", "crossSiteFrequencyEnabled", "attributionLedgerEnabled"];
      const toSave = { blacklist, whitelist, customParams };
      for (const key of BOOL_KEYS) {
        if (typeof data[key] === "boolean") toSave[key] = data[key];
      }
      // devMode from imported file → local storage
      if (typeof data.devMode === "boolean") {
        await setDevMode(data.devMode);
      }
      // Handle disabledCategories (validated against known category keys)
      const VALID_CATEGORIES = new Set(["utm", "ads", "email", "social", "platform_noise", "generic"]);
      if (Array.isArray(data.disabledCategories) && data.disabledCategories.every(e => VALID_CATEGORIES.has(e))) {
        toSave.disabledCategories = data.disabledCategories;
      }
      // Handle toastDuration (number 5-60)
      if (typeof data.toastDuration === "number") {
        toSave.toastDuration = Math.max(5, Math.min(60, data.toastDuration));
      }
      // #925: userCustomRules — validate each entry as a bare param name and
      // cap at the customParams ceiling (same shape/limit the popup enforces).
      if (Array.isArray(data.userCustomRules)) {
        toSave.userCustomRules = data.userCustomRules
          .filter(isValidCustomParam)
          .slice(0, IMPORT_LIST_CAPS.customParams);
      }
      // Handle language (any supported locale) — validate against SUPPORTED_LANGS
      // so codes added after the legacy en/es/pt/de set (fr/it/ja, #707) survive
      // an export→import round-trip instead of being silently dropped.
      if (SUPPORTED_LANGS.some(l => l.code === data.language)) {
        toSave.language = data.language;
      }
      await setPrefs(toSave);

      // Re-read prefs and update all UI toggles and lists
      const newPrefs = await chrome.storage.sync.get(PREF_DEFAULTS);
      document.getElementById("inject").checked = newPrefs.injectOwnAffiliate;
      document.getElementById("notify").checked = newPrefs.notifyForeignAffiliate;
      document.getElementById("strip-affiliates").checked = newPrefs.stripAllAffiliates;
      document.getElementById("dnr-enabled").checked = newPrefs.dnrEnabled;
      document.getElementById("context-menu-toggle").checked = newPrefs.contextMenuEnabled;
      document.getElementById("block-pings").checked = newPrefs.blockPings;
      document.getElementById("amp-redirect").checked = newPrefs.ampRedirect;
      document.getElementById("unwrap-redirects").checked = newPrefs.unwrapRedirects;
      // #925: refresh the newly-surfaced privacy + display toggles after import
      document.getElementById("canonical-extractor").checked = newPrefs.canonicalExtractorEnabled;
      document.getElementById("cross-site-frequency").checked = newPrefs.crossSiteFrequencyEnabled;
      document.getElementById("attribution-ledger").checked = newPrefs.attributionLedgerEnabled;
      document.getElementById("param-breakdown").checked = newPrefs.paramBreakdown;
      document.getElementById("show-report-button").checked = newPrefs.showReportButton;
      document.getElementById("domain-stats").checked = newPrefs.domainStats;
      document.getElementById("show-badge").checked = newPrefs.showBadge;
      // devMode is device-local — re-read from local storage after import
      document.getElementById("dev-mode").checked = await getDevMode();
      document.getElementById("toast-duration-select").value = String(newPrefs.toastDuration || 15);
      syncDevTools();
      if (toSave.language) {
        _currentLang = toSave.language;
        document.getElementById("lang-select").value = _currentLang;
        applyTranslations(_currentLang);
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
    const confirmed = window.confirm(
      "This log includes your browser version and extension settings.\n\n" +
      "Do NOT share it publicly (e.g. in a GitHub issue) without reviewing it first.\n\n" +
      "Proceed with export?"
    );
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

  // Per-shortener pass/fail counters (ADR-0004 phase 4, #700)
  initShortenerStats();
}

/**
 * MUGA: Renders per-shortener pass/fail counters in the dev-tools card.
 * (ADR-0004 phase 4, #700)
 *
 * Builds a table of pass/fail counts for the GENERIC_SHORTENERS allowlist,
 * reading from chrome.storage.local ("shortenerStats"). DOM is built with
 * createElement + textContent only — no innerHTML for dynamic data.
 */
async function initShortenerStats() {
  const tableEl = document.getElementById("shortener-stats-table");
  const resetBtn = document.getElementById("shortener-stats-reset-btn");
  if (!tableEl) return;

  async function renderStats() {
    const stats = await getShortenerStats();
    tableEl.replaceChildren(); // clear without innerHTML

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";

    // Header row
    const thead = document.createElement("thead");
    const hrow = document.createElement("tr");
    for (const label of ["Host", t("shortener_stats_pass", _currentLang), t("shortener_stats_fail", _currentLang)]) {
      const th = document.createElement("th");
      th.style.cssText = "text-align:left;padding:2px 8px 2px 0;color:#888;font-weight:500;";
      th.textContent = label;
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement("tbody");
    for (const host of GENERIC_SHORTENERS) {
      const entry = stats[host] || { pass: 0, fail: 0 };
      const tr = document.createElement("tr");

      const tdHost = document.createElement("td");
      tdHost.style.cssText = "padding:2px 8px 2px 0;font-family:monospace;";
      tdHost.textContent = host;

      const tdPass = document.createElement("td");
      tdPass.style.cssText = "padding:2px 8px 2px 0;color:#22c55e;text-align:right;";
      tdPass.textContent = String(entry.pass);

      const tdFail = document.createElement("td");
      tdFail.style.cssText = "padding:2px 8px 2px 0;color:#ef4444;text-align:right;";
      tdFail.textContent = String(entry.fail);

      tr.appendChild(tdHost);
      tr.appendChild(tdPass);
      tr.appendChild(tdFail);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableEl.appendChild(table);
  }

  await renderStats();

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      await new Promise((resolve) => {
        chrome.storage.local.set({ shortenerStats: {} }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
      await renderStats();
      showToast(t("shortener_stats_reset", _currentLang));
    });
  }
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
      newBtn.addEventListener("click", () => {
        try {
          const hostname = new URL(input).hostname;
          const version = chrome.runtime.getManifest().version;
          const removed = result.removedTracking?.join(", ") || "none";
          const action = result.action || "none";
          const title = encodeURIComponent(`[URL Report] ${hostname}`);
          const body = encodeURIComponent(
            `## URL Report\n\n` +
            `**Domain:** ${hostname}\n` +
            `**MUGA version:** ${version}\n` +
            `**Browser:** ${navigator.userAgent}\n` +
            `**Action taken:** ${action}\n` +
            `**Params removed:** ${removed}\n\n` +
            `## Problem\n\n` +
            `<!-- Describe what went wrong: params that should have been removed but weren't, or params that were removed but shouldn't have been -->\n\n` +
            `## Expected behavior\n\n` +
            `<!-- What should MUGA do with this URL? -->\n`
          );
          window.open(`https://github.com/yocreoquesi/muga/issues/new?title=${title}&body=${body}`, "_blank", "noopener,noreferrer");
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
 * Initialises the "Follow shortener redirects" toggle (ADR-0004 phase 2, #699).
 * The permission request is the first await in the enable path (Firefox MV2
 * gesture-frame requirement). The pref persists to chrome.storage.sync, and a
 * denial reverts the checkbox.
 *
 * @param {object} prefs - Merged preferences object (PREF_DEFAULTS shape)
 */
async function initFollowShorteners(prefs) {
  const checkbox = document.getElementById("followShortenersEnabled");
  if (!checkbox) return;
  checkbox.checked = !!prefs.followShortenersEnabled;

  checkbox.addEventListener("change", async () => {
    if (checkbox.checked) {
      // CRITICAL: chrome.permissions.request MUST be the FIRST await in the
      // enable branch (Firefox MV2 gesture-frame requirement).
      const granted = await requestShortenerPermissions();
      if (!granted) {
        checkbox.checked = false;
        showToast(t("optionsRemoteRulesPermDenied", _currentLang));
        return;
      }
      try { await setPrefs({ followShortenersEnabled: true }); }
      catch (err) { console.error("[MUGA] save followShortenersEnabled:", err); }
    } else {
      try { await setPrefs({ followShortenersEnabled: false }); }
      catch (err) { console.error("[MUGA] save followShortenersEnabled:", err); }
    }
  });
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
