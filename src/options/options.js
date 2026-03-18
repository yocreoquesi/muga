/**
 * MUGA — Options page
 */

import { applyTranslations, getStoredLang, t, SUPPORTED_LANGS } from "../lib/i18n.js";

const DEFAULTS = {
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
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

  renderList("blacklist-items", prefs.blacklist, "blacklist");
  renderList("whitelist-items", prefs.whitelist, "whitelist");
  renderStores();
  initLanguageSelect();
  bindListButtons();
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
  const STORES = [
    { name: "Amazon ES", param: "tag", ourTag: "" },
    { name: "Amazon DE", param: "tag", ourTag: "" },
    { name: "Amazon FR", param: "tag", ourTag: "" },
    { name: "Amazon IT", param: "tag", ourTag: "" },
    { name: "Amazon UK", param: "tag", ourTag: "" },
    { name: "Amazon US", param: "tag", ourTag: "" },
    { name: "Booking.com", param: "aid", ourTag: "" },
    { name: "AliExpress", param: "aff_fcid", ourTag: "" },
    { name: "PcComponentes", param: "ref", ourTag: "" },
    { name: "El Corte Inglés", param: "affiliateId", ourTag: "" },
    { name: "eBay", param: "campid", ourTag: "" },
  ];

  const grid = document.getElementById("stores-grid");
  grid.innerHTML = STORES.map(s => `
    <div class="store-chip">
      <div class="store-dot ${s.ourTag ? "active" : ""}"></div>
      <div>
        <div class="store-name">${s.name}</div>
        <div class="store-param">${s.param}=</div>
      </div>
    </div>
  `).join("");
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

document.addEventListener("DOMContentLoaded", init);
