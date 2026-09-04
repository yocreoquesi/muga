/**
 * MUGA — `scopedFacts[]` store segment tests (Slice 2 PR B, rules-scope-normalization)
 *
 * `scopedFacts` is a top-level SIBLING of `entries[]` — never an entry, never a
 * new ACTIONS label. It is where a gate-admitted host-scoped candidate lands,
 * because `entries[]` is read by `groupByScope`/`emitDomainRules`, and a fresh
 * host-scoped strip with no sibling preserve there hits the pinned
 * no-preserve-sibling throw in `rules-store-roundtrip.test.mjs` (Slice 1's
 * deliberate seam). A sibling segment the projections never read sidesteps it
 * structurally instead of relaxing that guard.
 *
 * The correctness-critical property (design correction C4): `serializeStore`
 * writes only the keys it knows about, so an unknown top-level key is silently
 * destroyed by the very next `promote-rules.mjs` (weekly, unattended) or
 * `harvest-preserve.mjs` round trip. Every test below that runs a fact through
 * `withGlobalParams`/`withDomainRules` → `serializeStore` is proving that
 * specific failure mode does NOT recur, not just that the shape round-trips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIONS,
  GLOBAL_SCOPE,
  emitDomainRules,
  emitParams,
  makeEntry,
  parseStore,
  serializeStore,
  withDomainRules,
  withGlobalParams,
  withScopedFacts,
} from "../../tools/rules-store.mjs";

const baseStore = () => ({
  schemaVersion: 1,
  entries: [makeEntry({ scope: GLOBAL_SCOPE, param: "utm_source", action: ACTIONS.STRIP })],
  projection: { scopes: {} },
});

// ── I1: absent when empty, present when not ──────────────────────────

test("a store with no scopedFacts serializes without the key at all", () => {
  const store = baseStore();
  const serialized = serializeStore(store);
  assert.equal(serialized.includes("scopedFacts"), false);
});

test("withScopedFacts([]) on an empty store leaves scopedFacts absent, not []", () => {
  const store = withScopedFacts(baseStore(), []);
  assert.equal(Object.hasOwn(store, "scopedFacts"), false);
  assert.equal(serializeStore(store).includes("scopedFacts"), false);
});

test("a store carrying one scoped fact serializes WITH the scopedFacts key", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const serialized = serializeStore(store);
  assert.equal(serialized.includes('"scopedFacts"'), true);
  assert.equal(serialized.includes('"youtube.com"'), true);
});

// ── Round trip ─────────────────────────────────────────────────────────

test("scopedFacts round-trips through serializeStore/parseStore", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const reparsed = parseStore(serializeStore(store));
  assert.deepEqual(reparsed.scopedFacts, store.scopedFacts);
});

test("a store with an EXPLICIT empty scopedFacts array parses, and re-serializes to absent", () => {
  const hand = JSON.stringify({ ...baseStore(), scopedFacts: [] });
  const parsed = parseStore(hand);
  assert.deepEqual(parsed.scopedFacts, []);
  assert.equal(serializeStore(parsed).includes("scopedFacts"), false);
});

// ── I5: validated on the way in ───────────────────────────────────────

test("withScopedFacts rejects a scope of GLOBAL_SCOPE", () => {
  assert.throws(
    () => withScopedFacts(baseStore(), [{ scope: GLOBAL_SCOPE, param: "x", action: ACTIONS.STRIP }]),
    (err) => err.message.includes(GLOBAL_SCOPE) || err.message.toLowerCase().includes("global"),
  );
});

test("withScopedFacts rejects a non-strip action", () => {
  assert.throws(
    () => withScopedFacts(baseStore(), [{ scope: "a.com", param: "x", action: ACTIONS.PRESERVE }]),
    (err) => err.message.includes("strip"),
  );
});

test("withScopedFacts rejects a malformed (empty) param", () => {
  assert.throws(
    () => withScopedFacts(baseStore(), [{ scope: "a.com", param: "", action: ACTIONS.STRIP }]),
  );
});

test("parseStore rejects a scopedFacts entry with scope \"*\" read from disk", () => {
  const hostile = JSON.stringify({
    ...baseStore(),
    scopedFacts: [{ scope: GLOBAL_SCOPE, param: "x", action: ACTIONS.STRIP }],
  });
  assert.throws(() => parseStore(hostile));
});

test("parseStore rejects a scopedFacts entry with a non-strip action read from disk", () => {
  const hostile = JSON.stringify({
    ...baseStore(),
    scopedFacts: [{ scope: "a.com", param: "x", action: ACTIONS.PRESERVE }],
  });
  assert.throws(() => parseStore(hostile));
});

test("parseStore rejects a scopedFacts entry with a malformed param read from disk", () => {
  const hostile = JSON.stringify({
    ...baseStore(),
    scopedFacts: [{ scope: "a.com", param: "", action: ACTIONS.STRIP }],
  });
  assert.throws(() => parseStore(hostile));
});

// ── withScopedFacts: merge semantics ──────────────────────────────────

test("withScopedFacts dedups on (scope, param) and unions provenance.signals", () => {
  let store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  store = withScopedFacts(store, [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["other-source"] } },
  ]);
  assert.equal(store.scopedFacts.length, 1);
  assert.deepEqual(store.scopedFacts[0].provenance.signals, ["adguard-tp", "other-source"]);
});

test("withScopedFacts keeps a different (scope, param) pair as a distinct entry", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
    { scope: "vimeo.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  assert.equal(store.scopedFacts.length, 2);
});

test("withScopedFacts sorts deterministically by scope then param", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "zzz.example", param: "b", action: ACTIONS.STRIP, provenance: { signals: ["x"] } },
    { scope: "aaa.example", param: "z", action: ACTIONS.STRIP, provenance: { signals: ["x"] } },
    { scope: "aaa.example", param: "a", action: ACTIONS.STRIP, provenance: { signals: ["x"] } },
  ]);
  assert.deepEqual(
    store.scopedFacts.map((f) => `${f.scope}/${f.param}`),
    ["aaa.example/a", "aaa.example/z", "zzz.example/b"],
  );
});

// ── I4: withGlobalParams / withDomainRules preserve scopedFacts (pin) ──

test("withGlobalParams preserves scopedFacts untouched (promote path)", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const next = withGlobalParams(store, ["utm_source", "utm_medium"]);
  assert.deepEqual(next.scopedFacts, store.scopedFacts);
});

test("withDomainRules preserves scopedFacts untouched (harvest path)", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const next = withDomainRules(store, [
    { domain: "a.com", preserveParams: ["q"] },
  ]);
  assert.deepEqual(next.scopedFacts, store.scopedFacts);
});

// ── C4 / I3: the correctness-critical promote/harvest round trip ─────

test("scopedFacts survives withGlobalParams -> serializeStore (the weekly promote path)", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const promoted = withGlobalParams(store, ["utm_source", "utm_medium"]);
  const reparsed = parseStore(serializeStore(promoted));
  assert.deepEqual(reparsed.scopedFacts, store.scopedFacts);
});

test("scopedFacts survives withDomainRules -> serializeStore (the harvest path)", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  const harvested = withDomainRules(store, [{ domain: "a.com", preserveParams: ["q"] }]);
  const reparsed = parseStore(serializeStore(harvested));
  assert.deepEqual(reparsed.scopedFacts, store.scopedFacts);
});

// ── I2: the projections never read scopedFacts ────────────────────────

test("emitDomainRules does not throw on a fresh host with a scoped fact and no legacy preserve sibling", () => {
  // The whole point of the sibling segment: a Slice 2 fact for a BRAND NEW host
  // (no entries[] rows at all for that host) must never reach groupByScope, so
  // it must never trip the pinned no-preserve-sibling throw.
  const store = withScopedFacts(baseStore(), [
    { scope: "brand-new-host.example", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  assert.doesNotThrow(() => emitDomainRules(store));
  // And the rendered file must not mention the scoped host at all.
  assert.equal(emitDomainRules(store).includes("brand-new-host.example"), false);
});

test("emitParams does not include a scoped fact's param", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "youtube.com", param: "si", action: ACTIONS.STRIP, provenance: { signals: ["adguard-tp"] } },
  ]);
  assert.deepEqual(emitParams(store), ["utm_source"]);
});
