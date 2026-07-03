/**
 * MUGA — Explicit Settings toggle of a guarded pref must clear its per-device
 * override so the choice STICKS (#888 follow-up, write path).
 *
 * Root cause: the Settings write paths write only chrome.storage.sync (via
 * setPrefs) and never touch the per-device override (mugaPerDevicePrefs,
 * chrome.storage.local). getPrefs() overlays per-device overrides LAST
 * (prefs.js `{...sync, ...overlay, ...overrides}`), so a user who declined a
 * sync-inherited prompt during onboarding (override=false) sees the toggle
 * correctly OFF, flips it ON in Settings, setPrefs writes sync=true, but
 * getPrefs still returns false (the stale override wins) — the toggle reverts
 * on reload and the behaviour never changes.
 *
 * Fix: an explicit Settings toggle is this device's authoritative choice, so
 * reconcileOverrideForExplicitChoice() records the override to match the chosen
 * value for GUARDED_PREFS only. These are genuine behavioural tests: they drive
 * the real reconcile helper + getPrefs merge and assert the effective value.
 *
 * The two wiring sites (options.js bindToggle for injectOwnAffiliate;
 * service-worker.js ENABLE/DISABLE_REMOTE_RULES) are browser-only and covered
 * by source guards below, matching the codebase's established pattern.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

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
  return { localStore, syncStore };
}

async function freshPrefs() {
  return await import("../../src/lib/prefs.js?cb=" + Math.random());
}
async function freshPerDevice() {
  return await import("../../src/lib/per-device-prefs.js?cb=" + Math.random());
}

describe("write path — explicit Settings toggle reconciles the per-device override", () => {
  beforeEach(() => { installChromeStub(); });

  test("injectOwnAffiliate: enabling ON with a pre-existing override=false makes getPrefs() return true (sticks)", async () => {
    const perDevice = await freshPerDevice();
    // Device declined the sync-inherited prompt during onboarding.
    await perDevice.setOverrides({ injectOwnAffiliate: false });

    // Simulate the Settings write path: setPrefs writes sync ...
    const prefs = await freshPrefs();
    await prefs.setPrefs({ injectOwnAffiliate: true });

    // ... and (the fix) the explicit choice reconciles the per-device override.
    await perDevice.reconcileOverrideForExplicitChoice("injectOwnAffiliate", true);

    const effective = await prefs.getPrefs();
    assert.strictEqual(
      effective.injectOwnAffiliate, true,
      "after an explicit Settings enable, getPrefs must return true — the stale override must not win"
    );
  });

  test("remoteRulesEnabled: enabling ON with a pre-existing override=false makes getPrefs() return true (sticks)", async () => {
    const perDevice = await freshPerDevice();
    await perDevice.setOverrides({ remoteRulesEnabled: false });

    const prefs = await freshPrefs();
    await prefs.setPrefs({ remoteRulesEnabled: true });
    await perDevice.reconcileOverrideForExplicitChoice("remoteRulesEnabled", true);

    const effective = await prefs.getPrefs();
    assert.strictEqual(effective.remoteRulesEnabled, true);
  });

  test("remoteRulesEnabled: disabling OFF with a pre-existing override=true makes getPrefs() return false (sticks)", async () => {
    const perDevice = await freshPerDevice();
    await perDevice.setOverrides({ remoteRulesEnabled: true });

    const prefs = await freshPrefs();
    await prefs.setPrefs({ remoteRulesEnabled: false });
    await perDevice.reconcileOverrideForExplicitChoice("remoteRulesEnabled", false);

    const effective = await prefs.getPrefs();
    assert.strictEqual(effective.remoteRulesEnabled, false);
  });

  test("non-guarded key is a no-op — no per-device override is written, no throw", async () => {
    const perDevice = await freshPerDevice();
    // dnrEnabled is a normal synced pref, NOT in GUARDED_PREFS.
    await perDevice.reconcileOverrideForExplicitChoice("dnrEnabled", true);

    const overrides = await perDevice.getOverrides();
    assert.deepStrictEqual(
      overrides, {},
      "reconcile must not smuggle non-guarded keys into the per-device override map"
    );
  });
});

describe("write path — source guards for the browser-only wiring sites", () => {
  const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");
  const swSource = readFileSync(join(ROOT, "src/background/service-worker.js"), "utf8");

  test("options.js bindToggle reconciles guarded prefs (membership-gated, not blanket)", () => {
    const start = optionsJs.indexOf("function bindToggle(");
    assert.ok(start !== -1, "bindToggle must exist");
    const end = optionsJs.indexOf("\nfunction ", start + 1);
    const body = optionsJs.slice(start, end === -1 ? undefined : end);

    assert.ok(
      /GUARDED_PREFS/.test(body),
      "bindToggle must gate the reconcile on GUARDED_PREFS membership (not blanket-clear every toggle)"
    );
    assert.ok(
      /reconcileOverrideForExplicitChoice/.test(body),
      "bindToggle must reconcile the per-device override for guarded prefs so the choice sticks"
    );
  });

  test("service-worker ENABLE_REMOTE_RULES reconciles the remoteRulesEnabled override to true", () => {
    const body = swSource.match(/"ENABLE_REMOTE_RULES"[\s\S]*?"DISABLE_REMOTE_RULES"/)?.[0] || "";
    assert.ok(
      /reconcileOverrideForExplicitChoice\(\s*["']remoteRulesEnabled["']\s*,\s*true/.test(body),
      "ENABLE_REMOTE_RULES must reconcile the per-device override to true"
    );
  });

  test("service-worker DISABLE_REMOTE_RULES reconciles the remoteRulesEnabled override to false", () => {
    const body = swSource.match(/"DISABLE_REMOTE_RULES"[\s\S]*?"GET_REMOTE_RULES_STATUS"/)?.[0] || "";
    assert.ok(
      /reconcileOverrideForExplicitChoice\(\s*["']remoteRulesEnabled["']\s*,\s*false/.test(body),
      "DISABLE_REMOTE_RULES must reconcile the per-device override to false"
    );
  });
});
