/**
 * MUGA — Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, parseListEntry } from "../lib/cleaner.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, sessionStorage } from "../lib/storage.js";

// B4 — fetch domain-rules dynamically (import assertions incompatible with Firefox;
//       top-level await disallowed in Chrome MV3 service workers)
let domainRules = [];
let _domainRulesReady = fetch(chrome.runtime.getURL("rules/domain-rules.json"))
  .then(r => r.json())
  .then(data => { domainRules = data; })
  .catch(() => { /* domain-rules unavailable — continue without */ });

// B3 — chrome.action (MV3) does not exist in Firefox MV2; fall back to browserAction
const actionApi = globalThis.chrome?.action || globalThis.chrome?.browserAction || {};

// Run migration once on startup (no-op if already done)
migrateStatsToLocal();

// --- Debug log (dev mode only) ---
const DEBUG_LOG_MAX = 200;

function appendDebugLog(level, args) {
  const entry = { ts: Date.now(), level, msg: args.map(a => {
    try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch { return "[unserializable]"; }
  }).join(" ") };
  sessionStorage.get({ debugLog: [] }).then(data => {
    const log = [entry, ...data.debugLog].slice(0, DEBUG_LOG_MAX);
    sessionStorage.set({ debugLog: log });
  });
}

const _origError = console.error.bind(console);
console.error = (...args) => { _origError(...args); appendDebugLog("error", args); };
const _origWarn = console.warn.bind(console);
console.warn = (...args) => { _origWarn(...args); appendDebugLog("warn", args); };

// --- Prefs cache ---

let cachedPrefs = null;
let prefsFetchPromise = null;

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

// --- DNR sync helpers ---

const DYNAMIC_RULE_ID = 1000;

async function syncCustomParamsDNR(customParams) {
  try {
    if (!customParams || customParams.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DYNAMIC_RULE_ID],
        addRules: [],
      });
      return;
    }
    const normalized = customParams.map(p => p.trim().toLowerCase());
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
  if (prefs.dnrEnabled) {
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

// Matches http/https URLs in arbitrary text — used by the "selection" context menu handler
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/g;

// --- Context menu helpers ---

async function syncContextMenus(enabled) {
  await chrome.contextMenus.removeAll();
  if (!enabled) return;
  const prefs = await getPrefsWithCache();
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

async function appendHistory(original, clean) {
  if (original === clean) return;
  const data = await sessionStorage.get({ history: [] });
  const entry = { original, clean, ts: Date.now() };
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
  if (changes.customParams || changes.dnrEnabled) {
    const prefs = await getPrefsWithCache();
    await applyDnrState(prefs);
  }
  if (changes.contextMenuEnabled || changes.language) {
    const enabled = changes.contextMenuEnabled
      ? changes.contextMenuEnabled.newValue !== false
      : (await getPrefsWithCache()).contextMenuEnabled !== false;
    await syncContextMenus(enabled);
  }
});

// --- Main message listener from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getPrefs") {
    getPrefsWithCache().then(sendResponse);
    return true;
  }

  if (message.type === "PROCESS_URL") {
    const tabId = sender.tab?.id;
    handleProcessUrl(message.url, { skipNotify: message.skipNotify })
      .then(result => {
        updateTabBadge(tabId, result.junkRemoved ?? 0);
        sendResponse(result);
      });
    return true; // keep the channel open for the async response
  }

  if (message.type === "ADD_TO_WHITELIST") {
    const entry = message.tag;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) {
      sendResponse({ ok: false });
      return true;
    }
    getPrefsWithCache().then(async prefs => {
      if (!prefs.whitelist.includes(entry)) {
        await setPrefs({ whitelist: [...prefs.whitelist, entry] });
        cachedPrefs = null;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "ADD_TO_BLACKLIST") {
    const entry = message.tag;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) {
      sendResponse({ ok: false });
      return true;
    }
    getPrefsWithCache().then(async prefs => {
      if (!prefs.blacklist.includes(entry)) {
        await setPrefs({ blacklist: [...prefs.blacklist, entry] });
        cachedPrefs = null;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "GET_DEBUG_LOG") {
    sessionStorage.get({ debugLog: [] }).then(data => sendResponse({ log: data.debugLog }));
    return true;
  }

  // exposed for future dev-tools use
  if (message.type === "CLEAR_DEBUG_LOG") {
    sessionStorage.set({ debugLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }

});

async function handleProcessUrl(rawUrl, { skipNotify = false } = {}) {
  await _domainRulesReady;
  const prefs = await getPrefsWithCache();

  if (!prefs.enabled) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  // On copy: suppress the toast and affiliate injection — user didn't navigate,
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
  const localStats = await getStats();
  if (!localStats.firstUsed) {
    await setStats({ firstUsed: Date.now() });
  }

  // Update stats and session history — only count if the URL actually changed (S13)
  const urlChanged = result.cleanUrl !== rawUrl;
  if (result.action !== "untouched" && (urlChanged || result.junkRemoved > 0)) {
    incrementStat("urlsCleaned");
    await appendHistory(rawUrl, result.cleanUrl);
  }
  if (result.junkRemoved > 0) {
    incrementStat("junkRemoved", result.junkRemoved);
  }
  if (result.action === "detected_foreign") {
    incrementStat("referralsSpotted");
    // If the user has "replace foreign affiliate" enabled, build the URL with our tag
    if (prefs.allowReplaceAffiliate && result.detectedAffiliate?.pattern?.ourTag) {
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

// --- On install: open onboarding on first run, register context menu ---
chrome.runtime.onInstalled.addListener(async (details) => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);

  if (prefs.contextMenuEnabled !== false) {
    await syncContextMenus(true);
  }

  if (details.reason === "install") {
    // First install — open the onboarding page in a new tab
    const installPrefs = await getPrefs();
    if (!installPrefs.onboardingDone) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
  }
});

// --- Keyboard shortcut: copy clean URL of current tab ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-clean-url") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab?.id) return;

  const result = await handleProcessUrl(tab.url, { skipNotify: true });
  chrome.tabs.sendMessage(tab.id, {
    type: "COPY_TO_CLIPBOARD",
    text: result.cleanUrl,
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (info.menuItemId === "muga-copy-clean") {
    // Route through handleProcessUrl so stats are incremented correctly.
    // skipNotify: true suppresses the foreign-affiliate toast and injection (not relevant on copy).
    const result = await handleProcessUrl(info.linkUrl, { skipNotify: true });

    // Copy to clipboard via content script (service worker has no direct clipboard access)
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "COPY_TO_CLIPBOARD",
        text: result.cleanUrl,
      });
    }
    return;
  }

  if (info.menuItemId === "muga-copy-clean-selection") {
    if (!tab?.id) return;
    // Ask the content script to handle it — it can access the actual DOM selection including hrefs
    chrome.tabs.sendMessage(tab.id, { type: "GET_AND_COPY_CLEAN_SELECTION" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        // Fallback: plain-text approach (original behavior)
        const text = info.selectionText;
        if (!text) return;
        let result = text;
        (async () => {
          const matches = [...text.matchAll(URL_RE)];
          for (const match of matches) {
            const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
            const cleaned = await handleProcessUrl(candidate, { skipNotify: true });
            if (cleaned.cleanUrl !== candidate) result = result.split(candidate).join(cleaned.cleanUrl);
          }
          chrome.tabs.sendMessage(tab.id, { type: "COPY_TO_CLIPBOARD", text: result });
        })();
      }
    });
    return;
  }
});
