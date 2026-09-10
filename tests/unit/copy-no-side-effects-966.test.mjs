/**
 * MUGA — #966: copy actions must not mutate stats, session history, or the
 * attribution ledger.
 *
 * Before this fix the popup History copy affordances reprocessed the entry via
 * PROCESS_URL with only `skipNotify: true`. In handleProcessUrl, `skipStats`
 * gated ONLY incrementStat; appendHistory and pushAttributionAndPersist ran
 * unconditionally. So copying an already-counted URL inflated "URLs cleaned",
 * prepended a DUPLICATE session-history row (evicting real entries from the
 * 10-item buffer), and pushed a duplicate ledger event.
 *
 * The fix threads a `skipSideEffects` flag end-to-end: the popup sets it, the
 * PROCESS_URL handler forwards it, and handleProcessUrl gates ALL side effects
 * (stats, domain stats, history, cleaned/passthrough/affiliate logging, and the
 * ledger push) behind it — while still computing the clean URL for the response.
 *
 * service-worker.js and popup.js are browser-only (top-level chrome.*), so the
 * popup-wiring and PROCESS_URL-forwarding checks below still pin the wiring via
 * source inspection (the established pattern for this module — see
 * sw-robustness-833.test.mjs, popup-copy-safe-history.test.mjs).
 *
 * handleProcessUrl itself moved to src/background/process-url.js (#1266 item 5,
 * slice 6) and is Node-importable now — the five gating checks that used to be
 * `SW_SOURCE` regex matches against handleProcessUrl's body are migrated below
 * to real behavioral assertions against the actual function (see
 * tests/unit/process-url.test.mjs for the fuller ordering suite; this file
 * keeps the #966-specific regression scenario in one place).
 */

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const SW_SOURCE = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");
const POPUP_SOURCE = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
const require = createRequire(import.meta.url);
// Real domain rules — needed for a genuine "detected_foreign" result. The
// global tracking-param table alone (used by DIRTY_URL below) never produces
// that action; only a domain-specific affiliate pattern match does.
const REAL_DOMAIN_RULES = require("../../src/rules/domain-rules.json");
const AFFILIATE_URL = "https://www.amazon.es/dp/B08N5WRWNW?tag=creator-21";

function makeFakeLocal() {
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
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      if (cb) cb();
    },
  };
}

globalThis.chrome = { storage: { local: makeFakeLocal() }, runtime: { lastError: null } };

const { createProcessUrl } = await import("../../src/background/process-url.js");
const { getStats } = await import("../../src/lib/storage.js");

const DIRTY_URL = "https://example.com/?utm_source=newsletter";

function makeHarness({ domainRules = [], prefsOverrides = {} } = {}) {
  const calls = { appendHistory: 0, ledgerPersist: 0 };
  const localData = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        get(defaults, cb) {
          const out = {};
          for (const [k, v] of Object.entries(defaults || {})) {
            out[k] = localData.has(k) ? localData.get(k) : v;
          }
          cb(out);
        },
        set(items, cb) {
          for (const [k, v] of Object.entries(items)) localData.set(k, v);
          if ("attributionLedger" in items) calls.ledgerPersist++;
          if (cb) cb();
        },
      },
    },
    runtime: { lastError: null },
  };
  const { handleProcessUrl } = createProcessUrl({
    domainRulesLoader: { ensure: async () => {} },
    pathRulesLoader: { ensure: async () => {} },
    firstUsedBootstrap: { ensure: async () => {} },
    getPrefs: async () => ({
      enabled: true, onboardingDone: true, devMode: false,
      attributionLedgerEnabled: true, notifyForeignAffiliate: true,
      ...prefsOverrides,
    }),
    getDomainRules: () => domainRules,
    getPathStripRules: () => [],
    getPathAffiliateRules: () => [],
    frequencyTracker: null,
    appendHistory: async () => { calls.appendHistory++; },
  });
  return { handleProcessUrl, calls };
}

describe("#966 — copy-safe reprocessing skips all side effects", () => {

  test("popup sends skipSideEffects:true on the copy-safe PROCESS_URL", () => {
    assert.ok(
      /type:\s*"PROCESS_URL"[^}]*skipSideEffects:\s*true/.test(POPUP_SOURCE),
      "getCopySafeCleanUrl must send skipSideEffects:true",
    );
  });

  test("PROCESS_URL handler forwards message.skipSideEffects", () => {
    assert.ok(
      /handleProcessUrl\(message\.url,\s*\{[^}]*skipSideEffects:\s*!!message\.skipSideEffects/.test(SW_SOURCE),
      "the PROCESS_URL message handler must thread skipSideEffects through",
    );
  });

  test("skipSideEffects:true suppresses the stat increment (real handleProcessUrl)", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { handleProcessUrl } = makeHarness();
      const before = await getStats();
      await handleProcessUrl(DIRTY_URL, { skipNotify: true, skipStats: true, skipSideEffects: true });
      mock.timers.tick(60);
      await new Promise((r) => setImmediate(r));
      const after = await getStats();
      assert.equal(after.stats.urlsCleaned, before.stats.urlsCleaned || 0,
        "urlsCleaned/junkRemoved must not be bumped on a copy-safe reprocess");
    } finally {
      mock.timers.reset();
    }
  });

  test("skipSideEffects:true suppresses appendHistory (real handleProcessUrl)", async () => {
    const { handleProcessUrl, calls } = makeHarness();
    await handleProcessUrl(DIRTY_URL, { skipNotify: true, skipStats: true, skipSideEffects: true });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.appendHistory, 0, "appendHistory must not run on a copy-safe reprocess");
  });

  test("skipSideEffects:true suppresses the attribution ledger push (real handleProcessUrl)", async () => {
    const { handleProcessUrl, calls } = makeHarness();
    await handleProcessUrl(DIRTY_URL, { skipNotify: true, skipStats: true, skipSideEffects: true });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.ledgerPersist, 0, "the ledger must not be written on a copy-safe reprocess");
  });

  test("referralsSpotted is not bumped on a copy of a real detected_foreign URL", async () => {
    // Real domain-rules.json + a genuine affiliate tag, so this actually
    // reaches the detected_foreign branch — not a stand-in for it.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { handleProcessUrl } = makeHarness({ domainRules: REAL_DOMAIN_RULES });
      const before = await getStats();
      // skipStats:false on purpose: referralsSpotted's gate in the source is
      // `if (!skipSideEffects)` alone — a SEPARATE top-level block from the
      // urlsCleaned/junkRemoved block, which additionally checks !skipStats.
      // Leaving skipStats off here is what proves skipSideEffects gates this
      // one by itself, not the skipStats+skipSideEffects combination.
      const result = await handleProcessUrl(AFFILIATE_URL, { skipStats: false, skipSideEffects: true });
      mock.timers.tick(60);
      await new Promise((r) => setImmediate(r));
      assert.equal(result.action, "detected_foreign", "fixture sanity check — must actually hit the branch under test");
      const after = await getStats();
      assert.equal(after.stats.referralsSpotted || 0, before.stats.referralsSpotted || 0,
        "referralsSpotted must stay gated by skipSideEffects alone, matching the source's separate top-level `if`",
      );
    } finally {
      mock.timers.reset();
    }
  });

  test("contrast: the SAME detected_foreign URL DOES bump referralsSpotted without skipSideEffects", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { handleProcessUrl } = makeHarness({ domainRules: REAL_DOMAIN_RULES });
      const before = await getStats();
      const result = await handleProcessUrl(AFFILIATE_URL, {});
      mock.timers.tick(60);
      await new Promise((r) => setImmediate(r));
      assert.equal(result.action, "detected_foreign");
      const after = await getStats();
      assert.equal(after.stats.referralsSpotted, (before.stats.referralsSpotted || 0) + 1,
        "a normal (non-copy) navigation to the same URL must bump referralsSpotted — proves the prior test's 0 was the gate, not a fixture that never fires",
      );
    } finally {
      mock.timers.reset();
    }
  });

  test("the selection-copy product behavior is unchanged (still counts once)", () => {
    // Out of scope for #966: copying a text selection of URLs still tallies one
    // cleaned event. Guard against an accidental regression that silences it.
    assert.ok(
      /if \(anyChanged\) incrementStat\("urlsCleaned"\)/.test(SW_SOURCE),
      "selection-copy must keep its single incrementStat(urlsCleaned)",
    );
  });
});
