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
  CANDIDATE_DOMAIN_THRESHOLD,
  CANDIDATE_VALUE_THRESHOLD,
  CANDIDATE_ENTROPY_THRESHOLD,
  CANDIDATE_NAME_LENGTH_MIN,
  valueEntropy,
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

// ── Graduation pipeline (issue #532, slice extension of B16) ─────────────────
//
// The tracker now carries an explicit per-param state machine:
//   observed → suspicious → candidate
//
// `observed`   — first time we see the param on any domain.
// `suspicious` — meets the existing B16 flagging threshold (≥3 domains AND
//                ≥3 distinct value-hashes). `getFlagged()` continues to return
//                this set, so consumers (popup) keep working unchanged.
// `candidate`  — strong cross-site-tracker signal: ≥5 domains AND ≥10 values
//                AND entropyAvg > 3.0 AND param name length ≥ 4. The length
//                guard excludes generic 3-letter params (id/pid/ref) that the
//                PRD (muga#529) explicitly rejects.
//
// State is computed LAZILY in getState() / getFlagged() — we do NOT pay the
// cost on the hot observe() path. The only thing observe() updates is the
// running mean entropy, which is O(1).

describe("valueEntropy — Shannon entropy helper", () => {
  test("returns 0 for an empty / null-ish input (no information)", () => {
    assert.equal(valueEntropy(""), 0);
    assert.equal(valueEntropy(null), 0);
    assert.equal(valueEntropy(undefined), 0);
  });

  test("returns 0 for a single-character string (only one symbol)", () => {
    assert.equal(valueEntropy("x"), 0);
  });

  test("returns 0 for a constant-character string (only one symbol)", () => {
    assert.equal(valueEntropy("aaaa"), 0);
  });

  test("a uniform 2-symbol string has entropy 1.0 (one bit per symbol)", () => {
    assert.equal(valueEntropy("ab"), 1);
    assert.equal(valueEntropy("abab"), 1);
  });

  test("higher-variety strings produce strictly higher entropy than low-variety ones", () => {
    const low = valueEntropy("aaab");
    const high = valueEntropy("abcdefghij");
    assert.ok(high > low, `expected ${high} > ${low}`);
  });

  test("a long random-ish hex-style id crosses the 3.0 candidate threshold", () => {
    // Real-world cross-site IDs (UUIDs, base64 tokens) live well above 3.0.
    const e = valueEntropy("9f3c1ea2b48d6701ffac5e2d");
    assert.ok(e > 3.0, `expected entropy > 3, got ${e}`);
  });
});

describe("createTracker — graduation thresholds export", () => {
  test("exports CANDIDATE_DOMAIN_THRESHOLD = 5", () => {
    assert.equal(CANDIDATE_DOMAIN_THRESHOLD, 5);
  });
  test("exports CANDIDATE_VALUE_THRESHOLD = 10", () => {
    assert.equal(CANDIDATE_VALUE_THRESHOLD, 10);
  });
  test("exports CANDIDATE_ENTROPY_THRESHOLD = 3.0", () => {
    assert.equal(CANDIDATE_ENTROPY_THRESHOLD, 3.0);
  });
  test("exports CANDIDATE_NAME_LENGTH_MIN = 4", () => {
    assert.equal(CANDIDATE_NAME_LENGTH_MIN, 4);
  });
});

describe("createTracker — getState() state machine", () => {
  test("unknown param returns 'observed' (defensive default)", async () => {
    const { tracker } = makeTracker();
    assert.equal(await tracker.getState("nope"), "observed");
  });

  test("first observation on a single domain → 'observed'", async () => {
    const { tracker } = makeTracker();
    await tracker.observe("a.com", "uid", "v1");
    assert.equal(await tracker.getState("uid"), "observed");
  });

  test("3 domains × 3 values → 'suspicious' (matches existing B16 flag)", async () => {
    const { tracker } = makeTracker();
    await tracker.observe("a.com", "uid", "v1");
    await tracker.observe("b.com", "uid", "v2");
    await tracker.observe("c.com", "uid", "v3");
    assert.equal(await tracker.getState("uid"), "suspicious");
    // And getFlagged still surfaces it, unchanged.
    const flagged = await tracker.getFlagged();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].param, "uid");
  });

  test("5 domains × 10 high-entropy values + name length ≥4 → 'candidate'", async () => {
    // Use the real defaultHasher would slow tests; the stub hasher is fine
    // because state evaluation looks at counts + entropyAvg, and entropyAvg
    // is computed from the RAW value (pre-hash), so we can drive it directly.
    const { tracker } = makeTracker();
    const highEntropyValues = [
      "9f3c1ea2b48d6701ffac5e2d",
      "8a14bd0fe21c95773bbe44a1",
      "7c0d59e6bb4827419fe10cda",
      "6b21e8a44dc91075ffac88e3",
      "5d39b07a6e15cc8842b990fe",
      "4e54c01b8a76dd9711e205bb",
      "3c61d52f9b8c11ea7700ff43",
      "2a78e0419fcd203baa551c66",
      "1b86f1538e0c34cd99cc7700",
      "0a93021647db17ee4471ad58",
    ];
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    // 5 domains × 10 values = 50 observations. Spread values across domains
    // so we hit BOTH thresholds.
    for (let i = 0; i < highEntropyValues.length; i++) {
      const d = domains[i % domains.length];
      await tracker.observe(d, "userid", highEntropyValues[i]);
    }
    // Make sure all 5 domains are touched at least once.
    for (const d of domains) await tracker.observe(d, "userid", "9f3c1ea2b48d6701ffac5e2d");
    assert.equal(await tracker.getState("userid"), "candidate");
  });

  test("5 domains × 10 high-entropy values BUT param length 3 → still 'suspicious' (length guard rejects)", async () => {
    // PRD muga#529: 3-letter generic params (id, pid, ref) MUST NOT graduate.
    const { tracker } = makeTracker();
    const values = [
      "9f3c1ea2b48d6701ffac5e2d", "8a14bd0fe21c95773bbe44a1",
      "7c0d59e6bb4827419fe10cda", "6b21e8a44dc91075ffac88e3",
      "5d39b07a6e15cc8842b990fe", "4e54c01b8a76dd9711e205bb",
      "3c61d52f9b8c11ea7700ff43", "2a78e0419fcd203baa551c66",
      "1b86f1538e0c34cd99cc7700", "0a93021647db17ee4471ad58",
    ];
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    for (let i = 0; i < values.length; i++) {
      await tracker.observe(domains[i % domains.length], "ref", values[i]);
    }
    for (const d of domains) await tracker.observe(d, "ref", "9f3c1ea2b48d6701ffac5e2d");
    assert.equal(await tracker.getState("ref"), "suspicious");
  });

  test("5 domains × 10 LOW-entropy values → still 'suspicious' (entropy guard rejects)", async () => {
    // Sequential numeric IDs have low Shannon entropy per character — they
    // look like an enumerated user list, not a high-entropy tracking ID.
    const { tracker } = makeTracker();
    const values = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    for (let i = 0; i < values.length; i++) {
      await tracker.observe(domains[i % domains.length], "userid", values[i]);
    }
    for (const d of domains) await tracker.observe(d, "userid", "1");
    const state = await tracker.getState("userid");
    assert.equal(state, "suspicious", `got ${state} — entropy guard should have rejected this`);
  });
});

describe("createTracker — entry metadata extensions", () => {
  test("entry carries firstSeen, lastSeen, entropyAvg after observation", async () => {
    const { tracker, adapter } = makeTracker();
    await tracker.observe("a.com", "uid", "v1");
    const stored = await adapter.get();
    const e = stored.params.uid;
    assert.equal(typeof e.firstSeen, "number");
    assert.equal(typeof e.lastSeen, "number");
    assert.equal(typeof e.entropyAvg, "number");
    assert.ok(e.entropyAvg >= 0);
  });

  test("firstSeen ≤ lastSeen across many observations (monotonic)", async () => {
    const { tracker, adapter } = makeTracker();
    for (let i = 0; i < 5; i++) {
      await tracker.observe("a.com", "uid", `v${i}`);
    }
    const e = (await adapter.get()).params.uid;
    assert.ok(e.firstSeen <= e.lastSeen, `firstSeen ${e.firstSeen} > lastSeen ${e.lastSeen}`);
  });

  test("entropyAvg is a finite number ≥ 0 after many observations (running-mean property)", async () => {
    const { tracker, adapter } = makeTracker();
    const samples = ["abc", "aaaa", "9f3c1ea2", "xy", "qqqq", "abcdef"];
    for (const v of samples) await tracker.observe("a.com", "uid", v);
    const e = (await adapter.get()).params.uid;
    assert.ok(Number.isFinite(e.entropyAvg), `entropyAvg not finite: ${e.entropyAvg}`);
    assert.ok(e.entropyAvg >= 0, `entropyAvg negative: ${e.entropyAvg}`);
  });

  test("entropyAvg of constant-value observations stays 0", async () => {
    const { tracker, adapter } = makeTracker();
    for (let i = 0; i < 4; i++) await tracker.observe("a.com", "uid", "aaaa");
    const e = (await adapter.get()).params.uid;
    assert.equal(e.entropyAvg, 0);
  });
});

describe("createTracker — LRU and graduation interact cleanly", () => {
  test("a 'candidate' entry can be evicted by LRU just like any other entry", async () => {
    // No special handling: the state machine is read-side only. If something
    // graduates to candidate but then sits idle while 1000 newer params come
    // in, it gets evicted along with everything else. That's intentional —
    // the LRU is the storage budget; promotion doesn't pin entries.
    const { tracker, adapter } = makeTracker();
    // Promote "userid" to candidate first.
    const values = [
      "9f3c1ea2b48d6701ffac5e2d", "8a14bd0fe21c95773bbe44a1",
      "7c0d59e6bb4827419fe10cda", "6b21e8a44dc91075ffac88e3",
      "5d39b07a6e15cc8842b990fe", "4e54c01b8a76dd9711e205bb",
      "3c61d52f9b8c11ea7700ff43", "2a78e0419fcd203baa551c66",
      "1b86f1538e0c34cd99cc7700", "0a93021647db17ee4471ad58",
    ];
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    for (let i = 0; i < values.length; i++) {
      await tracker.observe(domains[i % domains.length], "userid", values[i]);
    }
    assert.equal(await tracker.getState("userid"), "candidate");
    // Now flood with MAX unique params. "userid" is the OLDEST → evicted.
    for (let i = 0; i < MAX_TRACKED_PARAMS; i++) {
      await tracker.observe("z.com", `flood${i}`, "v");
    }
    const stored = await adapter.get();
    assert.ok(!stored.params.userid, "candidate entry should have been evicted by LRU");
    // After eviction, getState falls back to defensive default.
    assert.equal(await tracker.getState("userid"), "observed");
  });
});

// ---------------------------------------------------------------------------
// #731 — per-entry values/domains arrays must be bounded. Only the param
// COUNT was LRU-capped; a single high-cardinality param could accrue unbounded
// distinct hashes/domains. Capping just above the candidate thresholds is
// lossless for classification (the caps exceed every threshold).
// ---------------------------------------------------------------------------
import {
  MAX_VALUES_PER_PARAM,
  MAX_DOMAINS_PER_PARAM,
} from "../../src/lib/cross-site-frequency.js";

describe("createTracker — per-entry array ceilings (#731)", () => {
  test("caps sit above the candidate thresholds (lossless for classification)", () => {
    assert.ok(MAX_VALUES_PER_PARAM >= CANDIDATE_VALUE_THRESHOLD);
    assert.ok(MAX_DOMAINS_PER_PARAM >= CANDIDATE_DOMAIN_THRESHOLD);
  });

  test("a high-cardinality param does not grow values/domains without bound", async () => {
    const { tracker, adapter } = makeTracker();
    // One param, 60 distinct values across 20 distinct domains.
    for (let i = 0; i < 60; i++) {
      await tracker.observe(`d${i % 20}.com`, "gclid", `val-${i}`);
    }
    const stored = await adapter.get();
    const entry = stored.params.gclid;
    assert.ok(entry.values.length <= MAX_VALUES_PER_PARAM, `values capped (${entry.values.length} <= ${MAX_VALUES_PER_PARAM})`);
    assert.ok(entry.domains.length <= MAX_DOMAINS_PER_PARAM, `domains capped (${entry.domains.length} <= ${MAX_DOMAINS_PER_PARAM})`);
  });

  test("capping does not change graduation — a candidate stays a candidate", async () => {
    const { tracker } = makeTracker();
    // Drive well past every candidate floor with high-entropy values.
    for (let i = 0; i < 40; i++) {
      await tracker.observe(`shop${i % 12}.com`, "trackingid", `b64-${i}-Zk9xQ${i}`);
    }
    // values capped at MAX_VALUES_PER_PARAM (>= CANDIDATE_VALUE_THRESHOLD) and
    // domains capped at MAX_DOMAINS_PER_PARAM (>= CANDIDATE_DOMAIN_THRESHOLD),
    // so the candidate verdict is preserved despite the clamp.
    const state = await tracker.getState("trackingid");
    assert.equal(state, "candidate", "param must still graduate to candidate after capping");
  });
});
