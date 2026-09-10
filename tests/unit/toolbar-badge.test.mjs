/**
 * MUGA — Unit tests for src/background/toolbar-badge.js (#1266 item 2, item 5)
 *
 * This is the cold-start repaint test #1266 item 2 asks for. Before this
 * slice, updateTabBadge/collectBadgeTotals/computeTabActiveState/
 * repaintAllTabsActiveState and the chrome.tabs.onUpdated/onRemoved bodies
 * lived in service-worker.js, which cannot be imported in Node (top-level
 * chrome.* calls) — so the defect and its fix could only be described in a
 * comment, never proven against real code.
 *
 * The defect (#1266 item 2): src/lib/toolbar-presenter.js's `activeStates`
 * map is in-memory only, unlike its durably-backed sibling `badgeTotals`.
 * After an MV3 restart the map is empty, and isTabInactive() defaults to
 * active for every tab — including one whose hostname is fully exempt and
 * should read as inactive. `repaintAllTabsActiveState` is the only thing
 * that recomputes it for already-open tabs; the fix wiring it into
 * onStartup/onInstalled landed in PR #1292, but nothing proved it worked.
 *
 * Below: a FRESH real createToolbarPresenter (empty activeStates — the
 * exact post-restart shape) plus a FRESH real createToolbarBadge, wired to
 * the same bus. First the gap is demonstrated (no repaint => every tab
 * reads active, even the exempt one). Then repaintAllTabsActiveState is
 * called and the presenter's view is shown to be corrected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createToolbarEventBus } from "../../src/lib/toolbar-event-bus.js";
import { createTabPresenterState } from "../../src/lib/tab-presenter-state.js";
import { createToolbarPresenter } from "../../src/lib/toolbar-presenter.js";
import { createToolbarBadge, computeTabActiveState } from "../../src/background/toolbar-badge.js";

function makeRecordingActionApi() {
  return {
    calls: [],
    setTitle() {},
    setBadgeText() {},
    setBadgeBackgroundColor() {},
  };
}

/**
 * Builds a fresh presenter + toolbar-badge pair wired to the same bus —
 * exactly the composition service-worker.js wires in production, minus the
 * chrome.* plumbing. `presenter`'s activeStates map starts empty, matching
 * a cold MV3 restart.
 */
function setup() {
  const bus = createToolbarEventBus();
  const emitted = [];
  bus.subscribe((e) => emitted.push(e));

  const state = createTabPresenterState();
  const presenter = createToolbarPresenter({
    bus,
    state,
    actionApi: makeRecordingActionApi(),
    t: (key) => key,
    getShowBadge: () => true,
    isOnboardingDone: () => true,
  });

  const sessionStore = {};
  const sessionStorage = {
    get: async (query) => {
      const result = {};
      if (query === null || query === undefined) return { ...sessionStore };
      for (const [k, def] of Object.entries(query)) {
        result[k] = Object.prototype.hasOwnProperty.call(sessionStore, k) ? sessionStore[k] : def;
      }
      return result;
    },
    set: async (items) => { Object.assign(sessionStore, items); },
    remove: async (keys) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete sessionStore[k];
    },
  };

  const removedKeys = [];
  const trackingSessionStorage = {
    ...sessionStorage,
    remove: async (keys) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      removedKeys.push(...ks);
      return sessionStorage.remove(keys);
    },
  };

  return { bus, emitted, state, presenter, sessionStore, sessionStorage: trackingSessionStorage, removedKeys };
}

function makeTabsApi(tabs) {
  const calls = [];
  return {
    calls,
    query: (queryInfo, cb) => { calls.push(queryInfo); cb(tabs); },
  };
}

const BASE_PREFS = { enabled: true, onboardingDone: true, whitelist: [], blacklist: [] };
const EXEMPT_PREFS = { ...BASE_PREFS, whitelist: ["exempt.example"] };

describe("toolbar-badge — cold-start repaint (#1266 item 2)", () => {
  test("PROVES THE GAP: with no repaint, every tab (including a fully-exempt one) reads active", () => {
    const { presenter } = setup();
    // Fresh presenter, fresh activeStates map — exactly the post-MV3-restart
    // shape. Nothing has repainted yet.
    assert.equal(presenter._isTabActive(1), true, "an unclassified tab defaults to active");
    assert.equal(
      presenter._isTabActive(2), true,
      "a tab on a fully-exempt hostname STILL reads active before any repaint — this is the #1266 item 2 defect",
    );
  });

  test("FIXES THE GAP: repaintAllTabsActiveState corrects every open http(s) tab", async () => {
    const { bus, presenter, sessionStorage } = setup();
    const tabsApi = makeTabsApi([
      { id: 1, url: "https://active.example/page" },
      { id: 2, url: "https://exempt.example/page" }, // whitelist-exempt => inactive
    ]);
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => EXEMPT_PREFS, sessionStorage, tabsApi,
    });

    await toolbarBadge.repaintAllTabsActiveState(EXEMPT_PREFS);

    assert.equal(presenter._isTabActive(1), true, "an active tab must read active after repaint");
    assert.equal(presenter._isTabActive(2), false, "the exempt tab must read inactive after repaint — the fix");
  });
});

describe("toolbar-badge — repaintAllTabsActiveState: documented skips", () => {
  test("skips non-http(s) tabs (chrome://, extension pages, etc.)", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const tabsApi = makeTabsApi([
      { id: 1, url: "chrome://extensions" },
      { id: 2, url: "https://example.com/" },
    ]);
    const toolbarBadge = createToolbarBadge({ bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi });

    await toolbarBadge.repaintAllTabsActiveState(BASE_PREFS);

    const changed = emitted.filter((e) => e.type === "tabActiveStateChanged").map((e) => e.tabId);
    assert.deepStrictEqual(changed, [2], "only the http(s) tab should get a tabActiveStateChanged");
  });

  test("skips a tab with a malformed url", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const tabsApi = makeTabsApi([
      { id: 1, url: "not a valid url" },
      { id: 2, url: "https://example.com/" },
    ]);
    const toolbarBadge = createToolbarBadge({ bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi });

    await toolbarBadge.repaintAllTabsActiveState(BASE_PREFS);

    const changed = emitted.filter((e) => e.type === "tabActiveStateChanged").map((e) => e.tabId);
    assert.deepStrictEqual(changed, [2], "the malformed-url tab must never throw and must be skipped");
  });

  test("skips a tab with a missing id", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const tabsApi = makeTabsApi([
      { url: "https://example.com/" }, // no id
      { id: 2, url: "https://example.com/" },
    ]);
    const toolbarBadge = createToolbarBadge({ bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi });

    await toolbarBadge.repaintAllTabsActiveState(BASE_PREFS);

    const changed = emitted.filter((e) => e.type === "tabActiveStateChanged").map((e) => e.tabId);
    assert.deepStrictEqual(changed, [2]);
  });

  test("skips a tab with a negative id", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const tabsApi = makeTabsApi([
      { id: -1, url: "https://example.com/" },
      { id: 2, url: "https://example.com/" },
    ]);
    const toolbarBadge = createToolbarBadge({ bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi });

    await toolbarBadge.repaintAllTabsActiveState(BASE_PREFS);

    const changed = emitted.filter((e) => e.type === "tabActiveStateChanged").map((e) => e.tabId);
    assert.deepStrictEqual(changed, [2]);
  });

  test("!prefs.onboardingDone: returns immediately without querying tabs or emitting", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const tabsApi = makeTabsApi([{ id: 1, url: "https://example.com/" }]);
    const toolbarBadge = createToolbarBadge({ bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi });

    await toolbarBadge.repaintAllTabsActiveState({ ...BASE_PREFS, onboardingDone: false });

    assert.deepStrictEqual(tabsApi.calls, [], "chrome.tabs.query must never be called before onboarding is done");
    assert.deepStrictEqual(emitted, []);
  });
});

describe("toolbar-badge — onTabRemoved: evicts both session keys", () => {
  test("removes tab_{id} AND tab_badge_{id}, and emits tabClosed", () => {
    const { bus, emitted, sessionStorage, removedKeys } = setup();
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi: makeTabsApi([]),
    });

    toolbarBadge.onTabRemoved(42);

    assert.deepStrictEqual(removedKeys.sort(), ["tab_42", "tab_badge_42"].sort());
    assert.deepStrictEqual(emitted, [{ type: "tabClosed", tabId: 42 }]);
  });
});

describe("toolbar-badge — onTabUpdated: durable total + emit ordering", () => {
  test("reads the durable tab_badge_{id} total and emits navigationStarted BEFORE tabActiveStateChanged", async () => {
    const { bus, emitted, sessionStorage } = setup();
    await sessionStorage.set({ tab_badge_5: 7 });
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(5, { status: "loading" }, { url: "https://example.com/" });

    assert.deepStrictEqual(
      emitted.map((e) => e.type),
      ["navigationStarted", "tabActiveStateChanged"],
      "navigationStarted must be emitted before tabActiveStateChanged — the presenter's per-page reset must not clobber the freshly-recomputed active flag",
    );
    assert.equal(emitted[0].total, 7, "navigationStarted must carry the durable running total");
    assert.equal(emitted[1].active, true);
  });

  test("resets the per-page tab_{id} key on every navigation start", async () => {
    const { bus, sessionStorage, removedKeys } = setup();
    await sessionStorage.set({ tab_9: 3 });
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(9, { status: "loading" }, { url: "https://example.com/" });

    assert.ok(removedKeys.includes("tab_9"), "the per-page popup counter must reset on navigation start");
  });

  test("ignores updates that are not a navigation start (changeInfo.status !== 'loading')", async () => {
    const { bus, emitted, sessionStorage, removedKeys } = setup();
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(5, { status: "complete" }, { url: "https://example.com/" });

    assert.deepStrictEqual(emitted, []);
    assert.deepStrictEqual(removedKeys, []);
  });

  test("!prefs.onboardingDone: resets the per-page key but emits nothing", async () => {
    const { bus, emitted, sessionStorage, removedKeys } = setup();
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => ({ ...BASE_PREFS, onboardingDone: false }), sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(5, { status: "loading" }, { url: "https://example.com/" });

    assert.ok(removedKeys.includes("tab_5"));
    assert.deepStrictEqual(emitted, []);
  });

  test("a getPrefs() failure still emits navigationStarted (the safer default) but skips the active-state recompute", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => { throw new Error("cold SW"); }, sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(5, { status: "loading" }, { url: "https://example.com/" });

    assert.deepStrictEqual(emitted.map((e) => e.type), ["navigationStarted"]);
  });

  test("a non-http(s) tab url is left untouched (no tabActiveStateChanged emitted)", async () => {
    const { bus, emitted, sessionStorage } = setup();
    const toolbarBadge = createToolbarBadge({
      bus, getPrefs: async () => BASE_PREFS, sessionStorage, tabsApi: makeTabsApi([]),
    });

    await toolbarBadge.onTabUpdated(5, { status: "loading" }, { url: "chrome://newtab" });

    assert.deepStrictEqual(emitted.map((e) => e.type), ["navigationStarted"]);
  });
});

describe("computeTabActiveState — the real, exported formula", () => {
  test("active when enabled + onboarded + not exempt", () => {
    assert.equal(computeTabActiveState(BASE_PREFS, "example.com"), true);
  });

  test("inactive when globally disabled", () => {
    assert.equal(computeTabActiveState({ ...BASE_PREFS, enabled: false }, "example.com"), false);
  });

  test("inactive when onboarding is not done", () => {
    assert.equal(computeTabActiveState({ ...BASE_PREFS, onboardingDone: false }, "example.com"), false);
  });

  test("inactive when the site is fully exempt (domain-only whitelist entry)", () => {
    assert.equal(computeTabActiveState(EXEMPT_PREFS, "exempt.example"), false);
  });

  test("fail-safe: missing/malformed prefs never grants an exemption", () => {
    assert.equal(computeTabActiveState(null, "example.com"), false);
    assert.equal(computeTabActiveState(undefined, "example.com"), false);
  });
});
