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
  emitScoped,
  makeEntry,
  parseStore,
  serializeStore,
  withDomainRules,
  withGlobalParams,
  withScopedFacts,
} from "../../tools/rules-store.mjs";
import { validateScopedFacts } from "../../src/lib/remote-rules.js";

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

// ── The scope must be a plain hostname ───────────────────────────────
//
// A scoped fact is the only store content that LEAVES the repository: it is
// projected into params.json, signed, served, and finally becomes a DNR
// `requestDomains` entry. Both ends of that channel — `sign-rules.mjs` and
// `src/lib/remote-rules.js` — reject anything but a plain hostname, so a fact
// this module accepted and they did not would land in the store, survive
// review, and die silently at publication with nothing to point at.
//
// Upstream writes wildcard and truncated anchors routinely (`amazon.*`,
// `www.ebay.`, #1228), so this is the shape that actually shows up.

test("withScopedFacts rejects a wildcard anchor", () => {
  assert.throws(
    () => withScopedFacts(baseStore(), [
      { scope: "amazon.*", param: "dchild", action: ACTIONS.STRIP },
    ]),
    /not a plain hostname/,
  );
});

test("withScopedFacts rejects a truncated anchor", () => {
  assert.throws(
    () => withScopedFacts(baseStore(), [
      { scope: "www.ebay.", param: "mkcid", action: ACTIONS.STRIP },
    ]),
    /not a plain hostname/,
  );
});

test("withScopedFacts rejects a single-label host", () => {
  // No public suffix, so it can never be a real anchor — and DNR would match it
  // against an intranet name.
  assert.throws(
    () => withScopedFacts(baseStore(), [
      { scope: "localhost", param: "si", action: ACTIONS.STRIP },
    ]),
    /not a plain hostname/,
  );
});

test("withScopedFacts accepts a subdomain host", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "gaming.amazon.com", param: "ingress", action: ACTIONS.STRIP },
  ]);
  assert.strictEqual(store.scopedFacts[0].scope, "gaming.amazon.com");
});

test("parseStore rejects a wildcard anchor read from disk", () => {
  // The guard has to hold on the read path too: a fact hand-edited into the
  // committed store would otherwise reach the projection unchecked.
  const text = serializeStore({
    ...baseStore(),
    scopedFacts: [{ scope: "amazon.ca", param: "dchild", action: ACTIONS.STRIP }],
  }).replace('"amazon.ca"', '"amazon.*"');

  assert.throws(() => parseStore(text), /not a plain hostname/);
});

// ── emitScoped: the store→payload pivot ──────────────────────────────
//
// The store is SCOPE-major (one fact per (scope, param), which is the unit
// provenance hangs off); the signed payload is PARAM-major ({param, hosts[]},
// which is what canonicalScopedMessage signs). emitScoped is the one place that
// pivot happens.

test("emitScoped on a store with no scoped facts is an empty list", () => {
  assert.deepStrictEqual(emitScoped(baseStore()), []);
  assert.deepStrictEqual(emitScoped({ ...baseStore(), scopedFacts: [] }), []);
});

test("emitScoped pivots scope-major facts into param-major payload entries", () => {
  const store = withScopedFacts(baseStore(), [
    { scope: "tiktok.com", param: "_r", action: ACTIONS.STRIP },
    { scope: "vt.tiktok.com", param: "_r", action: ACTIONS.STRIP },
    { scope: "instagram.com", param: "igsh", action: ACTIONS.STRIP },
  ]);

  assert.deepStrictEqual(emitScoped(store), [
    { param: "_r", hosts: ["tiktok.com", "vt.tiktok.com"] },
    { param: "igsh", hosts: ["instagram.com"] },
  ]);
});

test("emitScoped is deterministic — params sorted, hosts sorted", () => {
  // The payload is re-signed from this. If the order moved between runs, an
  // unchanged store would produce a different scopedSig and a pointless diff on
  // every weekly run.
  const a = withScopedFacts(baseStore(), [
    { scope: "z.example.com", param: "zz", action: ACTIONS.STRIP },
    { scope: "a.example.com", param: "zz", action: ACTIONS.STRIP },
    { scope: "m.example.com", param: "aa", action: ACTIONS.STRIP },
  ]);
  const b = withScopedFacts(baseStore(), [
    { scope: "m.example.com", param: "aa", action: ACTIONS.STRIP },
    { scope: "a.example.com", param: "zz", action: ACTIONS.STRIP },
    { scope: "z.example.com", param: "zz", action: ACTIONS.STRIP },
  ]);

  assert.deepStrictEqual(emitScoped(a), emitScoped(b));
  assert.deepStrictEqual(emitScoped(a), [
    { param: "aa", hosts: ["m.example.com"] },
    { param: "zz", hosts: ["a.example.com", "z.example.com"] },
  ]);
});

test("emitScoped drops provenance — it is repository history, not payload bytes", () => {
  const store = withScopedFacts(baseStore(), [
    {
      scope: "tiktok.com",
      param: "_r",
      action: ACTIONS.STRIP,
      provenance: { signals: ["adguard-tp"], firstSeenAt: "2026-09-01T00:00:00.000Z" },
    },
  ]);

  assert.deepStrictEqual(emitScoped(store), [{ param: "_r", hosts: ["tiktok.com"] }]);
});

test("emitScoped ignores a non-strip action", () => {
  // Unreachable through withScopedFacts, which refuses one. Asserted on a raw
  // store so the projection cannot become the place a scoped PRESERVE turns
  // into a strip if a later slice ever admits one.
  const store = {
    ...baseStore(),
    scopedFacts: [
      { scope: "example.com", param: "keep", action: ACTIONS.PRESERVE },
      { scope: "example.com", param: "drop", action: ACTIONS.STRIP },
    ],
  };

  assert.deepStrictEqual(emitScoped(store), [{ param: "drop", hosts: ["example.com"] }]);
});

test("emitScoped output is what the RUNTIME validator accepts", () => {
  // Pins the two ends of the channel together. The store could emit a shape
  // that is internally consistent and still be discarded on every user's
  // machine; this is the assertion that would catch that.
  const store = withScopedFacts(baseStore(), [
    { scope: "tiktok.com", param: "_r", action: ACTIONS.STRIP },
    { scope: "instagram.com", param: "igsh", action: ACTIONS.STRIP },
  ]);
  const emitted = emitScoped(store);

  const { accepted, rejected } = validateScopedFacts(emitted);
  assert.strictEqual(rejected, 0, "the runtime dropped a fact the store published");
  assert.deepStrictEqual(accepted, emitted);
});
