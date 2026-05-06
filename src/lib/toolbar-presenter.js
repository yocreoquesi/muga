/**
 * MUGA: Toolbar Presenter
 *
 * Single point of design control over the browser-action toolbar surface
 * (tooltip via setTitle, badge text via setBadgeText, badge color via
 * setBadgeBackgroundColor). No code outside this module may call those
 * APIs directly.
 *
 * Subscribes to a ToolbarEventBus and translates semantic events into
 * the right per-tab surface state. State is cached in TabPresenterState
 * so the same surface call is not issued twice for the same value.
 *
 * Surface channels carrying the wedge cue:
 *   - Tooltip text (setTitle) — explicit "Creator referral preserved".
 *   - Badge color (setBadgeBackgroundColor) — green when preserved.
 *   - Popup-internal "Creator referral preserved" badge (rendered by
 *     popup.js, not by this module).
 *
 * Icon variants were retired 2026-05-07: the on-disk preserved PNGs
 * were byte-identical to the default icons (silent no-op), so swapping
 * them produced no visible change while still emitting setIcon calls
 * that occasionally caused per-tab icon flicker on Firefox. The wedge
 * is now communicated through the three channels above.
 */

// Semantic badge colors (#367). The tab's most recent event determines which
// color the badge wears.
//
//   BLUE   — routine cleaning happened.
//   GREEN  — a creator referral was preserved on this tab's navigation.
//   YELLOW — a foreign affiliate was detected and the user has the toast
//            disabled (so this is the only ambient signal for that case).
//
// The set is closed and small. Adding a fourth color requires a deliberate
// design decision (see PRD #350).
export const BADGE_COLOR_DEFAULT  = "#2563eb"; // blue
export const BADGE_COLOR_CLEANED  = "#2563eb"; // blue (same as default; explicit alias for clarity)
export const BADGE_COLOR_PRESERVED = "#16a34a"; // green
export const BADGE_COLOR_DETECTED  = "#ca8a04"; // yellow

/**
 * Returns the semantic badge color for a given tab state.
 * Pure function. Exported for tests.
 */
export function badgeColorFor(s) {
  if (s.creatorReferralPreserved) return BADGE_COLOR_PRESERVED;
  if (s.foreignAffiliateDetected) return BADGE_COLOR_DETECTED;
  return BADGE_COLOR_CLEANED; // blue is the default whether or not anything cleaned
}

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
  // Default badge background color at startup. Per-tab calls below override
  // this when a tab's state warrants a semantic color (#367).
  actionApi.setBadgeBackgroundColor?.({ color: BADGE_COLOR_DEFAULT });

  function tooltipFor(s) {
    const cleaned   = s.paramsRemoved > 0;
    const preserved = s.creatorReferralPreserved;
    if (cleaned && preserved) return t("tooltip_cleaned_and_preserved");
    if (preserved)            return t("tooltip_preserved");
    if (cleaned)              return t("tooltip_cleaned");
    return t("tooltip_default");
  }

  function applyTab(tabId, prev, next) {
    // Tooltip. Only call setTitle if the resolved string changed.
    const prevTitle = tooltipFor(prev);
    const nextTitle = tooltipFor(next);
    if (prevTitle !== nextTitle) {
      actionApi.setTitle?.({ tabId, title: nextTitle });
    }

    // Badge color. Only call setBadgeBackgroundColor if the resolved
    // color changed for this tab — setBadgeBackgroundColor with a tabId
    // sets the per-tab override; we avoid redundant calls.
    const prevColor = badgeColorFor(prev);
    const nextColor = badgeColorFor(next);
    if (prevColor !== nextColor) {
      actionApi.setBadgeBackgroundColor?.({ tabId, color: nextColor });
    }

    // Badge text. Mirrors the pre-existing behavior: numeric count of
    // params removed on this tab; empty when zero.
    if (next.paramsRemoved !== prev.paramsRemoved) {
      const text = next.paramsRemoved > 0 ? String(next.paramsRemoved) : "";
      actionApi.setBadgeText?.({ tabId, text });
    }
  }

  function clearTab(tabId) {
    state.reset(tabId);
    actionApi.setBadgeText?.({ tabId, text: "" });
    actionApi.setTitle?.({ tabId, title: t("tooltip_default") });
    actionApi.setBadgeBackgroundColor?.({ tabId, color: BADGE_COLOR_DEFAULT });
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
    // Test/introspection: returns the tooltip string the presenter would
    // show for a given state. Useful for unit tests without mocking
    // setTitle round-trips.
    _tooltipFor: tooltipFor,
  };
}
