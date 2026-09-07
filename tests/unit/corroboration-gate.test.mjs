/**
 * MUGA: GATE 2 — corroboration-gate tests (#776, #798).
 *
 * Verifies the corroboration predicate: a candidate is accepted when ANY of
 * three arms passes — signals arm (≥ MIN_SIGNALS), entropy arm
 * (entropy >= ENTROPY_FLOOR), or CSF arm (crossSiteFrequency >= CSF_FLOOR).
 * Null values on heuristic arms cause that arm to be skipped (not treated as
 * failing). The accepted result includes a `passedArm` field identifying which
 * arm caused acceptance; multiple arms record the first in precedence order.
 *
 * Tests cover: module shape, threshold boundaries, opts override, malformed
 * candidate handling (REJECTS — inverse of GATE 1/3's accept-malformed posture),
 * no-mutation purity, partitionCandidates batch behavior, and three-arm OR
 * predicate with null-skip guards and floor overrides (#798).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SIGNALS,
  SCOPED_MIN_SIGNALS,
  ENTROPY_FLOOR,
  CSF_FLOOR,
  checkCorroborationGate,
  partitionCandidates,
} from "../../tools/rule-ingestion/gates/corroboration-gate.mjs";
import { isScoped } from "../../tools/rule-ingestion/orchestrate.mjs";

// ── T-01: Module shape ────────────────────────────────────────────────────────

describe("corroboration-gate module shape", () => {
  test("MIN_SIGNALS is 2", () => {
    assert.equal(MIN_SIGNALS, 2);
  });

  test("ENTROPY_FLOOR is 4.0", () => {
    assert.equal(ENTROPY_FLOOR, 4.0);
  });

  test("CSF_FLOOR is 3", () => {
    assert.equal(CSF_FLOOR, 3);
  });

  test("SCOPED_MIN_SIGNALS is 1, strictly below MIN_SIGNALS", () => {
    assert.equal(SCOPED_MIN_SIGNALS, 1);
    assert.ok(SCOPED_MIN_SIGNALS < MIN_SIGNALS);
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

// ── T-02: Accept at/above threshold (signals arm) ────────────────────────────

describe("checkCorroborationGate — accept via signals arm", () => {
  test("exactly two signals → accepted with passedArm 'signals'", () => {
    const candidate = { param: "utm_source", signals: ["adguard-tp", "clearurls"], entropy: null, crossSiteFrequency: null };
    assert.deepEqual(checkCorroborationGate(candidate), { rejected: false, passedArm: "signals" });
  });

  test("three signals → accepted with passedArm 'signals'", () => {
    const candidate = { signals: ["adguard-tp", "clearurls", "brave"], entropy: null, crossSiteFrequency: null };
    assert.deepEqual(checkCorroborationGate(candidate), { rejected: false, passedArm: "signals" });
  });
});

// ── T-03: Reject below threshold — all arms null ─────────────────────────────

describe("checkCorroborationGate — reject below threshold", () => {
  test("one signal, null arms → rejected; detail includes arm values", () => {
    const candidate = { param: "fbclid", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "corroboration-below-threshold");
    assert.equal(result.detail.signalCount, 1);
    assert.equal(result.detail.minSignals, 2);
    assert.equal(result.detail.entropy, null);
    assert.equal(result.detail.crossSiteFrequency, null);
    assert.equal(result.detail.entropyFloor, 4.0);
    assert.equal(result.detail.csfFloor, 3);
  });

  test("zero signals, null arms → rejected with signalCount 0", () => {
    const candidate = { param: "ref", signals: [], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
    assert.equal(result.detail.signalCount, 0);
  });
});

// ── T-04: Opts override ───────────────────────────────────────────────────────

describe("checkCorroborationGate — opts override", () => {
  test("minSignals:1 accepts single-source candidate with passedArm 'signals'", () => {
    const candidate = { signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate, { minSignals: 1 });
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "signals");
  });

  test("minSignals:3 rejects two-source candidate with correct detail", () => {
    const candidate = { signals: ["adguard-tp", "clearurls"], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate, { minSignals: 3 });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "corroboration-below-threshold");
    assert.equal(result.detail.signalCount, 2);
    assert.equal(result.detail.minSignals, 3);
  });
});

// ── T-05: Malformed candidate — REJECTS (inverse of GATE 1/3 accept-malformed) ─

describe("checkCorroborationGate — malformed → rejected", () => {
  // WHY: GATE 2 rejects = "not yet corroborated". A candidate with no provable
  // signals IS the failure mode the gate exists to catch. Accept-malformed would
  // defeat the gate's entire purpose.

  test("null candidate → rejected with signalCount 0", () => {
    const result = checkCorroborationGate(null);
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "corroboration-below-threshold");
    assert.equal(result.detail.signalCount, 0);
    assert.equal(result.detail.minSignals, 2);
  });

  test("undefined candidate → rejected with signalCount 0", () => {
    const result = checkCorroborationGate(undefined);
    assert.equal(result.rejected, true);
    assert.equal(result.detail.signalCount, 0);
  });

  test("empty object (no signals field) → rejected with signalCount 0", () => {
    const result = checkCorroborationGate({});
    assert.equal(result.rejected, true);
    assert.equal(result.detail.signalCount, 0);
  });

  test("signals: null → rejected with signalCount 0", () => {
    const result = checkCorroborationGate({ signals: null });
    assert.equal(result.rejected, true);
    assert.equal(result.detail.signalCount, 0);
  });

  test("signals is a string (not array) → rejected with signalCount 0", () => {
    const result = checkCorroborationGate({ signals: "adguard-tp" });
    assert.equal(result.rejected, true);
    assert.equal(result.detail.signalCount, 0);
  });
});

// ── T-06: Three-arm OR predicate — heuristic arms (#798) ─────────────────────
//
// T-06 was previously "entropy ignored / single-source still rejected."
// That behaviour is REPLACED: entropy and CSF arms are now ACTIVE (#798).
// A single-signal candidate with entropy >= ENTROPY_FLOOR MUST now pass.

describe("checkCorroborationGate — entropy arm (#798)", () => {
  test("single signal + entropy >= ENTROPY_FLOOR → accepted with passedArm 'entropy'", () => {
    // Spec: Scenario "Entropy arm passes, signals insufficient"
    const candidate = { param: "track", signals: ["adguard-tp"], entropy: 5.0, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "entropy");
  });

  test("entropy exactly at floor (4.0) → accepted", () => {
    const candidate = { signals: ["x"], entropy: 4.0, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "entropy");
  });

  test("entropy below floor (2.0 < 4.0) → rejected", () => {
    // Spec: Scenario "Entropy below floor — arm skipped as failing"
    const candidate = { signals: ["x"], entropy: 2.0, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });

  test("entropy null → arm skipped, does not rescue", () => {
    const candidate = { signals: ["x"], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });

  test("entropy undefined → arm skipped, does not rescue", () => {
    const candidate = { signals: ["x"] }; // no entropy key at all
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });

  test("entropyFloor override: entropy 3.1 passes at floor 3.0 (fails at default 4.0)", () => {
    // Spec: Scenario "Floor override"
    const candidate = { signals: ["x"], entropy: 3.1, crossSiteFrequency: null };
    // Default floor → rejected
    assert.equal(checkCorroborationGate(candidate).rejected, true);
    // Override to 3.0 → accepted
    const result = checkCorroborationGate(candidate, { entropyFloor: 3.0 });
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "entropy");
  });
});

describe("checkCorroborationGate — CSF arm (#798)", () => {
  test("single signal + crossSiteFrequency >= CSF_FLOOR → accepted with passedArm 'csf'", () => {
    // Spec: Scenario "CSF arm passes, signals insufficient"
    const candidate = { signals: ["x"], entropy: null, crossSiteFrequency: 3 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "csf");
  });

  test("crossSiteFrequency exactly at floor (3) → accepted", () => {
    const candidate = { signals: [], entropy: null, crossSiteFrequency: 3 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "csf");
  });

  test("entropy present but below floor + CSF at floor → accepted with passedArm 'csf'", () => {
    // The entropy arm FAILING (not just null-skipping) must not block the CSF arm.
    const candidate = { signals: ["x"], entropy: 2.0, crossSiteFrequency: 3 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "csf");
  });

  test("crossSiteFrequency below floor (2 < 3) → rejected", () => {
    // Spec: Scenario "CSF below floor — arm skipped as failing"
    const candidate = { signals: ["x"], entropy: null, crossSiteFrequency: 2 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });

  test("crossSiteFrequency null → arm skipped, does not rescue", () => {
    const candidate = { signals: ["x"], entropy: null, crossSiteFrequency: null };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
  });

  test("csfFloor override: csf 2 passes at floor 2 (fails at default 3)", () => {
    const candidate = { signals: ["x"], entropy: null, crossSiteFrequency: 2 };
    // Default → rejected
    assert.equal(checkCorroborationGate(candidate).rejected, true);
    // Override to 2 → accepted
    const result = checkCorroborationGate(candidate, { csfFloor: 2 });
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "csf");
  });
});

describe("checkCorroborationGate — multi-arm precedence (#798)", () => {
  test("all three arms pass → passedArm is 'signals' (first in precedence)", () => {
    const candidate = { signals: ["a", "b"], entropy: 5.0, crossSiteFrequency: 4 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "signals");
  });

  test("signals fail, entropy and CSF pass → passedArm is 'entropy' (second in precedence)", () => {
    const candidate = { signals: ["a"], entropy: 5.0, crossSiteFrequency: 4 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "entropy");
  });

  test("signals fail, entropy null, CSF passes → passedArm is 'csf'", () => {
    const candidate = { signals: ["a"], entropy: null, crossSiteFrequency: 5 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, false);
    assert.equal(result.passedArm, "csf");
  });
});

describe("checkCorroborationGate — reject detail includes arm values (#798)", () => {
  test("rejected result detail contains entropy/csf/floor values for quarantine transparency", () => {
    const candidate = { signals: ["x"], entropy: 2.5, crossSiteFrequency: 1 };
    const result = checkCorroborationGate(candidate);
    assert.equal(result.rejected, true);
    // Detail must include evaluated arm values
    assert.equal(result.detail.entropy, 2.5);
    assert.equal(result.detail.crossSiteFrequency, 1);
    assert.equal(result.detail.entropyFloor, 4.0);
    assert.equal(result.detail.csfFloor, 3);
    assert.equal(result.detail.signalCount, 1);
    assert.equal(result.detail.minSignals, 2);
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
    const A = { param: "utm_source", signals: ["adguard-tp", "clearurls"], entropy: null, crossSiteFrequency: null };
    const B = { param: "some_tracker", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null };
    const C = { param: "gclid", signals: ["adguard-tp", "clearurls", "brave"], entropy: null, crossSiteFrequency: null };

    const { accepted, rejected } = partitionCandidates([A, B, C]);

    assert.deepEqual(accepted, [A, C]);
    assert.equal(rejected.length, 1);
    assert.strictEqual(rejected[0].candidate, B);
    assert.equal(rejected[0].reason, "corroboration-below-threshold");
    assert.equal(rejected[0].detail.signalCount, 1);
    assert.equal(rejected[0].detail.minSignals, 2);
  });

  test("empty input → {accepted:[], rejected:[]}", () => {
    assert.deepEqual(partitionCandidates([]), { accepted: [], rejected: [] });
  });

  test("all accepted via signals arm", () => {
    const candidates = [
      { signals: ["a", "b"], entropy: null, crossSiteFrequency: null },
      { signals: ["c", "d"], entropy: null, crossSiteFrequency: null },
    ];
    const { accepted, rejected } = partitionCandidates(candidates);
    assert.equal(accepted.length, 2);
    assert.equal(rejected.length, 0);
  });

  test("all rejected when no arm passes", () => {
    const candidates = [
      { signals: ["a"], entropy: null, crossSiteFrequency: null },
      { signals: [], entropy: null, crossSiteFrequency: null },
    ];
    const { accepted, rejected } = partitionCandidates(candidates);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 2);
  });

  test("opts forwarded — minSignals:1 makes single-source accepted", () => {
    const candidates = [{ signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null }];
    const { accepted, rejected } = partitionCandidates(candidates, { minSignals: 1 });
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 0);
  });

  test("opts forwarded — entropyFloor override accepts candidate via entropy arm", () => {
    // Spec: Scenario "partitionCandidates forwards gateOpts to each check"
    // candidate with 1 signal, entropy 3.6, default floor 4.0 → rejected
    // with entropyFloor: 3.5 → accepted
    const cLow = { signals: ["x"], entropy: 3.6, crossSiteFrequency: null };
    const { accepted: accDefault } = partitionCandidates([cLow]);
    assert.equal(accDefault.length, 0); // default floor 4.0, fails

    const { accepted, rejected } = partitionCandidates([cLow], { entropyFloor: 3.5 });
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 0);
  });
});

// ── Scope-aware arm 1 (#1229) ────────────────────────────────────────────────
//
// MIN_SIGNALS is 2 because a promoted param applies to the whole web, and one
// upstream's word is not enough for that. An anchored fact makes a smaller
// claim — "this param is a tracker ON THIS HOST" — which is the claim upstream
// itself made, at the scope upstream chose. Taking it there runs the risk
// upstream's own users already run; widening it to global claims more than
// upstream ever did, which is #1212's shape.
//
// The measurement that makes this load-bearing: AdGuard's host-anchored
// coverage is a SINGLE adapter, so at MIN_SIGNALS=2 none of #1229's 1541
// gate-admitted (param, host) pairs can pass arm 1 at all.

describe("GATE 2 — scope-aware signal threshold (#1229)", () => {
  test("a host-anchored candidate passes on ONE signal", () => {
    const result = checkCorroborationGate({
      param: "igsh",
      scope: "instagram.com",
      signals: ["adguard-tp"],
    });

    assert.strictEqual(result.rejected, false);
    assert.strictEqual(result.passedArm, "anchor");
  });

  test("the SAME candidate without an anchor is still rejected", () => {
    // The whole point: nothing is relaxed on the global path. One upstream
    // saying a name is a tracker everywhere is exactly what the gate refuses.
    const result = checkCorroborationGate({ param: "igsh", signals: ["adguard-tp"] });

    assert.strictEqual(result.rejected, true);
    assert.strictEqual(result.reason, "corroboration-below-threshold");
  });

  test("an anchored candidate with NO signals is still rejected", () => {
    // Relaxed to 1, not to 0. A candidate no upstream reported is the failure
    // mode this gate exists to catch, and that reasoning does not depend on
    // scope.
    const result = checkCorroborationGate({ param: "igsh", scope: "instagram.com", signals: [] });

    assert.strictEqual(result.rejected, true);
    assert.strictEqual(result.detail.anchored, true);
    assert.strictEqual(result.detail.minSignals, SCOPED_MIN_SIGNALS);
  });

  test('scope "*" gets NO relaxation, even though isScoped() calls it scoped', () => {
    // The asymmetry that is easy to get wrong. `isScoped` counts "*" as scoped
    // so it stays OUT of the global signed list — exclusion only costs reach.
    // Here "*" IS the global claim, so counting it as anchored would hand the
    // relaxed threshold to the exact case the threshold protects.
    const result = checkCorroborationGate({ param: "cid", scope: "*", signals: ["adguard-tp"] });

    assert.strictEqual(result.rejected, true);
    assert.strictEqual(result.detail.anchored, false);
    assert.strictEqual(result.detail.minSignals, MIN_SIGNALS);
    // And the predicate the global path uses still calls it scoped, unchanged.
    assert.strictEqual(isScoped({ scope: "*" }), true);
  });

  test('an empty scope is not an anchor', () => {
    const result = checkCorroborationGate({ param: "cid", scope: "", signals: ["adguard-tp"] });
    assert.strictEqual(result.rejected, true);
    assert.strictEqual(result.detail.anchored, false);
  });

  test("an anchored candidate that clears the GLOBAL bar reports 'signals', not 'anchor'", () => {
    // So the quarantine report distinguishes a fact that NEEDED its scope from
    // one that merely has it. Reporting "anchor" for both would overstate how
    // much the relaxation is actually carrying.
    const result = checkCorroborationGate({
      param: "igsh",
      scope: "instagram.com",
      signals: ["adguard-tp", "clearurls"],
    });

    assert.strictEqual(result.rejected, false);
    assert.strictEqual(result.passedArm, "signals");
  });

  test("scopedMinSignals is overridable without touching the global threshold", () => {
    const candidate = { param: "igsh", scope: "instagram.com", signals: ["adguard-tp"] };

    assert.strictEqual(checkCorroborationGate(candidate).rejected, false);
    assert.strictEqual(
      checkCorroborationGate(candidate, { scopedMinSignals: 2 }).rejected,
      true,
      "raising the scoped threshold must bind the scoped path",
    );
  });

  test("lowering minSignals does not raise the bar on the anchored path", () => {
    // The thresholds are chosen explicitly rather than as a min() of the two,
    // so a one-off run that loosens the global bar cannot silently tighten the
    // scoped one, or the reverse.
    const anchored = { param: "igsh", scope: "instagram.com", signals: ["adguard-tp"] };
    assert.strictEqual(checkCorroborationGate(anchored, { minSignals: 5 }).rejected, false);
  });

  test("partitionCandidates splits an anchored and a global single-signal candidate", () => {
    const { accepted, rejected } = partitionCandidates([
      { param: "igsh", scope: "instagram.com", signals: ["adguard-tp"] },
      { param: "igsh", signals: ["adguard-tp"] },
    ]);

    assert.strictEqual(accepted.length, 1);
    assert.strictEqual(accepted[0].scope, "instagram.com");
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].candidate.scope, undefined);
  });
});
