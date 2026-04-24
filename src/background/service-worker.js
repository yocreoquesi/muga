/**
 * MUGA: Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, parseListEntry } from "../lib/cleaner.js";
import { getAffiliateDomains } from "../lib/affiliates.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, sessionStorage, incrementDomainStat, cacheDomainRules, getCachedDomainRules } from "../lib/storage.js";
import { isValidListEntry } from "../lib/validation.js";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../lib/dnr-ids.js";
import { t } from "../lib/i18n.js";
import {
  REMOTE_ALARM_NAME,
  ALARM_PERIOD_MIN,
  ALARM_DELAY_MIN,
  runRemoteRulesFetch,
  clearRemoteCache,
  REMOTE_RULE_ID,
} from "../lib/remote-rules.js";
import { TRUSTED_PUBLIC_KEYS } from "../lib/remote-rules-keys.js";

self.addEventListener("unhandledrejection", (e) => {
  console.warn("[MUGA] unhandled rejection:", e.reason);
});

// Pre-compute affiliate domains once at startup for getPrefs responses
const _affiliateDomains = getAffiliateDomains();

let _firstUsedSet = false;

// B4: fetch domain-rules dynamically (import assertions incompatible with Firefox;
//       top-level await disallowed in Chrome MV3 service workers).
// Cache-first: on each SW restart we attempt to read from chrome.storage.session
// first. Only falls back to fetch() on a cache miss. On persistent fetch failure
// (up to 3 attempts) we log the error and leave domainRules as [] so the SW can
// still operate without domain-specific rules.
let domainRules = [];
let _domainRulesReady = null;
let _domainRulesFetchAttempts = 0;
const DOMAIN_RULES_MAX_ATTEMPTS = 3;

async function _loadDomainRules() {
  const cached = await getCachedDomainRules();
  if (cached) {
    domainRules = cached;
    return;
  }
  if (_domainRulesFetchAttempts >= DOMAIN_RULES_MAX_ATTEMPTS) {
    console.error("[MUGA] domain-rules.json: max fetch attempts reached; domain rules unavailable");
    return;
  }
  try {
    _domainRulesFetchAttempts++;
    const r = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    const data = await r.json();
    domainRules = data;
    await cacheDomainRules(data);
  } catch (err) {
    console.error("[MUGA] domain-rules.json fetch failed (attempt", _domainRulesFetchAttempts, "):", err);
    // Null out so the next handleProcessUrl call retries (up to the cap)
    _domainRulesReady = null;
  }
}

_domainRulesReady = _loadDomainRules();

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
    sessionStorage.set({ debugLog: log }).catch(() => { /* best-effort debug log */ });
  }).catch(() => { /* session storage may be unavailable */ });
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
let _cacheVersion = 0;

/**
 * Invalidates the prefs cache so the next getPrefsWithCache() call re-fetches.
 * Extracted to a single function so all three call-sites (storage.onChanged,
 * ADD_TO_WHITELIST, ADD_TO_BLACKLIST) remain consistent when the cache
 * mechanism evolves (e.g., adding a 4th invalidation flag).
 */
function _invalidatePrefsCache() {
  cachedPrefs = null;
  prefsFetchPromise = null;
  _cacheVersion++;
}

// Serialize list mutations (whitelist/blacklist) to prevent race conditions
// where two rapid messages read the same cached list and the second overwrites the first.
let _listMutationQueue = Promise.resolve();

function getPrefsWithCache() {
  if (cachedPrefs) return Promise.resolve(cachedPrefs);
  if (!prefsFetchPromise) {
    const versionAtStart = _cacheVersion;
    prefsFetchPromise = getPrefs().then(prefs => {
      if (_cacheVersion !== versionAtStart) {
        // Cache was invalidated while fetching — discard stale result
        prefsFetchPromise = null;
        return getPrefsWithCache();
      }
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

// --- Remote-rules alarm helpers ---
// Feature-detect chrome.alarms (absent in some stripped Firefox MV2 builds).
const hasAlarms = typeof chrome.alarms !== "undefined";

/**
 * Registers the remote-rules weekly alarm idempotently.
 * Called on onInstalled and onStartup. The alarm handler short-circuits
 * if remoteRulesEnabled is false, so always registering is safe (REQ-OPT-6).
 *
 * Pure helper — takes chrome.alarms as an injected dep for unit-testability.
 * No-op when the API is absent (feature-detect).
 *
 * @param {typeof chrome.alarms | undefined} alarms - chrome.alarms API (or undefined).
 */
function registerRemoteRulesAlarm(alarms) {
  if (!alarms) return;
  return alarms.create(REMOTE_ALARM_NAME, {
    periodInMinutes: ALARM_PERIOD_MIN,
    delayInMinutes: ALARM_DELAY_MIN,
  });
}

// --- DNR sync helpers ---
// Firefox MV2 does not support declarativeNetRequest; guard all DNR calls.
const hasDNR = typeof chrome.declarativeNetRequest !== "undefined";

async function syncCustomParamsDNR(customParams) {
  if (!hasDNR) return;
  try {
    if (!customParams || customParams.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
        addRules: [],
      });
      return;
    }
    const normalized = customParams
      .filter(p => /^[a-zA-Z0-9_.-]+$/.test(p.trim()))
      .map(p => p.trim().toLowerCase());
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
      addRules: [{
        id: DNR_CUSTOM_PARAMS_RULE_ID,
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
    }).catch(() => { /* no-op if already disabled */ });
    await syncCustomParamsDNR([]);
  }
}

// Matches http/https URLs in arbitrary text. Used by the "selection" context menu handler.
// NOTE: content/cleaner.js contains an identical copy of this regex. Content scripts
// cannot import ES modules, so the definition must stay in both files. The sync
// regression test at tests/unit/url-regex-sync.test.mjs enforces identical literals.
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
  // Titles sourced from lib/i18n.js (ctx_copy_clean_link / ctx_copy_clean_selection).
  // Canonical German (de): "Bereinigten Link kopieren" — see lib/i18n.js.
  const titles = {
    copy: t("ctx_copy_clean_link", lang),
    selection: t("ctx_copy_clean_selection", lang),
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
  _invalidatePrefsCache();
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

  if (message.type === "ADD_TO_WHITELIST" || message.type === "ADD_TO_BLACKLIST") {
    // List mutations must originate from a tab (content script). Reject messages
    // from extension pages (popup, options) that lack a sender.tab — they cannot
    // legitimately trigger list changes, and this prevents a defense-in-depth gap.
    if (!sender.tab) {
      try { sendResponse({ ok: false, error: "tab-only" }); } catch { /* channel closed */ }
      return false;
    }
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
      _invalidatePrefsCache();
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
      _invalidatePrefsCache();
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
    return true;
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
  // _domainRulesReady is nulled on fetch failure to allow retry on the next call
  if (!_domainRulesReady) _domainRulesReady = _loadDomainRules();
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
    if (parsedRaw?.search) {
      const passthroughEntry = { domain: parsedRaw.hostname.replace(/^www\./, "") };
      if (prefs.devMode) {
        passthroughEntry.path = parsedRaw.pathname;
        passthroughEntry.params = [...parsedRaw.searchParams.keys()];
      }
      logAction("passthrough", passthroughEntry);
    }
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
      try {
        const domain = parsedRaw.hostname.replace(/^www\./, "");
        const cleanedEntry = {
          source,
          domain,
          action: result.action,
          junkRemoved: result.junkRemoved,
        };
        if (prefs.devMode) {
          const parsedClean = new URL(result.cleanUrl);
          cleanedEntry.path = parsedRaw.pathname;
          cleanedEntry.removed = result.removedTracking;
          cleanedEntry.originalParams = [...parsedRaw.searchParams.keys()];
          cleanedEntry.cleanParams = [...parsedClean.searchParams.keys()];
          cleanedEntry.cleanUrl = result.cleanUrl;
        }
        logAction("cleaned", cleanedEntry);
      } catch { /* malformed cleanUrl — skip logging */ }
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
      try {
        const url = new URL(result.cleanUrl);
        const p = result.detectedAffiliate.pattern;
        url.searchParams.set(p.param, p.ourTag);
        result.withOurAffiliate = url.toString();
      } catch { /* malformed cleanUrl — skip injection */ }
    }
  }

  return result;
}

// --- On startup: apply DNR state + register remote-rules alarm ---
chrome.runtime.onStartup.addListener(async () => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  registerRemoteRulesAlarm(hasAlarms ? chrome.alarms : undefined);
});

// --- Dedup flag: prevent opening onboarding twice in the same background lifetime ---
let _onboardingTabOpened = false;
function openOnboardingOnce() {
  if (_onboardingTabOpened) return;
  _onboardingTabOpened = true;
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
}

// --- On install: open onboarding on first run, register context menu + alarm ---
chrome.runtime.onInstalled.addListener(async (details) => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  registerRemoteRulesAlarm(hasAlarms ? chrome.alarms : undefined);

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
