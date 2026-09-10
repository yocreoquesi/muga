/**
 * MUGA — Service-worker integration: Attribution Ledger persistence (#460, A2).
 *
 * The popup needs the ledger to survive service-worker restarts so users
 * see their last navigations even after Chrome aggressively kills the SW.
 * The SW therefore writes the ledger to `chrome.storage.local` under the
 * `attributionLedger` key after every `processUrl()` return.
 *
 * The SW itself is too big to import in a unit test — it pulls in the
 * whole cleaner pipeline, DNR setup, message routing, etc. Instead we
 * pin down two boundaries:
 *
 *   1. The presenter + storage round-trip: pushEvent → write → re-read →
 *      presentLedger → renderEntries works as a flow over a fake
 *      chrome.storage.local. This is what the popup will exercise on
 *      open after the SW has done its work.
 *
 *   2. process-url.js (src/background/process-url.js, #1266 item 5 slice 6)
 *      actually persists an event to chrome.storage.local after a clean,
 *      and actually honors the attributionLedgerEnabled privacy gate — a
 *      real, running proof now that the writer lives in an importable
 *      module, replacing what used to be a structural readFileSync scan of
 *      service-worker.js (which the ledger writer moved out of in full).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createLedger,
  pushEvent,
  presentLedger,
  fromCleanerResult,
  DEFAULT_LEDGER_CAPACITY,
} from "../../src/lib/attribution-ledger.js";
import { renderEntries } from "../../src/lib/attribution-ledger-view.js";

// Tiny in-memory chrome.storage.local stand-in. The SW production code
// uses chrome.storage.local.set / get with a default object; the same
// shape works here.
function makeFakeLocal() {
  const data = new Map();
  return {
    get(defaults) {
      const out = {};
      for (const [k, v] of Object.entries(defaults || {})) {
        out[k] = data.has(k) ? data.get(k) : v;
      }
      return Promise.resolve(out);
    },
    set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      return Promise.resolve();
    },
    _data: data,
  };
}

describe("ledger persistence — chrome.storage.local round-trip", () => {
  test("write → read → present → render preserves order and shape", async () => {
    const local = makeFakeLocal();
    let ledger = createLedger();

    // Simulate three SW pushes (cleaner returned three results).
    ledger = pushEvent(ledger, fromCleanerResult("https://a.example/?utm=1", { action: "cleaned", removedTracking: ["utm"], junkRemoved: 1 }));
    ledger = pushEvent(ledger, fromCleanerResult("https://shop.example/?tag=alice", { action: "detected_foreign", detectedAffiliate: { pattern: { group: "amazon", name: "amazon" } } }));
    ledger = pushEvent(ledger, fromCleanerResult("https://go.skim/?id=42", { action: "honored-creator", network: "skimlinks", creator: "youtube.com/@LTT" }));

    await local.set({ attributionLedger: ledger });

    // SW dies. Popup opens.
    const { attributionLedger } = await local.get({
      attributionLedger: { events: [], capacity: DEFAULT_LEDGER_CAPACITY },
    });

    assert.equal(attributionLedger.events.length, 3, "3 events round-tripped");
    const view = presentLedger(attributionLedger);
    const i18n = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
    const rows = renderEntries(view, i18n);
    assert.equal(rows.length, 3, "3 rows rendered after re-read");
    assert.equal(rows[0].badgeText, "ledger_badge_cleaned");
    assert.match(rows[1].badgeText, /ledger_badge_preserve_affiliate/);
    assert.match(rows[2].badgeText, /ledger_badge_honor_creator/);
    assert.match(rows[2].creatorCreditText, /ledger_creator_credit_template/);
  });

  test("popup default for empty/unset ledger is rendered as zero rows", async () => {
    const local = makeFakeLocal();
    const { attributionLedger } = await local.get({
      attributionLedger: { events: [], capacity: DEFAULT_LEDGER_CAPACITY },
    });
    const view = presentLedger(attributionLedger);
    const rows = renderEntries(view, (k) => k);
    assert.equal(rows.length, 0, "no rows rendered when ledger is empty");
  });

  test("ring buffer caps storage growth across many pushes", async () => {
    const local = makeFakeLocal();
    let ledger = createLedger(); // capacity 10
    for (let i = 0; i < 25; i++) {
      ledger = pushEvent(ledger, { type: "navigate", url: `https://e.example/${i}` });
      await local.set({ attributionLedger: ledger });
    }
    const { attributionLedger } = await local.get({ attributionLedger: { events: [], capacity: 10 } });
    assert.equal(attributionLedger.events.length, 10, "ring buffer enforced post-write");
    assert.equal(attributionLedger.events[0].url, "https://e.example/15", "oldest evicted");
    assert.equal(attributionLedger.events[9].url, "https://e.example/24", "newest preserved");
  });
});

describe("the ledger writer, and where it actually lives now", () => {
  // The ledger subsystem (creation, cold-start hydration, and
  // pushAttributionAndPersist) moved to src/background/process-url.js in
  // full (#1266 item 5, slice 6) — nothing outside handleProcessUrl ever
  // touched the in-memory `_attributionLedger`, so it had no reason to stay
  // behind. process-url.js is Node-importable, so the three checks that used
  // to structurally scan service-worker.js's source are replaced with a
  // real, running proof that createProcessUrl actually persists an event and
  // actually honors the privacy gate — the SW-source checks would have kept
  // "passing" for the wrong reason (or silently stopped proving anything)
  // once the writer moved, since they only assert substring presence.

  test("process-url.js persists an attribution event to chrome.storage.local after a clean", async () => {
    let seenSet = false;
    globalThis.chrome = {
      storage: { local: { get(d, cb) { cb({ ...d }); }, set(items, cb) { if ("attributionLedger" in items) seenSet = true; if (cb) cb(); } } },
      runtime: { lastError: null },
    };
    const { createProcessUrl } = await import("../../src/background/process-url.js");
    const { handleProcessUrl } = createProcessUrl({
      domainRulesLoader: { ensure: async () => {} },
      pathRulesLoader: { ensure: async () => {} },
      firstUsedBootstrap: { ensure: async () => {} },
      getPrefs: async () => ({ enabled: true, onboardingDone: true, attributionLedgerEnabled: true }),
      getDomainRules: () => [],
      getPathStripRules: () => [],
      getPathAffiliateRules: () => [],
      frequencyTracker: null,
      appendHistory: async () => {},
    });
    await handleProcessUrl("https://example.com/?utm_source=x", {});
    await new Promise((r) => setImmediate(r));
    assert.ok(seenSet, "handleProcessUrl must persist attributionLedger via chrome.storage.local.set");
  });

  test("process-url.js gates the ledger writer on attributionLedgerEnabled: false", async () => {
    let seenSet = false;
    globalThis.chrome = {
      storage: { local: { get(d, cb) { cb({ ...d }); }, set(items, cb) { if ("attributionLedger" in items) seenSet = true; if (cb) cb(); } } },
      runtime: { lastError: null },
    };
    const { createProcessUrl } = await import("../../src/background/process-url.js");
    const { handleProcessUrl } = createProcessUrl({
      domainRulesLoader: { ensure: async () => {} },
      pathRulesLoader: { ensure: async () => {} },
      firstUsedBootstrap: { ensure: async () => {} },
      getPrefs: async () => ({ enabled: true, onboardingDone: true, attributionLedgerEnabled: false }),
      getDomainRules: () => [],
      getPathStripRules: () => [],
      getPathAffiliateRules: () => [],
      frequencyTracker: null,
      appendHistory: async () => {},
    });
    await handleProcessUrl("https://example.com/?utm_source=x", {});
    await new Promise((r) => setImmediate(r));
    assert.equal(seenSet, false, "attributionLedgerEnabled:false must suppress the storage write entirely");
  });
});
