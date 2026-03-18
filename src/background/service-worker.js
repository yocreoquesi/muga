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
    handleProcessUrl(message.url).then(sendResponse);
    return true; // keep the channel open for the async response
  }

  if (message.type === "GET_PREFS") {
    getPrefs().then(sendResponse);
    return true;
  }
});

async function handleProcessUrl(rawUrl) {
  const prefs = await getPrefs();

  if (!prefs.enabled) {
    return { cleanUrl: rawUrl, action: "untouched" };
  }

  const result = processUrl(rawUrl, prefs);

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

// --- Context menu: "Copy clean link" ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "muga-copy-clean",
    title: "MUGA: Copy clean link",
    contexts: ["link"],
  });
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
