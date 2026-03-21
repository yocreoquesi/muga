/**
 * MUGA — Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS } from "../lib/i18n.js";
import { getSupportedStores } from "../lib/affiliates.js";
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

  renderList("custom-params-items", prefs.customParams, "customParams");
  renderList("blacklist-items", prefs.blacklist, "blacklist");
  renderList("whitelist-items", prefs.whitelist, "whitelist");
  renderStores();
  initLanguageSelect();
  bindListButtons();
  initStatsSection();
  initExportImport();
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

function renderStores() {
  const stores = getSupportedStores();

  const grid = document.getElementById("stores-grid");
  grid.innerHTML = "";

  stores.forEach(s => {
    const chip = document.createElement("div");
    chip.className = "store-chip";

    const dot = document.createElement("div");
    dot.className = "store-dot" + (s.ourTag ? " active" : "");

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
  if (countEl) countEl.textContent = `(${stores.length})`;
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
      if (!data.blacklist.every(isValidEntry) || !data.whitelist.every(isValidEntry) || !data.customParams.every(isValidEntry)) {
        throw new Error("invalid");
      }
      await chrome.storage.sync.set({ blacklist: data.blacklist, whitelist: data.whitelist, customParams: data.customParams });
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

document.addEventListener("DOMContentLoaded", init);
