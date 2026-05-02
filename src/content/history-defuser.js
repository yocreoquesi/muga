/**
 * MUGA: History Defuser — isolated-world gatekeeper (#444 / B10)
 *
 * The actual `history.pushState` / `history.replaceState` wrap lives in
 * a sibling main-world content script (`history-defuser-mainworld.js`)
 * — see that file for the WHY of dual-world wiring. This isolated-world
 * script is responsible for one job: reading the user's prefs and
 * notifying the main-world wrap whether the disabled-state gate is
 * open.
 *
 * Cross-world signaling: a `CustomEvent` dispatched on `document`
 * crosses the isolated/main-world boundary in MV3 (and on Firefox MV2
 * via the same DOM event bus). `window` property writes don't cross —
 * that's why we don't just set `window.__mugaEnabled` from here.
 *
 * The gate fails CLOSED by default: until prefs land and we dispatch a
 * `muga:history-gate { detail: { enabled: true } }` event, the
 * main-world wrap forwards calls untouched. Cleaner safe than
 * surprising a not-yet-onboarded user with a mutated URL.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js.
  if (window.self !== window.top) return;
  if (window.__mugaHistoryDefuserGate) return;
  window.__mugaHistoryDefuserGate = true;

  function dispatchGate(enabled) {
    try {
      document.dispatchEvent(new CustomEvent("muga:history-gate", {
        detail: { enabled: !!enabled },
      }));
    } catch { /* document detached or CustomEvent unavailable — silent */ }
  }

  function readPrefsAndGate() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        const ok = !!(prefs && prefs.enabled && prefs.onboardingDone);
        dispatchGate(ok);
      });
    } catch {
      // Extension context invalidated. Leave the gate closed.
    }
  }

  // Eagerly populate the gate. The main-world wrap may have already
  // intercepted the very first pushState before this resolves; that's
  // an inherent race we accept (fail-closed).
  readPrefsAndGate();

  // Re-read on storage changes so toggling MUGA off in the popup closes
  // the gate without a page reload.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === "sync" || area === "local") readPrefsAndGate();
    });
  }
})();
