/**
 * MUGA — toolbar presenter
 *
 * Verifies the contract: given an event sequence, the presenter writes
 * the right per-tab tooltip AND the right per-tab badge text. Tests
 * assert the API calls the presenter would make against a recording
 * stub — not screenshots, not real chrome APIs.
 *
 * Icon-variant swapping stays removed (the setIcon swap caused a
 * flash-and-disappear regression in Firefox MV2 — see f6a6e2b). The
 * badge (#910) is re-introduced as a NATIVE browser badge overlay
 * (setBadgeText only) on top of the single static manifest icon —
 * never a re-rendered/composited icon.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createToolbarEventBus } from "../../src/lib/toolbar-event-bus.js";
import { createTabPresenterState } from "../../src/lib/tab-presenter-state.js";
import {
  createToolbarPresenter,
  INACTIVE_GLYPH,
  INACTIVE_BADGE_COLOR,
  DEFAULT_BADGE_COLOR,
} from "../../src/lib/toolbar-presenter.js";

function makeRecordingActionApi() {
  const calls = [];
  return {
    calls,
    setTitle(arg) { calls.push(["setTitle", arg]); },
    setBadgeText(arg) { calls.push(["setBadgeText", arg]); },
    setBadgeBackgroundColor(arg) { calls.push(["setBadgeBackgroundColor", arg]); },
  };
}

const STRINGS = {
  tooltip_default:               "MUGA",
  tooltip_cleaned:               "MUGA — tracking removed",
  tooltip_preserved:             "MUGA — creator referral preserved",
  tooltip_cleaned_and_preserved: "MUGA — tracking removed, creator referral preserved",
  tooltip_inactive:              "MUGA: off on this site",
};
const t = (key) => STRINGS[key] ?? key;

/**
 * @param {{ showBadge?: boolean, onboardingDone?: boolean }} [opts]
 * @returns {object} test rig, plus setShowBadge/setOnboardingDone mutators
 *   so tests can flip the live pref/consent state mid-sequence (mirrors how
 *   the SW's cachedPrefs-backed accessors behave in production).
 */
function setup({ showBadge = true, onboardingDone = true } = {}) {
  const bus = createToolbarEventBus();
  const state = createTabPresenterState();
  const actionApi = makeRecordingActionApi();
  let _showBadge = showBadge;
  let _onboardingDone = onboardingDone;
  const presenter = createToolbarPresenter({
    bus,
    state,
    actionApi,
    t,
    getShowBadge: () => _showBadge,
    isOnboardingDone: () => _onboardingDone,
  });
  return {
    bus, state, actionApi, presenter,
    setShowBadge: (v) => { _showBadge = v; },
    setOnboardingDone: (v) => { _onboardingDone = v; },
  };
}

function badgeCallsFor(actionApi, tabId) {
  return actionApi.calls.filter(([k, arg]) => k === "setBadgeText" && arg.tabId === tabId);
}

function bgColorCallsFor(actionApi, tabId) {
  return actionApi.calls.filter(([k, arg]) => k === "setBadgeBackgroundColor" && arg.tabId === tabId);
}

function titleCallsFor(actionApi, tabId) {
  return actionApi.calls.filter(([k, arg]) => k === "setTitle" && arg.tabId === tabId);
}

describe("toolbar-presenter — startup", () => {
  test("does not write to the action surface at construction", () => {
    const { actionApi } = setup();
    assert.equal(actionApi.calls.length, 0);
  });
});

describe("toolbar-presenter — urlCleaned", () => {
  test("first cleaning sets tooltip to cleaned", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setTitle")?.[1],
      { tabId: 7, title: "MUGA — tracking removed" }
    );
  });

  test("zero or negative paramsRemoved is a no-op", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 0 });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: -5 });
    assert.equal(actionApi.calls.length, 0);
  });
});

describe("toolbar-presenter — creatorReferralPreserved", () => {
  test("on a clean tab, sets tooltip to preserved", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "creatorReferralPreserved", tabId: 9 });
    const titleCall = actionApi.calls.find(([k]) => k === "setTitle");
    assert.deepEqual(titleCall?.[1], { tabId: 9, title: "MUGA — creator referral preserved" });
  });

  test("after a cleaning event, sets tooltip to combined", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 9, paramsRemoved: 4 });
    actionApi.calls.length = 0;
    bus.emit({ type: "creatorReferralPreserved", tabId: 9 });
    const titleCall = actionApi.calls.find(([k]) => k === "setTitle");
    assert.deepEqual(
      titleCall?.[1],
      { tabId: 9, title: "MUGA — tracking removed, creator referral preserved" }
    );
  });
});

describe("toolbar-presenter — navigationStarted", () => {
  test("resets tooltip to default and clears tab state", () => {
    const { bus, state, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 5, paramsRemoved: 2 });
    bus.emit({ type: "creatorReferralPreserved", tabId: 5 });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 5 });
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setTitle")?.[1],
      { tabId: 5, title: "MUGA" }
    );
    assert.equal(state.get(5).paramsRemoved, 0);
    assert.equal(state.get(5).creatorReferralPreserved, false);
  });
});

describe("toolbar-presenter — tabClosed", () => {
  test("evicts the tab from state without writing to the action surface", () => {
    const { bus, state, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 3, paramsRemoved: 1 });
    actionApi.calls.length = 0;
    bus.emit({ type: "tabClosed", tabId: 3 });
    assert.equal(actionApi.calls.find(([k]) => k === "setTitle"), undefined);
    assert.equal(state.size(), 0);
  });

  test("reused tabId does not see stale state", () => {
    const { bus, state } = setup();
    bus.emit({ type: "urlCleaned", tabId: 11, paramsRemoved: 7 });
    bus.emit({ type: "tabClosed", tabId: 11 });
    assert.equal(state.get(11).paramsRemoved, 0);
    assert.equal(state.get(11).creatorReferralPreserved, false);
  });
});

describe("toolbar-presenter — badge (#910)", () => {
  test("does not write a badge at construction", () => {
    const { actionApi } = setup();
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("first cleaning writes the count as native badge text", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)[1], { tabId: 7, text: "3" });
  });

  test("accumulates across multiple urlCleaned events on the same tab", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)[1], { tabId: 7, text: "5" });
  });

  test("uses the caller-supplied running total when present (survives SW restarts)", () => {
    // updateTabBadge() in the SW persists the running total in
    // chrome.storage.session and passes it as event.total so the badge
    // stays correct even if the presenter's in-memory map was reset by a
    // service-worker restart mid-tab-lifetime.
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2, total: 99 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)[1], { tabId: 7, text: "99" });
  });

  test("accumulates across navigationStarted — badge total survives in-tab navigation (including SPA)", () => {
    const { bus, actionApi, state } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    bus.emit({ type: "navigationStarted", tabId: 7 });
    // The per-page tooltip state resets on navigation...
    assert.equal(state.get(7).paramsRemoved, 0);
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2 });
    // ...but the badge total does not: it's the tab's running total.
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)[1], { tabId: 7, text: "5" });
  });

  test("per-tab isolation: two tabs accumulate independently", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 3 });
    bus.emit({ type: "urlCleaned", tabId: 2, paramsRemoved: 9 });
    assert.deepEqual(badgeCallsFor(actionApi, 1).at(-1)[1], { tabId: 1, text: "3" });
    assert.deepEqual(badgeCallsFor(actionApi, 2).at(-1)[1], { tabId: 2, text: "9" });
  });

  test("navigationStarted RE-PAINTS the badge — the browser clears per-tab badge text on navigation (#950 flicker)", () => {
    // The browser resets the per-tab badge on every navigation (MDN
    // action.setBadgeText tabId). navigationStarted must re-write the running
    // total so the count does not vanish after a navigation that produces no
    // urlCleaned of its own. Without the re-paint the badge stays blank until
    // the next clean — the flicker the user reported.
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 4 });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 7 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "4" });
  });

  test("navigationStarted re-paints from the caller-supplied durable total when the in-memory map was wiped (cold SW)", () => {
    // Mirrors production: the SW passes event.total (read from the durable
    // tab_badge_{tabId} session key). After a service-worker restart the
    // in-memory map is empty, so the durable total is the only source.
    const { bus, actionApi, presenter } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 4 });
    presenter._resetInMemoryTotals();
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 7, total: 4 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "4" });
  });

  test("navigationStarted does NOT paint a per-tab badge for a fresh tab that has cleaned nothing", () => {
    // A fresh tab has no running total, so re-painting must not create a
    // per-tab override (which would mask the global badge and violate the
    // "no digit on a fresh tab" contract).
    const { bus, actionApi } = setup();
    bus.emit({ type: "navigationStarted", tabId: 7 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("navigationStarted re-paint respects showBadge OFF (no badge written)", () => {
    const { bus, actionApi } = setup({ showBadge: false });
    bus.emit({ type: "navigationStarted", tabId: 7, total: 5 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("navigationStarted re-paint is gated on onboarding (must not mask the global \"!\" badge)", () => {
    const { bus, actionApi } = setup({ onboardingDone: false });
    bus.emit({ type: "navigationStarted", tabId: 7, total: 5 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("tabClosed resets the running total; reused tabId starts fresh", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 5, paramsRemoved: 8 });
    bus.emit({ type: "tabClosed", tabId: 5 });
    actionApi.calls.length = 0;
    bus.emit({ type: "urlCleaned", tabId: 5, paramsRemoved: 1 });
    assert.deepEqual(badgeCallsFor(actionApi, 5).at(-1)[1], { tabId: 5, text: "1" });
  });

  test("zero or negative paramsRemoved does not write a badge", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 0 });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: -3 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("no digit is shown for a fresh tab (no per-tab override ever written)", () => {
    const { actionApi } = setup();
    assert.equal(badgeCallsFor(actionApi, 42).length, 0);
  });
});

describe("toolbar-presenter — badge + onboarding precedence (#910)", () => {
  test("badge is not written while onboarding is incomplete — the global \"!\" badge must win", () => {
    const { bus, actionApi } = setup({ onboardingDone: false });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("the tooltip is unaffected by onboarding state — only the badge is gated", () => {
    const { bus, actionApi } = setup({ onboardingDone: false });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.ok(actionApi.calls.find(([k]) => k === "setTitle"));
  });

  test("badge resumes once onboarding completes; the tracked total is preserved meanwhile", () => {
    const { bus, actionApi, setOnboardingDone } = setup({ onboardingDone: false });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    setOnboardingDone(true);
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)[1], { tabId: 7, text: "5" });
  });
});

describe("toolbar-presenter — showBadge pref (#910)", () => {
  test("badge is not written while showBadge is off", () => {
    const { bus, actionApi } = setup({ showBadge: false });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
  });

  test("showBadgePrefChanged(false) clears the badge on every tracked tab", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 4 });
    bus.emit({ type: "urlCleaned", tabId: 2, paramsRemoved: 6 });
    actionApi.calls.length = 0;
    bus.emit({ type: "showBadgePrefChanged", value: false });
    assert.deepEqual(badgeCallsFor(actionApi, 1).at(-1)[1], { tabId: 1, text: "" });
    assert.deepEqual(badgeCallsFor(actionApi, 2).at(-1)[1], { tabId: 2, text: "" });
  });

  test("showBadgePrefChanged(true) repaints the accumulated totals", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 4 });
    bus.emit({ type: "showBadgePrefChanged", value: false });
    actionApi.calls.length = 0;
    bus.emit({ type: "showBadgePrefChanged", value: true });
    assert.deepEqual(badgeCallsFor(actionApi, 1).at(-1)[1], { tabId: 1, text: "4" });
  });

  test("further urlCleaned events stop updating the badge once showBadge is off", () => {
    const { bus, actionApi, setShowBadge } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 4 });
    setShowBadge(false);
    bus.emit({ type: "showBadgePrefChanged", value: false });
    actionApi.calls.length = 0;
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 10 });
    assert.equal(badgeCallsFor(actionApi, 1).length, 0);
  });

  test("showBadgePrefChanged(false) clears badges from the DURABLE tab list even when the in-memory map is empty (SW-restart map blind spot #910)", () => {
    // A fresh presenter after a service-worker restart: no urlCleaned has
    // been replayed, so badgeTotals is empty — yet the browser still shows
    // per-tab badges and the durable tab_badge_* session keys survive. The
    // SW enumerates those keys and passes them as event.tabs. The OFF toggle
    // MUST clear every one, not just whatever happens to be in memory.
    const { bus, actionApi } = setup();
    bus.emit({
      type: "showBadgePrefChanged",
      value: false,
      tabs: [{ tabId: 1, total: 4 }, { tabId: 2, total: 6 }],
    });
    assert.deepEqual(badgeCallsFor(actionApi, 1).at(-1)?.[1], { tabId: 1, text: "" });
    assert.deepEqual(badgeCallsFor(actionApi, 2).at(-1)?.[1], { tabId: 2, text: "" });
  });

  test("showBadgePrefChanged(true) repaints from the DURABLE tab list when the in-memory map is empty", () => {
    const { bus, actionApi } = setup();
    bus.emit({
      type: "showBadgePrefChanged",
      value: true,
      tabs: [{ tabId: 3, total: 7 }],
    });
    assert.deepEqual(badgeCallsFor(actionApi, 3).at(-1)?.[1], { tabId: 3, text: "7" });
  });

  test("showBadgePrefChanged merges the durable tab list with the in-memory map (union of both is cleared)", () => {
    const { bus, actionApi } = setup();
    // tab 1 is tracked in-memory; tab 2 exists only in the durable list.
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 4 });
    actionApi.calls.length = 0;
    bus.emit({
      type: "showBadgePrefChanged",
      value: false,
      tabs: [{ tabId: 2, total: 6 }],
    });
    assert.deepEqual(badgeCallsFor(actionApi, 1).at(-1)?.[1], { tabId: 1, text: "" });
    assert.deepEqual(badgeCallsFor(actionApi, 2).at(-1)?.[1], { tabId: 2, text: "" });
  });

  test("showBadgePrefChanged does not touch the action surface while onboarding is incomplete (does not disturb the \"!\" badge)", () => {
    const { bus, actionApi, setOnboardingDone } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 4 });
    setOnboardingDone(false);
    actionApi.calls.length = 0;
    bus.emit({ type: "showBadgePrefChanged", value: false });
    assert.equal(actionApi.calls.length, 0);
  });
});

describe("toolbar-presenter — robustness", () => {
  test("ignores events without a valid tabId", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", paramsRemoved: 2 });
    bus.emit({ type: "urlCleaned", tabId: -1, paramsRemoved: 2 });
    bus.emit({ type: "urlCleaned", tabId: "x", paramsRemoved: 2 });
    assert.equal(actionApi.calls.length, 0);
  });

  test("ignores unknown event types", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "neverHeardOfIt", tabId: 1 });
    assert.equal(actionApi.calls.length, 0);
  });

  test("does not call setTitle redundantly when state-equivalent updates land", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 1 });
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 1 });
    const titleCalls = actionApi.calls.filter(([k]) => k === "setTitle");
    assert.equal(titleCalls.length, 1);
  });
});

// ── Inactive badge precedence (toolbar-inactive-badge) ──────────────────────
//
// A tab is INACTIVE when MUGA is globally disabled or the tab's site is
// fully exempt. The service worker recomputes this on navigation commit and
// on prefs changes and tells the presenter via `tabActiveStateChanged`.
// Precedence (highest first): onboarding-incomplete > showBadge-off >
// inactive-glyph > active-count.
describe("toolbar-presenter — inactive badge precedence", () => {
  test("exports INACTIVE_GLYPH, INACTIVE_BADGE_COLOR, and DEFAULT_BADGE_COLOR as named constants", () => {
    assert.equal(typeof INACTIVE_GLYPH, "string");
    assert.ok(INACTIVE_GLYPH.length > 0);
    assert.equal(typeof INACTIVE_BADGE_COLOR, "string");
    assert.equal(typeof DEFAULT_BADGE_COLOR, "string");
    assert.notEqual(INACTIVE_BADGE_COLOR, DEFAULT_BADGE_COLOR);
  });

  test("tabActiveStateChanged(active:false) shows the inactive glyph on a grey background", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: INACTIVE_GLYPH });
    assert.deepEqual(bgColorCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, color: INACTIVE_BADGE_COLOR });
  });

  test("inactive glyph takes precedence over a historical count — even after urlCleaned events", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 5 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "5" });

    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: INACTIVE_GLYPH });

    // A further clean on an inactive tab must NOT bring the count back —
    // the glyph still wins, even though the running total keeps accumulating
    // internally (it will resurface once the tab becomes active again).
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: INACTIVE_GLYPH });
  });

  test("active tab shows the count with the default badge background", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: true });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 4 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "4" });
    assert.deepEqual(bgColorCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, color: DEFAULT_BADGE_COLOR });
  });

  test("showBadge OFF shows nothing at all, even when the tab is inactive (no glyph, no count)", () => {
    const { bus, actionApi } = setup({ showBadge: false });
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
    assert.equal(bgColorCallsFor(actionApi, 7).length, 0);
  });

  test("onboarding incomplete writes no per-tab badge, even when the tab is inactive", () => {
    const { bus, actionApi } = setup({ onboardingDone: false });
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.equal(badgeCallsFor(actionApi, 7).length, 0);
    assert.equal(bgColorCallsFor(actionApi, 7).length, 0);
  });

  test("navigationStarted repaints the inactive glyph even for a tab with a zero running total", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 7 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: INACTIVE_GLYPH });
  });

  test("active -> inactive -> active repaints correctly (count, then glyph, then count again)", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "3" });

    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: INACTIVE_GLYPH });

    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: true });
    assert.deepEqual(badgeCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, text: "3" });
  });

  test("tooltip switches to tooltip_inactive when the tab becomes inactive", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.deepEqual(titleCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, title: "MUGA — tracking removed" });

    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.deepEqual(titleCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, title: "MUGA: off on this site" });
  });

  test("tooltip returns to the page-state tooltip once the tab becomes active again", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: true });
    assert.deepEqual(titleCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, title: "MUGA — tracking removed" });
  });

  test("inactive tooltip survives navigationStarted's per-page reset (does not bounce back to default)", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 7 });
    assert.deepEqual(titleCallsFor(actionApi, 7).at(-1)?.[1], { tabId: 7, title: "MUGA: off on this site" });
  });

  test("tabClosed evicts the active-state flag; a reused tabId starts fresh (active by default)", () => {
    const { bus, actionApi, presenter } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 7, active: false });
    assert.equal(presenter._isTabActive(7), false);
    bus.emit({ type: "tabClosed", tabId: 7 });
    assert.equal(presenter._isTabActive(7), true);
  });

  test("a tab never told otherwise defaults to active (no glyph without an explicit inactive signal)", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 42, paramsRemoved: 1 });
    assert.deepEqual(badgeCallsFor(actionApi, 42).at(-1)?.[1], { tabId: 42, text: "1" });
  });

  test("showBadgePrefChanged(true) repaint respects the inactive glyph over the durable total", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "tabActiveStateChanged", tabId: 3, active: false });
    actionApi.calls.length = 0;
    bus.emit({ type: "showBadgePrefChanged", value: true, tabs: [{ tabId: 3, total: 7 }] });
    assert.deepEqual(badgeCallsFor(actionApi, 3).at(-1)?.[1], { tabId: 3, text: INACTIVE_GLYPH });
    assert.deepEqual(bgColorCallsFor(actionApi, 3).at(-1)?.[1], { tabId: 3, color: INACTIVE_BADGE_COLOR });
  });
});

describe("toolbar-event-bus", () => {
  test("subscribers receive events", () => {
    const bus = createToolbarEventBus();
    const events = [];
    bus.subscribe(e => events.push(e));
    bus.emit({ type: "ping" });
    assert.deepEqual(events, [{ type: "ping" }]);
  });

  test("unsubscribe stops further delivery", () => {
    const bus = createToolbarEventBus();
    const events = [];
    const unsub = bus.subscribe(e => events.push(e));
    bus.emit({ type: "a" });
    unsub();
    bus.emit({ type: "b" });
    assert.deepEqual(events, [{ type: "a" }]);
  });

  test("a throwing listener does not break delivery to others", () => {
    const bus = createToolbarEventBus();
    const events = [];
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe(e => events.push(e));
    bus.emit({ type: "ok" });
    assert.deepEqual(events, [{ type: "ok" }]);
  });
});

describe("tab-presenter-state", () => {
  test("get on unknown tab returns empty record", () => {
    const state = createTabPresenterState();
    const s = state.get(42);
    assert.equal(s.paramsRemoved, 0);
    assert.equal(s.creatorReferralPreserved, false);
    assert.equal(s.foreignAffiliateDetected, false);
  });

  test("update accumulates paramsRemoved", () => {
    const state = createTabPresenterState();
    state.update(1, { paramsRemoved: 3 });
    state.update(1, { paramsRemoved: 2 });
    assert.equal(state.get(1).paramsRemoved, 5);
  });

  test("update sets boolean flags monotonically", () => {
    const state = createTabPresenterState();
    state.update(1, { creatorReferralPreserved: true });
    assert.equal(state.get(1).creatorReferralPreserved, true);
  });

  test("reset clears state for a tab", () => {
    const state = createTabPresenterState();
    state.update(1, { paramsRemoved: 5, creatorReferralPreserved: true });
    state.reset(1);
    assert.equal(state.get(1).paramsRemoved, 0);
    assert.equal(state.get(1).creatorReferralPreserved, false);
  });

  test("evict removes the tab from the map", () => {
    const state = createTabPresenterState();
    state.update(1, { paramsRemoved: 5 });
    state.update(2, { paramsRemoved: 5 });
    state.evict(1);
    assert.equal(state.size(), 1);
    assert.equal(state.get(1).paramsRemoved, 0);
  });
});
