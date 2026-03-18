/**
 * MUGA — Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl } from "../lib/cleaner.js";
import { getPrefs, incrementStat } from "../lib/storage.js";

// --- Main message listener from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_URL") {
    handleProcessUrl(message.url, { skipInject: message.skipInject }).then(sendResponse);
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

  // Update stats
  if (result.removedTracking.length > 0) {
    await incrementStat("trackingRemoved");
  }
  if (result.action === "injected") {
    await incrementStat("affiliatesInjected");
  }
  if (result.action === "detected_foreign") {
    await incrementStat("foreignDetected");
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

  if (details.reason === "install") {
    // First install — open the onboarding page in a new tab
    const prefs = await chrome.storage.sync.get({ onboardingDone: false });
    if (!prefs.onboardingDone) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "muga-copy-clean") return;
  const prefs = await getPrefs();
  const result = processUrl(info.linkUrl, { ...prefs, notifyForeignAffiliate: false });

  // Copy to clipboard via content script (service worker has no direct clipboard access)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "COPY_TO_CLIPBOARD",
      text: result.cleanUrl,
    });
  }
});
