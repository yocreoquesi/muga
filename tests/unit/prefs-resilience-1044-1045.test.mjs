/**
 * MUGA — audit #1044 / #1045: prefs read/write must degrade honestly.
 *
 * #1044: setPrefs() swallowed chrome.storage write errors and resolved
 *        undefined, so a failed import reported success while the UI reverted.
 *        It now returns a boolean, and the Settings import path routes a failed
 *        write to the existing import_error path instead of the success toast.
 *
 * #1045: getPrefs() ran all four reads under one Promise.all with an outer
 *        catch that returned bare PREF_DEFAULTS. A transient sync-read failure
 *        therefore discarded the independently-stored consent record
 *        (onboardingDone) and the per-device overrides, so a fully onboarded
 *        user looked never-onboarded and a declined per-device pref reverted.
 *        Each read now degrades on its OWN failure.
 *
 * Behavioral tests drive the real prefs.js against a chrome stub whose sync
 * area can be made to fail; source guards cover the browser-only import wiring.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REQUIRED_CONSENT_VERSION } from "../../src/lib/consent-version-manifest.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

/**
 * Installs a chrome stub whose sync area can be told to fail its get/set by
 * setting chrome.runtime.lastError during the callback (mirrors the real API
 * contract prefs.js checks).
 */
function installChromeStub({ failSyncGet = false, failSyncSet = false } = {}) {
  const localStore = new Map();
  const syncStore = new Map();
  const runtime = { lastError: null };

  const withErr = (fail, run) => {
    runtime.lastError = fail ? { message: "simulated storage failure" } : null;
    run();
    runtime.lastError = null;
  };

  const makeArea = (store, { failGet = false, failSet = false } = {}) => ({
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = store.has(k) ? store.get(k) : v;
        }
      }
      withErr(failGet, () => cb(result));
    },
    set: (data, cb) => {
      if (!failSet) for (const [k, v] of Object.entries(data)) store.set(k, v);
      withErr(failSet, () => cb && cb());
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
      withErr(false, () => cb && cb());
    },
  });

  globalThis.chrome = {
    storage: {
      local: makeArea(localStore),
      sync: makeArea(syncStore, { failGet: failSyncGet, failSet: failSyncSet }),
    },
    runtime,
  };
  return { localStore, syncStore };
}

async function freshPrefs() {
  return await import("../../src/lib/prefs.js?cb=" + Math.random());
}

afterEach(() => { delete globalThis.chrome; });

describe("#1044 — setPrefs reports whether the write actually landed", () => {
  test("returns true on a successful write", async () => {
    installChromeStub();
    const prefs = await freshPrefs();
    assert.strictEqual(await prefs.setPrefs({ enabled: false }), true);
  });

  test("returns false (never throws) when the sync write fails", async () => {
    installChromeStub({ failSyncSet: true });
    const prefs = await freshPrefs();
    assert.strictEqual(
      await prefs.setPrefs({ enabled: false }), false,
      "setPrefs must resolve false on a storage write failure so callers can detect it",
    );
  });
});

describe("#1045 — getPrefs degrades per-source; a sync failure keeps consent + overrides", () => {
  test("preserves onboardingDone from the consent record when the sync read fails", async () => {
    const { localStore } = installChromeStub({ failSyncGet: true });
    localStore.set("mugaConsent", {
      onboardingDone: true,
      consentVersion: REQUIRED_CONSENT_VERSION,
      consentDate: 1,
    });
    const prefs = await freshPrefs();
    const effective = await prefs.getPrefs();
    assert.strictEqual(
      effective.onboardingDone, true,
      "a transient sync-read failure must NOT discard the independently-stored consent record",
    );
  });

  test("preserves a per-device override when the sync read fails", async () => {
    const { localStore } = installChromeStub({ failSyncGet: true });
    localStore.set("mugaPerDevicePrefs", { injectOwnAffiliate: false });
    const prefs = await freshPrefs();
    const effective = await prefs.getPrefs();
    assert.strictEqual(
      effective.injectOwnAffiliate, false,
      "a sync-read failure must not discard the per-device override overlay",
    );
  });
});

describe("#1044 — Settings import aborts to import_error on a failed write (source guard)", () => {
  const OPTIONS_JS = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

  test("import handler captures the setPrefs result", () => {
    assert.ok(
      /const\s+saved\s*=\s*await\s+setPrefs\(\s*toSave\s*\)/.test(OPTIONS_JS),
      "the import handler must capture the setPrefs() result",
    );
  });

  test("import handler bails when the write did not land (no false success toast)", () => {
    assert.ok(
      /if\s*\(\s*!saved\s*\)\s*throw/.test(OPTIONS_JS),
      "the import handler must abort (to the import_error path) when setPrefs returns false",
    );
  });
});
