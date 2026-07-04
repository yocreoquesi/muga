/**
 * MUGA — GET_REMOTE_RULES_STATUS reports the CANONICAL effective value (#888 follow-up)
 *
 * Regression for the bug where the Settings "remote rule updates" toggle showed
 * OFF even though the user had it ON (default) and the weekly fetch was running.
 *
 * Root cause: the service-worker handler read
 *   chrome.storage.sync.get({ remoteRulesEnabled: false })
 * with a hardcoded `false` default that contradicts
 *   PREF_DEFAULTS.remoteRulesEnabled === true.
 * On a fresh install the key is never written, so the handler reported `false`
 * while getPrefs() (the value the extension actually uses) reported `true`.
 *
 * The fix routes the handler through buildRemoteRulesStatus({ getPrefs, ... }),
 * so `enabled` always equals the effective getPrefs() value — including any
 * per-device override.
 *
 * These tests exercise the extracted helper against the REAL getPrefs() with an
 * in-memory chrome stub, plus a source guard on the service worker so the
 * hardcoded-default anti-pattern cannot silently return.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

import { buildRemoteRulesStatus } from "../../src/lib/remote-rules-status.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

// In-memory chrome stub. `get` supports BOTH callback style (used by getPrefs /
// getConsent / getOverrides / getTestFixtures internally) AND promise style
// (used by buildRemoteRulesStatus's `await local.get(...)`).
function installChromeStub() {
  const localStore = new Map();
  const syncStore = new Map();

  const makeArea = (store) => ({
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = store.has(k) ? store.get(k) : v;
        }
      }
      if (cb) { cb(result); return; }
      return Promise.resolve(result);
    },
    set: (data, cb) => {
      for (const [k, v] of Object.entries(data)) store.set(k, v);
      if (cb) cb();
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
      if (cb) cb();
      return Promise.resolve();
    },
  });

  globalThis.chrome = {
    storage: { local: makeArea(localStore), sync: makeArea(syncStore) },
    runtime: { lastError: null },
  };
  return { localStore, syncStore, local: makeArea(localStore) };
}

// Fresh module graph per test so per-device-prefs / consent modules re-bind to
// the freshly installed chrome stub.
async function freshGetPrefs() {
  const mod = await import("../../src/lib/prefs.js?cb=" + Math.random());
  return mod.getPrefs;
}

describe("buildRemoteRulesStatus — enabled equals the effective getPrefs() value", () => {
  let stores;

  beforeEach(() => {
    stores = installChromeStub();
  });

  test("PREF_DEFAULTS.remoteRulesEnabled is true (guards the whole premise)", () => {
    assert.strictEqual(PREF_DEFAULTS.remoteRulesEnabled, true);
  });

  test("fresh install (no remoteRulesEnabled key in sync) reports enabled: true", async () => {
    // Nothing written to sync — the fresh-install condition that triggered the bug.
    const getPrefs = await freshGetPrefs();
    const status = await buildRemoteRulesStatus({
      getPrefs,
      local: stores.local,
      hasDNR: true,
    });
    assert.strictEqual(
      status.enabled, true,
      "on a fresh install the toggle must render ON, matching the true default and the running fetch"
    );
    // And it must equal the canonical effective value.
    const effective = (await getPrefs()).remoteRulesEnabled;
    assert.strictEqual(status.enabled, effective, "reported enabled must equal getPrefs().remoteRulesEnabled");
  });

  test("per-device override remoteRulesEnabled=false reports enabled: false", async () => {
    // A user declined the sync-inherited prompt on this device: local override wins.
    const perDevice = await import("../../src/lib/per-device-prefs.js?cb=" + Math.random());
    await perDevice.setOverrides({ remoteRulesEnabled: false });
    // Sync still says absent/true — the pre-fix raw read would ignore the override.
    stores.syncStore.set("remoteRulesEnabled", true);

    const getPrefs = await freshGetPrefs();
    const status = await buildRemoteRulesStatus({
      getPrefs,
      local: stores.local,
      hasDNR: true,
    });
    assert.strictEqual(
      status.enabled, false,
      "a per-device override must win — display must match getPrefs()"
    );
    assert.strictEqual(status.enabled, (await getPrefs()).remoteRulesEnabled);
  });

  test("passes through local meta / remoteParams and supportsDNR", async () => {
    stores.localStore.set("remoteParams", ["remote_x"]);
    stores.localStore.set("remoteRulesMeta", { version: 3, fetchedAt: "2026-07-01T00:00:00Z", paramCount: 1, lastError: null, published: "2026-06-30T00:00:00Z" });

    const getPrefs = await freshGetPrefs();
    const status = await buildRemoteRulesStatus({ getPrefs, local: stores.local, hasDNR: false });
    assert.deepEqual(status.remoteParams, ["remote_x"]);
    assert.strictEqual(status.meta.version, 3);
    assert.strictEqual(status.supportsDNR, false);
    assert.strictEqual(status.ok, true);
  });

  test("passes through remoteRulesChangelog from local storage (#984)", async () => {
    const changelog = { addedCount: 2, removedCount: 1, added: ["utm_new1", "utm_new2"], removed: ["utm_old"], fetchedAt: "2026-07-01T00:00:00Z", prevFetchedAt: "2026-06-24T00:00:00Z" };
    stores.localStore.set("remoteRulesChangelog", changelog);

    const getPrefs = await freshGetPrefs();
    const status = await buildRemoteRulesStatus({ getPrefs, local: stores.local, hasDNR: true });
    assert.deepEqual(status.changelog, changelog);
  });

  test("remoteRulesChangelog defaults to null when never written", async () => {
    const getPrefs = await freshGetPrefs();
    const status = await buildRemoteRulesStatus({ getPrefs, local: stores.local, hasDNR: true });
    assert.strictEqual(status.changelog, null);
  });
});

describe("service-worker source guard — no hardcoded remote-rules default", () => {
  const swSrc = readFileSync(join(ROOT, "src/background/service-worker.js"), "utf8");

  test("GET_REMOTE_RULES_STATUS no longer reads sync with a hardcoded false default", () => {
    assert.ok(
      !/sync\.get\(\{\s*remoteRulesEnabled:\s*false\s*\}\)/.test(swSrc),
      "the hardcoded { remoteRulesEnabled: false } sync read must be gone (it contradicted PREF_DEFAULTS)"
    );
  });

  test("the handler builds its reply via buildRemoteRulesStatus", () => {
    assert.ok(
      swSrc.includes("buildRemoteRulesStatus"),
      "the SW must route GET_REMOTE_RULES_STATUS through buildRemoteRulesStatus (canonical getPrefs value)"
    );
  });
});
