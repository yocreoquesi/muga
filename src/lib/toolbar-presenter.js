/**
 * MUGA: Toolbar Presenter
 *
 * Single point of design control over the browser-action toolbar surface:
 * the dynamic per-tab tooltip (setTitle) and the per-tab numeric badge
 * (setBadgeText). No code outside this module may call chrome.action.set*
 * for either surface.
 *
 * Subscribes to a ToolbarEventBus and tracks two SEPARATE pieces of
 * per-tab state, deliberately kept apart because their reset semantics
 * differ:
 *
 *   - Tooltip state (`state`, a TabPresenterState) — cleaned / creator-
 *     referral-preserved / foreign-affiliate-detected flags for the
 *     CURRENT page. Reset on every `navigationStarted` (per-page).
 *   - Badge total (`badgeTotals`, owned by this module) — the tab's
 *     running count of tracking params stripped, accumulated across
 *     EVERY navigation in the tab's lifetime, including SPA/in-page
 *     navigations. Reset ONLY on `tabClosed` (#910).
 *
 * Icon-variant swapping (setIcon) stays permanently removed: the swap to
 * the *-preserved.png variant raced navigationStarted's icon reset and
 * made the toolbar icon flash/disappear in Firefox MV2 (f6a6e2b). The
 * extension ships a single static icon declared in the manifest; the
 * badge (#910) is a NATIVE browser badge overlay on top of that icon —
 * never a re-rendered/composited icon (no OffscreenCanvas/ImageData).
 *
 * Badge visibility is gated on two live accessors (mirroring how `t`
 * resolves the current language from cachedPrefs at call time):
 *   - `getShowBadge()`     — the user's `showBadge` preference.
 *   - `isOnboardingDone()` — whether consent/onboarding is complete.
 * The global "!" onboarding badge (src/background/service-worker.js,
 * applyOnboardingBadge) has NO tabId; a per-tab setBadgeText call —
 * even with an empty string — creates a per-tab override that masks
 * that global badge for that tab. So while onboarding is incomplete,
 * this presenter must never call setBadgeText with a tabId at all.
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
 * @param {() => boolean} [args.getShowBadge] - Returns the current
 *   `showBadge` preference. Defaults to always-true.
 * @param {() => boolean} [args.isOnboardingDone] - Returns whether
 *   onboarding/consent is complete. Defaults to always-true.
 * @returns {object} Presenter with introspection helpers.
 */
export function createToolbarPresenter({ bus, state, actionApi, t, getShowBadge, isOnboardingDone }) {
  const showBadgeEnabled = typeof getShowBadge === "function" ? getShowBadge : () => true;
  const onboardingDone   = typeof isOnboardingDone === "function" ? isOnboardingDone : () => true;

  // Per-tab running total of tracking params stripped, accumulated across
  // the tab's whole lifetime. See module doc comment above for why this is
  // a separate map from `state`. In-memory only — the SW re-hydrates a
  // tab's authoritative total from chrome.storage.session (survives
  // service-worker restarts) and passes it as event.total on urlCleaned;
  // see updateTabBadge() in service-worker.js.
  const badgeTotals = new Map();

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

  // Writes the badge for one tab. Never touches the action surface while
  // onboarding is pending (see module doc comment) or while showBadge is
  // off. Empty string when the total is zero — no digit is ever shown for
  // a fresh tab because this is only called with a positive total.
  function writeBadge(tabId, total) {
    if (!onboardingDone() || !showBadgeEnabled()) return;
    actionApi.setBadgeText?.({ tabId, text: total > 0 ? String(total) : "" });
  }

  bus.subscribe((event) => {
    if (!event || typeof event !== "object" || !event.type) return;

    // Global (non-tab-scoped) event: the showBadge preference flipped.
    // Repaints or clears every tab's badge immediately — "stops updates"
    // alone is not enough, existing badges must go too.
    //
    // Source of truth for WHICH tabs have a badge: the DURABLE per-tab
    // totals the SW enumerates from chrome.storage.session (tab_badge_*)
    // and passes as event.tabs. The in-memory `badgeTotals` map does NOT
    // survive service-worker eviction, so iterating it alone would leave
    // stale browser-rendered badges on every tab after a restart — the OFF
    // toggle would clear nothing (#910 OFF-path map blind spot). We MERGE
    // the durable list over the in-memory map so every known tab is touched
    // even when the map is empty.
    if (event.type === "showBadgePrefChanged") {
      if (!onboardingDone()) return; // "!" onboarding badge wins; no per-tab badge exists to touch
      const enabled = event.value === true;
      const totals = new Map(badgeTotals);
      if (Array.isArray(event.tabs)) {
        for (const entry of event.tabs) {
          const tabId = Number(entry?.tabId);
          if (!Number.isFinite(tabId) || tabId < 0) continue;
          totals.set(tabId, Math.max(0, Number(entry.total) || 0));
        }
      }
      for (const [tabId, total] of totals) {
        actionApi.setBadgeText?.({ tabId, text: enabled && total > 0 ? String(total) : "" });
        // Keep the in-memory map in sync with the durable totals so
        // subsequent urlCleaned accumulation continues correctly after a
        // restart-driven repaint rehydrated the tab set.
        badgeTotals.set(tabId, total);
      }
      return;
    }

    const tabId = event.tabId;
    if (typeof tabId !== "number" || tabId < 0) return;

    switch (event.type) {
      case "urlCleaned": {
        const count = Math.max(0, Number(event.paramsRemoved) || 0);
        if (count === 0) return;
        const { prev, next } = state.update(tabId, { paramsRemoved: count });
        applyTab(tabId, prev, next);

        // Prefer the caller-supplied authoritative running total (survives
        // SW restarts) over in-memory accumulation.
        const total = Number.isFinite(event.total)
          ? Math.max(0, event.total)
          : (badgeTotals.get(tabId) || 0) + count;
        badgeTotals.set(tabId, total);
        writeBadge(tabId, total);
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
        // Two independent jobs, deliberately kept apart:
        //
        //  1. Tooltip — this is per-PAGE state, so reset it to default.
        //  2. Badge — the running tab total must NOT reset (it accumulates
        //     across every navigation, including SPA/in-page — #910). BUT
        //     the browser CLEARS the per-tab badge TEXT on every navigation
        //     commit (MDN action.setBadgeText, `tabId`: "The text is reset
        //     when the user navigates this tab to a new page."). So after a
        //     navigation the badge the user briefly saw is gone — and unless
        //     the next page happens to trigger a urlCleaned, nothing ever
        //     re-writes it. We therefore RE-PAINT the durable total here,
        //     exactly as uBlock Origin repaints from its stored per-tab
        //     counter (pageStore.counts.blocked.any) on every tabCommitted
        //     rather than only when a block occurs.
        //
        // Cold-SW safe: prefer the caller-supplied durable total (the SW
        // reads tab_badge_{tabId} from chrome.storage.session and passes it
        // as event.total) over the in-memory map, which does not survive a
        // service-worker restart. Only positive totals are painted — a fresh
        // tab that has cleaned nothing must never get a per-tab override.
        clearTab(tabId);
        const total = Number.isFinite(event.total)
          ? Math.max(0, event.total)
          : (badgeTotals.get(tabId) || 0);
        badgeTotals.set(tabId, total);
        if (total > 0) writeBadge(tabId, total);
        return;
      }
      case "tabClosed": {
        state.evict(tabId);
        badgeTotals.delete(tabId);
        return;
      }
      default:
        return;
    }
  });

  return {
    _tooltipFor: tooltipFor,
    _badgeTotal: (tabId) => badgeTotals.get(tabId) || 0,
    // Test-only: wipe the in-memory running totals to simulate a
    // service-worker restart (the durable tab_badge_* session keys and the
    // browser-rendered badges survive; this map does not). Used by the
    // #910 OFF-path regression to prove the clear no longer depends on it.
    _resetInMemoryTotals: () => { badgeTotals.clear(); },
  };
}
