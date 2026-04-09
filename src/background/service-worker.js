/**
 * MUGA: Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, parseListEntry } from "../lib/cleaner.js";
import { getAffiliateDomains } from "../lib/affiliates.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, sessionStorage, incrementDomainStat } from "../lib/storage.js";

self.addEventListener("unhandledrejection", (e) => {
  console.warn("[MUGA] unhandled rejection:", e.reason);
});

// Pre-compute affiliate domains once at startup for getPrefs responses
const _affiliateDomains = getAffiliateDomains();

let _firstUsedSet = false;

// B4: fetch domain-rules dynamically (import assertions incompatible with Firefox;
//       top-level await disallowed in Chrome MV3 service workers)
let domainRules = [];
let _domainRulesReady = fetch(chrome.runtime.getURL("rules/domain-rules.json"))
  .then(r => r.json())
  .then(data => { domainRules = data; })
  .catch(err => console.warn("[MUGA] domain-rules.json fetch failed:", err));

// B3: chrome.action (MV3) does not exist in Firefox MV2; fall back to browserAction
const actionApi = globalThis.chrome?.action || globalThis.chrome?.browserAction || {};

// Run migration once on startup (no-op if already done)
migrateStatsToLocal();

// --- Session log (actions + errors, exported via debug log) ---
const SESSION_LOG_MAX = 2000;
const MAX_URL_LENGTH = 8192;

function appendSessionLog(level, args) {
  const entry = { ts: Date.now(), level, msg: args.map(a => {
    try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch { return "[unserializable]"; }
  }).join(" ") };
  sessionStorage.get({ debugLog: [] }).then(data => {
    const log = [entry, ...data.debugLog].slice(0, SESSION_LOG_MAX);
    sessionStorage.set({ debugLog: log }).catch(() => {});
  }).catch(() => {});
}

/** Log a MUGA action as a structured object for rich debug output. */
function logAction(action, detail) {
  if (typeof detail === "object") {
    appendSessionLog("action", [`[${action}]`, JSON.stringify(detail)]);
  } else {
    appendSessionLog("action", [`[${action}]`, detail]);
  }
}

const _origError = console.error.bind(console);
console.error = (...args) => { _origError(...args); appendSessionLog("error", args); };
const _origWarn = console.warn.bind(console);
console.warn = (...args) => { _origWarn(...args); appendSessionLog("warn", args); };

// --- Prefs cache ---

let cachedPrefs = null;
let prefsFetchPromise = null;

// Serialize list mutations (whitelist/blacklist) to prevent race conditions
// where two rapid messages read the same cached list and the second overwrites the first.
let _listMutationQueue = Promise.resolve();

function getPrefsWithCache() {
  if (cachedPrefs) return Promise.resolve(cachedPrefs);
  if (!prefsFetchPromise) {
    prefsFetchPromise = getPrefs().then(prefs => {
      // Pre-parse blacklist/whitelist once so processUrl doesn't re-parse on every call
      prefs._parsedBlacklist = (prefs.blacklist || []).map(parseListEntry);
      prefs._parsedWhitelist = (prefs.whitelist || []).map(parseListEntry);
      cachedPrefs = prefs;
      prefsFetchPromise = null;
      return prefs;
    });
  }
  return prefsFetchPromise;
}

// --- Input validation helpers ---

/** Validates a blacklist/whitelist entry: domain, domain::disabled, or domain::param::value */
function isValidListEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) return false;
  const parts = entry.split("::");
  if (parts.length > 3) return false;
  if (!parts[0] || !/^[a-zA-Z0-9.-]+$/.test(parts[0])) return false;
  if (parts.length === 2 && parts[1] !== "disabled") return false;
  if (parts.length === 3 && (!parts[1] || !parts[2])) return false;
  return true;
}

// --- DNR sync helpers ---
// Firefox MV2 does not support declarativeNetRequest; guard all DNR calls.
const hasDNR = typeof chrome.declarativeNetRequest !== "undefined";

const DYNAMIC_RULE_ID = 1000;

async function syncCustomParamsDNR(customParams) {
  if (!hasDNR) return;
  try {
    if (!customParams || customParams.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DYNAMIC_RULE_ID],
        addRules: [],
      });
      return;
    }
    const normalized = customParams
      .filter(p => /^[a-zA-Z0-9_.-]+$/.test(p.trim()))
      .map(p => p.trim().toLowerCase());
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DYNAMIC_RULE_ID],
      addRules: [{
        id: DYNAMIC_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { transform: { queryTransform: { removeParams: normalized } } },
        },
        condition: { urlFilter: "*", resourceTypes: ["main_frame"] },
      }],
    });
  } catch (err) {
    console.error("[MUGA] syncCustomParamsDNR failed:", err);
  }
}

async function applyDnrState(prefs) {
  if (!hasDNR) return;
  if (prefs.enabled && prefs.dnrEnabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["tracking_params"],
    }).catch(() => {}); // no-op if already enabled
    await syncCustomParamsDNR(prefs.customParams);
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["tracking_params"],
    }).catch(() => {});
    await syncCustomParamsDNR([]);
  }
}

// Matches http/https URLs in arbitrary text. Used by the "selection" context menu handler.
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

// --- Context menu helpers ---
// Firefox Android does not support chrome.contextMenus; guard all calls.
const hasContextMenus = typeof chrome.contextMenus !== "undefined";

async function syncContextMenus(enabled) {
  if (!hasContextMenus) return;
  await chrome.contextMenus.removeAll();
  if (!enabled) return;
  const prefs = await getPrefsWithCache();
  if (!prefs.enabled) return;
  const lang = prefs.language || "en";
  const titles = {
    copy: lang === "es" ? "Copiar enlace limpio" : "Copy clean link",
    selection: lang === "es" ? "Copiar enlaces limpios de la selección" : "Copy clean links in selection",
  };
  chrome.contextMenus.create({
    id: "muga-copy-clean",
    title: titles.copy,
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "muga-copy-clean-selection",
    title: titles.selection,
    contexts: ["selection"],
  });
}

// Set badge appearance once on startup
actionApi.setBadgeBackgroundColor?.({ color: "#2563eb" });

// --- Badge helpers ---

async function updateTabBadge(tabId, junkRemoved) {
  if (!tabId || junkRemoved <= 0) return;
  const key = `tab_${tabId}`;
  const data = await sessionStorage.get({ [key]: 0 });
  const newCount = data[key] + junkRemoved;
  await sessionStorage.set({ [key]: newCount });
  actionApi.setBadgeText?.({ text: String(newCount), tabId });
}

// Clear badge when a tab starts navigating to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    sessionStorage.remove(`tab_${tabId}`);
    actionApi.setBadgeText?.({ text: "", tabId });
  }
});

// Clean up session data when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStorage.remove(`tab_${tabId}`);
});

// --- Session history helpers ---

const HISTORY_MAX = 10;

async function appendHistory(original, clean, removedTracking = []) {
  if (original === clean) return;
  const data = await sessionStorage.get({ history: [] });
  const entry = { original, clean, ts: Date.now(), removedTracking };
  const history = [entry, ...data.history].slice(0, HISTORY_MAX);
  await sessionStorage.set({ history });
}

// --- Storage change listener: invalidate cache and re-apply DNR state ---
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  // Any sync storage change (including disabledCategories, contextMenuEnabled, etc.)
  // must invalidate the prefs cache so the next getPrefsWithCache() reads fresh data.
  cachedPrefs = null;
  prefsFetchPromise = null;
  if (changes.customParams || changes.dnrEnabled || changes.enabled) {
    const prefs = await getPrefsWithCache();
    await applyDnrState(prefs);
  }
  if (changes.contextMenuEnabled || changes.language || changes.enabled) {
    const enabled = changes.contextMenuEnabled
      ? changes.contextMenuEnabled.newValue !== false
      : (await getPrefsWithCache()).contextMenuEnabled !== false;
    await syncContextMenus(enabled);
  }
});

// --- Main message listener from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate that messages come from our own extension
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === "getPrefs") {
    getPrefsWithCache()
      .then(prefs => sendResponse({ ...prefs, _affiliateDomains }))
      .catch(() => { try { sendResponse(null); } catch { /* channel closed */ } });
    return true;
  }

  if (message.type === "PROCESS_URL") {
    if (typeof message.url !== "string" || message.url.length > MAX_URL_LENGTH) {
      try { sendResponse({ cleanUrl: null, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null }); } catch { /* channel closed */ }
      return true;
    }
    const tabId = sender.tab?.id;
    handleProcessUrl(message.url, { skipNotify: message.skipNotify, source: message.skipNotify ? "copy_selection" : "navigation", skipStats: !!message.skipStats })
      .then(result => {
        updateTabBadge(tabId, result.junkRemoved ?? 0);
        sendResponse(result);
      })
      .catch(err => {
        console.error("[MUGA] PROCESS_URL handler failed:", err);
        try { sendResponse({ cleanUrl: message.url, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null }); } catch { /* channel closed */ }
      });
    return true; // keep the channel open for the async response
  }

  if (message.type === "ADD_TO_WHITELIST") {
    const entry = message.tag;
    if (!isValidListEntry(entry)) {
      sendResponse({ ok: false });
      return true;
    }
    _listMutationQueue = _listMutationQueue.then(async () => {
      const fresh = await getPrefs();
      if (!fresh.whitelist.includes(entry)) {
        await setPrefs({ whitelist: [...fresh.whitelist, entry] });
        logAction("whitelist_add", { entry });
      }
      cachedPrefs = null;
      prefsFetchPromise = null;
      sendResponse({ ok: true });
    }).catch(err => {
      console.error("[MUGA] ADD_TO_WHITELIST handler failed:", err);
      try { sendResponse({ ok: false }); } catch { /* channel closed */ }
    });
    return true;
  }

  if (message.type === "ADD_TO_BLACKLIST") {
    const entry = message.tag;
    if (!isValidListEntry(entry)) {
      sendResponse({ ok: false });
      return true;
    }
    _listMutationQueue = _listMutationQueue.then(async () => {
      const fresh = await getPrefs();
      if (!fresh.blacklist.includes(entry)) {
        await setPrefs({ blacklist: [...fresh.blacklist, entry] });
        logAction("blacklist_add", { entry });
      }
      cachedPrefs = null;
      prefsFetchPromise = null;
      sendResponse({ ok: true });
    }).catch(err => {
      console.error("[MUGA] ADD_TO_BLACKLIST handler failed:", err);
      try { sendResponse({ ok: false }); } catch { /* channel closed */ }
    });
    return true;
  }

  if (message.type === "GET_DEBUG_LOG") {
    sessionStorage.get({ debugLog: [] }).then(data => {
      sendResponse({ log: data.debugLog || [] });
    }).catch(() => {
      sendResponse({ log: [] });
    });
    return true;
  }

  if (message.type === "INCREMENT_STAT") {
    const ALLOWED_STAT_KEYS = ["urlsCleaned", "junkRemoved", "referralsSpotted"];
    if (ALLOWED_STAT_KEYS.includes(message.key)) incrementStat(message.key);
    sendResponse({ ok: true });
    return false;
  }

  // exposed for future dev-tools use
  if (message.type === "CLEAR_DEBUG_LOG") {
    sessionStorage.set({ debugLog: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

});

async function handleProcessUrl(rawUrl, { skipNotify = false, source = "navigation", skipStats = false } = {}) {
  if (!rawUrl?.startsWith("http")) return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  await _domainRulesReady;
  const prefs = await getPrefsWithCache();

  if (!prefs.enabled || !prefs.onboardingDone) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  // On copy: suppress the toast and affiliate injection. User didn't navigate,
  // they just copied a link, so we should not inject our tag either.
  const effectivePrefs = skipNotify
    ? { ...prefs, notifyForeignAffiliate: false, injectOwnAffiliate: false }
    : prefs;

  let result;
  try {
    result = processUrl(rawUrl, effectivePrefs, domainRules);
  } catch (err) {
    console.error("[MUGA] processUrl failed:", err, rawUrl);
    return { cleanUrl: rawUrl, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  // Record first use timestamp for nudge threshold (stored locally)
  if (!_firstUsedSet) {
    const localStats = await getStats();
    if (localStats.firstUsed) {
      _firstUsedSet = true;
    } else {
      await setStats({ firstUsed: Date.now() });
      _firstUsedSet = true;
    }
  }

  // Update stats and session history. Only count if the URL actually changed (S13).
  const urlChanged = result.cleanUrl !== rawUrl;
  let parsedRaw;
  try { parsedRaw = new URL(rawUrl); } catch { /* ignore */ }
  if (result.action === "untouched" || (!urlChanged && result.junkRemoved === 0)) {
    if (parsedRaw?.search) logAction("passthrough", { domain: parsedRaw.hostname.replace(/^www\./, ""), path: parsedRaw.pathname, params: [...parsedRaw.searchParams.keys()] });
  }
  if (result.action !== "untouched" && (urlChanged || result.junkRemoved > 0)) {
    if (!skipStats) {
      incrementStat("urlsCleaned");
      if (result.junkRemoved > 0) incrementStat("junkRemoved", result.junkRemoved);
      if (prefs.domainStats && result.junkRemoved > 0) {
        try {
          const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
          incrementDomainStat(hostname, result.junkRemoved);
        } catch { /* invalid URL, skip domain stat */ }
      }
    }
    await appendHistory(rawUrl, result.cleanUrl, result.removedTracking ?? []);
    if (parsedRaw) {
      const domain = parsedRaw.hostname.replace(/^www\./, "");
      const parsedClean = new URL(result.cleanUrl);
      logAction("cleaned", {
        source,
        domain,
        path: parsedRaw.pathname,
        action: result.action,
        removed: result.removedTracking,
        junkRemoved: result.junkRemoved,
        originalParams: [...parsedRaw.searchParams.keys()],
        cleanParams: [...parsedClean.searchParams.keys()],
        cleanUrl: result.cleanUrl,
      });
    }
  }
  if (result.action === "detected_foreign") {
    incrementStat("referralsSpotted");
    const d = result.detectedAffiliate;
    logAction("affiliate_detected", {
      domain: parsedRaw?.hostname.replace(/^www\./, "") ?? "",
      param: d?.param,
      value: d?.value,
      store: d?.pattern?.name ?? null,
      action: result.action,
    });
    // If injection is enabled, build the URL with our tag so "Remove it" can use it
    if (prefs.injectOwnAffiliate && result.detectedAffiliate?.pattern?.ourTag) {
      const url = new URL(result.cleanUrl);
      const p = result.detectedAffiliate.pattern;
      url.searchParams.set(p.param, p.ourTag);
      result.withOurAffiliate = url.toString();
    }
  }

  return result;
}

// --- On startup: apply DNR state ---
chrome.runtime.onStartup.addListener(async () => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
});

// --- Dedup flag: prevent opening onboarding twice in the same background lifetime ---
let _onboardingTabOpened = false;
function openOnboardingOnce() {
  if (_onboardingTabOpened) return;
  _onboardingTabOpened = true;
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
}

// --- On install: open onboarding on first run, register context menu ---
chrome.runtime.onInstalled.addListener(async (details) => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);

  if (prefs.contextMenuEnabled !== false) {
    await syncContextMenus(true);
  }

  if (details.reason === "install") {
    const installPrefs = await getPrefs();
    if (!installPrefs.onboardingDone) {
      openOnboardingOnce();
    }
  }
});

// --- Fallback: onInstalled is unreliable in Firefox MV2 temporary add-ons ---
// If onboarding was never completed, open it on background load. This also
// covers edge cases where onInstalled fires before the module registers its
// listener. The dedup flag ensures only one tab opens even if both paths fire.
(async () => {
  try {
    const prefs = await getPrefs();
    if (!prefs.onboardingDone) {
      openOnboardingOnce();
    }
    // Also ensure context menus are registered on first load
    if (prefs.contextMenuEnabled !== false) {
      await syncContextMenus(true);
    }
  } catch (e) {
    console.error("[MUGA] fallback onboarding check failed:", e);
  }
})();

// --- Keyboard shortcut: copy clean URL of current tab ---
// Firefox Android does not support chrome.commands
if (chrome.commands) chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-clean-url") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab?.id) return;

  const result = await handleProcessUrl(tab.url, { skipNotify: true, source: "shortcut" });
  chrome.tabs.sendMessage(tab.id, {
    type: "COPY_TO_CLIPBOARD",
    text: result.cleanUrl,
  }, () => void chrome.runtime.lastError);
});

if (hasContextMenus) chrome.contextMenus.onClicked.addListener(async (info) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (info.menuItemId === "muga-copy-clean") {
    const result = await handleProcessUrl(info.linkUrl, { skipNotify: true, source: "copy_link" });

    // Copy to clipboard via content script (service worker has no direct clipboard access)
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "COPY_TO_CLIPBOARD",
        text: result.cleanUrl,
      }, () => void chrome.runtime.lastError);
    }
    return;
  }

  if (info.menuItemId === "muga-copy-clean-selection") {
    if (!tab?.id) return;
    // Ask the content script to handle it: it can access the actual DOM selection including hrefs
    chrome.tabs.sendMessage(tab.id, { type: "GET_AND_COPY_CLEAN_SELECTION" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        // Fallback: plain-text approach (original behavior)
        const text = info.selectionText;
        if (!text) return;
        let result = text;
        (async () => {
          const matches = [...text.matchAll(URL_RE)];
          let anyChanged = false;
          for (const match of matches) {
            const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
            const cleaned = await handleProcessUrl(candidate, { skipNotify: true, source: "copy_selection", skipStats: true });
            if (cleaned.cleanUrl !== candidate) { result = result.replaceAll(candidate, cleaned.cleanUrl); anyChanged = true; }
          }
          if (anyChanged) incrementStat("urlsCleaned");
          chrome.tabs.sendMessage(tab.id, { type: "COPY_TO_CLIPBOARD", text: result }, () => void chrome.runtime.lastError);
        })();
      }
    });
    return;
  }
});
