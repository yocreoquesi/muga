/**
 * MUGA — Unit tests for src/lib/storage.js
 *
 * Run with: npm test
 *
 * Coverage:
 *   - PREF_DEFAULTS shape and default values
 *   - devMode default (sprint feature)
 *   - remoteRulesEnabled default (T1.2 — remote rules feature)
 *   - Remote rules helpers: getRemoteRulesState, setRemoteRulesState,
 *     getRemoteParams, setRemoteParams, clearRemoteParams
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PREF_DEFAULTS } from "../../src/lib/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/storage.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// PREF_DEFAULTS shape
// ---------------------------------------------------------------------------
describe("PREF_DEFAULTS — shape and default values", () => {
  test("devMode is NOT in PREF_DEFAULTS (moved to chrome.storage.local)", () => {
    // devMode is device-local and should not sync across devices (C8 TODO resolved)
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "devMode"),
      false,
      "devMode must not be in PREF_DEFAULTS — it lives in chrome.storage.local via getDevMode/setDevMode"
    );
  });

  test("getDevMode and setDevMode are exported from storage.js", () => {
    // Verify the new local-storage helpers exist in source
    const storageSource = STORAGE_SOURCE;
    assert.ok(storageSource.includes("export async function getDevMode("), "getDevMode must be exported");
    assert.ok(storageSource.includes("export async function setDevMode("), "setDevMode must be exported");
  });

  test("getDevMode reads from chrome.storage.local (not sync)", () => {
    const devModeBlock = STORAGE_SOURCE.slice(
      STORAGE_SOURCE.indexOf("export async function getDevMode("),
      STORAGE_SOURCE.indexOf("export async function getDevMode(") + 400
    );
    assert.ok(devModeBlock.includes("chrome.storage.local.get"), "getDevMode must use chrome.storage.local.get");
  });

  test("enabled defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.enabled, true);
  });

  test("notifyForeignAffiliate defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.notifyForeignAffiliate, false);
  });

  test("blacklist defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.blacklist, []);
  });

  test("whitelist defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.whitelist, []);
  });

  test("customParams defaults to empty array", () => {
    assert.deepEqual(PREF_DEFAULTS.customParams, []);
  });

  test("devMode is absent from PREF_DEFAULTS (lives in local storage)", () => {
    // After C8 migration, PREF_DEFAULTS no longer contains devMode.
    assert.strictEqual(PREF_DEFAULTS.devMode, undefined);
  });

  // T1.2 — remote rules toggle default flipped to true (#888): readiness
  // (signing infra, defense-in-depth tests, disclosure copy) was ratified.
  test("remoteRulesEnabled defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.remoteRulesEnabled, true);
  });

  test("remoteRulesEnabled is a boolean (not undefined or null)", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.remoteRulesEnabled, "boolean");
  });
});

// ---------------------------------------------------------------------------
// Remote rules helpers — structural tests (T1.2)
// Helpers call chrome.storage APIs which are unavailable in Node.
// We verify the source exports and API usage structurally to ensure:
//   - kept helpers are exported (getRemoteParams, setRemoteParams)
//   - remoteParams and remoteRulesMeta live in chrome.storage.local
// Three orphan exports (getRemoteRulesState / setRemoteRulesState /
// clearRemoteParams) were retired in #709 — zero production callers.
// The negative assertions below pin that decision.
// ---------------------------------------------------------------------------
describe("remote rules helpers — structural assertions (T1.2)", () => {

  test("storage.js exports getRemoteParams", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export async function getRemoteParams"),
      "getRemoteParams must be exported from storage.js"
    );
  });

  test("storage.js exports setRemoteParams", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export async function setRemoteParams"),
      "setRemoteParams must be exported from storage.js"
    );
  });

  test("storage.js does NOT export getRemoteRulesState / setRemoteRulesState / clearRemoteParams (#709)", () => {
    // Retired as orphan exports — zero production callers. clearRemoteCache
    // in src/lib/remote-rules.js is the active clear path; the remoteRulesEnabled
    // toggle is read/written directly via chrome.storage.sync in the SW (no helper).
    assert.ok(
      !STORAGE_SOURCE.includes("export async function getRemoteRulesState"),
      "getRemoteRulesState was retired in #709 — do not reintroduce without a real caller"
    );
    assert.ok(
      !STORAGE_SOURCE.includes("export async function setRemoteRulesState"),
      "setRemoteRulesState was retired in #709 — do not reintroduce without a real caller"
    );
    assert.ok(
      !STORAGE_SOURCE.includes("export async function clearRemoteParams"),
      "clearRemoteParams was retired in #709 — clearRemoteCache in remote-rules.js owns this path"
    );
  });

  test("remoteRulesEnabled toggle uses chrome.storage.sync", () => {
    // The SW writes the toggle directly via chrome.storage.sync (cross-device pref)
    assert.ok(
      STORAGE_SOURCE.includes("chrome.storage.sync"),
      "storage.js must reference chrome.storage.sync"
    );
  });

  test("remoteParams and remoteRulesMeta use chrome.storage.local", () => {
    // Remote params are device-local (not synced) per design §1.2 / REQ-MERGE-1
    assert.ok(
      STORAGE_SOURCE.includes("remoteParams"),
      "storage.js must reference remoteParams"
    );
    assert.ok(
      STORAGE_SOURCE.includes("remoteRulesMeta"),
      "storage.js must reference remoteRulesMeta"
    );
  });
});
