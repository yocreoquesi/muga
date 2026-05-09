/**
 * MUGA — toolbar presenter
 *
 * Verifies the contract: given an event sequence, the presenter writes
 * the right per-tab tooltip. Tests assert the API calls the presenter
 * would make against a recording stub — not screenshots, not real
 * chrome APIs.
 *
 * Badge text/color and icon variant surfaces were removed (the icon
 * swap caused a flash-and-disappear regression in Firefox MV2 and the
 * per-tab counter was confusing). The tooltip is the only dynamic
 * surface the presenter currently writes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createToolbarEventBus } from "../../src/lib/toolbar-event-bus.js";
import { createTabPresenterState } from "../../src/lib/tab-presenter-state.js";
import { createToolbarPresenter } from "../../src/lib/toolbar-presenter.js";

function makeRecordingActionApi() {
  const calls = [];
  return {
    calls,
    setTitle(arg) { calls.push(["setTitle", arg]); },
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
