/**
 * MUGA: GATE 2 — corroboration-gate tests (#776).
 *
 * Verifies the corroboration predicate: a candidate is accepted only when
 * ≥ MIN_SIGNALS independent upstream sources reported it. Signal count is the
 * SOLE predicate — entropy/CSF arms are NOT evaluated (deferred to #798).
 *
 * Tests cover: module shape, threshold boundaries, opts override, malformed
 * candidate handling (REJECTS — inverse of GATE 1/3's accept-malformed posture),
 * no-mutation purity, and partitionCandidates batch behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SIGNALS,
  checkCorroborationGate,
  partitionCandidates,
} from "../../tools/rule-ingestion/gates/corroboration-gate.mjs";

// ── T-01: Module shape ────────────────────────────────────────────────────────

describe("corroboration-gate module shape", () => {
  test("MIN_SIGNALS is 2", () => {
    assert.equal(MIN_SIGNALS, 2);
  });

  test("checkCorroborationGate is a function", () => {
    assert.equal(typeof checkCorroborationGate, "function");
  });

  test("partitionCandidates is a function", () => {
    assert.equal(typeof partitionCandidates, "function");
  });

  test("no default export", async () => {
    const mod = await import(
      "../../tools/rule-ingestion/gates/corroboration-gate.mjs"
    );
    assert.equal(mod.default, undefined);
  });
});

// ── T-02: Accept at/above threshold ──────────────────────────────────────────

describe("checkCorroborationGate — accept", () => {
  test("exactly two signals → accepted", () => {
    const candidate = { param: "utm_source", signals: ["adguard-tp", "clearurls"] };
    assert.deepEqual(checkCorroborationGate(candidate), { rejected: false });
  });

  test("three signals → accepted", () => {
    const candidate = { signals: ["adguard-tp", "clearurls", "brave"] };
    assert.deepEqual(checkCorroborationGate(candidate), { rejected: false });
  });
});

// ── T-03: Reject below threshold ─────────────────────────────────────────────

describe("checkCorroborationGate — reject below threshold", () => {
  test("one signal → rejected with signalCount 1", () => {
    const candidate = { param: "fbclid", signals: ["adguard-tp"] };
    assert.deepEqual(checkCorroborationGate(candidate), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 1, minSignals: 2 },
    });
  });

  test("zero signals → rejected with signalCount 0", () => {
    const candidate = { param: "ref", signals: [] };
    assert.deepEqual(checkCorroborationGate(candidate), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });
});

// ── T-04: Opts override ───────────────────────────────────────────────────────

describe("checkCorroborationGate — opts override", () => {
  test("minSignals:1 accepts single-source candidate", () => {
    const candidate = { signals: ["adguard-tp"] };
    assert.deepEqual(
      checkCorroborationGate(candidate, { minSignals: 1 }),
      { rejected: false }
    );
  });

  test("minSignals:3 rejects two-source candidate with correct detail", () => {
    const candidate = { signals: ["adguard-tp", "clearurls"] };
    assert.deepEqual(
      checkCorroborationGate(candidate, { minSignals: 3 }),
      {
        rejected: true,
        reason: "corroboration-below-threshold",
        detail: { signalCount: 2, minSignals: 3 },
      }
    );
  });
});

// ── T-05: Malformed candidate — REJECTS (inverse of GATE 1/3 accept-malformed) ─

describe("checkCorroborationGate — malformed → rejected", () => {
  // WHY: GATE 2 rejects = "not yet corroborated". A candidate with no provable
  // signals IS the failure mode the gate exists to catch. Accept-malformed would
  // defeat the gate's entire purpose.

  test("null candidate → rejected with signalCount 0", () => {
    assert.deepEqual(checkCorroborationGate(null), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });

  test("undefined candidate → rejected with signalCount 0", () => {
    assert.deepEqual(checkCorroborationGate(undefined), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });

  test("empty object (no signals field) → rejected with signalCount 0", () => {
    assert.deepEqual(checkCorroborationGate({}), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });

  test("signals: null → rejected with signalCount 0", () => {
    assert.deepEqual(checkCorroborationGate({ signals: null }), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });

  test("signals is a string (not array) → rejected with signalCount 0", () => {
    assert.deepEqual(checkCorroborationGate({ signals: "adguard-tp" }), {
      rejected: true,
      reason: "corroboration-below-threshold",
      detail: { signalCount: 0, minSignals: 2 },
    });
  });
});

// ── T-06: Entropy does not rescue single-source candidate ─────────────────────

describe("checkCorroborationGate — entropy ignored", () => {
  test("non-null entropy on single-source candidate still rejected", () => {
    // WHY: entropy/CSF evaluation is deferred to #798 — these fields are
    // HARDCODED null at ingestion time. Including an entropy arm here = dead code.
    const candidate = { param: "track", signals: ["adguard-tp"], entropy: 4.5, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });
});

// ── T-07: Pure function — no mutation ────────────────────────────────────────

describe("checkCorroborationGate — purity", () => {
  test("call does not mutate input candidate", () => {
    const signals = ["adguard-tp"];
    const c = { param: "foo", signals };
    checkCorroborationGate(c);
    // signals array reference and contents must be identical after the call
    assert.strictEqual(c.signals, signals);
    assert.deepEqual(c.signals, ["adguard-tp"]);
  });
});

// ── T-08: partitionCandidates ─────────────────────────────────────────────────

describe("partitionCandidates", () => {
  test("mixed candidates → correct buckets, order preserved", () => {
    const A = { param: "utm_source", signals: ["adguard-tp", "clearurls"] };
    const B = { param: "some_tracker", signals: ["adguard-tp"] };
    const C = { param: "gclid", signals: ["adguard-tp", "clearurls", "brave"] };

    const { accepted, rejected } = partitionCandidates([A, B, C]);

    assert.deepEqual(accepted, [A, C]);
    assert.equal(rejected.length, 1);
    assert.strictEqual(rejected[0].candidate, B);
    assert.equal(rejected[0].reason, "corroboration-below-threshold");
    assert.deepEqual(rejected[0].detail, { signalCount: 1, minSignals: 2 });
  });

  test("empty input → {accepted:[], rejected:[]}", () => {
    assert.deepEqual(partitionCandidates([]), { accepted: [], rejected: [] });
  });

  test("all accepted", () => {
    const candidates = [
      { signals: ["a", "b"] },
      { signals: ["c", "d"] },
    ];
    const { accepted, rejected } = partitionCandidates(candidates);
    assert.equal(accepted.length, 2);
    assert.equal(rejected.length, 0);
  });

  test("all rejected", () => {
    const candidates = [
      { signals: ["a"] },
      { signals: [] },
    ];
    const { accepted, rejected } = partitionCandidates(candidates);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 2);
  });

  test("opts forwarded — minSignals:1 makes single-source accepted", () => {
    const candidates = [{ signals: ["adguard-tp"] }];
    const { accepted, rejected } = partitionCandidates(candidates, { minSignals: 1 });
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 0);
  });
});
