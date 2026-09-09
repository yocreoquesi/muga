/**
 * MUGA — Unit tests for src/background/dnr-sync.js (#1266 item 5, #1268)
 *
 * dnr-sync.js is the extraction #1268 calls the highest-value slice: the DNR
 * sync helpers used to live in service-worker.js, which cannot be imported
 * in Node because it makes `chrome.*` calls at module scope. So none of the
 * assertions below could previously be written at all — the best the suite
 * could do was a hand-written mirror (tests/unit/custom-params-dnr.test.mjs)
 * or a source-text scrape (tests/unit/allowlist-dnr.test.mjs), neither of
 * which can prove something actually ran at runtime, only that a string is
 * present in the source.
 *
 * This file exercises the REAL, imported functions and proves runtime
 * behavior a mirror or a source scrape structurally cannot reach:
 *
 *   - the #1257 item 5 consent-withdrawal guarantee: applyDnrState's
 *     gate-closed branch actually clears every dynamic rule ID MUGA owns,
 *     not just the ones a step's own source text mentions;
 *   - hasDNR() false makes every sync*DNR function a true no-op — nothing
 *     touches the (absent) chrome.declarativeNetRequest at all;
 *   - loadStaticTrackingRules() caches after the first read, so a
 *     service-worker lifetime with many wakes does not re-fetch the bundled
 *     ruleset on every one;
 *   - syncCategoryFilteredDNR()'s _categoryMirrorKey short-circuit actually
 *     skips the write when prefs have not changed, not just that the source
 *     contains an early-return.
 */

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as DNR_IDS from "../../src/lib/dnr-ids.js";
import { ownedDynamicRanges } from "../../src/background/dnr-teardown.js";

// ── Stub chrome + fetch BEFORE importing dnr-sync.js ─────────────────────────

function makeFakeDnr() {
  const calls = [];
  return {
    calls,
    updateDynamicRules(opts) {
      calls.push(structuredClone(opts));
      return Promise.resolve();
    },
  };
}

let fakeDnr;
let fetchCalls;
let dnrSync;

const BASE_MANIFEST = { manifest_version: 3, declarative_net_request: { rule_resources: [] } };

function installChromeStub() {
  globalThis.chrome = {
    declarativeNetRequest: {
      updateDynamicRules: (opts) => fakeDnr.updateDynamicRules(opts),
      updateEnabledRulesets: () => Promise.resolve(),
      getDynamicRules: () => Promise.resolve([]),
    },
    runtime: {
      getManifest: () => BASE_MANIFEST,
      getURL: (p) => "file://" + p,
    },
  };
}

before(async () => {
  installChromeStub();
  globalThis.fetch = (...args) => {
    fetchCalls.push(args);
    return Promise.resolve({ json: () => Promise.resolve([]) });
  };
  dnrSync = await import("../../src/background/dnr-sync.js");
});

beforeEach(() => {
  fakeDnr = makeFakeDnr();
  fetchCalls = [];
  installChromeStub();
});

// ── hasDNR() false: every sync*DNR is a true no-op ───────────────────────────

describe("hasDNR() false — every sync*DNR touches nothing", () => {
  beforeEach(() => {
    // Simulate an environment without declarativeNetRequest (Firefox Android,
    // or any browser lacking the API) rather than removing chrome entirely —
    // applyDnrState's own hasDNR() check is what must stop it, not a crash
    // from a missing chrome.runtime.
    globalThis.chrome.declarativeNetRequest = undefined;
  });

  test("hasDNR() itself reports false", () => {
    assert.strictEqual(dnrSync.hasDNR(), false);
  });

  test("syncCustomParamsDNR is a no-op", async () => {
    await dnrSync.syncCustomParamsDNR(["tracked"]);
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("syncAllowlistDNR is a no-op", async () => {
    await dnrSync.syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("syncCategoryFilteredDNR is a no-op (and never fetches the static ruleset)", async () => {
    await dnrSync.syncCategoryFilteredDNR({ disabledCategories: ["ads"] });
    assert.strictEqual(fakeDnr.calls.length, 0);
    assert.strictEqual(fetchCalls.length, 0, "must not read the static ruleset when DNR is unavailable");
  });

  test("syncSuppressRefererDNR is a no-op", async () => {
    await dnrSync.syncSuppressRefererDNR({ suppressReferer: true });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("syncBlockBeaconsDNR is a no-op", async () => {
    await dnrSync.syncBlockBeaconsDNR({ blockBeacons: true });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("syncBlocklistRefererDNR is a no-op", async () => {
    await dnrSync.syncBlocklistRefererDNR({ blacklist: ["blocked.com"] });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("syncBlocklistBeaconsDNR is a no-op", async () => {
    await dnrSync.syncBlocklistBeaconsDNR({ blacklist: ["blocked.com"] });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("reconcileRemoteDnrRule is a no-op", async () => {
    await dnrSync.reconcileRemoteDnrRule({ remoteRulesEnabled: true });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });

  test("applyDnrState is a no-op regardless of gate state", async () => {
    await dnrSync.applyDnrState({ enabled: true, dnrEnabled: true, onboardingDone: true });
    await dnrSync.applyDnrState({ enabled: false, dnrEnabled: true, onboardingDone: true });
    assert.strictEqual(fakeDnr.calls.length, 0);
  });
});

// ── #1257 item 5: gate-closed tears down EVERY owned range ──────────────────

describe("applyDnrState — gate-closed branch clears every dynamic rule ID MUGA owns", () => {
  test("every id in every ownedDynamicRanges() range is cleared via removeRuleIds", async () => {
    await dnrSync.applyDnrState({
      enabled: false, // gate closed
      dnrEnabled: true,
      onboardingDone: true,
      whitelist: ["example.com"],
      blacklist: ["blocked.com"],
      remoteRulesEnabled: false,
    });

    const removedIds = new Set();
    for (const call of fakeDnr.calls) {
      for (const id of call.removeRuleIds ?? []) removedIds.add(id);
    }

    const ranges = ownedDynamicRanges(DNR_IDS);
    assert.ok(ranges.length >= 9, "sanity check: dnr-ids.js should declare at least 9 owned ranges");

    const uncovered = [];
    for (const [start, end] of ranges) {
      for (let id = start; id <= end; id++) {
        if (!removedIds.has(id)) uncovered.push(id);
      }
    }
    assert.deepEqual(
      uncovered,
      [],
      `gate-closed teardown left ${uncovered.length} MUGA-owned id(s) uncleared: ${uncovered.slice(0, 20).join(", ")}${uncovered.length > 20 ? "…" : ""}`,
    );
  });

  test("readback failure (getDynamicRules throws) is reported, not silently treated as clean", async () => {
    globalThis.chrome.declarativeNetRequest.getDynamicRules = () => Promise.reject(new Error("boom"));
    const originalError = console.error;
    const errorCalls = [];
    console.error = (...args) => { errorCalls.push(args); };
    try {
      await dnrSync.applyDnrState({ enabled: false, dnrEnabled: true, onboardingDone: true });
    } finally {
      console.error = originalError;
    }
    assert.ok(
      errorCalls.some((args) => String(args[0] ?? "").includes("could not read back")),
      "an unverifiable teardown must be reported, not treated as success",
    );
  });
});

// ── loadStaticTrackingRules(): caches after the first read ──────────────────

describe("loadStaticTrackingRules — caches for the module lifetime", () => {
  test("a second call does not re-fetch", async () => {
    const first = await dnrSync.loadStaticTrackingRules();
    const callsAfterFirst = fetchCalls.length;
    assert.strictEqual(callsAfterFirst, 1, "the first call must read the bundled ruleset");

    const second = await dnrSync.loadStaticTrackingRules();
    assert.strictEqual(fetchCalls.length, callsAfterFirst, "a second call must not fetch again");
    assert.strictEqual(second, first, "the cached array instance must be returned, not a fresh parse");
  });
});

// ── syncCategoryFilteredDNR(): _categoryMirrorKey short-circuit ─────────────

describe("syncCategoryFilteredDNR — unchanged prefs do not re-register", () => {
  // _categoryMirrorKey is module-level state that persists across tests in
  // this file (a fresh service-worker lifetime is one module instance too),
  // so each test below uses a key value no other test in this file uses —
  // that keeps each assertion correct regardless of what ran before it,
  // the same way a real service worker's history before this call is
  // unknown to it.

  test("two consecutive calls with the same disabledCategories set write only once", async () => {
    await dnrSync.syncCategoryFilteredDNR({ disabledCategories: ["mirror-key-test-a"] });
    const callsAfterFirst = fakeDnr.calls.length;
    assert.strictEqual(callsAfterFirst, 1, "the first sync for a new key must write");

    // A fresh array with equal content, not the same reference — the guard
    // must compare by VALUE (the sorted, joined key), not by identity.
    await dnrSync.syncCategoryFilteredDNR({ disabledCategories: ["mirror-key-test-a"] });
    assert.strictEqual(
      fakeDnr.calls.length,
      callsAfterFirst,
      "an identical disabledCategories set must not trigger another updateDynamicRules call",
    );
  });

  test("a different disabledCategories set DOES write again", async () => {
    await dnrSync.syncCategoryFilteredDNR({ disabledCategories: ["mirror-key-test-b"] });
    const callsAfterFirst = fakeDnr.calls.length;
    assert.strictEqual(callsAfterFirst, 1, "the first sync for this key must write");

    await dnrSync.syncCategoryFilteredDNR({ disabledCategories: ["mirror-key-test-b", "mirror-key-test-c"] });
    assert.ok(
      fakeDnr.calls.length > callsAfterFirst,
      "a changed disabledCategories set must trigger a fresh write",
    );
  });
});
