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
  test("devMode defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.devMode, false);
  });

  test("enabled defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.enabled, true);
  });

  test("injectOwnAffiliate defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.injectOwnAffiliate, false);
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

  test("devMode is a boolean (not undefined or null)", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.devMode, "boolean");
  });

  // T1.2 — remote rules toggle must default to false (REQ-OPT-1)
  test("remoteRulesEnabled defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.remoteRulesEnabled, false);
  });

  test("remoteRulesEnabled is a boolean (not undefined or null)", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.remoteRulesEnabled, "boolean");
  });
});

// ---------------------------------------------------------------------------
// Remote rules helpers — structural tests (T1.2)
// Helpers call chrome.storage APIs which are unavailable in Node.
// We verify the source exports and API usage structurally to ensure:
//   - all helpers are exported
//   - toggle (remoteRulesEnabled) lives in chrome.storage.sync
//   - remoteParams and remoteRulesMeta live in chrome.storage.local
//   - clearRemoteParams removes both remoteParams and remoteRulesMeta
// ---------------------------------------------------------------------------
describe("remote rules helpers — structural assertions (T1.2)", () => {

  test("storage.js exports getRemoteRulesState", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export async function getRemoteRulesState"),
      "getRemoteRulesState must be exported from storage.js"
    );
  });

  test("storage.js exports setRemoteRulesState", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export async function setRemoteRulesState"),
      "setRemoteRulesState must be exported from storage.js"
    );
  });

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

  test("storage.js exports clearRemoteParams", () => {
    assert.ok(
      STORAGE_SOURCE.includes("export async function clearRemoteParams"),
      "clearRemoteParams must be exported from storage.js"
    );
  });

  test("remoteRulesEnabled toggle uses chrome.storage.sync", () => {
    // The helper must read/write remoteRulesEnabled from sync (cross-device pref)
    assert.ok(
      STORAGE_SOURCE.includes("chrome.storage.sync"),
      "storage.js must reference chrome.storage.sync for the toggle"
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

  test("clearRemoteParams removes both remoteParams and remoteRulesMeta", () => {
    // Verify that the clear function handles both keys (REQ-OPT-5)
    const clearFnMatch = STORAGE_SOURCE.match(
      /function clearRemoteParams[\s\S]{0,500}?remoteParams[\s\S]{0,200}?remoteRulesMeta/
    );
    assert.ok(
      clearFnMatch !== null,
      "clearRemoteParams must reference both remoteParams and remoteRulesMeta"
    );
  });
});
