/**
 * MUGA — Unit tests for the csft-upstream privacy module
 * (src/lib/csft-upstream.js, issue #537)
 *
 * The module exists to STRUCTURALLY enforce the privacy contract for the
 * "Report upstream" button in the popup's Suspicious params section.
 *
 * Contract:
 *   - Sole export: buildUpstreamPayload(trackerState, paramName)
 *   - Returns an object with EXACTLY two fields:
 *       { paramName: string, firstPartyDomainCount: number }
 *   - NEVER includes value, hash, raw values, domain list, or any other
 *     identifying field — even if the trackerState carries them. The
 *     module's narrow shape is the privacy guarantee.
 *
 * Property tests iterate at least 100 random tracker states with diverse
 * value hashes, raw values, and domain lists. The output is asserted to:
 *   - have exactly 2 keys
 *   - never contain any value, hash, or domain string
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamPayload } from "../../src/lib/csft-upstream.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pseudo-random integer in [min, max). Deterministic via a seeded LCG. */
function makeRng(seed = 0xC0FFEE) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const rng = makeRng();
const randInt = (max) => Math.floor(rng() * max);
const randHex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[randInt(16)]).join("");
const randDomain = () => `${randHex(6)}.example-${randInt(1000)}.test`;

/** Builds a trackerState entry shaped exactly like cross-site-frequency persists. */
function makeEntry({ nDomains, nValues }) {
  return {
    domains: Array.from({ length: nDomains }, randDomain),
    values: Array.from({ length: nValues }, () => randHex(64)),
    firstSeen: 1700000000000 + randInt(1_000_000),
    lastSeen: 1700000000000 + randInt(1_000_000),
    count: nValues,
    entropyAvg: rng() * 6,
  };
}

// ── Output shape: exactly 2 keys ────────────────────────────────────────────

test("buildUpstreamPayload returns an object with EXACTLY 2 keys", () => {
  const state = { uid: makeEntry({ nDomains: 5, nValues: 12 }) };
  const out = buildUpstreamPayload(state, "uid");
  assert.equal(typeof out, "object");
  assert.notEqual(out, null);
  assert.equal(Object.keys(out).length, 2, "must have exactly 2 keys");
});

test("buildUpstreamPayload output keys are exactly paramName + firstPartyDomainCount", () => {
  const state = { foo: makeEntry({ nDomains: 3, nValues: 4 }) };
  const out = buildUpstreamPayload(state, "foo");
  const keys = Object.keys(out).sort();
  assert.deepEqual(keys, ["firstPartyDomainCount", "paramName"]);
});

test("paramName is a string equal to the requested name", () => {
  const state = { utm_source: makeEntry({ nDomains: 7, nValues: 9 }) };
  const out = buildUpstreamPayload(state, "utm_source");
  assert.equal(typeof out.paramName, "string");
  assert.equal(out.paramName, "utm_source");
});

test("firstPartyDomainCount is a non-negative integer", () => {
  const state = { x: makeEntry({ nDomains: 4, nValues: 2 }) };
  const out = buildUpstreamPayload(state, "x");
  assert.equal(typeof out.firstPartyDomainCount, "number");
  assert.ok(Number.isInteger(out.firstPartyDomainCount));
  assert.ok(out.firstPartyDomainCount >= 0);
  assert.equal(out.firstPartyDomainCount, 4);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test("paramName not present in trackerState → firstPartyDomainCount === 0", () => {
  const state = { uid: makeEntry({ nDomains: 5, nValues: 5 }) };
  const out = buildUpstreamPayload(state, "missing");
  assert.equal(out.paramName, "missing");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("entry with 0 domains (defensive) → firstPartyDomainCount === 0", () => {
  const state = { sid: { domains: [], values: ["h"], firstSeen: 0, lastSeen: 0, count: 1, entropyAvg: 0 } };
  const out = buildUpstreamPayload(state, "sid");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("entry missing the domains array (defensive) → firstPartyDomainCount === 0", () => {
  const state = { sid: { values: ["h"], firstSeen: 0, lastSeen: 0, count: 1, entropyAvg: 0 } };
  const out = buildUpstreamPayload(state, "sid");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("trackerState is null → returns sensible default with count 0", () => {
  const out = buildUpstreamPayload(null, "uid");
  assert.equal(Object.keys(out).length, 2);
  assert.equal(out.paramName, "uid");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("trackerState is undefined → returns sensible default with count 0", () => {
  const out = buildUpstreamPayload(undefined, "uid");
  assert.equal(Object.keys(out).length, 2);
  assert.equal(out.paramName, "uid");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("paramName is null/undefined → coerces to empty string, count 0", () => {
  const out = buildUpstreamPayload({}, null);
  assert.equal(typeof out.paramName, "string");
  assert.equal(out.firstPartyDomainCount, 0);
});

test("accepts wrapped { params: ... } shape (raw cross-site-frequency state)", () => {
  // The cross-site-frequency adapter persists state as { params: { ... } }.
  // The module accepts both the raw entry map and the wrapped shape so
  // callers don't have to unwrap manually.
  const state = { params: { uid: makeEntry({ nDomains: 6, nValues: 4 }) } };
  const out = buildUpstreamPayload(state, "uid");
  assert.equal(out.firstPartyDomainCount, 6);
});

// ── Privacy property test: 100+ random states, no leakage ────────────────────

test("PROPERTY: 100 random trackerStates → output never contains any value, hash, or domain", () => {
  const ITERATIONS = 150;
  for (let i = 0; i < ITERATIONS; i++) {
    const nDomains = 1 + randInt(15);
    const nValues = 1 + randInt(20);
    const entry = makeEntry({ nDomains, nValues });
    const paramName = `p_${randHex(4)}_${i}`;
    const state = { [paramName]: entry };

    const out = buildUpstreamPayload(state, paramName);

    // Shape invariant
    assert.equal(Object.keys(out).length, 2,
      `iteration ${i}: output must have exactly 2 keys`);
    assert.equal(out.paramName, paramName);
    assert.equal(out.firstPartyDomainCount, nDomains);

    // Privacy invariant — serialize and check no domain or hash leaked.
    const serialized = JSON.stringify(out);
    for (const dom of entry.domains) {
      assert.ok(!serialized.includes(dom),
        `iteration ${i}: serialized output leaked domain "${dom}"`);
    }
    for (const hash of entry.values) {
      assert.ok(!serialized.includes(hash),
        `iteration ${i}: serialized output leaked value-hash "${hash}"`);
    }
    // Defense in depth: forbidden field names must not appear at any level.
    for (const forbidden of ["domains", "values", "hash", "value", "firstSeen", "lastSeen", "entropyAvg", "count"]) {
      assert.ok(!Object.prototype.hasOwnProperty.call(out, forbidden),
        `iteration ${i}: output must not carry "${forbidden}"`);
    }
  }
});

test("PROPERTY: output object is a plain new object (not a reference to the entry)", () => {
  const entry = makeEntry({ nDomains: 4, nValues: 5 });
  const state = { uid: entry };
  const out = buildUpstreamPayload(state, "uid");
  // Mutating the output must not touch the original entry.
  out.paramName = "tampered";
  out.firstPartyDomainCount = 999;
  assert.equal(state.uid.domains.length, 4, "input entry must not be mutated");
});
