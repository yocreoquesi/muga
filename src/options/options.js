/**
 * MUGA: Options page
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { getSupportedStores, TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { PREF_DEFAULTS, setPrefs } from "../lib/storage.js";
import { isValidListEntry } from "../lib/validation.js";

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

  let prefs;
  try { prefs = await chrome.storage.sync.get(PREF_DEFAULTS); } catch (err) { console.error("[MUGA] load prefs:", err); prefs = { ...PREF_DEFAULTS }; }

  // --- Consent gate: redirect to onboarding if user hasn't accepted ToS ---
  if (!prefs.onboardingDone) {
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
  renderCategories(prefs.disabledCategories || []);
  renderStores();
  initLanguageSelect();
  bindListButtons();
  initStatsSection();
  initExportImport();

  bindToggle("dev-mode", "devMode", prefs);
  syncDevTools();
  document.getElementById("dev-mode").addEventListener("change", syncDevTools);
  initDevTools();

  // Rate link: point to the correct store
  const rateLink = document.getElementById("rate-store-link");
  if (rateLink) {
    const isFirefox = navigator.userAgent.includes("Firefox");
    rateLink.href = isFirefox
      ? "https://addons.mozilla.org/firefox/addon/muga/"
      : "https://chromewebstore.google.com/detail/muga/";
  }
}

/** Binds a checkbox to a sync storage preference key. */
function bindToggle(id, key, prefs) {
  const el = document.getElementById(id);
  el.checked = prefs[key];
  el.addEventListener("change", () => {
    try { setPrefs({ [key]: el.checked }); } catch (err) { console.error("[MUGA] save toggle:", err); }
  });
}

/** Renders a blacklist/whitelist/customParams list into its container. */
function renderList(containerId, items, listKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("empty_list", _currentLang);
    container.appendChild(p);
    return;
  }
  items.forEach((entry, i) => {
    const div = document.createElement("div");
    div.className = "list-item";
    const span = document.createElement("span");
    span.textContent = entry;

    const btn = document.createElement("button");
    btn.className = "del-btn";
    btn.dataset.list = listKey;
    btn.dataset.index = i;
    btn.textContent = "×";
    btn.setAttribute("aria-label", `Remove ${entry}`);

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

/** Renders tracking category toggle cards. */
function renderCategories(disabledCategories) {
  const card = document.getElementById("categories-card");
  card.innerHTML = "";
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
    input.addEventListener("change", async () => {
      let prefs;
      try { prefs = await chrome.storage.sync.get({ disabledCategories: [] }); } catch (err) { console.error("[MUGA] load categories:", err); return; }
      const set = new Set(prefs.disabledCategories);
      if (input.checked) {
        set.delete(key);
      } else {
        set.add(key);
      }
      try { await setPrefs({ disabledCategories: [...set] }); } catch (err) { console.error("[MUGA] save category:", err); }
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
  const allStores = getSupportedStores();
  const activeStores = allStores.filter(s => s.ourTag && s.ourTag.trim() !== "");

  const grid = document.getElementById("stores-grid");
  const hintEl = document.getElementById("stores-hint");
  grid.innerHTML = "";

  if (activeStores.length === 0) {
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

  // Group stores by brand
  const groups = new Map();
  for (const s of activeStores) {
    const key = s.group || s.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
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
      chip.setAttribute("aria-label", `Toggle ${groupName} stores`);
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
  select.value = _currentLang;
  select.addEventListener("change", async () => {
    _currentLang = select.value;
    try { await setPrefs({ language: _currentLang }); } catch (err) { console.error("[MUGA] save language:", err); }
    applyTranslations(_currentLang);
    // Re-render dynamic lists with new language
    let prefs;
    try { prefs = await chrome.storage.sync.get(PREF_DEFAULTS); } catch (err) { console.error("[MUGA] reload prefs:", err); prefs = { ...PREF_DEFAULTS }; }
    renderList("custom-params-items", prefs.customParams || [], "customParams");
    renderList("blacklist-items", prefs.blacklist, "blacklist");
    renderList("whitelist-items", prefs.whitelist, "whitelist");
  });
}

/** Serializes list mutations to prevent read-modify-write races. */
let _listMutex = Promise.resolve();
function withListLock(fn) {
  _listMutex = _listMutex.then(fn, fn);
  return _listMutex;
}

/** Adds a new entry to a list (blacklist/whitelist/customParams). */
function addEntry(listKey, inputId, containerId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  if (listKey === "customParams") {
    if (!/^[a-zA-Z0-9_.\-]+$/.test(value)) {
      showToast(t("import_error", _currentLang));
      return;
    }
  } else if (!isValidListEntry(value)) {
    showToast(t("import_error", _currentLang));
    return;
  }
  return withListLock(async () => {
    let prefs;
    try { prefs = await chrome.storage.sync.get({ [listKey]: [] }); } catch (err) { console.error("[MUGA] load list:", err); return; }
    const list = prefs[listKey];
    if (!list.includes(value)) {
      list.push(value);
      try { await setPrefs({ [listKey]: list }); } catch (err) { console.error("[MUGA] save entry:", err); }
      renderList(containerId, list, listKey);
    }
    input.value = "";
  });
}

/** Removes an entry from a list by index. */
function removeEntry(listKey, index) {
  return withListLock(async () => {
    const containerMap = { blacklist: "blacklist-items", whitelist: "whitelist-items", customParams: "custom-params-items" };
    const containerId = containerMap[listKey] ?? `${listKey}-items`;
    let prefs;
    try { prefs = await chrome.storage.sync.get({ [listKey]: [] }); } catch (err) { console.error("[MUGA] load list:", err); return; }
    const list = prefs[listKey];
    list.splice(index, 1);
    try { await setPrefs({ [listKey]: list }); } catch (err) { console.error("[MUGA] save entry:", err); }
    renderList(containerId, list, listKey);
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
}

/** Initializes export/import settings functionality. */
function initExportImport() {
  document.getElementById("export-btn").addEventListener("click", async () => {
    let prefs;
    try { prefs = await chrome.storage.sync.get(PREF_DEFAULTS); } catch (err) { console.error("[MUGA] export prefs:", err); return; }
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
      devMode: prefs.devMode,
      paramBreakdown: prefs.paramBreakdown,
      showReportButton: prefs.showReportButton,
      domainStats: prefs.domainStats,
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
      if (data.blacklist.length > 500 || data.whitelist.length > 500 || data.customParams.length > 200) {
        throw new Error("invalid");
      }
      const isValidParam = e => typeof e === "string" && e.length > 0 && e.length < 500 && /^[a-zA-Z0-9_.\-]+$/.test(e);
      if (!data.blacklist.every(isValidListEntry) || !data.whitelist.every(isValidListEntry) || !data.customParams.every(isValidParam)) {
        throw new Error("invalid");
      }
      const BOOL_KEYS = ["enabled", "injectOwnAffiliate", "notifyForeignAffiliate", "stripAllAffiliates", "dnrEnabled", "blockPings", "ampRedirect", "unwrapRedirects", "contextMenuEnabled", "devMode", "paramBreakdown", "showReportButton", "domainStats"];
      const toSave = { blacklist: data.blacklist, whitelist: data.whitelist, customParams: data.customParams };
      for (const key of BOOL_KEYS) {
        if (typeof data[key] === "boolean") toSave[key] = data[key];
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
      // Handle language (any supported locale)
      if (["en", "es", "pt", "de"].includes(data.language)) {
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
      document.getElementById("dev-mode").checked = newPrefs.devMode;
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
      renderCategories(newPrefs.disabledCategories || []);
      showToast(t("import_success", _currentLang));
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
  devToolsCard.style.display = devModeEl.checked ? "" : "none";
}

/** Initializes dev tools: URL tester and preview features. */
function initDevTools() {
  // Report broken site: opens a pre-filled GitHub issue
  const reportBrokenBtn = document.getElementById("dev-report-broken-btn");
  if (reportBrokenBtn) {
    reportBrokenBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let hostname = "unknown";
      try { if (tab?.url) hostname = new URL(tab.url).hostname; } catch { /* non-http tab */ }
      const version = chrome.runtime.getManifest().version;
      const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
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
        `**Features active:** ${features}\n\n` +
        `## What broke?\n\n` +
        `<!-- Describe what stopped working after MUGA cleaned the URL -->\n`
      );
      window.open(`https://github.com/yocreoquesi/muga/issues/new?title=${title}&body=${body}&labels=broken-site`, "_blank", "noopener,noreferrer");
    });
  }

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
      info.textContent = `Status: dismissed=${localData.nudgeDismissed}, shown=${localData.nudgeShownCount}/3, lastShown=${localData.nudgeLastShown ? new Date(localData.nudgeLastShown).toLocaleDateString() : "never"}`;

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:6px";
      const btnStyle = "flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer";

      const rateBtn = document.createElement("button");
      rateBtn.style.cssText = btnStyle;
      rateBtn.textContent = t("rate_nudge_btn_short", _currentLang);

      const dismissBtn = document.createElement("button");
      dismissBtn.style.cssText = btnStyle + ";color:#666";
      dismissBtn.textContent = `Dismiss (${localData.nudgeShownCount}/3)`;

      const resetBtn = document.createElement("button");
      resetBtn.style.cssText = btnStyle + ";color:#f59e0b;font-size:10px";
      resetBtn.textContent = "Reset counters";

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
        const isFirefox = navigator.userAgent.includes("Firefox");
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
          info.textContent = "Counters reset to 0. Ready for fresh testing.";
        } else {
          await chrome.storage.local.set({ nudgeShownCount: newCount, nudgeLastShown: Date.now() });
          info.textContent = `Status: dismissed=false, shown=${newCount}/3, lastShown=now`;
        }
        dismissBtn.textContent = `Dismiss (${newCount > 3 ? 0 : newCount}/3)`;
      });

      resetBtn.addEventListener("click", async () => {
        await chrome.storage.local.set({ nudgeShownCount: 0, nudgeDismissed: false, nudgeLastShown: 0 });
        info.textContent = "All nudge counters reset. Ready for testing.";
        dismissBtn.textContent = "Dismiss (0/3)";
      });
    });
  }

  // Show onboarding
  document.getElementById("dev-show-onboarding-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  });

  // Export debug log
  document.getElementById("dev-export-log-btn").addEventListener("click", async () => {
    const [response, prefs, localData] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_DEBUG_LOG" }),
      chrome.storage.sync.get(PREF_DEFAULTS),
      chrome.storage.local.get({ stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 } }),
    ]);
    const log = response?.log ?? [];
    const manifest = chrome.runtime.getManifest();

    // Redact sensitive-ish fields but include config for debugging
    const safePrefs = { ...prefs };
    delete safePrefs._parsedBlacklist;
    delete safePrefs._parsedWhitelist;

    const payload = {
      muga_version: manifest.version,
      browser: navigator.userAgent,
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
  if (reportBtn) reportBtn.style.display = "none";
  if (!input) return;
  try {
    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
    const { processUrl } = await import("../lib/cleaner.js");
    const resp = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    const domainRules = await resp.json();
    const result = processUrl(input, { ...prefs, notifyForeignAffiliate: false }, domainRules);
    cleanEl.textContent = result.cleanUrl;
    if (result.removedTracking?.length > 0) {
      removedEl.textContent = t("dev_url_removed", _currentLang).replace("%s", result.removedTracking.join(", "));
    } else if (result.cleanUrl === input) {
      removedEl.textContent = t("dev_url_clean", _currentLang);
    } else {
      removedEl.textContent = t("dev_url_action", _currentLang).replace("%s", result.action);
    }
    resultDiv.style.display = "";

    // Show report button after results (clone to avoid listener accumulation)
    if (reportBtn) {
      const newBtn = reportBtn.cloneNode(true);
      reportBtn.parentNode.replaceChild(newBtn, reportBtn);
      newBtn.style.display = "";
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
    cleanEl.textContent = "Error: " + e.message;
    removedEl.textContent = "";
    resultDiv.style.display = "";
  }
}

document.addEventListener("DOMContentLoaded", init);
