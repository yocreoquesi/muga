/**
 * MUGA — Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS } from "../lib/i18n.js";
import { getSupportedStores, TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { PREF_DEFAULTS } from "../lib/storage.js";

let currentLang = "en";

async function init() {
  currentLang = await getStoredLang();
  applyTranslations(currentLang);

  const prefs = await chrome.storage.sync.get(PREF_DEFAULTS);

  bindToggle("inject", "injectOwnAffiliate", prefs);
  bindToggle("notify", "notifyForeignAffiliate", prefs);
  bindToggle("replace", "allowReplaceAffiliate", prefs);
  bindToggle("strip-affiliates", "stripAllAffiliates", prefs);

  // replace requires inject — dim the row when inject is off (#237)
  syncReplaceState();
  document.getElementById("inject").addEventListener("change", syncReplaceState);

  bindToggle("dnr-enabled", "dnrEnabled", prefs);
  bindToggle("context-menu-toggle", "contextMenuEnabled", prefs);
  bindToggle("block-pings", "blockPings", prefs);
  bindToggle("amp-redirect", "ampRedirect", prefs);
  bindToggle("unwrap-redirects", "unwrapRedirects", prefs);

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

// "Replace with ours" only makes sense when affiliate injection is on (#237)
function syncReplaceState() {
  const injectOn = document.getElementById("inject").checked;
  const replaceRow = document.getElementById("replace").closest(".row");
  replaceRow.style.opacity = injectOn ? "" : "0.4";
  replaceRow.style.pointerEvents = injectOn ? "" : "none";
}

function renderList(containerId, items, listKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<p class="empty">${t("empty_list", currentLang)}</p>`;
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
    if (!confirm(t("stats_reset_confirm", currentLang))) return;
    await chrome.storage.local.set({
      stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
      firstUsed: null,
      nudgeDismissed: false,
    });
    alert(t("stats_reset_done", currentLang));
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
      allowReplaceAffiliate: prefs.allowReplaceAffiliate,
      stripAllAffiliates: prefs.stripAllAffiliates,
      dnrEnabled: prefs.dnrEnabled,
      blockPings: prefs.blockPings,
      ampRedirect: prefs.ampRedirect,
      unwrapRedirects: prefs.unwrapRedirects,
      blacklist: prefs.blacklist,
      whitelist: prefs.whitelist,
      customParams: prefs.customParams,
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
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.muga || !Array.isArray(data.blacklist) || !Array.isArray(data.whitelist) || !Array.isArray(data.customParams)) {
        throw new Error("invalid");
      }
      const isValidEntry = e => typeof e === "string" && e.length > 0 && e.length < 500;
      if (data.blacklist.length > 500 || data.whitelist.length > 500 || data.customParams.length > 200) {
        throw new Error("invalid");
      }
      if (!data.blacklist.every(isValidEntry) || !data.whitelist.every(isValidEntry) || !data.customParams.every(isValidEntry)) {
        throw new Error("invalid");
      }
      const BOOL_KEYS = ["enabled", "injectOwnAffiliate", "notifyForeignAffiliate", "allowReplaceAffiliate", "stripAllAffiliates", "dnrEnabled", "blockPings", "ampRedirect", "unwrapRedirects"];
      const toSave = { blacklist: data.blacklist, whitelist: data.whitelist, customParams: data.customParams };
      for (const key of BOOL_KEYS) {
        if (typeof data[key] === "boolean") toSave[key] = data[key];
      }
      await chrome.storage.sync.set(toSave);
      renderList("blacklist-items", data.blacklist, "blacklist");
      renderList("whitelist-items", data.whitelist, "whitelist");
      renderList("custom-params-items", data.customParams, "customParams");
      alert(t("import_success", currentLang));
    } catch {
      alert(t("import_error", currentLang));
    }
    fileInput.value = "";
  });
}

function syncDevTools() {
  const on = document.getElementById("dev-mode").checked;
  document.getElementById("dev-tools-card").style.display = on ? "" : "none";
}

function initDevTools() {
  // Preview notification
  document.getElementById("dev-preview-notify-btn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { type: "PREVIEW_TOAST" });
    });
  });

  // Show onboarding
  document.getElementById("dev-show-onboarding-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  });

  // Export debug log
  document.getElementById("dev-export-log-btn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_DEBUG_LOG" });
    const log = response?.log ?? [];
    const manifest = chrome.runtime.getManifest();
    const payload = { muga_version: manifest.version, exported_at: new Date().toISOString(), log };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
    const domainRules = await import("../rules/domain-rules.json", { with: { type: "json" } });
    const result = processUrl(input, { ...prefs, notifyForeignAffiliate: false }, domainRules.default);
    cleanEl.textContent = result.cleanUrl;
    if (result.removedTracking?.length > 0) {
      removedEl.textContent = `Removed: ${result.removedTracking.join(", ")}`;
    } else if (result.cleanUrl === input) {
      removedEl.textContent = "No tracking params found — URL is already clean.";
    } else {
      removedEl.textContent = `Action: ${result.action}`;
    }
    resultDiv.style.display = "";
  } catch (e) {
    cleanEl.textContent = "Error: " + e.message;
    removedEl.textContent = "";
    resultDiv.style.display = "";
  }
}

document.addEventListener("DOMContentLoaded", init);
