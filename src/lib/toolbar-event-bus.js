/**
 * MUGA: Toolbar Event Bus
 *
 * Thin internal pub/sub. The URL-processing path emits semantic events
 * (urlCleaned, creatorReferralPreserved, foreignAffiliateDetected,
 * navigationStarted, tabClosed); the toolbar presenter subscribes and
 * translates them into chrome.action.* calls.
 *
 * Decoupling matters: the URL pipeline does not call browser APIs
 * directly, and the presenter does not know about URL cleaning. This is
 * what keeps the presenter testable and the cleaning code free of
 * presentation concerns.
 *
 * Event shapes:
 *   { type: "urlCleaned",                tabId: number, paramsRemoved: number }
 *   { type: "creatorReferralPreserved",  tabId: number }
 *   { type: "foreignAffiliateDetected",  tabId: number }
 *   { type: "navigationStarted",         tabId: number }
 *   { type: "tabClosed",                 tabId: number }
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
