/**
 * MUGA — consent-storage (#355)
 *
 * Round-trip tests for the consent record. Uses a stateful in-memory
 * chrome.storage stub so reads return what was written, and asserts
 * that consent never leaks into chrome.storage.sync.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function installChromeStub() {
  const localStore = new Map();
  const syncStore  = new Map();

  const makeArea = (store) => ({
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
      } else if (Array.isArray(defaults)) {
        for (const k of defaults) result[k] = store.has(k) ? store.get(k) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = store.has(k) ? store.get(k) : v;
        }
      }
      cb && cb(result);
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
    storage: {
      local: makeArea(localStore),
      sync:  makeArea(syncStore),
    },
    runtime: { lastError: null },
  };

  return { localStore, syncStore };
}

/**
 * Installs a chrome stub whose storage callbacks fail by setting
 * chrome.runtime.lastError (the way the real chrome.* APIs signal errors).
 * lastError is set just for the duration of the synchronous callback, then
 * cleared — mirroring chrome's per-call error surface.
 */
function installFailingChromeStub(failMessage = "storage quota exceeded") {
  const fail = (...args) => {
    const cb = args[args.length - 1];
    chrome.runtime.lastError = { message: failMessage };
    if (cb) cb({});
    chrome.runtime.lastError = null;
  };
  const area = { get: fail, set: fail, remove: fail };
  globalThis.chrome = {
    storage: { local: area, sync: area },
    runtime: { lastError: null },
  };
}

describe("consent-storage", () => {
  let stores;
  let consentStorage;

  beforeEach(async () => {
    stores = installChromeStub();
    consentStorage = await import("../../src/lib/consent-storage.js?cb=" + Math.random());
  });

  test("getConsent returns defaults when nothing stored", async () => {
    const c = await consentStorage.getConsent();
    assert.deepEqual(c, {
      onboardingDone: false,
      consentVersion: null,
      consentDate: null,
    });
  });

  test("setConsent + getConsent round-trips", async () => {
    await consentStorage.setConsent({
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 1700000000000,
    });
    const c = await consentStorage.getConsent();
    assert.deepEqual(c, {
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 1700000000000,
    });
  });

  test("setConsent writes to local, never to sync", async () => {
    await consentStorage.setConsent({ onboardingDone: true, consentVersion: "1.0", consentDate: 0 });
    assert.ok(stores.localStore.has("mugaConsent"), "local must have the key");
    assert.equal(stores.syncStore.has("mugaConsent"), false, "sync must NOT have the key");
  });

  test("setConsent merges partial updates against the stored record", async () => {
    await consentStorage.setConsent({
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: 100,
    });
    await consentStorage.setConsent({ consentVersion: "1.1" });
    const c = await consentStorage.getConsent();
    assert.equal(c.onboardingDone, true, "untouched field must be preserved");
    assert.equal(c.consentVersion, "1.1", "patched field updated");
    assert.equal(c.consentDate, 100, "untouched field must be preserved");
  });

  test("setConsent rejects non-object input", async () => {
    await assert.rejects(() => consentStorage.setConsent(null));
    await assert.rejects(() => consentStorage.setConsent("string"));
    await assert.rejects(() => consentStorage.setConsent(123));
  });

  test("clearConsent removes the record", async () => {
    await consentStorage.setConsent({ onboardingDone: true, consentVersion: "1.0", consentDate: 0 });
    await consentStorage.clearConsent();
    const c = await consentStorage.getConsent();
    assert.deepEqual(c, {
      onboardingDone: false,
      consentVersion: null,
      consentDate: null,
    });
    assert.equal(stores.localStore.has("mugaConsent"), false);
  });
});

describe("consent-storage — error / reject paths (#728 items 15/16)", () => {
  let consentStorage;

  beforeEach(async () => {
    installFailingChromeStub();
    consentStorage = await import("../../src/lib/consent-storage.js?cb=" + Math.random());
  });

  test("getConsent swallows a storage error and returns CONSENT_DEFAULTS (item 15)", async () => {
    // Documented contract: getConsent never throws — on any error it returns
    // the defaults so callers render the never-onboarded state safely.
    const c = await consentStorage.getConsent();
    assert.deepEqual(c, {
      onboardingDone: false,
      consentVersion: null,
      consentDate: null,
    });
  });

  test("setConsent rejects when the storage write fails (item 16)", async () => {
    // setConsent must propagate the failure so onboarding can surface a save
    // error. The reject value is chrome.runtime.lastError (a plain object, not
    // an Error), so assert it rejects and carries the failure message.
    await assert.rejects(
      () => consentStorage.setConsent({ onboardingDone: true }),
      (err) => err && err.message === "storage quota exceeded",
    );
  });

  test("clearConsent rejects when the storage remove fails (item 16)", async () => {
    await assert.rejects(
      () => consentStorage.clearConsent(),
      (err) => err && err.message === "storage quota exceeded",
    );
  });
});
