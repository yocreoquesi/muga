/**
 * MUGA — Options page
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { getSupportedStores, TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { PREF_DEFAULTS } from "../lib/storage.js";

let currentLang = "en";

// --- Toast & confirm helpers (replace native alert/confirm) ---

let _toastEl = null;
let _toastTimer = null;

function showToast(msg) {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    _toastEl.className = "toast";
    _toastEl.setAttribute("role", "status");
    _toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.classList.add("visible");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove("visible"), 2500);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    const box = document.createElement("div");
    box.className = "confirm-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const p = document.createElement("p");
    p.id = "confirm-msg";
    p.textContent = msg;

    box.setAttribute("aria-labelledby", "confirm-msg");

    const btns = document.createElement("div");
    btns.className = "confirm-btns";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "confirm-cancel";
    cancelBtn.textContent = "Cancel";

    const okBtn = document.createElement("button");
    okBtn.className = "confirm-ok";
    okBtn.textContent = "OK";

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
    const close = (val) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(val); };
    document.addEventListener("keydown", onKey);
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

async function init() {
  currentLang = await getStoredLang();
  applyTranslations(currentLang);

  const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);

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
    chrome.storage.sync.set({ toastDuration: val });
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
}

function bindToggle(id, key, prefs) {
  const el = document.getElementById(id);
  el.checked = prefs[key];
  el.addEventListener("change", () => chrome.storage.sync.set({ [key]: el.checked }));
}

function renderList(containerId, items, listKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("empty_list", currentLang);
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

function bindListButtons() {
  document.getElementById("cp-add-btn").addEventListener("click", () =>
    addEntry("customParams", "cp-input", "custom-params-items"));
  document.getElementById("bl-add-btn").addEventListener("click", () =>
    addEntry("blacklist", "bl-input", "blacklist-items"));
  document.getElementById("wl-add-btn").addEventListener("click", () =>
    addEntry("whitelist", "wl-input", "whitelist-items"));
}

function renderCategories(disabledCategories) {
  const card = document.getElementById("categories-card");
  card.innerHTML = "";
  const disabled = new Set(disabledCategories);

  for (const [key, cat] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
    const isEs = currentLang === "es";
    const label = isEs ? cat.labelEs : cat.label;
    const desc = isEs ? cat.descriptionEs : cat.description;

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
      const prefs = await chrome.storage.sync.get({ disabledCategories: [] });
      const set = new Set(prefs.disabledCategories);
      if (input.checked) {
        set.delete(key);
      } else {
        set.add(key);
      }
      await chrome.storage.sync.set({ disabledCategories: [...set] });
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

function renderStores() {
  const allStores = getSupportedStores();
  // Only show stores where an affiliate tag has been configured.
  const activeStores = allStores.filter(s => s.ourTag && s.ourTag.trim() !== "");

  const grid = document.getElementById("stores-grid");
  const hintEl = document.getElementById("stores-hint");
  grid.innerHTML = "";

  if (activeStores.length === 0) {
    // Hide the stores grid and hint; show a placeholder message instead.
    grid.hidden = true;
    if (hintEl) hintEl.hidden = true;
    const placeholder = document.createElement("p");
    placeholder.className = "empty";
    placeholder.style.cssText = "padding:8px 16px 12px";
    placeholder.textContent = t("no_active_stores", currentLang);
    grid.parentNode.insertBefore(placeholder, grid);
    const countEl = document.getElementById("stores-count");
    if (countEl) countEl.textContent = "";
    return;
  }

  grid.hidden = false;
  if (hintEl) hintEl.hidden = false;

  activeStores.forEach(s => {
    const chip = document.createElement("div");
    chip.className = "store-chip";

    const dot = document.createElement("div");
    dot.className = "store-dot active";

    const info = document.createElement("div");

    const nameEl = document.createElement("div");
    nameEl.className = "store-name";
    nameEl.textContent = s.name;

    const paramEl = document.createElement("div");
    paramEl.className = "store-param";
    paramEl.textContent = s.param + "=";

    info.appendChild(nameEl);
    info.appendChild(paramEl);
    chip.appendChild(dot);
    chip.appendChild(info);
    grid.appendChild(chip);
  });

  const countEl = document.getElementById("stores-count");
  if (countEl) countEl.textContent = `(${activeStores.length})`;
}

function initLanguageSelect() {
  const select = document.getElementById("lang-select");
  select.value = currentLang;
  select.addEventListener("change", async () => {
    currentLang = select.value;
    await chrome.storage.sync.set({ language: currentLang });
    applyTranslations(currentLang);
    // Re-render dynamic lists with new language
    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
    renderList("custom-params-items", prefs.customParams || [], "customParams");
    renderList("blacklist-items", prefs.blacklist, "blacklist");
    renderList("whitelist-items", prefs.whitelist, "whitelist");
  });
}

async function addEntry(listKey, inputId, containerId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  const prefs = await chrome.storage.sync.get({ [listKey]: [] });
  const list = prefs[listKey];
  if (!list.includes(value)) {
    list.push(value);
    await chrome.storage.sync.set({ [listKey]: list });
    renderList(containerId, list, listKey);
  }
  input.value = "";
}

async function removeEntry(listKey, index) {
  const containerMap = { blacklist: "blacklist-items", whitelist: "whitelist-items", customParams: "custom-params-items" };
  const containerId = containerMap[listKey] ?? `${listKey}-items`;
  const prefs = await chrome.storage.sync.get({ [listKey]: [] });
  const list = prefs[listKey];
  list.splice(index, 1);
  await chrome.storage.sync.set({ [listKey]: list });
  renderList(containerId, list, listKey);
}

function initStatsSection() {
  const versionEl = document.getElementById("version-number");
  if (versionEl) {
    versionEl.textContent = chrome.runtime.getManifest().version;
  }

  document.getElementById("reset-stats-btn").addEventListener("click", async () => {
    const ok = await showConfirm(t("stats_reset_confirm", currentLang));
    if (!ok) return;
    await chrome.storage.local.set({
      stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
      firstUsed: null,
      nudgeDismissed: false,
    });
    showToast(t("stats_reset_done", currentLang));
  });
}

function initExportImport() {
  document.getElementById("export-btn").addEventListener("click", async () => {
    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
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
      language: prefs.language,
      devMode: prefs.devMode,
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
      showToast(t("import_error", currentLang));
      fileInput.value = "";
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.muga || !Array.isArray(data.blacklist) || !Array.isArray(data.whitelist) || !Array.isArray(data.customParams)) {
        throw new Error("invalid");
      }
      const isValidEntry = e => typeof e === "string" && e.length > 0 && e.length < 500 && /^[\x20-\x7E]+$/.test(e);
      if (data.blacklist.length > 500 || data.whitelist.length > 500 || data.customParams.length > 200) {
        throw new Error("invalid");
      }
      if (!data.blacklist.every(isValidEntry) || !data.whitelist.every(isValidEntry) || !data.customParams.every(isValidEntry)) {
        throw new Error("invalid");
      }
      const BOOL_KEYS = ["enabled", "injectOwnAffiliate", "notifyForeignAffiliate", "stripAllAffiliates", "dnrEnabled", "blockPings", "ampRedirect", "unwrapRedirects", "contextMenuEnabled", "devMode"];
      const toSave = { blacklist: data.blacklist, whitelist: data.whitelist, customParams: data.customParams };
      for (const key of BOOL_KEYS) {
        if (typeof data[key] === "boolean") toSave[key] = data[key];
      }
      // Handle disabledCategories (array of strings)
      if (Array.isArray(data.disabledCategories) && data.disabledCategories.every(e => typeof e === "string")) {
        toSave.disabledCategories = data.disabledCategories;
      }
      // Handle toastDuration (number 5-60)
      if (typeof data.toastDuration === "number") {
        toSave.toastDuration = Math.max(5, Math.min(60, data.toastDuration));
      }
      // Handle language (string "en"|"es")
      if (data.language === "en" || data.language === "es") {
        toSave.language = data.language;
      }
      await chrome.storage.sync.set(toSave);

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
        currentLang = toSave.language;
        document.getElementById("lang-select").value = currentLang;
        applyTranslations(currentLang);
      }
      renderList("blacklist-items", newPrefs.blacklist, "blacklist");
      renderList("whitelist-items", newPrefs.whitelist, "whitelist");
      renderList("custom-params-items", newPrefs.customParams, "customParams");
      renderCategories(newPrefs.disabledCategories || []);
      showToast(t("import_success", currentLang));
    } catch {
      showToast(t("import_error", currentLang));
    }
    fileInput.value = "";
  });
}

function syncDevTools() {
  const devModeEl = document.getElementById("dev-mode");
  const devToolsCard = document.getElementById("dev-tools-card");
  if (!devModeEl || !devToolsCard) return;
  devToolsCard.style.display = devModeEl.checked ? "" : "none";
}

function initDevTools() {
  // Preview notification — replicas the real affiliate toast from content/cleaner.js
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
    titleDiv.textContent = t("toast_title", currentLang);

    const msgDiv = document.createElement("div");
    msgDiv.style.cssText = "margin-bottom:10px;font-size:12px;color:#ddd";
    msgDiv.appendChild(document.createTextNode("amazon.es " + t("toast_tag_msg", currentLang) + " "));
    const codeEl = document.createElement("code");
    codeEl.style.cssText = "background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px";
    codeEl.textContent = "tag=competitor-21";
    msgDiv.appendChild(codeEl);

    const btnDiv = document.createElement("div");
    btnDiv.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";

    const keepBtn = document.createElement("button");
    keepBtn.style.cssText = btnStyle;
    keepBtn.textContent = t("toast_allow", currentLang);
    btnDiv.appendChild(keepBtn);

    const removeBtn = document.createElement("button");
    removeBtn.style.cssText = btnStyle;
    removeBtn.textContent = t("toast_block", currentLang);
    btnDiv.appendChild(removeBtn);

    const dismissBtn = document.createElement("button");
    dismissBtn.style.cssText = "margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer;background:none;border:none;display:block;width:100%";
    dismissBtn.textContent = t("toast_dismiss", currentLang);

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
    // Enforce 2MB limit — trim oldest log entries if needed
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

async function testUrl() {
  const input = document.getElementById("dev-url-input").value.trim();
  const resultDiv = document.getElementById("dev-url-result");
  const cleanEl = document.getElementById("dev-url-clean");
  const removedEl = document.getElementById("dev-url-removed");
  if (!input) return;
  try {
    const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);
    const { processUrl } = await import("../lib/cleaner.js");
    const resp = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    const domainRules = await resp.json();
    const result = processUrl(input, { ...prefs, notifyForeignAffiliate: false }, domainRules);
    cleanEl.textContent = result.cleanUrl;
    if (result.removedTracking?.length > 0) {
      removedEl.textContent = t("dev_url_removed", currentLang).replace("%s", result.removedTracking.join(", "));
    } else if (result.cleanUrl === input) {
      removedEl.textContent = t("dev_url_clean", currentLang);
    } else {
      removedEl.textContent = t("dev_url_action", currentLang).replace("%s", result.action);
    }
    resultDiv.style.display = "";
  } catch (e) {
    cleanEl.textContent = "Error: " + e.message;
    removedEl.textContent = "";
    resultDiv.style.display = "";
  }
}

document.addEventListener("DOMContentLoaded", init);
