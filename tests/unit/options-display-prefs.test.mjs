/**
 * MUGA — Settings initial toggle state == effective getPrefs() value (#888 follow-up)
 *
 * Secondary defect (same architectural root as the remote-rules one): the
 * options page read its initial toggle state from a RAW
 *   chrome.storage.sync.get(PREF_DEFAULTS)
 * which never overlays per-device overrides (per-device-prefs.getOverrides()),
 * unlike the canonical getPrefs(). So a toggle with a per-device override —
 * remoteRulesEnabled — could DISPLAY a value that disagrees with the
 * effective value the rest of the extension uses.
 *
 * The fix makes init() read from getPrefs(). These tests:
 *   1. Pin the canonical merge behaviour (getPrefs overlays the per-device
 *      override for remoteRulesEnabled), so the value the fixed Settings
 *      read renders is the effective one.
 *   2. Source-guard options.js so the initial read cannot regress back to the
 *      raw sync read that ignored overrides.
 *
 * drop-affiliate-injection (PR 1b): injectOwnAffiliate was removed from
 * GUARDED_PREFS along with the pref itself — remoteRulesEnabled is now the
 * sole guarded pref covered here.
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

async function freshGetPrefs() {
  const mod = await import("../../src/lib/prefs.js?cb=" + Math.random());
  return mod.getPrefs;
}
async function freshPerDevice() {
  return await import("../../src/lib/per-device-prefs.js?cb=" + Math.random());
}

describe("canonical merged prefs — the value Settings must display", () => {
  let stores;
  beforeEach(() => { stores = installChromeStub(); });

  test("remoteRulesEnabled: per-device override false wins over the true default", async () => {
    const perDevice = await freshPerDevice();
    await perDevice.setOverrides({ remoteRulesEnabled: false });
    // sync absent → default true; override must still win.

    const getPrefs = await freshGetPrefs();
    const prefs = await getPrefs();
    assert.strictEqual(prefs.remoteRulesEnabled, false);
  });

  test("remoteRulesEnabled display: the value init() renders equals getPrefs(), not the raw sync value", async () => {
    // Device declined the sync-inherited remoteRulesEnabled prompt (override=false)
    // while sync says ON. init() renders the toggle from `prefs[key]` where
    // `prefs = await getPrefs()` (see options.js init + bindToggle). The OLD
    // buggy read used a raw chrome.storage.sync.get(PREF_DEFAULTS), which would
    // have rendered ON. This proves the two disagree and the fix must pick the
    // merged (override-honored) value.
    const perDevice = await freshPerDevice();
    await perDevice.setOverrides({ remoteRulesEnabled: false });
    stores.syncStore.set("remoteRulesEnabled", true);

    // What the OLD code read (raw sync, ignoring overrides).
    const rawSync = await new Promise((resolve) =>
      globalThis.chrome.storage.sync.get({ remoteRulesEnabled: false }, resolve));

    // What init() now renders: the effective getPrefs() value.
    const getPrefs = await freshGetPrefs();
    const rendered = (await getPrefs()).remoteRulesEnabled;

    assert.strictEqual(rawSync.remoteRulesEnabled, true, "raw sync read (old path) says ON");
    assert.strictEqual(rendered, false, "getPrefs (new path) honors the per-device override → renders OFF");
    assert.notStrictEqual(
      rendered, rawSync.remoteRulesEnabled,
      "the fix matters: the effective value the toggle renders must differ from the raw sync value"
    );
  });

  test("no override → getPrefs returns the sync/default value unchanged", async () => {
    const getPrefs = await freshGetPrefs();
    const prefs = await getPrefs();
    assert.strictEqual(prefs.remoteRulesEnabled, true, "default");
  });
});

describe("options.js source guard — initial toggle read uses canonical getPrefs()", () => {
  const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

  test("init() reads initial prefs via getPrefs(), not a raw sync.get(PREF_DEFAULTS)", () => {
    // Isolate the init() body: from `async function init()` to the next top-level function.
    const initStart = optionsJs.indexOf("async function init()");
    assert.ok(initStart !== -1, "init() must exist");
    const initEnd = optionsJs.indexOf("\nfunction bindToggle(", initStart);
    const initBody = optionsJs.slice(initStart, initEnd === -1 ? undefined : initEnd);

    assert.ok(
      /await getPrefs\(\)/.test(initBody),
      "init() must load the initial toggle state from getPrefs() (merges per-device overrides)"
    );
    assert.ok(
      !/chrome\.storage\.sync\.get\(PREF_DEFAULTS\)/.test(initBody),
      "init() must NOT read the initial toggle state from a raw chrome.storage.sync.get(PREF_DEFAULTS)"
    );
  });

  test("options.js imports getPrefs", () => {
    assert.ok(
      /import\s*\{[^}]*\bgetPrefs\b[^}]*\}\s*from\s*["']\.\.\/lib\/storage\.js["']/.test(optionsJs),
      "options.js must import getPrefs from storage.js"
    );
  });
});
