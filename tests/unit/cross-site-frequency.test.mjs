/**
 * MUGA — Unit tests for the Cross-Site Frequency Tracker
 * (src/lib/cross-site-frequency.js, issue #446, slice B16)
 *
 * The tracker watches URL parameters (name, value-hash) across visited
 * first-party domains. When ANY paramName meets BOTH thresholds — 3+
 * distinct first-party domains AND 3+ distinct values — it is flagged
 * as a likely cross-site identifier. Storage is local-only; no telemetry.
 *
 * These tests use:
 *   - an in-memory storage adapter (deterministic, no chrome.* needed)
 *   - a stub hasher (deterministic, lets us simulate hash collisions)
 *
 * Coverage:
 *   - Below threshold (2 domains) → NOT flagged
 *   - Below threshold (2 distinct values) → NOT flagged
 *   - Threshold met (3 domains AND 3 values) → flagged
 *   - LRU eviction at 1000th unique entry
 *   - Disabled flag → no-op
 *   - Hash collisions count as same value (documented rule)
 *   - getFlagged() returns currently-flagged params
 *   - Re-observation does not double-count distincts
 *   - Storage adapter shape sanity
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryAdapter,
  createTracker,
  MAX_TRACKED_PARAMS,
  DOMAIN_THRESHOLD,
  VALUE_THRESHOLD,
} from "../../src/lib/cross-site-frequency.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A deterministic stub hasher. Returns "h:<input>" so two different inputs
 * map to two different hashes — UNLESS the caller explicitly wants a
 * collision, in which case they pass identical inputs OR use
 * `collidingHasher` below.
 */
const stubHasher = async (s) => `h:${s}`;

/**
 * Hasher that collides every input onto the same digest. Used to verify
 * the documented collision rule: distinct input values that share a hash
 * are NOT counted as distinct (we trust the hash as the identity key).
 */
const collidingHasher = async () => "COLLIDE";

function makeTracker({ enabled = true, hasher = stubHasher } = {}) {
  const adapter = createInMemoryAdapter();
  const tracker = createTracker({ adapter, hasher, enabled });
  return { tracker, adapter };
}

// ── Threshold semantics ──────────────────────────────────────────────────────

describe("createTracker — threshold semantics", () => {
  test("exports DOMAIN_THRESHOLD and VALUE_THRESHOLD as 3", () => {
    assert.equal(DOMAIN_THRESHOLD, 3);
    assert.equal(VALUE_THRESHOLD, 3);
  });

  test("2 distinct domains, 5 distinct values → NOT flagged (domain floor not met)", async () => {
    const { tracker } = makeTracker();
    // Same param, 2 domains, 5 values total.
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("a.com", "uid", "v2");
    await tracker.observe("a.com", "uid", "v3");
    await tracker.observe("b.com", "uid", "v4");
    await tracker.observe("b.com", "uid", "v5");
    const flagged = await tracker.getFlagged();
    assert.deepEqual(flagged, []);
  });

  test("5 distinct domains, 2 distinct values → NOT flagged (value floor not met)", async () => {
    const { tracker } = makeTracker();
    // Same param, 5 domains, only 2 distinct values.
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v1");
    await tracker.observe("c.com", "uid", "v2");
    await tracker.observe("d.com", "uid", "v2");
    await tracker.observe("e.com", "uid", "v1");
    const flagged = await tracker.getFlagged();
    assert.deepEqual(flagged, []);
  });

  test("3 distinct domains AND 3 distinct values → flagged", async () => {
    const { tracker } = makeTracker();
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    const flagged = await tracker.getFlagged();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].param, "uid");
    assert.ok(flagged[0].domains >= DOMAIN_THRESHOLD);
    assert.ok(flagged[0].values >= VALUE_THRESHOLD);
  });

  test("re-observing the same (domain, value) does not inflate distinct counts", async () => {
    const { tracker } = makeTracker();
    // Hammer the same triple — should still be 1 domain / 1 value.
    for (let i = 0; i < 10; i++) {
      await tracker.observe("a.com", "uid", "v1");
    }
    const flagged = await tracker.getFlagged();
    assert.deepEqual(flagged, []);
  });
});

// ── AND condition — the 4-values-2-domains case from the issue ───────────────

describe("createTracker — AND condition (issue-mandated case)", () => {
  test("one paramName has 4 distinct values across only 2 domains → NOT flagged", async () => {
    // Issue #446 explicitly calls this out: many values on too few domains
    // is the shape of a search-query or session-id, not a cross-site ID.
    const { tracker } = makeTracker();
    await tracker.observe("a.com", "q", "alpha");
    await tracker.observe("a.com", "q", "beta");
    await tracker.observe("b.com", "q", "gamma");
    await tracker.observe("b.com", "q", "delta");
    const flagged = await tracker.getFlagged();
    assert.deepEqual(flagged, []);
  });
});

// ── Hash collisions ──────────────────────────────────────────────────────────

describe("createTracker — hash collision rule", () => {
  test("colliding hasher: distinct input values that hash identically count as ONE value", async () => {
    // Documented rule: the tracker's identity for a value IS the hash.
    // If two raw values collide, they are treated as the same value. This
    // is acceptable because SHA-256 collisions are not adversarially
    // reachable in practice — and we'd rather under-count than store
    // raw values (which would be a privacy regression).
    const { tracker } = makeTracker({ hasher: collidingHasher });
    await tracker.observe("a.com", "uid", "raw1");
    await tracker.observe("b.com", "uid", "raw2");
    await tracker.observe("c.com", "uid", "raw3");
    // 3 domains, 1 value (collisions) → does not meet value threshold.
    const flagged = await tracker.getFlagged();
    assert.deepEqual(flagged, []);
  });
});

// ── LRU eviction ─────────────────────────────────────────────────────────────

describe("createTracker — LRU eviction", () => {
  test("exports MAX_TRACKED_PARAMS = 1000", () => {
    assert.equal(MAX_TRACKED_PARAMS, 1000);
  });

  test("inserting MAX+1 unique params evicts the least-recently-touched one", async () => {
    const { tracker, adapter } = makeTracker();
    // Fill exactly to the cap with unique param names.
    for (let i = 0; i < MAX_TRACKED_PARAMS; i++) {
      await tracker.observe("d.com", `p${i}`, "v");
    }
    // Touch the FIRST param so it becomes the most recent — guarantees
    // it survives the next eviction. (Confirms LRU, not FIFO.)
    await tracker.observe("d.com", "p0", "v");
    // Add the 1001st unique param. Cap is enforced; one entry must drop.
    await tracker.observe("d.com", "p_overflow", "v");

    const stored = await adapter.get();
    const params = Object.keys(stored.params || {});
    assert.equal(params.length, MAX_TRACKED_PARAMS);
    // The newcomer is in.
    assert.ok(params.includes("p_overflow"));
    // The recently-touched one survived.
    assert.ok(params.includes("p0"));
    // The least-recently-touched one (p1) got evicted.
    assert.ok(!params.includes("p1"));
  });
});

// ── Disabled flag ────────────────────────────────────────────────────────────

describe("createTracker — disabled flag", () => {
  test("when enabled=false, observe() is a no-op and storage stays empty", async () => {
    const { tracker, adapter } = makeTracker({ enabled: false });
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    const stored = await adapter.get();
    // No params should have been written. The shape stays at its empty default.
    assert.deepEqual(stored.params || {}, {});
    assert.deepEqual(await tracker.getFlagged(), []);
  });

  test("enabled flag is read at construction; setEnabled flips it at runtime", async () => {
    // Privacy-sensitive: turning the feature off must take effect immediately.
    const { tracker, adapter } = makeTracker({ enabled: true });
    await tracker.observe("a.com", "uid", "v1");
    tracker.setEnabled(false);
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    const stored = await adapter.get();
    // Only the first observation made it through.
    assert.equal(Object.keys(stored.params || {}).length, 1);
  });
});

// ── getFlagged shape ─────────────────────────────────────────────────────────

describe("createTracker — getFlagged() output shape", () => {
  test("returns [] when nothing crosses the threshold", async () => {
    const { tracker } = makeTracker();
    assert.deepEqual(await tracker.getFlagged(), []);
  });

  test("returns one entry per flagged param with { param, domains, values }", async () => {
    const { tracker } = makeTracker();
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    const flagged = await tracker.getFlagged();
    assert.equal(flagged.length, 1);
    const entry = flagged[0];
    assert.equal(typeof entry.param, "string");
    assert.equal(typeof entry.domains, "number");
    assert.equal(typeof entry.values, "number");
  });

  test("does not surface params that fall back below threshold (param-by-param)", async () => {
    const { tracker } = makeTracker();
    // "uid" crosses threshold; "q" does not.
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    await tracker.observe("a.com", "q", "alpha");
    await tracker.observe("b.com", "q", "beta");
    const flagged = await tracker.getFlagged();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].param, "uid");
  });
});

// ── In-memory adapter sanity ─────────────────────────────────────────────────

describe("createInMemoryAdapter — shape", () => {
  test("get() resolves to an object with a params field (default {})", async () => {
    const adapter = createInMemoryAdapter();
    const data = await adapter.get();
    assert.equal(typeof data, "object");
    assert.deepEqual(data.params || {}, {});
  });

  test("set() persists and get() reads back", async () => {
    const adapter = createInMemoryAdapter();
    await adapter.set({ params: { x: { domains: ["a.com"], values: ["h:v1"], lastSeen: 1 } } });
    const data = await adapter.get();
    assert.ok(data.params.x);
    assert.deepEqual(data.params.x.domains, ["a.com"]);
  });

  test("two adapter instances are isolated (no shared state)", async () => {
    const a = createInMemoryAdapter();
    const b = createInMemoryAdapter();
    await a.set({ params: { z: { domains: ["a.com"], values: ["h:v1"], lastSeen: 1 } } });
    const dataB = await b.get();
    assert.deepEqual(dataB.params || {}, {});
  });
});
