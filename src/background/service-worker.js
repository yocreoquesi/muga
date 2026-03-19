/**
 * MUGA — Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl } from "../lib/cleaner.js";
import { getPrefs, incrementStat, getStats, setStats, migrateStatsToLocal } from "../lib/storage.js";

// Run migration once on startup (no-op if already done)
migrateStatsToLocal();

// Matches http/https URLs in arbitrary text — used by the "selection" context menu handler
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/g;

// Set badge appearance once on startup
chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });

// --- Badge helpers ---

async function updateTabBadge(tabId, junkRemoved) {
  if (!tabId || junkRemoved <= 0) return;
  const key = `tab_${tabId}`;
  const data = await chrome.storage.session.get({ [key]: 0 });
  const newCount = data[key] + junkRemoved;
  await chrome.storage.session.set({ [key]: newCount });
  chrome.action.setBadgeText({ text: String(newCount), tabId });
}

// Clear badge when a tab starts navigating to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

// Clean up session data when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab_${tabId}`);
});

// --- Session history helpers ---

const HISTORY_MAX = 5;

async function appendHistory(original, clean) {
  if (original === clean) return;
  const data = await chrome.storage.session.get({ history: [] });
  const entry = { original, clean, ts: Date.now() };
  const history = [entry, ...data.history].slice(0, HISTORY_MAX);
  await chrome.storage.session.set({ history });
}

// --- Main message listener from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_URL") {
    const tabId = sender.tab?.id;
    handleProcessUrl(message.url, { skipInject: message.skipInject })
      .then(result => {
        updateTabBadge(tabId, result.junkRemoved ?? 0);
        sendResponse(result);
      });
    return true; // keep the channel open for the async response
  }

  if (message.type === "GET_PREFS") {
    getPrefs().then(sendResponse);
    return true;
  }
});

async function handleProcessUrl(rawUrl, { skipInject = false } = {}) {
  const prefs = await getPrefs();

  if (!prefs.enabled) {
    return { cleanUrl: rawUrl, action: "untouched" };
  }

  // On copy: respect the user's affiliate injection setting but suppress the toast
  // (same behaviour as the context menu handler)
  const effectivePrefs = skipInject
    ? { ...prefs, notifyForeignAffiliate: false }
    : prefs;

  const result = processUrl(rawUrl, effectivePrefs);

  // Record first use timestamp for nudge threshold (stored locally)
  const localStats = await getStats();
  if (!localStats.firstUsed) {
    await setStats({ firstUsed: Date.now() });
  }

  // Update stats and session history
  if (result.action !== "untouched") {
    await incrementStat("urlsCleaned");
    await appendHistory(rawUrl, result.cleanUrl);
  }
  if (result.junkRemoved > 0) {
    await incrementStat("junkRemoved", result.junkRemoved);
  }
  if (result.action === "detected_foreign") {
    await incrementStat("referralsSpotted");
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

// --- On install: open onboarding on first run, register context menu ---
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.create({
    id: "muga-copy-clean",
    title: "MUGA: Copy clean link",
    contexts: ["link"],
  });

  chrome.contextMenus.create({
    id: "muga-copy-clean-selection",
    title: "MUGA: Copy clean link",
    contexts: ["selection"],
  });

  if (details.reason === "install") {
    // First install — open the onboarding page in a new tab
    const prefs = await chrome.storage.sync.get({ onboardingDone: false });
    if (!prefs.onboardingDone) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
  }
});

// --- Keyboard shortcut: copy clean URL of current tab ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-clean-url") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab?.id) return;

  const result = await handleProcessUrl(tab.url, { skipInject: true });
  chrome.tabs.sendMessage(tab.id, {
    type: "COPY_TO_CLIPBOARD",
    text: result.cleanUrl,
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (info.menuItemId === "muga-copy-clean") {
    // Route through handleProcessUrl so stats are incremented correctly.
    // skipInject: true suppresses the foreign-affiliate toast (not relevant on copy).
    const result = await handleProcessUrl(info.linkUrl, { skipInject: true });

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
    const text = info.selectionText;
    if (!text || !tab?.id) return;

    // Find all URLs in the selected text and clean each one that has query params
    const matches = [...text.matchAll(URL_RE)];
    let result = text;
    for (const match of matches) {
      const rawUrl = match[0];
      const candidate = rawUrl.replace(/[.,;:!?)\]]+$/, "");
      if (!candidate.includes("?")) continue;
      const cleaned = await handleProcessUrl(candidate, { skipInject: true });
      if (cleaned.cleanUrl !== candidate) {
        result = result.replace(candidate, cleaned.cleanUrl);
      }
    }

    chrome.tabs.sendMessage(tab.id, { type: "COPY_TO_CLIPBOARD", text: result });
  }
});
