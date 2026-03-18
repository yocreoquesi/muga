/**
 * MUGA — Options page
 */

const DEFAULTS = {
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  allowReplaceAffiliate: false,
  blacklist: [],
  whitelist: [],
};

async function init() {
  const prefs = await chrome.storage.sync.get(DEFAULTS);

  bindToggle("inject", "injectOwnAffiliate", prefs);
  bindToggle("notify", "notifyForeignAffiliate", prefs);
  bindToggle("replace", "allowReplaceAffiliate", prefs);

  renderList("blacklist-items", prefs.blacklist, "blacklist");
  renderList("whitelist-items", prefs.whitelist, "whitelist");
  renderStores();
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
    container.innerHTML = `<p class="empty">No entries yet.</p>`;
    return;
  }
  items.forEach((entry, i) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span>${entry}</span>
      <button class="del-btn" onclick="removeEntry('${listKey}', ${i})">×</button>
    `;
    container.appendChild(div);
  });
}

function renderStores() {
  // AFFILIATE_PATTERNS is embedded inline to avoid an ES module import in a non-module context.
  // Keep in sync with src/lib/affiliates.js.
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

window.addEntry = async function (listKey, inputId, containerId) {
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
};

window.removeEntry = async function (listKey, index) {
  const containerId = listKey === "blacklist" ? "blacklist-items" : "whitelist-items";
  const prefs = await chrome.storage.sync.get({ [listKey]: [] });
  const list = prefs[listKey];
  list.splice(index, 1);
  await chrome.storage.sync.set({ [listKey]: list });
  renderList(containerId, list, listKey);
};

document.addEventListener("DOMContentLoaded", init);
