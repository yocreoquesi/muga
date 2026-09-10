/**
 * MUGA — Unit tests for src/background/remote-rules-wake.js (#1266 item 5, slice 4)
 *
 * `maybeFetchRemoteRules` used to live in service-worker.js, which cannot be
 * imported in Node because it makes `chrome.*` calls at module scope. Before
 * this move, `tests/unit/service-worker-patterns.test.mjs` carried a
 * hand-written mirror of it (`makeMaybeFetchHelper()`, "Pure extraction... for
 * unit testing. Mirrors the production logic") whose own `deps.runFetch` was
 * a bare injected callback — it never ran the real `runRemoteRulesFetch`
 * pipeline, so it could not prove the one thing the throttle actually
 * depends on: that `remoteRulesMeta.fetchedAt` is written on success and
 * left untouched on failure. This file drives the REAL function against the
 * REAL `runRemoteRulesFetch` (same signature-verification path
 * `remote-rules-integration.test.mjs` exercises), so it can prove what the
 * mirror structurally could not:
 *
 *   - a successful fetch persists `fetchedAt`, and a LATER, freshly-imported
 *     "SW lifetime" (module state resets on every real service-worker
 *     restart, simulated here via a cache-busted re-import) sees that
 *     persisted timestamp and skips re-fetching inside the 7-day window;
 *   - a failed fetch does NOT persist `fetchedAt` (only `lastError`), so a
 *     later lifetime is not permanently wedged — it tries again on its next
 *     wake, exactly as a real transient network failure should recover.
 *
 * service-worker-patterns.test.mjs keeps the egress-gate scenarios
 * (remoteRulesEnabled / consent / dedup-within-a-lifetime) that were already
 * behavioral before this move; this file adds the cross-lifetime coverage
 * #1266 asks for specifically.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { canonicalMessage } from "../../src/lib/remote-rules.js";
import { TERMS_VERSION } from "../../src/lib/consent-storage.js";

// ── Test-only Ed25519 keypair (never a real committed key) ──────────────────
const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } = generateKeyPairSync("ed25519");

function signMessage(msg) {
  const buf = cryptoSign(null, Buffer.from(msg, "utf8"), TEST_PRIV_KEY);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function testPubKeyBase64() {
  const der = TEST_PUB_KEY.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

/** A fetchImpl resolving with a validly-signed remote-rules payload. */
function makeSignedFetchImpl(params, version = 1) {
  const published = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1h ago
  const canonical = canonicalMessage(version, published, params);
  const sig = signMessage(canonical);
  const bytes = Buffer.from(JSON.stringify({ version, published, params, sig }), "utf8");

  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: new Uint8Array(bytes) });
          },
          cancel: () => Promise.resolve(),
        };
      },
    },
  });
}

/** A fetchImpl that always fails at the network layer. */
function makeFailingFetchImpl() {
  return async () => { throw new Error("simulated network failure"); };
}

/**
 * chrome.storage.{sync,local} stub matching real chrome semantics: a
 * callback argument uses the callback form, its absence returns a Promise —
 * the same dual shape service-worker.js's own `_remoteRulesDeps()` relies on
 * (`chrome.storage.local.get(d)` with no callback, used as a Promise).
 */
function makeDualArea(store) {
  return {
    get: (defaults, cb) => {
      const result = { ...defaults, ...store };
      if (typeof cb === "function") { cb(result); return undefined; }
      return Promise.resolve(result);
    },
    set: (obj, cb) => {
      Object.assign(store, obj);
      if (typeof cb === "function") { cb(); return undefined; }
      return Promise.resolve();
    },
    remove: (key, cb) => {
      (Array.isArray(key) ? key : [key]).forEach((k) => delete store[k]);
      if (typeof cb === "function") { cb(); return undefined; }
      return Promise.resolve();
    },
  };
}

function installChromeStub(syncStore = {}, localStore = {}) {
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: { sync: makeDualArea(syncStore), local: makeDualArea(localStore) },
  };
  return { syncStore, localStore };
}

/** Builds the runRemoteRulesFetch-shaped deps, wired to the SAME chrome.storage.local as getRemoteParams/getPrefs read — matches production `_remoteRulesDeps()`. */
function makeProdShapedDeps({ fetchImpl, trustedKeys }) {
  return {
    fetchImpl,
    subtle: globalThis.crypto.subtle,
    trustedKeys,
    storage: {
      get: (d) => chrome.storage.local.get(d),
      set: (i) => chrome.storage.local.set(i),
      remove: (k) => chrome.storage.local.remove(k),
    },
    dnr: { updateDynamicRules: async () => {} },
  };
}

/** A fresh module instance — the test equivalent of a real SW cold start, since `_remoteRulesCheckedThisLifetime` is module-scope state. */
async function freshMaybeFetchRemoteRules() {
  const mod = await import(`../../src/background/remote-rules-wake.js?cb=${Math.random()}`);
  return mod.maybeFetchRemoteRules;
}

const VALID_CONSENT_RECORD = { onboardingDone: true, consentVersion: TERMS_VERSION, consentDate: Date.now() };

describe("maybeFetchRemoteRules — throttle survives real fetch outcomes across SW lifetimes", () => {
  test("a successful fetch persists fetchedAt, and a later lifetime inside the interval does not re-fetch", async () => {
    const { localStore } = installChromeStub(
      { remoteRulesEnabled: true },
      { mugaConsent: VALID_CONSENT_RECORD },
    );
    const trustedKeys = [testPubKeyBase64()];

    // Lifetime A: nothing stored yet, so the fetch fires and succeeds.
    let attemptsA = 0;
    const fetchImplA = async (...args) => {
      attemptsA++;
      return makeSignedFetchImpl(["remote_tracker_a"])(...args);
    };
    const maybeFetchA = await freshMaybeFetchRemoteRules();
    await maybeFetchA(makeProdShapedDeps({ fetchImpl: fetchImplA, trustedKeys }));

    assert.strictEqual(attemptsA, 1, "lifetime A must attempt the fetch (nothing stored yet)");
    assert.ok(localStore.remoteParams, "the real pipeline ran and persisted remoteParams");
    assert.ok(localStore.remoteRulesMeta?.fetchedAt, "fetchedAt must be recorded on success");

    // Lifetime B: a fresh module instance (simulated SW restart), reading
    // the SAME persisted storage lifetime A just wrote to.
    let attemptsB = 0;
    const fetchImplB = async (...args) => { attemptsB++; return makeSignedFetchImpl(["remote_tracker_b"])(...args); };
    const maybeFetchB = await freshMaybeFetchRemoteRules();
    await maybeFetchB(makeProdShapedDeps({ fetchImpl: fetchImplB, trustedKeys }));

    assert.strictEqual(attemptsB, 0, "a fresh lifetime inside the 7-day window must not re-fetch");
  });

  test("a recorded error does not permanently wedge later lifetimes", async () => {
    const { localStore } = installChromeStub(
      { remoteRulesEnabled: true },
      { mugaConsent: VALID_CONSENT_RECORD },
    );
    const trustedKeys = [testPubKeyBase64()];

    // Lifetime A: the fetch fails at the network layer.
    const maybeFetchA = await freshMaybeFetchRemoteRules();
    await maybeFetchA(makeProdShapedDeps({ fetchImpl: makeFailingFetchImpl(), trustedKeys }));

    assert.strictEqual(
      localStore.remoteRulesMeta?.fetchedAt,
      null,
      "a failed fetch must not record fetchedAt — only lastError",
    );
    assert.ok(
      localStore.remoteRulesMeta?.lastError,
      "the failure is recorded as lastError (proves the real error path ran, not a swallowed no-op)",
    );

    // Lifetime B: a later wake tries again — fetchedAt was never set, so
    // the throttle does not block it, and this time the fetch succeeds.
    let attemptedB = false;
    const fetchImplB = async (...args) => { attemptedB = true; return makeSignedFetchImpl(["remote_tracker_c"])(...args); };
    const maybeFetchB = await freshMaybeFetchRemoteRules();
    await maybeFetchB(makeProdShapedDeps({ fetchImpl: fetchImplB, trustedKeys }));

    assert.ok(attemptedB, "a later lifetime must still attempt the fetch — the earlier error did not wedge it");
    assert.ok(localStore.remoteRulesMeta?.fetchedAt, "the retry succeeds and records fetchedAt");
  });
});
