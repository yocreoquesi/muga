/**
 * MUGA — toolbar presenter (#358)
 *
 * Verifies the contract: given an event sequence, the presenter writes
 * the right per-tab tooltip and badge state. Tests assert the API calls
 * the presenter would make against a recording stub — not screenshots,
 * not real chrome APIs.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createToolbarEventBus } from "../../src/lib/toolbar-event-bus.js";
import { createTabPresenterState } from "../../src/lib/tab-presenter-state.js";
import {
  createToolbarPresenter,
  badgeColorFor,
  BADGE_COLOR_DEFAULT,
  BADGE_COLOR_PRESERVED,
  BADGE_COLOR_DETECTED,
} from "../../src/lib/toolbar-presenter.js";

function makeRecordingActionApi() {
  const calls = [];
  return {
    calls,
    setBadgeBackgroundColor(arg) { calls.push(["setBadgeBackgroundColor", arg]); },
    setBadgeText(arg)            { calls.push(["setBadgeText", arg]); },
    setTitle(arg)                { calls.push(["setTitle", arg]); },
    setIcon(arg)                 { calls.push(["setIcon", arg]); },
  };
}

const STRINGS = {
  tooltip_default:               "MUGA",
  tooltip_cleaned:               "MUGA — tracking removed",
  tooltip_preserved:             "MUGA — creator referral preserved",
  tooltip_cleaned_and_preserved: "MUGA — tracking removed, creator referral preserved",
};
const t = (key) => STRINGS[key] ?? key;

function setup() {
  const bus = createToolbarEventBus();
  const state = createTabPresenterState();
  const actionApi = makeRecordingActionApi();
  const presenter = createToolbarPresenter({ bus, state, actionApi, t });
  return { bus, state, actionApi, presenter };
}

describe("toolbar-presenter — startup", () => {
  test("sets the default badge background color once at construction", () => {
    const { actionApi } = setup();
    const colorCalls = actionApi.calls.filter(([k]) => k === "setBadgeBackgroundColor");
    assert.equal(colorCalls.length, 1);
    assert.deepEqual(colorCalls[0][1], { color: BADGE_COLOR_DEFAULT });
  });
});

describe("badgeColorFor (#367)", () => {
  test("default state returns the default (blue)", () => {
    assert.equal(badgeColorFor({}), BADGE_COLOR_DEFAULT);
    assert.equal(badgeColorFor({ paramsRemoved: 0 }), BADGE_COLOR_DEFAULT);
  });

  test("cleaned state still uses the default blue", () => {
    assert.equal(badgeColorFor({ paramsRemoved: 5 }), BADGE_COLOR_DEFAULT);
  });

  test("creator referral preserved beats cleaned — green wins", () => {
    assert.equal(
      badgeColorFor({ paramsRemoved: 5, creatorReferralPreserved: true }),
      BADGE_COLOR_PRESERVED
    );
    assert.equal(
      badgeColorFor({ creatorReferralPreserved: true }),
      BADGE_COLOR_PRESERVED
    );
  });

  test("foreign affiliate detected returns yellow", () => {
    assert.equal(
      badgeColorFor({ foreignAffiliateDetected: true }),
      BADGE_COLOR_DETECTED
    );
  });

  test("preserved + detected → preserved (green) wins", () => {
    // The semantic ordering: preserved is the strongest positive signal,
    // wins over detected (which is a passive notice).
    assert.equal(
      badgeColorFor({ creatorReferralPreserved: true, foreignAffiliateDetected: true }),
      BADGE_COLOR_PRESERVED
    );
  });
});

describe("toolbar-presenter — semantic badge color (#367)", () => {
  test("urlCleaned alone keeps badge color at blue", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 3 });
    const colorCalls = actionApi.calls.filter(([k]) => k === "setBadgeBackgroundColor");
    // No change — already blue from startup, no per-tab override needed
    assert.equal(colorCalls.length, 0);
  });

  test("creatorReferralPreserved sets per-tab green", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "creatorReferralPreserved", tabId: 5 });
    const colorCall = actionApi.calls.find(([k]) => k === "setBadgeBackgroundColor");
    assert.deepEqual(colorCall?.[1], { tabId: 5, color: BADGE_COLOR_PRESERVED });
  });

  test("foreignAffiliateDetected sets per-tab yellow", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "foreignAffiliateDetected", tabId: 7 });
    const colorCall = actionApi.calls.find(([k]) => k === "setBadgeBackgroundColor");
    assert.deepEqual(colorCall?.[1], { tabId: 7, color: BADGE_COLOR_DETECTED });
  });

  test("navigationStarted resets per-tab color back to blue", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "creatorReferralPreserved", tabId: 9 });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 9 });
    const colorCall = actionApi.calls.find(([k]) => k === "setBadgeBackgroundColor");
    assert.deepEqual(colorCall?.[1], { tabId: 9, color: BADGE_COLOR_DEFAULT });
  });

  test("idempotent — same color twice does not call setBadgeBackgroundColor again", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "creatorReferralPreserved", tabId: 1 });
    actionApi.calls.length = 0;
    // Re-emitting preserved on the same tab — color is already green, no API call
    bus.emit({ type: "creatorReferralPreserved", tabId: 1 });
    const colorCalls = actionApi.calls.filter(([k]) => k === "setBadgeBackgroundColor");
    assert.equal(colorCalls.length, 0);
  });
});

describe("toolbar-presenter — urlCleaned", () => {
  test("first cleaning sets the badge to count and tooltip to cleaned", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setBadgeText")?.[1],
      { tabId: 7, text: "3" }
    );
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setTitle")?.[1],
      { tabId: 7, title: "MUGA — tracking removed" }
    );
  });

  test("subsequent cleaning accumulates the count", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 3 });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 2 });
    const last = actionApi.calls.filter(([k]) => k === "setBadgeText").pop();
    assert.deepEqual(last?.[1], { tabId: 7, text: "5" });
  });

  test("zero or negative paramsRemoved is a no-op", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0; // discard startup call
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: 0 });
    bus.emit({ type: "urlCleaned", tabId: 7, paramsRemoved: -5 });
    assert.equal(actionApi.calls.length, 0);
  });
});

describe("toolbar-presenter — creatorReferralPreserved", () => {
  test("on a clean tab, sets tooltip to preserved (no badge change)", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "creatorReferralPreserved", tabId: 9 });
    const titleCall = actionApi.calls.find(([k]) => k === "setTitle");
    assert.deepEqual(titleCall?.[1], { tabId: 9, title: "MUGA — creator referral preserved" });
    // No badge text call because paramsRemoved is unchanged at zero
    assert.equal(actionApi.calls.find(([k]) => k === "setBadgeText"), undefined);
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
  test("clears badge text and resets tooltip to default", () => {
    const { bus, state, actionApi } = setup();
    bus.emit({ type: "urlCleaned", tabId: 5, paramsRemoved: 2 });
    bus.emit({ type: "creatorReferralPreserved", tabId: 5 });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 5 });
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setBadgeText")?.[1],
      { tabId: 5, text: "" }
    );
    assert.deepEqual(
      actionApi.calls.find(([k]) => k === "setTitle")?.[1],
      { tabId: 5, title: "MUGA" }
    );
    // State for the tab is reset
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
    // No setBadgeText / setTitle on close — the browser handles tab teardown
    assert.equal(actionApi.calls.find(([k]) => k === "setBadgeText"), undefined);
    assert.equal(actionApi.calls.find(([k]) => k === "setTitle"), undefined);
    // State map no longer holds the tab
    assert.equal(state.size(), 0);
  });

  test("reused tabId does not see stale state", () => {
    const { bus, state } = setup();
    bus.emit({ type: "urlCleaned", tabId: 11, paramsRemoved: 7 });
    bus.emit({ type: "tabClosed", tabId: 11 });
    // Browser reuses tabId 11 for a new tab later
    assert.equal(state.get(11).paramsRemoved, 0);
    assert.equal(state.get(11).creatorReferralPreserved, false);
  });
});

describe("toolbar-presenter — robustness", () => {
  test("ignores events without a valid tabId", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "urlCleaned", paramsRemoved: 2 }); // missing tabId
    bus.emit({ type: "urlCleaned", tabId: -1, paramsRemoved: 2 });
    bus.emit({ type: "urlCleaned", tabId: "x", paramsRemoved: 2 });
    assert.equal(actionApi.calls.length, 0);
  });

  test("ignores unknown event types", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "neverHeardOfIt", tabId: 1 });
    assert.equal(actionApi.calls.length, 0);
  });

  test("does not call setTitle redundantly when state-equivalent updates land", () => {
    const { bus, actionApi } = setup();
    // Two cleanings on the same tab. Tooltip stays at "tracking removed"
    // both times — setTitle should only be called once.
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 1 });
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 1 });
    const titleCalls = actionApi.calls.filter(([k]) => k === "setTitle");
    assert.equal(titleCalls.length, 1);
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

describe("toolbar-presenter — no icon swaps (icon variants retired 2026-05-07)", () => {
  // The wedge cue lives in tooltip + badge color + popup-internal badge.
  // The toolbar-presenter no longer swaps the action icon at all — the
  // on-disk preserved PNGs were byte-identical to the defaults, so the
  // swap was a silent no-op while still emitting setIcon calls that
  // occasionally caused per-tab icon flicker on Firefox. These tests
  // pin the no-call behaviour so it does not regress.

  test("urlCleaned never calls setIcon", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "urlCleaned", tabId: 1, paramsRemoved: 3 });
    const iconCalls = actionApi.calls.filter(([k]) => k === "setIcon");
    assert.equal(iconCalls.length, 0);
  });

  test("creatorReferralPreserved never calls setIcon", () => {
    const { bus, actionApi } = setup();
    actionApi.calls.length = 0;
    bus.emit({ type: "creatorReferralPreserved", tabId: 5 });
    const iconCalls = actionApi.calls.filter(([k]) => k === "setIcon");
    assert.equal(iconCalls.length, 0);
  });

  test("navigationStarted never calls setIcon", () => {
    const { bus, actionApi } = setup();
    bus.emit({ type: "creatorReferralPreserved", tabId: 7 });
    actionApi.calls.length = 0;
    bus.emit({ type: "navigationStarted", tabId: 7 });
    const iconCalls = actionApi.calls.filter(([k]) => k === "setIcon");
    assert.equal(iconCalls.length, 0);
  });
});
