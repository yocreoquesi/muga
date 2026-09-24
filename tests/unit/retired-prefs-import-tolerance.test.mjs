/**
 * MUGA — retired/de-controlled prefs: stored values must not break anything
 * (#1355, #1354).
 *
 * Three shapes of change landed in the same body of work:
 *   - hoverPreviewDelayMs, paramBreakdown, showReportButton: RETIRED —
 *     removed from PREF_DEFAULTS entirely.
 *   - dnrEnabled: control removed, but the pref itself STAYS in
 *     PREF_DEFAULTS as a real internal default.
 *
 * A user who upgrades still has these keys sitting in their real
 * chrome.storage.sync (retired ones) or may have an old, explicit value for
 * dnrEnabled from before its control was removed. Both cases must degrade
 * safely:
 *   1. getPrefs() must never throw, and must never surface a retired key.
 *   2. dnrEnabled's stored value is now IGNORED — the internal default
 *      governs unconditionally (#1355 review finding R3-001, fixed after
 *      this file was first written: a stored `dnrEnabled: false` from
 *      before the control's removal would otherwise strand a user off the
 *      DNR path forever, with no control left to flip it back). getPrefs()
 *      forces the default regardless of storage, and a one-time migration
 *      (migrateDropDnrEnabledPref, storage-migrations.js) deletes the stale
 *      key. See tests/unit/dnr-enabled-internal-default.test.mjs for the
 *      dedicated coverage of both halves of that fix.
 *   3. A settings-export file (any vintage) carrying any of these keys must
 *      import cleanly via planImport(), with retired keys ignored.
 *
 * getPrefs() itself is exercised against a realistic chrome.storage.sync
 * stub that mirrors the real API contract: chrome.storage.sync.get(keysObj)
 * returns exactly the keys present in keysObj, using the stored value where
 * one exists and the passed-in default otherwise. A key present in the
 * store but ABSENT from keysObj (i.e. no longer in PREF_DEFAULTS) is simply
 * never returned — this is the mechanism that makes retirement safe with no
 * extra migration code required.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeChromeMock } from "./helpers/chrome-stub.mjs";

/**
 * A chrome.storage stub whose `sync.get(defaults, cb)` honours the real
 * contract: returns exactly the requested keys, stored value if present,
 * default otherwise. Extra stored keys not in `defaults` are invisible to
 * the caller — mirroring how a retired PREF_DEFAULTS key naturally stops
 * being read back, without any explicit "delete this key" migration.
 */
function installRealisticSyncStub(storedValues) {
  const syncStore = new Map(Object.entries(storedValues));
  globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: false });
  globalThis.chrome.storage.sync.get = (defaults, cb) => {
    const result = {};
    for (const [k, v] of Object.entries(defaults)) {
      result[k] = syncStore.has(k) ? syncStore.get(k) : v;
    }
    cb(result);
  };
}

describe("getPrefs() tolerates a pre-upgrade chrome.storage.sync payload (#1355)", () => {
  test("retired keys (hoverPreviewDelayMs, paramBreakdown, showReportButton) never surface, no throw", async () => {
    installRealisticSyncStub({
      hoverPreviewDelayMs: 5000,   // a user who somehow had a non-default value
      paramBreakdown: false,       // a user who had turned this off
      showReportButton: false,     // a user who had turned this off
      enabled: true,
    });

    const { getPrefs } = await import("../../src/lib/prefs.js?t=" + Date.now());
    let prefs;
    await assert.doesNotReject(async () => { prefs = await getPrefs(); });

    assert.ok(!("hoverPreviewDelayMs" in prefs), "hoverPreviewDelayMs must not surface — it is fully retired");
    assert.ok(!("paramBreakdown" in prefs), "paramBreakdown must not surface — it is fully retired");
    assert.ok(!("showReportButton" in prefs), "showReportButton must not surface — it is fully retired");
    assert.strictEqual(prefs.enabled, true, "unrelated real prefs must still read through normally");
  });

  // #1355 R3-001: this used to assert the stored value was honoured
  // ("control removed" != "value discarded"). That left a real user stranded
  // off the DNR path with no control to flip it back. Maintainer decision:
  // the internal default governs unconditionally instead — see
  // dnr-enabled-internal-default.test.mjs for the full dedicated coverage.
  test("dnrEnabled's stored value is IGNORED — the internal default governs unconditionally (#1355 R3-001)", async () => {
    installRealisticSyncStub({ dnrEnabled: false });

    const { getPrefs } = await import("../../src/lib/prefs.js?t=" + Date.now());
    const prefs = await getPrefs();

    assert.strictEqual(
      prefs.dnrEnabled, true,
      "a pre-#1355-fix stored dnrEnabled=false must not strand the user off the DNR path — the internal default (true) always wins",
    );
  });

  test("dnrEnabled falls back to its PREF_DEFAULTS default (true) when nothing was ever stored", async () => {
    installRealisticSyncStub({});

    const { getPrefs } = await import("../../src/lib/prefs.js?t=" + Date.now());
    const prefs = await getPrefs();

    assert.strictEqual(prefs.dnrEnabled, true);
  });
});

describe("planImport() tolerates any settings-export vintage carrying retired/de-controlled keys (#1355)", () => {
  test("all four keys together import cleanly in one file, none written to toSave", async () => {
    const { planImport } = await import("../../src/lib/settings-schema.js");
    const plan = planImport({
      muga: true,
      blacklist: [], whitelist: [], customParams: [],
      hoverPreviewDelayMs: 9999,
      paramBreakdown: true,
      showReportButton: true,
      dnrEnabled: false,
    });
    assert.strictEqual(plan.ok, true, "import must succeed despite carrying four retired/de-controlled keys");
    for (const key of ["hoverPreviewDelayMs", "paramBreakdown", "showReportButton", "dnrEnabled"]) {
      assert.strictEqual(plan.toSave[key], undefined, `"${key}" must not be written to toSave`);
    }
  });
});
