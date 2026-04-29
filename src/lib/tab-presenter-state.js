/**
 * MUGA: Tab Presenter State
 *
 * In-memory record of what each tab's toolbar currently shows. Keyed by
 * tabId. Reset on navigation start; evicted on tab close. Consulted by
 * the toolbar presenter whenever it has to compute the next surface
 * state for a tab.
 *
 * State per tab:
 *   {
 *     paramsRemoved: number,         // count strip events accumulated
 *     creatorReferralPreserved: bool,
 *     foreignAffiliateDetected: bool,
 *   }
 */

const EMPTY = Object.freeze({
  paramsRemoved: 0,
  creatorReferralPreserved: false,
  foreignAffiliateDetected: false,
});

export function createTabPresenterState() {
  const byTab = new Map();

  return {
    /**
     * Returns the current state for a tab. Never throws; missing tabs
     * return a frozen empty record so callers can read fields safely.
     * @param {number} tabId
     * @returns {object}
     */
    get(tabId) {
      return byTab.get(tabId) || EMPTY;
    },

    /**
     * Returns the previous state (for diff comparisons) and applies a
     * partial update. Numeric fields like `paramsRemoved` accumulate.
     * @param {number} tabId
     * @param {object} patch
     * @returns {{ prev: object, next: object }}
     */
    update(tabId, patch) {
      const prev = byTab.get(tabId) || EMPTY;
      const next = { ...prev };
      if (typeof patch.paramsRemoved === "number") {
        next.paramsRemoved = prev.paramsRemoved + patch.paramsRemoved;
      }
      if (patch.creatorReferralPreserved === true) {
        next.creatorReferralPreserved = true;
      }
      if (patch.foreignAffiliateDetected === true) {
        next.foreignAffiliateDetected = true;
      }
      byTab.set(tabId, next);
      return { prev, next };
    },

    /**
     * Resets a tab's state to empty (used on navigation start).
     * @param {number} tabId
     */
    reset(tabId) {
      byTab.delete(tabId);
    },

    /**
     * Evicts a tab from the state map (used on tab close).
     * @param {number} tabId
     */
    evict(tabId) {
      byTab.delete(tabId);
    },

    /**
     * Number of tracked tabs. Exposed for tests and diagnostics.
     * @returns {number}
     */
    size() {
      return byTab.size;
    },
  };
}
