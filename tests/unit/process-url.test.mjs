/**
 * MUGA — Unit tests for src/background/process-url.js (#1266 item 5, slice 6)
 *
 * handleProcessUrl is #1266 item 5's LAST extraction, deliberately: "since it
 * carries the most subtle side-effect ordering." Before this slice it lived
 * in service-worker.js, which makes `chrome.*` calls at module scope and
 * cannot be imported in Node — so every claim about its ordering (stats vs.
 * history, what skipStats/skipSideEffects/skipNotify actually gate, whether
 * a failing collaborator takes the whole clean down) could only ever be
 * pinned by source-text regex against `swSource`, never proven against a
 * running call. This file drives the REAL, imported `handleProcessUrl`.
 *
 * Every ordering assertion below was verified against process-url.js's own
 * source before being written — none is a guess formatted as a test. In
 * particular:
 *
 *   - the toolbar-bus emit ("creatorReferralPreserved") the issue's slice
 *     list names as a collaborator of handleProcessUrl is NOT actually
 *     inside it — it fires in service-worker.js's PROCESS_URL message
 *     handler, in a `.then()` AFTER handleProcessUrl resolves. There is
 *     nothing to test here about its relative order, and no test below
 *     claims one.
 *   - the "detected_foreign" stats/log block (referralsSpotted +
 *     affiliate_detected) is a SEPARATE top-level `if`, not nested inside
 *     the urlChanged/junkRemoved block — so it is gated by
 *     `!skipSideEffects` alone, NOT by `!skipStats && !skipSideEffects`
 *     like the urlsCleaned/junkRemoved bump is.
 *   - the Attribution Ledger push (`pushAttributionAndPersist`) is
 *     fire-and-forget — not awaited — so its own failures can never
 *     propagate out of handleProcessUrl, while `appendHistory`'s ARE
 *     awaited directly with no surrounding try/catch, so a rejection there
 *     propagates all the way out. These are not symmetric, and the tests
 *     below prove both sides rather than assuming one.
 */

import { test, describe, after, mock } from "node:test";
import assert from "node:assert/strict";

// incrementStat (src/lib/storage.js) batches through a real setTimeout(50).
// Faking `setTimeout` GLOBALLY for this whole file — once, not per-test — is
// deliberate: enabling/disabling it around each test leaves a REAL,
// already-armed native timer behind from any test that ran handleProcessUrl
// with skipStats:false while unmocked, and storage.js's own
// `_statsFlushTimer` guard then refuses to arm a NEW (mocked) timer for the
// next test until that stale real one eventually fires on its own — flaky
// by construction. One mocked clock for the entire file avoids that. Every
// `settle()` below deliberately uses `setImmediate`, not `setTimeout`, so it
// keeps working against the REAL event loop regardless.
mock.timers.enable({ apis: ["setTimeout"] });
after(() => mock.timers.reset());

// ── Stub chrome BEFORE importing anything that touches it ──────────────────
// process-url.js itself never touches chrome at true module scope (that is
// the whole point of the factory shape — see its docblock), but the
// REAL incrementStat/getStats (src/lib/storage.js) it imports directly DO
// touch chrome.storage.local when their internal flush timer fires, and the
// ledger subsystem inside the factory calls chrome.storage.local directly
// too. One fake, shared by both, keyed generically so it works for the
// "stats" key (storage.js) and the "attributionLedger" key (the ledger).
function makeFakeLocal(onSet) {
  const data = new Map();
  return {
    get(defaults, cb) {
      const out = {};
      for (const [k, v] of Object.entries(defaults || {})) {
        out[k] = data.has(k) ? data.get(k) : v;
      }
      cb(out);
    },
    set(items, cb) {
      if (onSet) onSet(items);
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      if (cb) cb();
    },
  };
}

globalThis.chrome = { storage: { local: makeFakeLocal() }, runtime: { lastError: null } };

const { createProcessUrl } = await import("../../src/background/process-url.js");
const { getStats } = await import("../../src/lib/storage.js");

// ── Test harness ─────────────────────────────────────────────────────────

function makePrefs(overrides = {}) {
  return {
    enabled: true,
    onboardingDone: true,
    devMode: false,
    domainStats: false,
    attributionLedgerEnabled: true,
    notifyForeignAffiliate: false,
    ...overrides,
  };
}

// A URL the real cleaner (src/lib/cleaner.js, driven with empty domain/path
// rule arrays) strips via its GLOBAL tracking-param table, independent of
// any rule file — so tests need no rule fixtures.
const DIRTY_URL = "https://example.com/?utm_source=newsletter";
const CLEAN_URL = "https://example.com/";

/**
 * @param {object} opts
 * @param {() => Promise<object>} [opts.getPrefsImpl]
 * @param {(...args: any[]) => Promise<void>} [opts.appendHistoryImpl]
 * @param {(items: object) => void} [opts.onLocalSet] - observes every chrome.storage.local.set call.
 */
function makeHarness({ getPrefsImpl, appendHistoryImpl, onLocalSet } = {}) {
  const order = [];
  globalThis.chrome = {
    storage: {
      local: makeFakeLocal((items) => {
        if (onLocalSet) onLocalSet(items);
        if ("attributionLedger" in items) order.push("ledgerPersist");
      }),
    },
    runtime: { lastError: null },
  };

  const domainRulesLoader = { ensure: async () => { order.push("domainRulesLoader.ensure"); } };
  const pathRulesLoader = { ensure: async () => { order.push("pathRulesLoader.ensure"); } };
  const firstUsedBootstrap = { ensure: async () => { order.push("firstUsedBootstrap.ensure"); } };
  const getPrefs = getPrefsImpl || (async () => { order.push("getPrefs"); return makePrefs(); });
  const appendHistory = appendHistoryImpl || (async () => { order.push("appendHistory"); });

  const { handleProcessUrl } = createProcessUrl({
    domainRulesLoader,
    pathRulesLoader,
    firstUsedBootstrap,
    getPrefs,
    getDomainRules: () => [],
    getPathStripRules: () => [],
    getPathAffiliateRules: () => [],
    frequencyTracker: null,
    appendHistory,
  });

  return { handleProcessUrl, order };
}

// Lets any fire-and-forget microtask chain (the ledger push) settle before
// a test inspects `order`, AND drains storage.js's incrementStat batch timer
// (mocked globally in this file — see top) so a pending increment from THIS
// test can never leak into the next test's fresh chrome.storage.local fake.
// Every test that calls handleProcessUrl calls this afterward for exactly
// that reason, whether or not it itself cares about stats.
async function settle() {
  mock.timers.tick(60);
  await new Promise((resolve) => setImmediate(resolve));
}

describe("handleProcessUrl — guard clauses run before any collaborator", () => {
  test("a non-http URL returns untouched and calls NOTHING", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const result = await handleProcessUrl("not-a-url", {});
    await settle();
    assert.equal(result.action, "untouched");
    assert.equal(result.cleanUrl, "not-a-url");
    assert.deepEqual(order, [], "no loader, no prefs read, no side effect for a non-http URL");
  });

  test("empty string returns untouched and calls NOTHING", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const result = await handleProcessUrl("", {});
    await settle();
    assert.equal(result.action, "untouched");
    assert.deepEqual(order, []);
  });
});

describe("handleProcessUrl — prefs gate (rules load and prefs are read before the gate)", () => {
  test("prefs.enabled === false: loaders + prefs run, nothing else does", async () => {
    const { handleProcessUrl, order } = makeHarness({
      getPrefsImpl: async () => { order.push("getPrefs"); return makePrefs({ enabled: false }); },
    });
    const result = await handleProcessUrl(DIRTY_URL, {});
    await settle();
    assert.equal(result.action, "untouched");
    assert.equal(order.length, 3, `expected exactly loaders+prefs, got ${JSON.stringify(order)}`);
    assert.ok(order.includes("domainRulesLoader.ensure"));
    assert.ok(order.includes("pathRulesLoader.ensure"));
    assert.ok(order.includes("getPrefs"));
    assert.ok(!order.includes("firstUsedBootstrap.ensure"), "the cleaner never runs when disabled");
    assert.ok(!order.includes("appendHistory"));
    assert.ok(!order.includes("ledgerPersist"));
  });

  test("prefs.onboardingDone === false: same shape as the disabled gate", async () => {
    const { handleProcessUrl, order } = makeHarness({
      getPrefsImpl: async () => { order.push("getPrefs"); return makePrefs({ onboardingDone: false }); },
    });
    const result = await handleProcessUrl(DIRTY_URL, {});
    await settle();
    assert.equal(result.action, "untouched");
    assert.ok(!order.includes("firstUsedBootstrap.ensure"));
    assert.ok(!order.includes("appendHistory"));
    assert.ok(!order.includes("ledgerPersist"));
  });
});

describe("handleProcessUrl — the documented order holds for a real clean", () => {
  test("loaders -> prefs -> firstUsedBootstrap -> appendHistory -> ledger persist", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const result = await handleProcessUrl(DIRTY_URL, {});
    await settle();

    assert.equal(result.action, "cleaned");
    assert.equal(result.cleanUrl, CLEAN_URL);
    assert.equal(result.junkRemoved, 1);

    const idx = (name) => order.indexOf(name);
    assert.ok(idx("domainRulesLoader.ensure") !== -1);
    assert.ok(idx("pathRulesLoader.ensure") !== -1);
    assert.ok(idx("getPrefs") > idx("domainRulesLoader.ensure"),
      "getPrefs must wait for the domain-rules loader (Promise.all)");
    assert.ok(idx("getPrefs") > idx("pathRulesLoader.ensure"),
      "getPrefs must wait for the path-rules loader (Promise.all)");
    assert.ok(idx("firstUsedBootstrap.ensure") > idx("getPrefs"),
      "firstUsedBootstrap.ensure runs after prefs, after the cleaner call");
    assert.ok(idx("appendHistory") > idx("firstUsedBootstrap.ensure"),
      "appendHistory runs after the firstUsed bootstrap");
    assert.ok(idx("ledgerPersist") > idx("appendHistory"),
      "the ledger push is sequenced (in source order) after appendHistory, even though it is not awaited");
  });

  test("the 'cleaned' branch and the ledger push both attempt regardless of prefs.domainStats", async () => {
    const { handleProcessUrl, order } = makeHarness({
      getPrefsImpl: async () => { order.push("getPrefs"); return makePrefs({ domainStats: true }); },
    });
    await handleProcessUrl(DIRTY_URL, {});
    await settle();
    assert.ok(order.includes("appendHistory"));
    assert.ok(order.includes("ledgerPersist"));
  });
});

describe("handleProcessUrl — skipStats gates ONLY the stat counters", () => {
  test("skipStats:true suppresses the stat increment but not history or the ledger", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const before = await getStats();

    await handleProcessUrl(DIRTY_URL, { skipStats: true });
    await settle();

    const after = await getStats();
    assert.equal(after.stats.urlsCleaned, before.stats.urlsCleaned || 0,
      "skipStats:true must not increment urlsCleaned");
    assert.ok(order.includes("appendHistory"), "history is NOT gated by skipStats");
    assert.ok(order.includes("ledgerPersist"), "the ledger push is NOT gated by skipStats");
  });

  test("skipStats:false (default) DOES increment the stat counter", async () => {
    const { handleProcessUrl } = makeHarness();
    const before = await getStats();

    await handleProcessUrl(DIRTY_URL, {});
    await settle();

    const after = await getStats();
    assert.equal(after.stats.urlsCleaned, (before.stats.urlsCleaned || 0) + 1);
  });
});

describe("handleProcessUrl — skipSideEffects gates stats, history, logging AND the ledger", () => {
  test("skipSideEffects:true suppresses everything storage-facing but still cleans the URL", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const before = await getStats();

    const result = await handleProcessUrl(DIRTY_URL, { skipSideEffects: true });
    await settle();
    assert.equal(result.action, "cleaned", "the cleaner itself still runs and reports the real result");
    assert.equal(result.cleanUrl, CLEAN_URL);

    const after = await getStats();
    assert.equal(after.stats.urlsCleaned, before.stats.urlsCleaned || 0, "no stat increment");
    assert.ok(!order.includes("appendHistory"), "no history write");
    assert.ok(!order.includes("ledgerPersist"), "no ledger push");
    // The rule loaders and prefs read still happen — skipSideEffects is not
    // a short-circuit, it only gates the write-side blocks further down.
    assert.ok(order.includes("domainRulesLoader.ensure"));
    assert.ok(order.includes("firstUsedBootstrap.ensure"));
  });
});

describe("handleProcessUrl — skipNotify changes what the cleaner sees, not what gets persisted", () => {
  test("skipNotify:true still writes history and pushes the ledger for an ordinary clean", async () => {
    const { handleProcessUrl, order } = makeHarness();
    const result = await handleProcessUrl(DIRTY_URL, { skipNotify: true });
    await settle();
    assert.equal(result.action, "cleaned");
    assert.ok(order.includes("appendHistory"), "skipNotify must not gate history — only skipSideEffects does");
    assert.ok(order.includes("ledgerPersist"), "skipNotify must not gate the ledger push — only skipSideEffects does");
  });
});

describe("handleProcessUrl — a failing appendHistory propagates and skips the ledger, but the queued stat survives", () => {
  test("appendHistory rejecting makes handleProcessUrl reject too", async () => {
    const { handleProcessUrl, order } = makeHarness({
      appendHistoryImpl: async () => { order.push("appendHistory"); throw new Error("storage full"); },
    });
    await assert.rejects(() => handleProcessUrl(DIRTY_URL, {}), /storage full/);
    await settle();
    assert.ok(!order.includes("ledgerPersist"),
      "the ledger push is sequenced after appendHistory in source order, so a throw there never reaches it");
  });

  test("the urlsCleaned increment queued before the throw is NOT rolled back", async () => {
    const { handleProcessUrl } = makeHarness({
      appendHistoryImpl: async () => { throw new Error("storage full"); },
    });
    const before = await getStats();

    await assert.rejects(() => handleProcessUrl(DIRTY_URL, {}));
    await settle();

    const after = await getStats();
    assert.equal(after.stats.urlsCleaned, (before.stats.urlsCleaned || 0) + 1,
      "incrementStat runs synchronously BEFORE the appendHistory await, so it is already queued when the throw happens");
  });
});

describe("handleProcessUrl — a failing ledger write does not take the clean down (fire-and-forget)", () => {
  test("chrome.storage.local.set throwing on the ledger write still resolves handleProcessUrl normally", async () => {
    const { handleProcessUrl, order } = makeHarness({
      onLocalSet: (items) => {
        if ("attributionLedger" in items) throw new Error("disk full");
      },
    });
    const result = await handleProcessUrl(DIRTY_URL, {});
    await settle();
    assert.equal(result.action, "cleaned", "pushAttributionAndPersist is fire-and-forget; its failure cannot affect the return");
    assert.equal(result.cleanUrl, CLEAN_URL);
    assert.ok(order.includes("appendHistory"), "history still wrote successfully");
  });
});

describe("handleProcessUrl — a failing prefs read propagates before any write-side collaborator runs", () => {
  test("getPrefs rejecting: loaders already ran, nothing downstream does", async () => {
    const { handleProcessUrl, order } = makeHarness({
      getPrefsImpl: async () => { order.push("getPrefs-attempt"); throw new Error("prefs unavailable"); },
    });
    await assert.rejects(() => handleProcessUrl(DIRTY_URL, {}), /prefs unavailable/);
    await settle();
    assert.ok(order.includes("domainRulesLoader.ensure"));
    assert.ok(order.includes("pathRulesLoader.ensure"));
    assert.ok(!order.includes("firstUsedBootstrap.ensure"));
    assert.ok(!order.includes("appendHistory"));
    assert.ok(!order.includes("ledgerPersist"));
  });
});
