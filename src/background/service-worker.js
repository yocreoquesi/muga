/**
 * MUGA — Service Worker (MV3)
 * Procesa URLs, gestiona mensajes del content script
 * y mantiene el estado de la extensión.
 */

import { processUrl } from "../lib/cleaner.js";
import { getPrefs, incrementStat } from "../lib/storage.js";

// --- Listener principal de mensajes desde content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_URL") {
    handleProcessUrl(message.url).then(sendResponse);
    return true; // mantiene el canal abierto para la respuesta async
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

  // Actualizar estadísticas
  if (result.removedTracking.length > 0) {
    await incrementStat("trackingRemoved");
  }
  if (result.action === "injected") {
    await incrementStat("affiliatesInjected");
  }
  if (result.action === "detected_foreign") {
    await incrementStat("foreignDetected");
    // Si el usuario tiene activado "reemplazar", preparar URL con nuestro afiliado
    if (prefs.allowReplaceAffiliate && result.detectedAffiliate?.pattern?.ourTag) {
      const url = new URL(result.cleanUrl);
      const p = result.detectedAffiliate.pattern;
      url.searchParams.set(p.param, p.ourTag);
      result.withOurAffiliate = url.toString();
    }
  }

  return result;
}

// --- Menú contextual: "Copiar enlace limpio" ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "muga-copy-clean",
    title: "MUGA: Copiar enlace limpio",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "muga-copy-clean") return;
  const prefs = await getPrefs();
  const result = processUrl(info.linkUrl, { ...prefs, notifyForeignAffiliate: false });

  // Copiar al portapapeles via content script (el SW no tiene acceso directo)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "COPY_TO_CLIPBOARD",
      text: result.cleanUrl,
    });
  }
});
