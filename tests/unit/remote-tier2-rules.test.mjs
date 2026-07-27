/**
 * MUGA — Unit tests for src/lib/remote-tier2-rules.js (#1027 Slice 2, PR B1)
 *
 * Coverage:
 *   - canonicalTier2Message: deterministic output, domain-tagged (distinct
 *     from params' canonicalMessage — defeats cross-type signature replay)
 *   - validateTier2PayloadShape: exact top-level key enforcement
 *   - validateTier2Rules: adversarial battery — exact rule shape, id
 *     format/uniqueness, selector array/length bounds, rule-count cap,
 *     accept-token scan, version/freshness anti-rollback, ADD-only collision
 *   - mergeIntoTier2Cache: storage-only write, version-floor advance
 *   - runTier2RulesFetch: orchestrator — happy path + fail-closed matrix
 *     (bad sig, params-signature replay, stale/rolled-back/future version,
 *     over-cap, malformed/extra-key payload, id-collision, token-hit)
 *
 * B1 note: this pipeline only WRITES chrome.storage.local. Nothing reads
 * `remoteTier2Rules` yet (PR B2 adds the content-script read) — every test
 * here only asserts fetch/validate/storage behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

// ── Test-only Ed25519 keypair (NEVER a real signing key) ─────────────────────
const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
  generateKeyPairSync("ed25519");

function signMessage(msg) {
  const sigBuf = cryptoSign(null, Buffer.from(msg, "utf8"), TEST_PRIV_KEY);
  return sigBuf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function testPubKeyBase64() {
  const der = TEST_PUB_KEY.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

// ── Imports (tested module) ──────────────────────────────────────────────────
import {
  canonicalTier2Message,
  validateTier2PayloadShape,
  validateTier2Rules,
  mergeIntoTier2Cache,
  runTier2RulesFetch,
  REMOTE_TIER2_RULES_URL,
  MAX_TIER2_PAYLOAD_BYTES,
  MAX_TIER2_RULES,
  MAX_SELECTORS_PER_ARRAY,
  MAX_SELECTOR_LEN,
  MAX_TIER2_ID_LEN,
  STALE_DAYS_TIER2,
  TIER2_ID_FORMAT_RE,
  TIER2_RULE_KEYS,
  BUNDLED_TIER2_IDS,
  ERR,
} from "../../src/lib/remote-tier2-rules.js";
import { canonicalMessage } from "../../src/lib/remote-rules.js";
import { TIER2_RULES } from "../../src/lib/cmp-tier2-rules.js";

// ── In-memory storage fake ────────────────────────────────────────────────────

function makeStorageFake(initial = {}) {
  const store = { ...initial };
  return {
    get(defaults) {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          result[key] = store[key];
        }
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

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
  return {
    id: "acme-cmp",
    present: ["#acme-banner"],
    reject: [".acme-reject"],
    openSettings: [],
    ...overrides,
  };
}

/** Builds a valid, signed Tier2 payload object (not yet JSON-stringified). */
function makeValidPayload({
  version = 1,
  published = new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h ago
  rules = [makeRule()],
  schemaVersion = 1,
} = {}) {
  const canonical = canonicalTier2Message(version, published, rules);
  const sig = signMessage(canonical);
  return { schemaVersion, version, published, rules, sig };
}

/** Creates a fake fetch that returns the given string/Uint8Array body. */
function fakeFetch(body) {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return async () => {
    let done = false;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
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
      },
    };
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

describe("Constants — shape and values", () => {
  test("REMOTE_TIER2_RULES_URL is the sibling tier2.json endpoint", () => {
    assert.strictEqual(REMOTE_TIER2_RULES_URL, "https://rules.muga.app/rules/v1/tier2.json");
  });

  test("caps match design ADR-4", () => {
    assert.strictEqual(MAX_TIER2_PAYLOAD_BYTES, 32 * 1024);
    assert.strictEqual(MAX_TIER2_RULES, 40);
    assert.strictEqual(MAX_SELECTORS_PER_ARRAY, 5);
    assert.strictEqual(MAX_SELECTOR_LEN, 200);
    assert.strictEqual(MAX_TIER2_ID_LEN, 64);
    assert.strictEqual(STALE_DAYS_TIER2, 60);
  });

  test("TIER2_ID_FORMAT_RE accepts lowercase-alphanumeric-hyphen only", () => {
    assert.ok(TIER2_ID_FORMAT_RE.test("acme-cmp-2"));
    assert.ok(!TIER2_ID_FORMAT_RE.test("Acme"));
    assert.ok(!TIER2_ID_FORMAT_RE.test("acme_cmp"));
    assert.ok(!TIER2_ID_FORMAT_RE.test("acme cmp"));
  });

  test("BUNDLED_TIER2_IDS matches the bundled TIER2_RULES ids", () => {
    assert.deepEqual([...BUNDLED_TIER2_IDS].sort(), TIER2_RULES.map((r) => r.id).sort());
  });

  test("ERR dictionary has the expected codes", () => {
    assert.strictEqual(ERR.SCHEMA_ERROR, "SCHEMA_ERROR");
    assert.strictEqual(ERR.VERIFY_FAILED, "VERIFY_FAILED");
    assert.strictEqual(ERR.DENYLIST_HIT, "DENYLIST_HIT");
    assert.strictEqual(ERR.OVER_CAP, "OVER_CAP");
    assert.strictEqual(ERR.VERSION_REGRESSION, "VERSION_REGRESSION");
    assert.strictEqual(ERR.STALE_PAYLOAD, "STALE_PAYLOAD");
    assert.strictEqual(ERR.ID_COLLISION, "ID_COLLISION");
    assert.strictEqual(ERR.NETWORK_ERROR, "NETWORK_ERROR");
  });
});

// ── canonicalTier2Message — domain-tagged, deterministic ────────────────────

describe("canonicalTier2Message — domain-tagged canonical form", () => {
  test("is deterministic for the same inputs", () => {
    const rules = [makeRule()];
    const a = canonicalTier2Message(1, "2026-07-01T00:00:00Z", rules);
    const b = canonicalTier2Message(1, "2026-07-01T00:00:00Z", rules);
    assert.strictEqual(a, b);
  });

  test("starts with the 'tier2|' domain tag", () => {
    const msg = canonicalTier2Message(1, "2026-07-01T00:00:00Z", [makeRule()]);
    assert.ok(msg.startsWith("tier2|1|2026-07-01T00:00:00Z|"));
  });

  test("is structurally distinct from params' canonicalMessage for the 'same' version/published", () => {
    const version = 1;
    const published = "2026-07-01T00:00:00Z";
    const rules = [makeRule()];
    const tier2Msg = canonicalTier2Message(version, published, rules);
    // A params payload can never share this exact string, no matter what
    // params array is chosen, because canonicalMessage has no "tier2|" tag
    // and joins params with "," rather than JSON.stringify-ing objects.
    const paramsMsg = canonicalMessage(version, published, ["a", "b"]);
    assert.notStrictEqual(tier2Msg, paramsMsg);
    assert.ok(!paramsMsg.startsWith("tier2|"));
  });

  test("selector special characters are safely escaped via JSON.stringify", () => {
    const rules = [makeRule({ reject: ['div[data-x="a,b"]'] })];
    const msg = canonicalTier2Message(1, "2026-07-01T00:00:00Z", rules);
    // Must be parseable back out of the JSON tail.
    const jsonTail = msg.slice("tier2|1|2026-07-01T00:00:00Z|".length);
    const parsed = JSON.parse(jsonTail);
    assert.deepEqual(parsed[0][2], ['div[data-x="a,b"]']);
  });
});

// ── validateTier2PayloadShape ─────────────────────────────────────────────────

describe("validateTier2PayloadShape — exact top-level shape", () => {
  test("accepts a well-formed payload", () => {
    const payload = makeValidPayload();
    const result = validateTier2PayloadShape(payload);
    assert.strictEqual(result.ok, true);
  });

  test("rejects a payload with an extra top-level key", () => {
    const payload = { ...makeValidPayload(), accept: true };
    const result = validateTier2PayloadShape(payload);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects a payload missing a required key", () => {
    const payload = makeValidPayload();
    delete payload.published;
    const result = validateTier2PayloadShape(payload);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects schemaVersion !== 1", () => {
    const payload = { ...makeValidPayload(), schemaVersion: 2 };
    assert.strictEqual(validateTier2PayloadShape(payload).ok, false);
  });

  test("rejects non-integer version", () => {
    const payload = { ...makeValidPayload(), version: 1.5 };
    assert.strictEqual(validateTier2PayloadShape(payload).ok, false);
  });

  test("rejects empty/whitespace published", () => {
    const payload = { ...makeValidPayload(), published: "   " };
    assert.strictEqual(validateTier2PayloadShape(payload).ok, false);
  });

  test("rejects rules that is not an array", () => {
    const payload = { ...makeValidPayload(), rules: {} };
    assert.strictEqual(validateTier2PayloadShape(payload).ok, false);
  });

  test("rejects sig that is not a string", () => {
    const payload = { ...makeValidPayload(), sig: 12345 };
    assert.strictEqual(validateTier2PayloadShape(payload).ok, false);
  });

  test("rejects non-object rule elements (null/array/primitive) before canonicalisation, never throws", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const payload = { ...makeValidPayload(), rules: [bad] };
      let result;
      assert.doesNotThrow(() => { result = validateTier2PayloadShape(payload); });
      assert.strictEqual(result.ok, false, `rules:[${JSON.stringify(bad)}] must fail shape`);
      assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
    }
  });

  test("rejects null / array / non-object top-level values", () => {
    assert.strictEqual(validateTier2PayloadShape(null).ok, false);
    assert.strictEqual(validateTier2PayloadShape([]).ok, false);
    assert.strictEqual(validateTier2PayloadShape("nope").ok, false);
  });
});

// ── validateTier2Rules — adversarial battery ─────────────────────────────────

describe("validateTier2Rules — adversarial battery", () => {
  const baseOpts = () => ({
    version: 5,
    published: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    versionFloor: 4,
    bundledIds: new Set(["complianz", "cookie-notice"]),
    nowMs: Date.now(),
  });

  test("accepts a well-formed single rule", () => {
    const result = validateTier2Rules([makeRule()], baseOpts());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.rules.length, 1);
  });

  test("accepts openSettings as an empty array (no two-step path)", () => {
    const result = validateTier2Rules([makeRule({ openSettings: [] })], baseOpts());
    assert.strictEqual(result.ok, true);
  });

  test("rejects a rule with a 5th key (e.g. an 'accept' field)", () => {
    const rule = { ...makeRule(), accept: [".acme-accept"] };
    const result = validateTier2Rules([rule], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects a rule missing a required key", () => {
    const rule = makeRule();
    delete rule.openSettings;
    const result = validateTier2Rules([rule], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects id with uppercase/symbols (format violation)", () => {
    const result = validateTier2Rules([makeRule({ id: "Acme_CMP" })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects id longer than MAX_TIER2_ID_LEN", () => {
    const longId = "a".repeat(MAX_TIER2_ID_LEN + 1);
    const result = validateTier2Rules([makeRule({ id: longId })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects duplicate ids within the same payload (remote-vs-remote dup)", () => {
    const rules = [makeRule({ id: "dup-id" }), makeRule({ id: "dup-id", present: ["#other"] })];
    const result = validateTier2Rules(rules, baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects an empty present[] (must have 1..5 selectors)", () => {
    const result = validateTier2Rules([makeRule({ present: [] })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects present[] over MAX_SELECTORS_PER_ARRAY", () => {
    const tooMany = Array.from({ length: MAX_SELECTORS_PER_ARRAY + 1 }, (_, i) => `#s${i}`);
    const result = validateTier2Rules([makeRule({ present: tooMany })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects openSettings[] over MAX_SELECTORS_PER_ARRAY", () => {
    const tooMany = Array.from({ length: MAX_SELECTORS_PER_ARRAY + 1 }, (_, i) => `#s${i}`);
    const result = validateTier2Rules([makeRule({ openSettings: tooMany })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects a selector longer than MAX_SELECTOR_LEN", () => {
    const longSelector = "." + "a".repeat(MAX_SELECTOR_LEN);
    const result = validateTier2Rules([makeRule({ reject: [longSelector] })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("rejects an empty-string selector", () => {
    const result = validateTier2Rules([makeRule({ reject: [""] })], baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.SCHEMA_ERROR);
  });

  test("token-scan: a selector containing 'accept' rejects the WHOLE payload", () => {
    const rules = [
      makeRule({ id: "clean-rule" }),
      makeRule({ id: "hostile-rule", reject: [".btn-accept-all"] }),
    ];
    const result = validateTier2Rules(rules, baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.DENYLIST_HIT);
  });

  test("token-scan: case-insensitive and applies to openSettings too", () => {
    const result = validateTier2Rules(
      [makeRule({ openSettings: [".ALLOWALL-panel"] })],
      baseOpts(),
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.DENYLIST_HIT);
  });

  test("token-scan: a generic selector with NO forbidden token passes this layer (spec hostile scenario)", () => {
    // Mirrors the spec's hostile-signed-payload scenario: a selector like
    // .btn-primary carries no forbidden token string and must pass HERE —
    // it is defeated later by the runtime click-veto (PR A, content-side),
    // not by this validator.
    const result = validateTier2Rules([makeRule({ reject: [".btn-primary"] })], baseOpts());
    assert.strictEqual(result.ok, true);
  });

  test("rejects payload exceeding MAX_TIER2_RULES (OVER_CAP)", () => {
    const rules = Array.from({ length: MAX_TIER2_RULES + 1 }, (_, i) =>
      makeRule({ id: `rule-${i}`, present: [`#p${i}`] }));
    const result = validateTier2Rules(rules, baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.OVER_CAP);
  });

  test("accepts exactly MAX_TIER2_RULES rules", () => {
    const rules = Array.from({ length: MAX_TIER2_RULES }, (_, i) =>
      makeRule({ id: `rule-${i}`, present: [`#p${i}`] }));
    const result = validateTier2Rules(rules, baseOpts());
    assert.strictEqual(result.ok, true);
  });

  test("rejects version <= versionFloor (VERSION_REGRESSION, rollback attempt)", () => {
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), version: 4, versionFloor: 4 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.VERSION_REGRESSION);
  });

  test("rejects version strictly lower than versionFloor", () => {
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), version: 2, versionFloor: 4 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.VERSION_REGRESSION);
  });

  test("accepts version strictly greater than versionFloor", () => {
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), version: 5, versionFloor: 4 });
    assert.strictEqual(result.ok, true);
  });

  test("rejects a stale payload beyond STALE_DAYS_TIER2", () => {
    const stalePublished = new Date(Date.now() - (STALE_DAYS_TIER2 + 1) * 24 * 60 * 60 * 1000).toISOString();
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), published: stalePublished });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.STALE_PAYLOAD);
  });

  test("rejects a future-dated payload beyond clock-skew tolerance", () => {
    const futurePublished = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), published: futurePublished });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.STALE_PAYLOAD);
  });

  test("rejects a malformed published date string", () => {
    const result = validateTier2Rules([makeRule()], { ...baseOpts(), published: "not-a-date" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.STALE_PAYLOAD);
  });

  test("ADD-only: rejects the WHOLE payload when one rule's id collides with a bundled id", () => {
    const rules = [
      makeRule({ id: "fresh-rule" }),
      makeRule({ id: "complianz", present: ["#other"], reject: [".other-reject"] }),
    ];
    const result = validateTier2Rules(rules, baseOpts());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, ERR.ID_COLLISION);
  });

  test("ADD-only: a fresh id with no bundled collision is accepted", () => {
    const result = validateTier2Rules([makeRule({ id: "fresh-rule" })], baseOpts());
    assert.strictEqual(result.ok, true);
  });
});

// ── mergeIntoTier2Cache ───────────────────────────────────────────────────────

describe("mergeIntoTier2Cache — storage-only write", () => {
  test("writes remoteTier2Rules and remoteTier2Meta", async () => {
    const storage = makeStorageFake();
    const rules = [makeRule()];
    const meta = { version: 3, fetchedAt: "2026-07-01T00:00:00Z", ruleCount: 1, lastError: null, published: "2026-06-01T00:00:00Z" };

    await mergeIntoTier2Cache(rules, meta, { storage });

    const stored = await storage.get({ remoteTier2Rules: null, remoteTier2Meta: null });
    assert.deepEqual(stored.remoteTier2Rules, rules);
    assert.deepEqual(stored.remoteTier2Meta, meta);
  });

  test("advances remoteTier2VersionFloor to the max of prior floor and new version", async () => {
    const storage = makeStorageFake({ remoteTier2VersionFloor: 3 });
    await mergeIntoTier2Cache([makeRule()], { version: 7, fetchedAt: null, ruleCount: 1, lastError: null, published: null }, { storage });
    const stored = await storage.get({ remoteTier2VersionFloor: 0 });
    assert.strictEqual(stored.remoteTier2VersionFloor, 7);
  });

  test("does not lower an existing higher floor", async () => {
    const storage = makeStorageFake({ remoteTier2VersionFloor: 9 });
    await mergeIntoTier2Cache([makeRule()], { version: 7, fetchedAt: null, ruleCount: 1, lastError: null, published: null }, { storage });
    const stored = await storage.get({ remoteTier2VersionFloor: 0 });
    assert.strictEqual(stored.remoteTier2VersionFloor, 9);
  });

  test("throws if called with more rules than MAX_TIER2_RULES (defense-in-depth)", async () => {
    const storage = makeStorageFake();
    const tooMany = Array.from({ length: MAX_TIER2_RULES + 1 }, (_, i) => makeRule({ id: `r${i}` }));
    await assert.rejects(() => mergeIntoTier2Cache(tooMany, { version: 1 }, { storage }));
  });
});

// ── runTier2RulesFetch — orchestrator, fail-closed matrix ───────────────────

describe("runTier2RulesFetch — orchestrator (fail-closed matrix)", () => {
  const subtle = globalThis.crypto?.subtle;
  const testPubB64 = testPubKeyBase64();

  function makeDeps({ overrideFetch, storedMeta, storedRules, storedFloor } = {}) {
    const storage = makeStorageFake({
      remoteTier2Rules: storedRules ?? [],
      remoteTier2Meta: storedMeta ?? { version: 0, fetchedAt: null, ruleCount: 0, lastError: null, published: null },
      remoteTier2VersionFloor: storedFloor ?? 0,
    });
    return {
      fetchImpl: overrideFetch ?? fakeFetch(JSON.stringify(makeValidPayload())),
      subtle,
      nowMs: Date.now(),
      storage,
      trustedKeys: [testPubB64],
    };
  }

  test("happy path: valid signed payload → rules written to storage", async () => {
    const deps = makeDeps();
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.strictEqual(result.remoteTier2Rules.length, 1);
    assert.strictEqual(result.remoteTier2Rules[0].id, "acme-cmp");
    assert.ok(result.remoteTier2Meta.fetchedAt);
    assert.strictEqual(result.remoteTier2Meta.lastError, null);
  });

  test("bad signature → VERIFY_FAILED, cache untouched", async () => {
    const prevRules = [makeRule({ id: "prev-rule" })];
    const prevMeta = { version: 1, fetchedAt: "2026-01-01T00:00:00Z", ruleCount: 1, lastError: null, published: "2026-01-01T00:00:00Z" };
    const badPayload = { ...makeValidPayload({ version: 2 }), sig: "aGVsbG8-d29ybGQ=" };

    const deps = makeDeps({
      overrideFetch: fakeFetch(JSON.stringify(badPayload)),
      storedRules: prevRules,
      storedMeta: prevMeta,
      storedFloor: 1,
    });

    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: prevRules, remoteTier2Meta: prevMeta });
    assert.deepEqual(result.remoteTier2Rules, prevRules, "cache must be untouched on VERIFY_FAILED");
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.VERIFY_FAILED);
  });

  test("params-signature replayed as a Tier2 payload is defeated by the domain tag", async () => {
    // Sign the OLD params-style canonical message (no 'tier2|' tag) with the
    // SAME shared key, then try to pass it off as a Tier2 payload with the
    // exact same version/published/rules. Since verifySignature checks the
    // signature against canonicalTier2Message (domain-tagged), this MUST
    // fail verification even though the key is genuinely trusted.
    const version = 3;
    const published = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const rules = [makeRule()];
    // Sign the PARAMS canonical form instead of the Tier2 one.
    const paramsStyleCanonical = canonicalMessage(version, published, ["a", "b"]);
    const replaySig = signMessage(paramsStyleCanonical);
    const replayedPayload = { schemaVersion: 1, version, published, rules, sig: replaySig };

    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(replayedPayload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, [], "a params-signed message must never verify as Tier2");
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.VERIFY_FAILED);
  });

  test("stale/rolled-back version → VERSION_REGRESSION, cache untouched", async () => {
    const prevRules = [makeRule({ id: "current-rule" })];
    const prevMeta = { version: 5, fetchedAt: null, ruleCount: 1, lastError: null, published: null };
    const regressionPayload = makeValidPayload({ version: 3 }); // < stored floor 5

    const deps = makeDeps({
      overrideFetch: fakeFetch(JSON.stringify(regressionPayload)),
      storedRules: prevRules,
      storedMeta: prevMeta,
      storedFloor: 5,
    });

    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: prevRules, remoteTier2Meta: prevMeta });
    assert.deepEqual(result.remoteTier2Rules, prevRules);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.VERSION_REGRESSION);
  });

  test("future-dated payload → STALE_PAYLOAD, cache untouched", async () => {
    const futurePublished = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const futurePayload = makeValidPayload({ published: futurePublished });

    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(futurePayload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.STALE_PAYLOAD);
  });

  test("over-cap payload (41 rules) → OVER_CAP, cache untouched", async () => {
    const tooMany = Array.from({ length: MAX_TIER2_RULES + 1 }, (_, i) =>
      makeRule({ id: `rule-${i}`, present: [`#p${i}`] }));
    const overCapPayload = makeValidPayload({ rules: tooMany });

    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(overCapPayload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.OVER_CAP);
  });

  test("extra top-level key → SCHEMA_ERROR, cache untouched", async () => {
    const payload = { ...makeValidPayload(), accept: true };
    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(payload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.SCHEMA_ERROR);
  });

  test("extra rule key → SCHEMA_ERROR, cache untouched (whole payload rejected)", async () => {
    const badRule = { ...makeRule(), accept: [".danger"] };
    const payload = makeValidPayload({ rules: [badRule] });
    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(payload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.SCHEMA_ERROR);
  });

  test("id-collision with a bundled rule → ID_COLLISION, cache untouched, bundled rules unaffected", async () => {
    const rules = [makeRule({ id: "fresh-rule" }), makeRule({ id: "complianz", present: ["#x"], reject: [".y"] })];
    const payload = makeValidPayload({ rules });
    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(payload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, [], "no rule from a colliding payload may be merged, including the fresh one");
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.ID_COLLISION);
    // Bundled rules live in a separate module never written by this pipeline.
    assert.ok(TIER2_RULES.find((r) => r.id === "complianz"), "bundled rule module itself is untouched by this fetch pipeline");
  });

  test("selector token-hit (e.g. '.btn-accept-all') → DENYLIST_HIT, whole payload rejected", async () => {
    const payload = makeValidPayload({ rules: [makeRule({ reject: [".btn-accept-all"] })] });
    const deps = makeDeps({ overrideFetch: fakeFetch(JSON.stringify(payload)) });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.DENYLIST_HIT);
  });

  test("malformed (non-JSON) body → SCHEMA_ERROR, cache untouched", async () => {
    const deps = makeDeps({ overrideFetch: fakeFetch("{not valid json") });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.SCHEMA_ERROR);
  });

  test("oversized body (> MAX_TIER2_PAYLOAD_BYTES) → rejected, cache untouched", async () => {
    const chunkSize = 1024;
    const chunks = Math.ceil((MAX_TIER2_PAYLOAD_BYTES + 2048) / chunkSize);
    let idx = 0;
    const overCapFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            read() {
              if (idx >= chunks) return Promise.resolve({ done: true, value: undefined });
              idx++;
              return Promise.resolve({ done: false, value: new Uint8Array(chunkSize) });
            },
            cancel() { return Promise.resolve(); },
          };
        },
      },
    });

    const deps = makeDeps({ overrideFetch: overCapFetch });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.OVER_CAP);
  });

  test("network rejection → NETWORK_ERROR, cache untouched", async () => {
    const deps = makeDeps({ overrideFetch: async () => { throw new Error("net::ERR_NAME_NOT_RESOLVED"); } });
    await runTier2RulesFetch(deps);

    const result = await deps.storage.get({ remoteTier2Rules: [], remoteTier2Meta: {} });
    assert.deepEqual(result.remoteTier2Rules, []);
    assert.strictEqual(result.remoteTier2Meta.lastError, ERR.NETWORK_ERROR);
  });

  test("dedup guard: overlapping calls are safe (no crash, no corruption)", async () => {
    let fetchCount = 0;
    let resolveFirst;
    const slowFetchImpl = (_url, opts) => {
      fetchCount++;
      return new Promise((resolve, reject) => {
        resolveFirst = () => {
          const body = JSON.stringify(makeValidPayload());
          let done = false;
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: {
              getReader() {
                return {
                  read() {
                    if (done) return Promise.resolve({ done: true, value: undefined });
                    done = true;
                    return Promise.resolve({ done: false, value: new Uint8Array(Buffer.from(body, "utf8")) });
                  },
                  cancel() { return Promise.resolve(); },
                };
              },
            },
          });
        };
        opts?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
        });
      });
    };

    const deps1 = makeDeps({ overrideFetch: slowFetchImpl });
    const deps2 = makeDeps({ overrideFetch: slowFetchImpl });

    const promise1 = runTier2RulesFetch(deps1);
    await new Promise((r) => setImmediate(r));
    const promise2 = runTier2RulesFetch(deps2);

    resolveFirst?.();
    await Promise.all([promise1, promise2]);

    assert.ok(fetchCount >= 1, "at least one fetch occurred");
  });
});

// ── TIER2_RULE_KEYS never-accept tripwire ────────────────────────────────────
//
// The content-side `tier2FilterRemoteToggleScope` (src/content/cookie-noise.js)
// is LIVE: it will happily promote a remote rule carrying a `toggleScope`
// field into the reject-only Save/toggle/lockedOn click surface. It is
// currently UNREACHABLE via a signed payload ONLY because this strict 4-key
// allowlist rejects any rule with an extra key (`toggleScope` included). That
// is the sole structural barrier between "signed remote data" and "a remote
// Save-click selector path". This test pins the allowlist so that relaxing it
// (e.g. adding `toggleScope` to the remote schema) trips RED and forces a
// deliberate re-review of the remote Save-click surface — the never-accept
// guarantee must never regress silently through a schema widening.
describe("TIER2_RULE_KEYS — strict 4-key allowlist tripwire (never-accept)", () => {
  test("equals EXACTLY {id, present, reject, openSettings} — widening it must force a remote toggleScope re-review", () => {
    assert.equal(TIER2_RULE_KEYS instanceof Set, true, "TIER2_RULE_KEYS must be a Set");
    assert.equal(TIER2_RULE_KEYS.size, 4, "exactly 4 keys — no field may express an accept/toggle action");
    assert.deepEqual(
      [...TIER2_RULE_KEYS].sort(),
      ["id", "openSettings", "present", "reject"],
      "adding any key (e.g. toggleScope) reaches the live tier2FilterRemoteToggleScope path — re-review the remote Save-click surface before widening",
    );
  });
});
