/**
 * MUGA — Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS } from "../lib/i18n.js";
import { getSupportedStores } from "../lib/affiliates.js";

const DEFAULTS = {
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

let currentLang = "en";

async function init() {
  currentLang = await getStoredLang();
  applyTranslations(currentLang);

  const prefs = await chrome.storage.sync.get(DEFAULTS);

  bindToggle("inject", "injectOwnAffiliate", prefs);
  bindToggle("notify", "notifyForeignAffiliate", prefs);
  bindToggle("replace", "allowReplaceAffiliate", prefs);
  bindToggle("strip-affiliates", "stripAllAffiliates", prefs);

  renderList("blacklist-items", prefs.blacklist, "blacklist");
  renderList("whitelist-items", prefs.whitelist, "whitelist");
  renderStores();
  initLanguageSelect();
  bindListButtons();
  initStatsSection();
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
    div.innerHTML = `
      <span>${entry}</span>
      <button class="del-btn" data-list="${listKey}" data-index="${i}">×</button>
    `;
    container.appendChild(div);
  });

  // Wire up delete buttons without inline onclick (CSP-safe)
  container.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () =>
      removeEntry(btn.dataset.list, parseInt(btn.dataset.index, 10)));
  });
}

function bindListButtons() {
  document.getElementById("bl-add-btn").addEventListener("click", () =>
    addEntry("blacklist", "bl-input", "blacklist-items"));
  document.getElementById("wl-add-btn").addEventListener("click", () =>
    addEntry("whitelist", "wl-input", "whitelist-items"));
}

function renderStores() {
  const stores = getSupportedStores();

  const grid = document.getElementById("stores-grid");
  grid.innerHTML = stores.map(s => `
    <div class="store-chip">
      <div class="store-dot ${s.ourTag ? "active" : ""}"></div>
      <div>
        <div class="store-name">${s.name}</div>
        <div class="store-param">${s.param}=</div>
      </div>
    </div>
  `).join("");

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
    const prefs = await chrome.storage.sync.get(DEFAULTS);
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
  const containerId = listKey === "blacklist" ? "blacklist-items" : "whitelist-items";
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

document.addEventListener("DOMContentLoaded", init);
