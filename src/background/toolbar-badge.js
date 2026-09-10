/**
 * MUGA — Toolbar badge + tab active-state, extracted so it can be imported in Node (#1266 item 2, item 5)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it — and that is exactly what made #1266 item 2
 * possible in the first place. The toolbar presenter's `activeStates` map
 * (src/lib/toolbar-presenter.js) is in-memory only, unlike its durably-backed
 * sibling `badgeTotals`, so after an MV3 restart `isTabInactive()` defaults
 * every open tab to active. `repaintAllTabsActiveState` is the only thing
 * that recomputes it for already-open tabs, and the fix that wires it into
 * `onStartup`/`onInstalled` landed in PR #1292 — but no test was ever
 * written for it, because the function it had to prove lived in a file Node
 * could not load. This move pays that debt off directly:
 * tests/unit/toolbar-badge.test.mjs builds a real cold-start `activeStates`
 * map (via the real createToolbarPresenter) and a real createToolbarBadge,
 * proves the gap first (every tab, including a fully-exempt one, reports
 * active with no repaint), then proves the fix (repaintAllTabsActiveState
 * corrects every open tab).
 *
 * This is the pure move #1266 item 5 sketches as its second slice: the
 * badge helpers (`updateTabBadge`, `collectBadgeTotals`), the tab
 * active-state helpers (`computeTabActiveState`, `repaintAllTabsActiveState`),
 * and the bodies of the `chrome.tabs.onUpdated` / `chrome.tabs.onRemoved`
 * listeners.
 *
 * Shaped as a factory (`createToolbarBadge`), not bare functions, because
 * service-worker.js owns the ToolbarEventBus instance (`toolbarBus`) and the
 * prefs cache accessor (`getPrefsWithCache`) — importing either back out of
 * this module would create an import cycle. The service worker injects both,
 * plus `sessionStorage` and its own `withSessionMutation`. That queue is
 * shared with `appendHistory`, which stays in service-worker.js (it is not
 * used only by this block), so the SAME queue instance must be injected
 * rather than duplicated here — see service-worker.js for the one true
 * instance. A caller that omits it gets a private, non-shared fallback,
 * which is fine for a standalone test but would silently drop the shared
 * serialization guarantee if used in production.
 *
 * `chrome.tabs.onUpdated.addListener` / `chrome.tabs.onRemoved.addListener`
 * themselves STAY in service-worker.js: #1266 is explicit that the lifecycle
 * wiring is the composition root, and moving the `addListener` calls here
 * would re-break importability — the whole reason this file exists. This
 * module exposes `onTabUpdated`/`onTabRemoved` for the entry file to
 * delegate to instead.
 */

import { isSiteFullyExempt } from "../lib/cleaner.js";

// --- Tab active-state (toolbar-inactive-badge) ---
//
// "Active-on-tab" mirrors isSiteFullyExempt/getFullyExemptDomains (#allowlist
// -full-inert) exactly the same way syncAllowlistDNR does for the network
// layer above: a tab is ACTIVE only when the extension is globally on,
// onboarding/consent is complete, AND the tab's hostname is not a fully
// exempt (allowlisted / per-site-paused — migratePerSiteDisableToAllowlist
// folded the legacy per-site pause into the same whitelist mechanism) site.
// Defensive by construction: any falsy/missing prefs resolves through
// isSiteFullyExempt's own fail-safe (false), so a malformed prefs object
// can only ever make computeTabActiveState MORE cautious about calling a
// tab "inactive", never less.
export function computeTabActiveState(prefs, hostname) {
  return prefs?.enabled === true && prefs?.onboardingDone === true && !isSiteFullyExempt(hostname, prefs);
}

/**
 * Creates the toolbar-badge helpers and wires them to the given bus.
 *
 * @param {object} args
 * @param {object} args.bus - ToolbarEventBus (subscribe/emit) — service-worker.js's `toolbarBus`.
 * @param {() => Promise<object>} args.getPrefs - warms/returns the prefs cache — service-worker.js's `getPrefsWithCache`.
 * @param {object} args.sessionStorage - chrome.storage.session shim (get/set/remove) — src/lib/storage.js's `sessionStorage`.
 * @param {object} [args.tabsApi] - chrome.tabs (or a stub). Defaults to `globalThis.chrome?.tabs`.
 * @param {(fn: () => Promise<any>) => Promise<any>} [args.withSessionMutation] - serializes a
 *   session-storage read-modify-write cycle against every other queued mutation. MUST be the
 *   same instance service-worker.js uses for `appendHistory` in production (see module doc).
 *   Defaults to a private, non-shared queue when omitted (test convenience only).
 * @returns {object} { updateTabBadge, collectBadgeTotals, repaintAllTabsActiveState, onTabUpdated, onTabRemoved }
 */
export function createToolbarBadge({ bus, getPrefs, sessionStorage, tabsApi, withSessionMutation }) {
  const tabsApiResolved = tabsApi || globalThis.chrome?.tabs;

  // Private fallback queue, only used when the caller does not inject the
  // shared service-worker.js instance — see module doc comment.
  let _localMutationQueue = Promise.resolve();
  const runSessionMutation = typeof withSessionMutation === "function"
    ? withSessionMutation
    : (fn) => {
        _localMutationQueue = _localMutationQueue.then(fn, fn);
        return _localMutationQueue;
      };

  // --- Badge helpers ---
  //
  // The badge text and tooltip are driven by the ToolbarPresenter (#358,
  // badge counter re-introduced #910). updateTabBadge emits a urlCleaned
  // event; the presenter writes the tooltip AND (when showBadge is on and
  // onboarding is done) the native toolbar badge text.
  //
  // TWO session-storage keys, two different reset semantics — do not merge
  // them:
  //   - `tab_{tabId}`       — per-PAGE count, cleared on every navigation.
  //     Feeds the popup's "This page" preview badge (src/popup/popup.js).
  //     Unchanged by #910.
  //   - `tab_badge_{tabId}` — per-TAB running total, cleared ONLY on tab
  //     close. Feeds the toolbar badge (#910's requirement: accumulates
  //     across every navigation in the tab, including SPA). Passed to the
  //     presenter as event.total so the badge stays correct even if the
  //     presenter's in-memory map was wiped by a service-worker restart.
  async function updateTabBadge(tabId, junkRemoved) {
    if (!tabId || junkRemoved <= 0) return;
    const key = `tab_${tabId}`;
    const badgeKey = `tab_badge_${tabId}`;

    // Serialized (#1097): without this, two rapid clean events on the same tab
    // (fast frames/SPA navigations) can each read the pre-update count before
    // either write lands, so the second write clobbers the first and the badge
    // undercounts. runSessionMutation queues this whole read-modify-write
    // cycle behind any other pending session-storage mutation.
    const badgeTotal = await runSessionMutation(async () => {
      const data = await sessionStorage.get({ [key]: 0 });
      const newCount = data[key] + junkRemoved;
      await sessionStorage.set({ [key]: newCount });

      const badgeData = await sessionStorage.get({ [badgeKey]: 0 });
      const newBadgeTotal = badgeData[badgeKey] + junkRemoved;
      await sessionStorage.set({ [badgeKey]: newBadgeTotal });
      return newBadgeTotal;
    });

    // Warm the prefs cache BEFORE emitting so the presenter's live accessors
    // (getShowBadge / isOnboardingDone, which read cachedPrefs at call time)
    // never observe a null cache on a cold/evicted MV3 service worker (#910
    // cold-SW race). The PROCESS_URL path is safe only because
    // handleProcessUrl() awaits getPrefsWithCache() before calling us — but
    // the BADGE_AND_STATS fire-and-forget path calls updateTabBadge with no
    // prior prefs read. Without this await, a cold SW would emit urlCleaned
    // while cachedPrefs is null, isOnboardingDone() would default to false,
    // and writeBadge() would silently skip the write — the badge would never
    // appear for that clean and only self-heal on the next one.
    await getPrefs();

    bus.emit({ type: "urlCleaned", tabId, paramsRemoved: junkRemoved, total: badgeTotal });
  }

  // Enumerate every tab's DURABLE running badge total from the
  // `tab_badge_{tabId}` session keys. The presenter's in-memory badgeTotals
  // map does NOT survive service-worker eviction, but these session keys do
  // (and so do the browser-rendered per-tab badges). When the showBadge pref
  // flips we pass this authoritative list to the presenter as event.tabs so
  // it can clear/repaint EVERY tab — including tabs whose badge was painted
  // before a restart wiped the in-memory map (#910 OFF-path map blind spot).
  async function collectBadgeTotals() {
    try {
      const all = await sessionStorage.get(null);
      const prefix = "tab_badge_";
      const tabs = [];
      for (const [key, value] of Object.entries(all || {})) {
        if (!key.startsWith(prefix)) continue;
        const tabId = Number(key.slice(prefix.length));
        if (!Number.isFinite(tabId) || tabId < 0) continue;
        tabs.push({ tabId, total: Math.max(0, Number(value) || 0) });
      }
      return tabs;
    } catch {
      return [];
    }
  }

  // Repaints EVERY open tab's active-state on the toolbar (#toolbar-inactive
  // -badge). Called whenever a pref that can flip Active-on-tab changes:
  // prefs.enabled, whitelist/blacklist (allowlist + per-site pause), or
  // onboarding/consent state.
  //
  // Cold-SW-safe by construction, unlike collectBadgeTotals() above: there is
  // no durable/session-storage record of "is this tab active" to rehydrate —
  // the value is always recomputed fresh from the tab's LIVE url (via
  // chrome.tabs.query, which reflects the real open-tab list regardless of
  // service-worker restarts) plus the current prefs. So a restart loses
  // nothing this function needs; there is nothing to lose.
  async function repaintAllTabsActiveState(prefs) {
    if (!prefs?.onboardingDone) return; // the global "!" badge owns the surface; nothing to repaint per-tab
    let tabs;
    try {
      tabs = await new Promise((resolve) => {
        tabsApiResolved.query({}, (r) => { void globalThis.chrome?.runtime?.lastError; resolve(r || []); });
      });
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (typeof tab.id !== "number" || tab.id < 0) continue;
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) continue; // skip non-http(s) tabs (chrome://, extension pages, etc.)
      let hostname;
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        continue; // malformed URL — never throw, just skip this tab (see AGENTS.md new URL() guard)
      }
      bus.emit({
        type: "tabActiveStateChanged",
        tabId: tab.id,
        active: computeTabActiveState(prefs, hostname),
      });
    }
  }

  // Reset the per-PAGE popup preview count and the tooltip on every
  // navigation start. Deliberately does NOT touch `tab_badge_{tabId}` or
  // emit anything badge-related — the toolbar badge is a per-TAB running
  // total that must survive navigation (#910).
  //
  // While onboarding is pending we deliberately skip the toolbar bus emit:
  // the cleaner is gated on onboardingDone, so there is no per-page state to
  // reset in this state, and emitting would still update the tooltip for a
  // tab the user has not consented on. Skipping is safe and matches the
  // pre-#910 behavior.
  async function onTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status !== "loading") return;
    sessionStorage.remove(`tab_${tabId}`);
    let prefs = null;
    try {
      prefs = await getPrefs();
      if (!prefs.onboardingDone) return;
    } catch { /* fall through and emit — toolbar reset is the safer default */ }
    // The browser CLEARS the per-tab badge TEXT on every navigation (MDN
    // action.setBadgeText, `tabId`: "reset when the user navigates this tab to
    // a new page"). Read the DURABLE running total so the presenter can
    // re-paint the badge the browser just wiped — otherwise the count vanishes
    // after any navigation that does not itself trigger a urlCleaned (#910
    // flicker). Cold-SW safe: this session key survives SW eviction even when
    // the presenter's in-memory map does not. Best-effort — on a read failure
    // the presenter falls back to its in-memory total.
    let total = 0;
    try {
      const badgeKey = `tab_badge_${tabId}`;
      const badgeData = await sessionStorage.get({ [badgeKey]: 0 });
      total = Math.max(0, Number(badgeData[badgeKey]) || 0);
    } catch { /* best-effort; presenter falls back to its in-memory total */ }
    bus.emit({ type: "navigationStarted", tabId, total });

    // Recompute the tab's active-state for the NEW page (toolbar-inactive
    // -badge). Emitted AFTER navigationStarted above so the presenter's
    // per-page reset (which repaints the tooltip/badge from the tab's
    // PREVIOUS active flag — see toolbar-presenter.js module doc) is
    // immediately corrected for the new hostname; the gap is at most one JS
    // macrotask within this same handler invocation, not user-observable.
    // Skipped when the prefs fetch above failed (prefs stays null) — best
    // effort, mirrors the fall-through above.
    if (prefs) {
      try {
        if (tab?.url && /^https?:\/\//i.test(tab.url)) {
          const hostname = new URL(tab.url).hostname;
          bus.emit({ type: "tabActiveStateChanged", tabId, active: computeTabActiveState(prefs, hostname) });
        }
        // Non-http(s) tab (chrome://, extension pages, new-tab, etc.): leave
        // the tab's active flag untouched — MUGA never runs there anyway.
      } catch { /* malformed tab.url (new URL() guard) — skip this navigation's recompute */ }
    }
  }

  // Clean up session data when a tab closes. Both the per-page popup
  // counter AND the per-tab badge running total are tab-scoped and must be
  // evicted here — this is the ONLY place the badge total resets (#910).
  function onTabRemoved(tabId) {
    sessionStorage.remove(`tab_${tabId}`);
    sessionStorage.remove(`tab_badge_${tabId}`);
    bus.emit({ type: "tabClosed", tabId });
  }

  return {
    updateTabBadge,
    collectBadgeTotals,
    repaintAllTabsActiveState,
    onTabUpdated,
    onTabRemoved,
  };
}
