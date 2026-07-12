/**
 * MUGA — Per-browser default for followShortenersEnabled.
 *
 * ADR-0004's native shortener resolver is opt-in on Firefox (MV2) because the
 * shortener host permissions must be granted via an explicit
 * chrome.permissions.request() gesture from Settings. On Chrome (MV3),
 * host_permissions already grants <all_urls> at install time (src/manifest.json),
 * so the same fetch works with zero extra prompts — there is no reason to make
 * users opt in a second time. This flips the EFFECTIVE default to true on
 * Chrome while leaving Firefox's default at false (unchanged).
 *
 * An explicitly stored value (the user toggled it) must always win over the
 * computed browser default — chrome.storage.sync.get(PREF_DEFAULTS, …) only
 * substitutes a default for a key ABSENT from storage, which is exactly what
 * these tests exercise end-to-end through getPrefs().
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Installs a chrome stub with in-memory sync/local storage areas and a
 * configurable runtime.getManifest(), mirroring the pattern used by
 * tests/unit/prefs-resilience-1044-1045.test.mjs.
 *
 * @param {object} [opts]
 * @param {number|undefined} [opts.manifestVersion] - manifest_version to report,
 *   or undefined to simulate an unavailable getManifest (unit-test-like host).
 * @param {object} [opts.storedSync] - pre-seeded chrome.storage.sync values.
 */
function installChromeStub({ manifestVersion, storedSync = {} } = {}) {
  const syncStore = new Map(Object.entries(storedSync));
  const localStore = new Map();
  const runtime = { lastError: null };

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
      cb(result);
    },
    set: (data, cb) => {
      for (const [k, v] of Object.entries(data)) store.set(k, v);
      cb && cb();
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
      cb && cb();
    },
  });

  const chromeStub = {
    storage: {
      sync: makeArea(syncStore),
      local: makeArea(localStore),
    },
    runtime,
  };

  if (manifestVersion !== undefined) {
    chromeStub.runtime.getManifest = () => ({ manifest_version: manifestVersion });
  }
  // When manifestVersion is undefined, deliberately omit getManifest entirely
  // to simulate an environment where the API is unavailable.

  globalThis.chrome = chromeStub;
  return { syncStore, localStore };
}

async function freshPrefs() {
  return await import("../../src/lib/prefs.js?cb=" + Math.random() + Date.now());
}

afterEach(() => { delete globalThis.chrome; });

describe("followShortenersEnabled — browser-dependent default (PREF_DEFAULTS)", () => {
  test("MV3 (Chrome) manifest → PREF_DEFAULTS.followShortenersEnabled is true", async () => {
    installChromeStub({ manifestVersion: 3 });
    const { PREF_DEFAULTS } = await freshPrefs();
    assert.equal(PREF_DEFAULTS.followShortenersEnabled, true);
  });

  test("MV2 (Firefox) manifest → PREF_DEFAULTS.followShortenersEnabled is false", async () => {
    installChromeStub({ manifestVersion: 2 });
    const { PREF_DEFAULTS } = await freshPrefs();
    assert.equal(PREF_DEFAULTS.followShortenersEnabled, false);
  });

  test("getManifest unavailable (stubbed host) → PREF_DEFAULTS.followShortenersEnabled is false, never throws", async () => {
    installChromeStub({}); // no getManifest at all
    await assert.doesNotReject(async () => {
      const { PREF_DEFAULTS } = await freshPrefs();
      assert.equal(PREF_DEFAULTS.followShortenersEnabled, false);
    });
  });
});

describe("followShortenersEnabled — a stored value always wins over the browser default", () => {
  test("stored false on an MV3 (Chrome) host stays false through getPrefs()", async () => {
    installChromeStub({ manifestVersion: 3, storedSync: { followShortenersEnabled: false } });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(
      effective.followShortenersEnabled, false,
      "a stored false must not be overridden by the MV3 default of true",
    );
  });

  test("stored true on an MV2 (Firefox) host stays true through getPrefs()", async () => {
    installChromeStub({ manifestVersion: 2, storedSync: { followShortenersEnabled: true } });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(
      effective.followShortenersEnabled, true,
      "a stored true must not be overridden by the MV2 default of false",
    );
  });

  test("unset on an MV3 (Chrome) host resolves to the browser default (true) through getPrefs()", async () => {
    installChromeStub({ manifestVersion: 3 });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.followShortenersEnabled, true);
  });

  test("unset on an MV2 (Firefox) host resolves to the browser default (false) through getPrefs()", async () => {
    installChromeStub({ manifestVersion: 2 });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.followShortenersEnabled, false);
  });
});
