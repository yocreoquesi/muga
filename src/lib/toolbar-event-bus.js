/**
 * MUGA: Toolbar Event Bus
 *
 * Thin internal pub/sub. The URL-processing path emits semantic events
 * (urlCleaned, creatorReferralPreserved, foreignAffiliateDetected,
 * navigationStarted, tabClosed, showBadgePrefChanged, tabActiveStateChanged);
 * the toolbar presenter subscribes and translates them into
 * chrome.action.* calls.
 *
 * Decoupling matters: the URL pipeline does not call browser APIs
 * directly, and the presenter does not know about URL cleaning. This is
 * what keeps the presenter testable and the cleaning code free of
 * presentation concerns.
 *
 * Event shapes:
 *   { type: "urlCleaned",                tabId: number, paramsRemoved: number, total?: number }
 *   { type: "creatorReferralPreserved",  tabId: number }
 *   { type: "foreignAffiliateDetected",  tabId: number }
 *   { type: "navigationStarted",         tabId: number }
 *   { type: "tabClosed",                 tabId: number }
 *   { type: "showBadgePrefChanged",      value: boolean }  // no tabId — global
 *   { type: "tabActiveStateChanged",     tabId: number, active: boolean }
 *
 * `urlCleaned.total`, when present, is the tab's authoritative running
 * badge total (persisted in chrome.storage.session by the SW so it
 * survives service-worker restarts — see updateTabBadge() in
 * service-worker.js). The presenter falls back to in-memory accumulation
 * when it is absent (#910).
 *
 * `tabActiveStateChanged.active` is whether MUGA is considered ACTIVE on
 * the tab's current site (prefs.enabled && prefs.onboardingDone &&
 * !isSiteFullyExempt(hostname, prefs) — see
 * service-worker.js#computeTabActiveState). Emitted on navigation commit
 * and on prefs changes that could flip the result (enabled, whitelist,
 * blacklist, mugaConsent, mugaPerDevicePrefs). The presenter uses it to
 * show the inactive glyph badge/tooltip in place of the running count
 * (toolbar-inactive-badge).
 */

export function createToolbarEventBus() {
  const listeners = [];
  return {
    /**
     * Subscribes a listener to all events.
     * @param {(event: object) => void} fn
     * @returns {() => void} Unsubscribe function.
     */
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    /**
     * Emits an event to all subscribers. Listener errors are isolated —
     * a throwing listener does not break delivery to subsequent ones.
     * @param {object} event
     */
    emit(event) {
      for (const fn of listeners.slice()) {
        try {
          fn(event);
        } catch (err) {
          console.error("[MUGA] toolbar bus listener error:", err);
        }
      }
    },
  };
}
