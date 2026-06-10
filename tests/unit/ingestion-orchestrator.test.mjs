/**
 * MUGA — Unit tests for tools/rule-ingestion/orchestrate.mjs
 *
 * Covers:
 *   - Binary bucket partitioning (R1)
 *   - Collect-all rejection reasons + uniform envelope (R2)
 *   - Gate ordering invariant / no-short-circuit (R3)
 *   - Determinism: same input → byte-identical output (R4)
 *   - buildParams: dedup + sort (R4)
 *   - GATE2 malformed-candidate fail-closed (R10)
 *   - Signing round-trip: verifySignature returns true (R6-S1)
 *   - Tamper detection: params / version / published (R6-S2, R6-S3)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import {
  runOrchestration,
  buildParams,
  canonicalMessage,
  DEFAULT_GATES,
} from "../../tools/rule-ingestion/orchestrate.mjs";

import { checkCorroborationGate } from "../../tools/rule-ingestion/gates/corroboration-gate.mjs";

import { verifySignature } from "../../src/lib/remote-rules.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stub gate factory: always passes */
function stubPass(label) {
  return {
    gate: label,
    check: () => ({ rejected: false }),
    optsKey: label,
    normalize: (v) => ({ gate: label, reason: v.reason, evidence: {} }),
  };
}

/** Stub gate factory: always rejects with given reason + evidence */
function stubReject(label, reason, evidence = {}) {
  return {
    gate: label,
    check: () => ({ rejected: true, reason, ...evidence }),
    optsKey: label,
    normalize: (v) => ({ gate: label, reason: v.reason, evidence }),
  };
}

/** Minimal valid candidate with enough signals for GATE2 */
function makeCandidate(param, overrides = {}) {
  return {
    param,
    signals: ["signal-a", "signal-b"],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Sign a canonical string with a private key → base64url */
function signCanonical(msg, privateKey) {
  return cryptoSign(null, Buffer.from(msg, "utf8"), privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Export raw 32-byte Ed25519 public key as standard base64 */
function exportPubKeyBase64(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

// ── All-stub gates (4 stubs, all passing) ─────────────────────────────────────
const ALL_PASS_GATES = [
  stubPass("affiliate-guard"),
  stubPass("corroboration-gate"),
  stubPass("canary-gate"),
  stubPass("functional-bias-gate"),
];

// ── Module shape: real DEFAULT_GATES wiring (stub tests bypass it) ────────────

describe("orchestrate — module shape", () => {
  test("no default export (named exports only)", async () => {
    const mod = await import("../../tools/rule-ingestion/orchestrate.mjs");
    assert.strictEqual(mod.default, undefined);
  });

  test("DEFAULT_GATES has the 4 gates in canonical order", () => {
    assert.strictEqual(DEFAULT_GATES.length, 4);
    assert.deepStrictEqual(
      DEFAULT_GATES.map((d) => d.gate),
      ["affiliate-guard", "corroboration-gate", "canary-gate", "functional-bias-gate"]
    );
  });

  test("every DEFAULT_GATES descriptor exposes check + normalize", () => {
    for (const d of DEFAULT_GATES) {
      assert.strictEqual(typeof d.check, "function", `${d.gate}.check`);
      assert.strictEqual(typeof d.normalize, "function", `${d.gate}.normalize`);
    }
  });
});

// ── T-01: Binary bucket + empty-input ────────────────────────────────────────

describe("R1 — Binary bucket partitioning", () => {
  test("R1-S1: all-pass gates → candidate lands in autoMerge, quarantine empty", () => {
    const candidate = makeCandidate("utm_source");
    const result = runOrchestration({
      candidates: [candidate],
      gates: ALL_PASS_GATES,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.autoMerge.length, 1);
    assert.strictEqual(result.quarantine.length, 0);
    assert.strictEqual(result.autoMerge[0], candidate);
  });

  test("R1-S2: one gate rejects → candidate lands in quarantine, autoMerge empty", () => {
    const candidate = makeCandidate("utm_source");
    const rejectGates = [
      stubPass("affiliate-guard"),
      stubReject("corroboration-gate", "corroboration-below-threshold"),
      stubPass("canary-gate"),
      stubPass("functional-bias-gate"),
    ];

    const result = runOrchestration({
      candidates: [candidate],
      gates: rejectGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.autoMerge.length, 0);
    assert.strictEqual(result.quarantine.length, 1);
    assert.strictEqual(result.quarantine[0].candidate, candidate);
  });

  test("R1-S3: empty input → both buckets empty, params empty", () => {
    const result = runOrchestration({
      candidates: [],
      gates: ALL_PASS_GATES,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(result.autoMerge, []);
    assert.deepStrictEqual(result.quarantine, []);
    assert.deepStrictEqual(result.artifactBody.params, []);
  });

  test("R1-S4: input order preserved within each bucket (A,C pass; B quarantined)", () => {
    const a = makeCandidate("alpha");
    const b = makeCandidate("beta");
    const c = makeCandidate("gamma");

    const orderGates = [
      stubPass("affiliate-guard"),
      {
        gate: "corroboration-gate",
        check: (candidate) =>
          candidate.param === "beta"
            ? { rejected: true, reason: "corroboration-below-threshold" }
            : { rejected: false },
        optsKey: "corroboration-gate",
        normalize: (v) => ({
          gate: "corroboration-gate",
          reason: v.reason,
          evidence: {},
        }),
      },
      stubPass("canary-gate"),
      stubPass("functional-bias-gate"),
    ];

    const result = runOrchestration({
      candidates: [a, b, c],
      gates: orderGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.autoMerge.length, 2);
    assert.strictEqual(result.autoMerge[0], a);
    assert.strictEqual(result.autoMerge[1], c);
    assert.strictEqual(result.quarantine.length, 1);
    assert.strictEqual(result.quarantine[0].candidate, b);
  });
});

// ── T-03: Collect-all rejections + envelope shape ─────────────────────────────

describe("R2 — Collect-all rejection reasons", () => {
  test("R2-S1: candidate rejected by GATE1+GATE4 → rejections.length===2, order [affiliate-guard, functional-bias-gate]", () => {
    const candidate = makeCandidate("ref");
    const rejectGates = [
      stubReject("affiliate-guard", "affiliate-collision", {
        collidingPrograms: [{ id: "amazon", source: "affiliate" }],
      }),
      stubPass("corroboration-gate"),
      stubPass("canary-gate"),
      stubReject("functional-bias-gate", "functional-param", {
        detail: { param: "ref" },
      }),
    ];

    const result = runOrchestration({
      candidates: [candidate],
      gates: rejectGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.quarantine.length, 1);
    const entry = result.quarantine[0];
    assert.strictEqual(entry.rejections.length, 2);
    assert.strictEqual(entry.rejections[0].gate, "affiliate-guard");
    assert.strictEqual(entry.rejections[1].gate, "functional-bias-gate");
  });

  test("R2-S2: each gate's envelope shape is uniform {gate, reason, evidence}", () => {
    const candidate = makeCandidate("ref");
    const rejectGate = [
      {
        gate: "affiliate-guard",
        check: () => ({
          rejected: true,
          reason: "affiliate-collision",
          collidingPrograms: [{ id: "amazon", source: "affiliate" }],
        }),
        optsKey: "affiliate-guard",
        normalize: (v) => ({
          gate: "affiliate-guard",
          reason: v.reason,
          evidence: { collidingPrograms: v.collidingPrograms },
        }),
      },
      stubPass("corroboration-gate"),
      stubPass("canary-gate"),
      stubPass("functional-bias-gate"),
    ];

    const result = runOrchestration({
      candidates: [candidate],
      gates: rejectGate,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.quarantine.length, 1);
    const rejection = result.quarantine[0].rejections[0];
    assert.strictEqual(rejection.gate, "affiliate-guard");
    assert.strictEqual(rejection.reason, "affiliate-collision");
    assert.ok("evidence" in rejection);
    assert.deepStrictEqual(rejection.evidence.collidingPrograms, [
      { id: "amazon", source: "affiliate" },
    ]);
  });

  test("R2-S3: candidate rejected by all 4 gates → rejections.length===4, order [G1,G2,G3,G4]", () => {
    const candidate = makeCandidate("ref");
    const allRejectGates = [
      stubReject("affiliate-guard", "affiliate-collision"),
      stubReject("corroboration-gate", "corroboration-below-threshold"),
      stubReject("canary-gate", "canary-break"),
      stubReject("functional-bias-gate", "functional-param"),
    ];

    const result = runOrchestration({
      candidates: [candidate],
      gates: allRejectGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.quarantine.length, 1);
    const entry = result.quarantine[0];
    assert.strictEqual(entry.rejections.length, 4);
    assert.strictEqual(entry.rejections[0].gate, "affiliate-guard");
    assert.strictEqual(entry.rejections[1].gate, "corroboration-gate");
    assert.strictEqual(entry.rejections[2].gate, "canary-gate");
    assert.strictEqual(entry.rejections[3].gate, "functional-bias-gate");
  });
});

// ── T-05: Gate ordering invariant + no-short-circuit ─────────────────────────

describe("R3 — Gate ordering invariant", () => {
  test("R3-S1: per-candidate call sequence is [affiliate-guard, corroboration-gate, canary-gate, functional-bias-gate]", () => {
    const callOrder = [];

    function trackingStub(label) {
      return {
        gate: label,
        check: () => {
          callOrder.push(label);
          return { rejected: false };
        },
        optsKey: label,
        normalize: (v) => ({ gate: label, reason: v.reason, evidence: {} }),
      };
    }

    const trackGates = [
      trackingStub("affiliate-guard"),
      trackingStub("corroboration-gate"),
      trackingStub("canary-gate"),
      trackingStub("functional-bias-gate"),
    ];

    const a = makeCandidate("alpha");
    const b = makeCandidate("beta");

    runOrchestration({
      candidates: [a, b],
      gates: trackGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    // Each candidate should see all 4 gates in order
    assert.strictEqual(callOrder.length, 8);
    assert.deepStrictEqual(callOrder.slice(0, 4), [
      "affiliate-guard",
      "corroboration-gate",
      "canary-gate",
      "functional-bias-gate",
    ]);
    assert.deepStrictEqual(callOrder.slice(4, 8), [
      "affiliate-guard",
      "corroboration-gate",
      "canary-gate",
      "functional-bias-gate",
    ]);

    // GATE1 index < GATE3 index for each candidate
    const g1First = callOrder.indexOf("affiliate-guard");
    const g3First = callOrder.indexOf("canary-gate");
    assert.ok(g1First < g3First, "GATE1 must execute before GATE3");
  });

  test("R3-S2: all 4 gates called even when GATE1 rejects (no short-circuit)", () => {
    const callOrder = [];

    const gatesNoShortCircuit = [
      {
        gate: "affiliate-guard",
        check: () => {
          callOrder.push("affiliate-guard");
          return { rejected: true, reason: "affiliate-collision" };
        },
        optsKey: "affiliate-guard",
        normalize: (v) => ({
          gate: "affiliate-guard",
          reason: v.reason,
          evidence: {},
        }),
      },
      {
        gate: "corroboration-gate",
        check: () => {
          callOrder.push("corroboration-gate");
          return { rejected: false };
        },
        optsKey: "corroboration-gate",
        normalize: (v) => ({ gate: "corroboration-gate", reason: v.reason, evidence: {} }),
      },
      {
        gate: "canary-gate",
        check: () => {
          callOrder.push("canary-gate");
          return { rejected: false };
        },
        optsKey: "canary-gate",
        normalize: (v) => ({ gate: "canary-gate", reason: v.reason, evidence: {} }),
      },
      {
        gate: "functional-bias-gate",
        check: () => {
          callOrder.push("functional-bias-gate");
          return { rejected: false };
        },
        optsKey: "functional-bias-gate",
        normalize: (v) => ({ gate: "functional-bias-gate", reason: v.reason, evidence: {} }),
      },
    ];

    runOrchestration({
      candidates: [makeCandidate("ref")],
      gates: gatesNoShortCircuit,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(callOrder, [
      "affiliate-guard",
      "corroboration-gate",
      "canary-gate",
      "functional-bias-gate",
    ]);
  });
});

// ── T-07: Determinism ─────────────────────────────────────────────────────────

describe("R4 — Determinism", () => {
  test("R4-S1: identical input → byte-identical output across two runs", () => {
    const candidates = [makeCandidate("utm_source"), makeCandidate("fbclid")];
    const opts = {
      candidates,
      gates: ALL_PASS_GATES,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    };

    const r1 = runOrchestration(opts);
    const r2 = runOrchestration(opts);

    assert.deepStrictEqual(r1.autoMerge, r2.autoMerge);
    assert.deepStrictEqual(r1.quarantine, r2.quarantine);
    assert.strictEqual(
      JSON.stringify(r1.artifactBody),
      JSON.stringify(r2.artifactBody)
    );
  });

  // ── T-08: buildParams dedup + sort ─────────────────────────────────────────
  test("R4-S2a: duplicate params deduped and sorted with localeCompare", () => {
    // Two candidates both carrying b-rule and a-rule
    const a = makeCandidate("b-rule");
    const b = makeCandidate("a-rule");
    const c = makeCandidate("b-rule"); // duplicate of a

    const result = runOrchestration({
      candidates: [a, b, c],
      gates: ALL_PASS_GATES,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(result.artifactBody.params, ["a-rule", "b-rule"]);
  });

  test("R4-S2b: empty autoMerge → params is []", () => {
    const allRejectGates = [
      stubReject("affiliate-guard", "affiliate-collision"),
      stubPass("corroboration-gate"),
      stubPass("canary-gate"),
      stubPass("functional-bias-gate"),
    ];

    const result = runOrchestration({
      candidates: [makeCandidate("utm_source")],
      gates: allRejectGates,
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(result.artifactBody.params, []);
  });
});

// ── Direct buildParams export tests ───────────────────────────────────────────

describe("buildParams", () => {
  test("dedup + sort via localeCompare", () => {
    const autoMerge = [
      { param: "z-rule" },
      { param: "a-rule" },
      { param: "z-rule" }, // duplicate
      { param: "m-rule" },
    ];
    assert.deepStrictEqual(buildParams(autoMerge), [
      "a-rule",
      "m-rule",
      "z-rule",
    ]);
  });

  test("empty input → []", () => {
    assert.deepStrictEqual(buildParams([]), []);
  });
});

// ── T-10: GATE2 malformed-candidate fail-closed with real gate ────────────────

describe("R10 — GATE2 malformed-candidate fail-closed", () => {
  test("R10-S1: candidate with signals:null quarantined by real GATE2, absent from autoMerge", () => {
    const malformed = {
      param: "x",
      signals: null,
      firstSeenAt: "2024-01-01T00:00:00.000Z",
      entropy: null,
      crossSiteFrequency: null,
    };

    // Use real GATE2 descriptor from the design, but inject via gateOpts
    const realGate2 = {
      gate: "corroboration-gate",
      check: checkCorroborationGate,
      optsKey: "corroborationGate",
      normalize: (v) => ({
        gate: "corroboration-gate",
        reason: v.reason,
        evidence: { detail: v.detail },
      }),
    };

    const result = runOrchestration({
      candidates: [malformed],
      gates: [
        stubPass("affiliate-guard"),
        realGate2,
        stubPass("canary-gate"),
        stubPass("functional-bias-gate"),
      ],
      gateOpts: { corroborationGate: { minSignals: 2 } },
      version: 1,
      published: "2024-01-01T00:00:00.000Z",
    });

    assert.strictEqual(result.autoMerge.length, 0, "malformed must not appear in autoMerge");
    assert.strictEqual(result.quarantine.length, 1);

    const entry = result.quarantine[0];
    assert.strictEqual(entry.candidate, malformed);

    const corrobRejection = entry.rejections.find(
      (r) => r.gate === "corroboration-gate"
    );
    assert.ok(corrobRejection, "rejection by corroboration-gate must exist");
    assert.strictEqual(corrobRejection.reason, "corroboration-below-threshold");
    // Detail now includes all evaluated arm values for quarantine transparency (#798)
    assert.strictEqual(corrobRejection.evidence.detail.signalCount, 0);
    assert.strictEqual(corrobRejection.evidence.detail.minSignals, 2);
    assert.strictEqual(corrobRejection.evidence.detail.entropy, null);
    assert.strictEqual(corrobRejection.evidence.detail.crossSiteFrequency, null);
    assert.strictEqual(corrobRejection.evidence.detail.entropyFloor, 4.0);
    assert.strictEqual(corrobRejection.evidence.detail.csfFloor, 3);

    // Must not appear in params
    assert.ok(
      !result.artifactBody.params.includes("x"),
      "malformed param must not appear in artifactBody.params"
    );
  });
});

// ── T-12/T-13/T-14: Signing round-trip ───────────────────────────────────────

describe("R6 — Signing round-trip verify", () => {
  // Generate throw-away test keypair once per test group
  const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
    generateKeyPairSync("ed25519");

  const testPubKeyB64 = exportPubKeyBase64(TEST_PUB_KEY);
  // We pass our throw-away test key directly via verifySignature's `trustedKeys`
  // parameter. This exercises the SAME Ed25519 WebCrypto verification logic that
  // production (#780) uses — verifySignature(canonical, sig, trustedKeys, subtle)
  // — only the keys array differs. It does NOT exercise the key-resolution path
  // in runRemoteRulesFetch (the MUGA_TEST / __MUGA_TRUSTED_KEYS__ override), which
  // is irrelevant here: verifySignature itself never reads process.env.
  const trustedKeys = [testPubKeyB64];

  // Fixed test payload for reproducibility
  const version = 1;
  const published = "2024-01-01T00:00:00.000Z";
  const params = ["a-rule", "b-rule"];

  test("R6-S1: verifySignature returns true for correctly signed canonical message", async () => {
    const canonical = canonicalMessage(version, published, params);
    const sig = signCanonical(canonical, TEST_PRIV_KEY);

    const result = await verifySignature(
      canonical,
      sig,
      trustedKeys,
      globalThis.crypto.subtle
    );

    assert.strictEqual(result, true, "verifySignature must return true for a valid signature");
  });

  test("R6-S2: tampered params → verifySignature returns false", async () => {
    const canonical = canonicalMessage(version, published, params);
    const sig = signCanonical(canonical, TEST_PRIV_KEY);

    // Tamper: add an extra param
    const tamperedParams = [...params, "c-injected"];
    const tamperedCanonical = canonicalMessage(version, published, tamperedParams);

    const result = await verifySignature(
      tamperedCanonical,
      sig,
      trustedKeys,
      globalThis.crypto.subtle
    );

    assert.strictEqual(result, false, "verifySignature must return false for tampered params");
  });

  test("R6-S3a: tampered version → verifySignature returns false", async () => {
    const canonical = canonicalMessage(version, published, params);
    const sig = signCanonical(canonical, TEST_PRIV_KEY);

    const tamperedCanonical = canonicalMessage(version + 1, published, params);

    const result = await verifySignature(
      tamperedCanonical,
      sig,
      trustedKeys,
      globalThis.crypto.subtle
    );

    assert.strictEqual(result, false, "verifySignature must return false for tampered version");
  });

  test("R6-S3b: tampered published → verifySignature returns false", async () => {
    const canonical = canonicalMessage(version, published, params);
    const sig = signCanonical(canonical, TEST_PRIV_KEY);

    const tamperedCanonical = canonicalMessage(
      version,
      "2099-12-31T23:59:59.000Z",
      params
    );

    const result = await verifySignature(
      tamperedCanonical,
      sig,
      trustedKeys,
      globalThis.crypto.subtle
    );

    assert.strictEqual(result, false, "verifySignature must return false for tampered published");
  });
});
