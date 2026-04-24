/**
 * MUGA — Integration-style unit tests for the remote-rules pipeline (T2.5)
 *
 * Covers the end-to-end path from alarm fire → fetch → verify → validate → merge → DNR → cleaner.
 * Uses in-memory fakes for storage and DNR, and a test-only Ed25519 keypair.
 *
 * Acceptance scenarios covered:
 *   SC-02  — happy path: signed payload → remoteParams written → DNR rule 1001 added
 *   SC-03  — disable path: clearRemoteCache removes remoteParams + rule 1001, leaves rule 1000
 *   SC-12  — remote param collision with built-in is silently dropped (dedup, not rejection)
 *
 * Not unit-testable here (documented as deferred):
 *   SC-10  — service worker killed mid-fetch: module state resets on worker restart
 *             (correct behavior by design; not mockable in unit test layer)
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

// ── Test-only Ed25519 keypair ─────────────────────────────────────────────────
// Generated once per test module. NEVER commit a real private key.
const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
  generateKeyPairSync("ed25519");

/** Sign a canonical string with the test key → base64url. */
function signMessage(msg) {
  const buf = cryptoSign(null, Buffer.from(msg, "utf8"), TEST_PRIV_KEY);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Export raw 32-byte public key as standard base64 (with padding). */
function testPubKeyBase64() {
  const der = TEST_PUB_KEY.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

// ── Imports ───────────────────────────────────────────────────────────────────
import {
  runRemoteRulesFetch,
  clearRemoteCache,
  canonicalMessage,
  REMOTE_RULE_ID,
  ERR,
} from "../../src/lib/remote-rules.js";

import { processUrl } from "../../src/lib/cleaner.js";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../../src/lib/dnr-ids.js";

// ── In-memory fakes ───────────────────────────────────────────────────────────

function makeStorageFake(initial = {}) {
  const store = { ...initial };
  return {
    get(defaults) {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      }
      return Promise.resolve(result);
    },
    set(items) {
      Object.assign(store, items);
      return Promise.resolve();
    },
    remove(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete store[k];
      return Promise.resolve();
    },
    _raw: store,
  };
}

function makeDnrFake() {
  const calls = [];
  return {
    updateDynamicRules(opts) { calls.push(JSON.parse(JSON.stringify(opts))); return Promise.resolve(); },
    _calls: calls,
  };
}

/**
 * Build a valid signed payload and return a fake fetch implementation
 * that resolves with those bytes.
 */
function makeSignedFetch(params, version = 1) {
  const published = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
  const canonical = canonicalMessage(version, published, params);
  const sig = signMessage(canonical);
  const payload = { version, published, params, sig };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");

  function fakeBody() {
    let done = false;
    return {
      getReader() {
        return {
          read() {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: new Uint8Array(bytes) });
          },
          cancel() { return Promise.resolve(); },
        };
      },
    };
  }

  const fetchImpl = () => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: fakeBody(),
  });

  return { fetchImpl, payload, published };
}

// ── SC-02: Happy path — fetch → verify → merge → DNR ─────────────────────────

describe("SC-02 — Happy path: signed payload merges into storage and DNR", () => {
  let storage, dnr;

  before(async () => {
    const remoteParams = ["remote_tracker_x", "remote_tracker_y"];
    const { fetchImpl } = makeSignedFetch(remoteParams, 1);
    storage = makeStorageFake({});
    dnr = makeDnrFake();

    await runRemoteRulesFetch({
      fetchImpl,
      subtle: globalThis.crypto.subtle,
      trustedKeys: [testPubKeyBase64()],
      storage,
      dnr,
    });
  });

  test("remoteParams written to storage after successful fetch", () => {
    const stored = storage._raw.remoteParams;
    assert.ok(Array.isArray(stored), "remoteParams must be an array in storage");
    assert.ok(stored.length > 0, "remoteParams must have entries after successful fetch");
    assert.ok(stored.includes("remote_tracker_x"), "remote_tracker_x must be in remoteParams");
    assert.ok(stored.includes("remote_tracker_y"), "remote_tracker_y must be in remoteParams");
  });

  test("remoteRulesMeta.fetchedAt is written to storage", () => {
    const meta = storage._raw.remoteRulesMeta;
    assert.ok(meta, "remoteRulesMeta must be written");
    assert.ok(typeof meta.fetchedAt === "string" && meta.fetchedAt.length > 0, "fetchedAt must be a non-empty string");
    assert.strictEqual(meta.lastError, null, "lastError must be null on success");
  });

  test("DNR updateDynamicRules called with rule 1001 containing remote params", () => {
    assert.ok(dnr._calls.length >= 1, "updateDynamicRules must be called at least once");
    const addCall = dnr._calls.find(c => c.addRules && c.addRules.length > 0);
    assert.ok(addCall, "at least one call must add rules");
    assert.strictEqual(addCall.addRules[0].id, REMOTE_RULE_ID, "rule id must be 1001");
    assert.strictEqual(addCall.addRules[0].id, 1001);
    const removeParams = addCall.addRules[0].action.redirect.transform.queryTransform.removeParams;
    assert.ok(removeParams.includes("remote_tracker_x"), "DNR rule must contain remote_tracker_x");
    assert.ok(removeParams.includes("remote_tracker_y"), "DNR rule must contain remote_tracker_y");
  });

  test("rule 1000 (custom params) is NOT touched by the remote-rules fetch", () => {
    for (const call of dnr._calls) {
      assert.ok(
        !(call.removeRuleIds ?? []).includes(DNR_CUSTOM_PARAMS_RULE_ID),
        `rule 1000 must not appear in removeRuleIds (call: ${JSON.stringify(call)})`
      );
      assert.ok(
        !(call.addRules ?? []).some(r => r.id === DNR_CUSTOM_PARAMS_RULE_ID),
        "rule 1000 must not appear in addRules during remote-rules fetch"
      );
    }
  });

  test("prefs.remoteParams populated — cleaner strips a remote param from a URL", () => {
    // Simulate reading prefs after the fetch (what the cleaner sees)
    const remoteParamsFromStorage = storage._raw.remoteParams;
    assert.ok(remoteParamsFromStorage.length > 0);

    const prefs = {
      enabled: true,
      onboardingDone: true,
      customParams: [],
      remoteParams: remoteParamsFromStorage,
      blacklist: [],
      whitelist: [],
      disabledCategories: [],
      dnrEnabled: true,
      stripAllAffiliates: false,
      ampRedirect: false,
      unwrapRedirects: false,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
    };

    const dirtyUrl = "https://example.com/page?remote_tracker_x=abc&keep_me=1";
    const result = processUrl(dirtyUrl, prefs, []);
    assert.ok(result.cleanUrl.includes("keep_me=1"), "keep_me must survive stripping");
    assert.ok(
      !result.cleanUrl.includes("remote_tracker_x"),
      "remote_tracker_x must be stripped by cleaner when in prefs.remoteParams"
    );
  });
});

// ── SC-03: Disable path — clearRemoteCache ────────────────────────────────────

describe("SC-03 — Disable path: clearRemoteCache clears storage and removes rule 1001", () => {
  let storage, dnr;

  before(async () => {
    // Pre-populate storage as if a prior fetch succeeded
    storage = makeStorageFake({
      remoteParams: ["remote_tracker_a"],
      remoteRulesMeta: { version: 1, fetchedAt: new Date().toISOString(), paramCount: 1, lastError: null, published: "2026-01-01T00:00:00Z" },
    });
    dnr = makeDnrFake();

    await clearRemoteCache({ storage, dnr });
  });

  test("remoteParams removed from storage", () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(storage._raw, "remoteParams"), "remoteParams must be removed");
  });

  test("remoteRulesMeta removed from storage", () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(storage._raw, "remoteRulesMeta"), "remoteRulesMeta must be removed");
  });

  test("DNR updateDynamicRules called with removeRuleIds: [1001]", () => {
    assert.ok(dnr._calls.length >= 1, "updateDynamicRules must be called");
    const removeCall = dnr._calls.find(c => (c.removeRuleIds ?? []).includes(REMOTE_RULE_ID));
    assert.ok(removeCall, "a call must remove rule 1001");
    assert.ok(!(removeCall.addRules ?? []).some(r => r.id === REMOTE_RULE_ID), "must not re-add rule 1001 on clear");
  });

  test("rule 1000 (custom params) is NOT touched on disable", () => {
    for (const call of dnr._calls) {
      assert.ok(
        !(call.removeRuleIds ?? []).includes(DNR_CUSTOM_PARAMS_RULE_ID),
        "rule 1000 must never be in removeRuleIds during clearRemoteCache"
      );
      assert.ok(
        !(call.addRules ?? []).some(r => r.id === DNR_CUSTOM_PARAMS_RULE_ID),
        "rule 1000 must never be in addRules during clearRemoteCache"
      );
    }
  });
});

// ── SC-12: Remote param collides with built-in — silent dedup ─────────────────

describe("SC-12 — Remote param collision with built-in: silent dedup, not rejection", () => {
  test("duplicate params are silently dropped from remoteParams; non-duplicates are kept", async () => {
    // "fbclid" is a known built-in tracking param in affiliates.js
    // "remote_unique_abc" is not in the built-in list
    // The pipeline should drop fbclid silently and keep remote_unique_abc
    const remoteParams = ["remote_unique_abc", "fbclid"]; // fbclid is built-in
    const { fetchImpl } = makeSignedFetch(remoteParams, 2);

    const storage = makeStorageFake({});
    const dnr = makeDnrFake();

    await runRemoteRulesFetch({
      fetchImpl,
      subtle: globalThis.crypto.subtle,
      trustedKeys: [testPubKeyBase64()],
      storage,
      dnr,
    });

    const stored = storage._raw.remoteParams;
    // If dedup ran, fbclid should be absent (it's already in built-ins)
    // remote_unique_abc should be present (it's not in built-ins)
    assert.ok(Array.isArray(stored), "remoteParams must be an array");
    assert.ok(stored.includes("remote_unique_abc"), "unique remote param must be kept");
    // fbclid is in built-ins, so it should be silently dropped
    assert.ok(!stored.includes("fbclid"), "fbclid must be silently deduped (already in built-ins)");
    // No error — this is NOT a payload rejection
    const meta = storage._raw.remoteRulesMeta;
    assert.strictEqual(meta.lastError, null, "dedup must not set lastError (SC-12 is a dedup, not rejection)");
  });
});

// ── Dedup guard (SC-11): smoke test at runRemoteRulesFetch level ──────────────

describe("SC-11 — Dedup guard: concurrent alarm fires drop the second trigger", () => {
  test("second runRemoteRulesFetch call during in-flight fetch is dropped silently", async () => {
    let resolveFirst;
    let firstStarted = false;
    let fetchCallCount = 0;

    const slowFetch = () => {
      fetchCallCount++;
      return new Promise((resolve) => {
        firstStarted = true;
        resolveFirst = () => {
          // Return a valid signed payload
          const params = ["dedup_test_param"];
          const published = new Date(Date.now() - 1000).toISOString();
          const canonical = canonicalMessage(1, published, params);
          const sig = signMessage(canonical);
          const payload = { version: 1, published, params, sig };
          const bytes = Buffer.from(JSON.stringify(payload), "utf8");
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: {
              getReader() {
                let done = false;
                return {
                  read() {
                    if (done) return Promise.resolve({ done: true });
                    done = true;
                    return Promise.resolve({ done: false, value: new Uint8Array(bytes) });
                  },
                  cancel() { return Promise.resolve(); },
                };
              },
            },
          });
        };
      });
    };

    const storage = makeStorageFake({});
    const dnr = makeDnrFake();
    const deps = {
      fetchImpl: slowFetch,
      subtle: globalThis.crypto.subtle,
      trustedKeys: [testPubKeyBase64()],
      storage,
      dnr,
    };

    // Start first fetch (will hang until resolveFirst is called)
    const first = runRemoteRulesFetch(deps);
    // Wait until the first fetch has started
    await new Promise(r => { const poll = setInterval(() => { if (firstStarted) { clearInterval(poll); r(); } }, 1); });

    // Second fire while first is in-flight — must be dropped
    await runRemoteRulesFetch(deps);
    assert.strictEqual(fetchCallCount, 1, "fetch must only be called once (dedup guard drops second)");

    // Resolve the first fetch
    resolveFirst();
    await first;

    assert.strictEqual(fetchCallCount, 1, "fetch count stays 1 after first completes");
  });
});
