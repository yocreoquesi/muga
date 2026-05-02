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
 *   2. The service-worker source contains the call site that pushes
 *      attribution events into chrome.storage.local. A structural
 *      readFileSync test catches the regression where someone removes
 *      the writer and the ledger silently stops accumulating.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

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

describe("service-worker source carries the ledger writer", () => {
  test("service-worker.js imports the attribution-ledger module", () => {
    const src = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");
    assert.ok(
      /from\s+"\.\.\/lib\/attribution-ledger\.js"/.test(src),
      "service-worker.js must import from attribution-ledger.js",
    );
  });

  test("service-worker.js writes attributionLedger to chrome.storage.local", () => {
    const src = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");
    assert.ok(
      /attributionLedger/.test(src),
      "service-worker.js must reference attributionLedger (writes to chrome.storage.local)",
    );
    // The writer must call chrome.storage.local.set somewhere — guard against
    // accidental drop-through to a different storage area.
    assert.ok(
      /chrome\.storage\.local\.set\([^)]*attributionLedger/.test(src) ||
        /attributionLedger[^]{0,200}chrome\.storage\.local\.set/.test(src),
      "service-worker.js must persist the ledger via chrome.storage.local.set",
    );
  });

  test("service-worker.js gates the ledger writer on attributionLedgerEnabled pref", () => {
    const src = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");
    assert.ok(
      /attributionLedgerEnabled/.test(src),
      "service-worker.js must gate the writer on prefs.attributionLedgerEnabled (privacy toggle)",
    );
  });
});
