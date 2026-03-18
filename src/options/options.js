/**
 * MUGA — Options page script
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
    container.innerHTML = `<p class="empty">Sin entradas todavía.</p>`;
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
