/**
 * MUGA: Toolbar Presenter
 *
 * Single point of design control over the browser-action toolbar surface:
 * the dynamic per-tab tooltip (setTitle) and the per-tab numeric badge
 * (setBadgeText / setBadgeBackgroundColor). No code outside this module
 * may call chrome.action.set* for either surface.
 *
 * Subscribes to a ToolbarEventBus and tracks THREE separate pieces of
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
 *   - Active state (`activeStates`, owned by this module) — whether MUGA
 *     is considered ACTIVE on the tab's current site (see the "Inactive
 *     badge" section below). Like `badgeTotals`, this is a TAB-level
 *     concern (survives navigation) rather than a per-page one: the site
 *     the tab is on does not change moment-to-moment the way the
 *     cleaned/preserved flags do, and unlike them, its value is always
 *     RECOMPUTED (not accumulated) by the caller on every navigation and
 *     on every relevant prefs change. Reset ONLY on `tabClosed`.
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
 *
 * Inactive badge (toolbar-inactive-badge):
 * A tab is INACTIVE when MUGA is globally disabled or the tab's site is
 * fully exempt (per-site pause / allowlist) — see
 * src/background/service-worker.js#computeTabActiveState, which mirrors
 * the "Active-on-tab" formula:
 *   prefs.enabled === true && prefs.onboardingDone === true &&
 *   !isSiteFullyExempt(hostname, prefs)
 * The service worker recomputes this on every navigation commit and on
 * every prefs change that could flip it (enabled, whitelist, blacklist,
 * mugaConsent, mugaPerDevicePrefs), and tells this presenter via the
 * `tabActiveStateChanged` bus event.
 *
 * Badge precedence, highest first (see paintBadge() below for the single
 * function implementing this for live events):
 *   1. Onboarding NOT done       -> no per-tab badge at all (the global
 *                                    "!" badge owns the surface).
 *   2. `showBadge` pref is off   -> no badge at all (no count, no glyph).
 *   3. Tab is INACTIVE           -> INACTIVE_GLYPH on a grey background,
 *                                    regardless of the tab's historical
 *                                    running count.
 *   4. Tab is ACTIVE             -> the existing running-count behavior,
 *                                    with the default badge background.
 * The tooltip follows the same active/inactive split: `tooltipFor()`
 * returns `tooltip_inactive` for an inactive tab, otherwise the existing
 * cleaned/preserved/default resolution — untouched by onboarding or
 * showBadge (those two only gate the BADGE, never the tooltip; this
 * matches the pre-existing "badge is not written while onboarding is
 * incomplete" invariant, which is a badge-only rule, not a tooltip rule).
 */

// Glyph shown on a tab where MUGA is inactive (globally disabled, or the
// site is fully exempt). Chosen for compact, badge-sized legibility
// (U+2298 CIRCLED DIVISION SLASH). If a real-browser smoke ever shows
// tofu/an unsupported glyph for some platform font, fall back to the
// plain ASCII "OFF" instead of chasing font coverage per platform.
export const INACTIVE_GLYPH = "⊘"; // "⊘"

// Grey background for the inactive-glyph badge — visually distinct from
// the brand-accent count badge below, signaling "off" without implying
// an error/warning color (no red/orange).
export const INACTIVE_BADGE_COLOR = "#8a8a8a";

// Default (active) badge background — matches the brand accent used
// across popup/options/onboarding CSS (--accent: #6A2BCF), so the count
// badge reads as "MUGA branded", not a bare browser default.
export const DEFAULT_BADGE_COLOR = "#6A2BCF";

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

  // Per-tab active/inactive flag (toolbar-inactive-badge). Absence means
  // "never told otherwise" — treated as ACTIVE (the safe default: never
  // show the "off" glyph for a tab we have not yet classified). Set by
  // `tabActiveStateChanged` events from the service worker; see module
  // doc comment for why this lives here rather than in TabPresenterState.
  const activeStates = new Map();

  function isTabInactive(tabId) {
    return activeStates.get(tabId) === false;
  }

  function tooltipFor(s, inactive) {
    if (inactive) return t("tooltip_inactive");
    const cleaned   = s.paramsRemoved > 0;
    const preserved = s.creatorReferralPreserved;
    if (cleaned && preserved) return t("tooltip_cleaned_and_preserved");
    if (preserved)            return t("tooltip_preserved");
    if (cleaned)              return t("tooltip_cleaned");
    return t("tooltip_default");
  }

  function applyTab(tabId, prev, next) {
    const inactive  = isTabInactive(tabId);
    const prevTitle = tooltipFor(prev, inactive);
    const nextTitle = tooltipFor(next, inactive);
    if (prevTitle !== nextTitle) {
      actionApi.setTitle?.({ tabId, title: nextTitle });
    }
  }

  function clearTab(tabId) {
    state.reset(tabId);
    // Use the tab's CURRENT active flag (unaffected by this per-page
    // reset — see module doc comment): an inactive tab must keep showing
    // the inactive tooltip across navigation, not bounce back to default.
    actionApi.setTitle?.({ tabId, title: tooltipFor(state.get(tabId), isTabInactive(tabId)) });
  }

  // Single choke point for every LIVE per-tab badge write (urlCleaned,
  // navigationStarted, tabActiveStateChanged). Implements the precedence
  // documented in the module doc comment: onboarding-incomplete or
  // showBadge-off means NO call at all — not even an empty-string clear —
  // preserving the pre-existing "no per-tab override before we know
  // consent/pref state" invariant (#910). Active/inactive precedence over
  // the count is enforced here too.
  function paintBadge(tabId, total) {
    if (!onboardingDone() || !showBadgeEnabled()) return;
    if (isTabInactive(tabId)) {
      actionApi.setBadgeText?.({ tabId, text: INACTIVE_GLYPH });
      actionApi.setBadgeBackgroundColor?.({ tabId, color: INACTIVE_BADGE_COLOR });
      return;
    }
    actionApi.setBadgeBackgroundColor?.({ tabId, color: DEFAULT_BADGE_COLOR });
    actionApi.setBadgeText?.({ tabId, text: total > 0 ? String(total) : "" });
  }

  // Variant used ONLY by the showBadgePrefChanged transition below. Unlike
  // paintBadge() above, this ACTIVELY clears the badge with an explicit
  // empty-string write when `enabled` is false — that event exists
  // specifically to erase stale badges the OFF toggle must remove, not to
  // silently skip. Takes `enabled` from the event's own value rather than
  // re-reading the live showBadgeEnabled() accessor, matching the
  // pre-existing behavior (avoids any accessor/event timing mismatch).
  function paintBadgeForTransition(tabId, total, enabled) {
    if (!enabled) {
      actionApi.setBadgeText?.({ tabId, text: "" });
      return;
    }
    if (isTabInactive(tabId)) {
      actionApi.setBadgeText?.({ tabId, text: INACTIVE_GLYPH });
      actionApi.setBadgeBackgroundColor?.({ tabId, color: INACTIVE_BADGE_COLOR });
      return;
    }
    actionApi.setBadgeBackgroundColor?.({ tabId, color: DEFAULT_BADGE_COLOR });
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
        paintBadgeForTransition(tabId, total, enabled);
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
        // paintBadge() itself enforces the inactive-takes-precedence rule:
        // an inactive tab shows the glyph here too, even though a clean
        // just happened — the count is not discarded (still tracked in
        // badgeTotals for when the tab becomes active again), just not shown.
        paintBadge(tabId, total);
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
        //  1. Tooltip — this is per-PAGE state, so reset it to default (or
        //     to the inactive tooltip, if the tab's active flag — which
        //     survives this reset, see module doc comment — says so).
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
        // tab that has cleaned nothing must never get a per-tab override —
        // UNLESS the tab is inactive, in which case the glyph is painted
        // regardless of total (the SW emits a fresh `tabActiveStateChanged`
        // for the new hostname right after this event; using the tab's
        // current — momentarily stale for one tick — active flag here just
        // means the glyph, if applicable, appears immediately rather than
        // one event later).
        clearTab(tabId);
        const total = Number.isFinite(event.total)
          ? Math.max(0, event.total)
          : (badgeTotals.get(tabId) || 0);
        badgeTotals.set(tabId, total);
        if (total > 0 || isTabInactive(tabId)) paintBadge(tabId, total);
        return;
      }
      case "tabActiveStateChanged": {
        // Recompute the tooltip (active <-> inactive can change the
        // tooltip even though the per-page `state` record itself did not
        // change) and repaint the badge under the new precedence.
        const wasInactive = isTabInactive(tabId);
        const nowInactive = event.active === false;
        activeStates.set(tabId, event.active !== false);
        if (wasInactive !== nowInactive) {
          const s = state.get(tabId);
          const prevTitle = tooltipFor(s, wasInactive);
          const nextTitle = tooltipFor(s, nowInactive);
          if (prevTitle !== nextTitle) {
            actionApi.setTitle?.({ tabId, title: nextTitle });
          }
        }
        // Always repaint: even a no-op transition (e.g. active -> active)
        // is cheap, and a real transition must clear/paint the surface
        // regardless of the tab's running total (see paintBadge()).
        paintBadge(tabId, badgeTotals.get(tabId) || 0);
        return;
      }
      case "tabClosed": {
        state.evict(tabId);
        badgeTotals.delete(tabId);
        activeStates.delete(tabId);
        return;
      }
      default:
        return;
    }
  });

  return {
    _tooltipFor: (s) => tooltipFor(s, false),
    _badgeTotal: (tabId) => badgeTotals.get(tabId) || 0,
    _isTabActive: (tabId) => !isTabInactive(tabId),
    // Test-only: wipe the in-memory running totals to simulate a
    // service-worker restart (the durable tab_badge_* session keys and the
    // browser-rendered badges survive; this map does not). Used by the
    // #910 OFF-path regression to prove the clear no longer depends on it.
    _resetInMemoryTotals: () => { badgeTotals.clear(); },
  };
}
