/**
 * MUGA — browsewrap Phase 2: shortener click/hover split.
 *
 * `followShortenersEnabled` (a single browser-aware-default pref gating BOTH
 * click-time and hover/proactive shortener resolution) is retired. It is
 * replaced by two independent, browser-agnostic prefs:
 *
 *   - `resolveShortenersOnClick` — default `true` on every browser. The user
 *     was already navigating to this link; resolving it at click time is
 *     low-risk.
 *   - `resolveShortenersOnHover` — default `false` on every browser (opt-in).
 *     Resolving on hover pings the shortener host for a link the user only
 *     looked at, never clicked — a privacy cost click-time resolution
 *     doesn't have.
 *
 * Both are plain PREF_DEFAULTS literals now (no `defaultFollowShortenersEnabled()`
 * browser-detection helper): the browser-aware default this file used to test
 * (true on Chrome MV3, false on Firefox MV2) is retired along with the single
 * pref — click's default is unconditionally true, hover's unconditionally
 * false, on every browser. A stored value still always wins over the default
 * (chrome.storage.sync.get(PREF_DEFAULTS, …) only substitutes a default for a
 * key ABSENT from storage).
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

function installChromeStub({ storedSync = {} } = {}) {
  const syncStore = new Map(Object.entries(storedSync));
  const localStore = new Map();
  const runtime = { lastError: null, getManifest: () => ({ manifest_version: 3 }) };

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

  globalThis.chrome = {
    storage: { sync: makeArea(syncStore), local: makeArea(localStore) },
    runtime,
  };
  return { syncStore, localStore };
}

async function freshPrefs() {
  return await import("../../src/lib/prefs.js?cb=" + Math.random() + Date.now());
}

afterEach(() => { delete globalThis.chrome; });

describe("PREF_DEFAULTS — followShortenersEnabled is fully retired", () => {
  test("PREF_DEFAULTS has no followShortenersEnabled key", async () => {
    installChromeStub();
    const { PREF_DEFAULTS } = await freshPrefs();
    assert.ok(!("followShortenersEnabled" in PREF_DEFAULTS));
  });
});

describe("PREF_DEFAULTS — resolveShortenersOnClick / resolveShortenersOnHover", () => {
  test("resolveShortenersOnClick literal defaults to true", async () => {
    installChromeStub();
    const { PREF_DEFAULTS } = await freshPrefs();
    assert.equal(PREF_DEFAULTS.resolveShortenersOnClick, true);
  });

  test("resolveShortenersOnHover literal defaults to false (opt-in)", async () => {
    installChromeStub();
    const { PREF_DEFAULTS } = await freshPrefs();
    assert.equal(PREF_DEFAULTS.resolveShortenersOnHover, false);
  });
});

describe("getPrefs() — defaults apply identically on every browser (no browser-aware overlay)", () => {
  test("unset resolveShortenersOnClick resolves to true", async () => {
    installChromeStub();
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.resolveShortenersOnClick, true);
  });

  test("unset resolveShortenersOnHover resolves to false", async () => {
    installChromeStub();
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.resolveShortenersOnHover, false);
  });

  test("a stored false for resolveShortenersOnClick is never overridden by the default", async () => {
    installChromeStub({ storedSync: { resolveShortenersOnClick: false } });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.resolveShortenersOnClick, false);
  });

  test("a stored true for resolveShortenersOnHover is never overridden by the default", async () => {
    installChromeStub({ storedSync: { resolveShortenersOnHover: true } });
    const { getPrefs } = await freshPrefs();
    const effective = await getPrefs();
    assert.equal(effective.resolveShortenersOnHover, true);
  });

  test("getPrefs never rejects even when chrome.runtime.getManifest is unavailable", async () => {
    installChromeStub();
    delete globalThis.chrome.runtime.getManifest;
    const { getPrefs } = await freshPrefs();
    await assert.doesNotReject(async () => {
      const effective = await getPrefs();
      assert.equal(effective.resolveShortenersOnClick, true);
      assert.equal(effective.resolveShortenersOnHover, false);
    });
  });
});
