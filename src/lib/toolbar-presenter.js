/**
 * MUGA: Toolbar Presenter
 *
 * Single point of design control over the browser-action toolbar surface.
 * Currently manages only the dynamic per-tab tooltip via setTitle.
 *
 * Subscribes to a ToolbarEventBus, tracks per-tab semantic state (cleaned,
 * creator-referral preserved, foreign affiliate detected) and translates
 * it into the right tooltip string. State is cached in TabPresenterState
 * so the same setTitle call is not issued twice for the same value.
 *
 * The badge text/color and icon variant surfaces were removed: the per-tab
 * count was confusing and the icon swap to the *-preserved.png variant
 * caused the toolbar icon to flash and disappear in Firefox MV2. The
 * extension now ships a single static icon declared in the manifest.
 */

/**
 * Creates a toolbar presenter and wires it to the bus. Returns the
 * presenter for testing / direct calls (not generally needed in
 * production — the bus is the entry point).
 *
 * @param {object} args
 * @param {object} args.bus       - ToolbarEventBus (subscribe/emit).
 * @param {object} args.state     - TabPresenterState (get/update/reset/evict).
 * @param {object} args.actionApi - chrome.action / browserAction shim.
 * @param {(key: string) => string} args.t - i18n lookup. Returns the
 *   localized string for the user's current language.
 * @returns {object} Presenter with introspection helpers.
 */
export function createToolbarPresenter({ bus, state, actionApi, t }) {
  function tooltipFor(s) {
    const cleaned   = s.paramsRemoved > 0;
    const preserved = s.creatorReferralPreserved;
    if (cleaned && preserved) return t("tooltip_cleaned_and_preserved");
    if (preserved)            return t("tooltip_preserved");
    if (cleaned)              return t("tooltip_cleaned");
    return t("tooltip_default");
  }

  function applyTab(tabId, prev, next) {
    const prevTitle = tooltipFor(prev);
    const nextTitle = tooltipFor(next);
    if (prevTitle !== nextTitle) {
      actionApi.setTitle?.({ tabId, title: nextTitle });
    }
  }

  function clearTab(tabId) {
    state.reset(tabId);
    actionApi.setTitle?.({ tabId, title: t("tooltip_default") });
  }

  bus.subscribe((event) => {
    if (!event || typeof event !== "object" || !event.type) return;
    const tabId = event.tabId;
    if (typeof tabId !== "number" || tabId < 0) return;

    switch (event.type) {
      case "urlCleaned": {
        const count = Math.max(0, Number(event.paramsRemoved) || 0);
        if (count === 0) return;
        const { prev, next } = state.update(tabId, { paramsRemoved: count });
        applyTab(tabId, prev, next);
        return;
      }
      case "creatorReferralPreserved": {
        const { prev, next } = state.update(tabId, { creatorReferralPreserved: true });
        applyTab(tabId, prev, next);
        return;
      }
      case "foreignAffiliateDetected": {
        const { prev, next } = state.update(tabId, { foreignAffiliateDetected: true });
        applyTab(tabId, prev, next);
        return;
      }
      case "navigationStarted": {
        clearTab(tabId);
        return;
      }
      case "tabClosed": {
        state.evict(tabId);
        return;
      }
      default:
        return;
    }
  });

  return {
    _tooltipFor: tooltipFor,
  };
}
