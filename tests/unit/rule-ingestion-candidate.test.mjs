/**
 * MUGA — Candidate format contract tests for rule-ingestion (#773).
 *
 * Locks the shared candidate shape the EPIC C gates consume: provenance in
 * signals[], entropy/crossSiteFrequency null at B2, single-source survival, and
 * deterministic merge ordering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCandidate,
  mergeCandidates,
} from "../../tools/rule-ingestion/candidate.mjs";

const NOW = "2026-05-31T00:00:00.000Z";

test("makeCandidate lowercases the param and carries one signal", () => {
  const c = makeCandidate("UTM_Source", "adguard-tp", { now: NOW });
  assert.deepEqual(c, {
    param: "utm_source",
    signals: ["adguard-tp"],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: NOW,
  });
});

test("mergeCandidates dedupes params and lowercases", () => {
  // After T-09: mergeCandidates returns { candidates, emptyDropped }
  const { candidates: out } = mergeCandidates(
    [{ id: "adguard-tp", params: ["fbclid", "FBCLID", "gclid"] }],
    { now: NOW },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => c.param).sort(),
    ["fbclid", "gclid"],
  );
});

test("mergeCandidates accumulates provenance across adapters without dup signals", () => {
  const { candidates: out } = mergeCandidates(
    [
      { id: "adguard-tp", params: ["fbclid"] },
      { id: "other", params: ["fbclid"] },
      { id: "adguard-tp", params: ["fbclid"] }, // repeat adapter, same param
    ],
    { now: NOW },
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].signals, ["adguard-tp", "other"]); // sorted, deduped
});

test("single-source candidates survive (corroboration is not a hard gate)", () => {
  const { candidates: out } = mergeCandidates(
    [{ id: "adguard-tp", params: ["only_here"] }],
    { now: NOW },
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].signals, ["adguard-tp"]);
});

test("entropy and crossSiteFrequency stay null at B2 (no corpus)", () => {
  const { candidates: out } = mergeCandidates(
    [{ id: "adguard-tp", params: ["x"] }],
    { now: NOW },
  );
  assert.equal(out[0].entropy, null);
  assert.equal(out[0].crossSiteFrequency, null);
});

test("merge sorts by signal count desc, then param asc", () => {
  const { candidates: out } = mergeCandidates(
    [
      { id: "a", params: ["zeta", "shared"] },
      { id: "b", params: ["shared", "alpha"] },
    ],
    { now: NOW },
  );
  // shared has 2 signals → first; rest single-signal, alphabetical.
  assert.deepEqual(
    out.map((c) => c.param),
    ["shared", "alpha", "zeta"],
  );
});

test("empty/whitespace params are dropped", () => {
  // After T-09: mergeCandidates returns { candidates, emptyDropped }
  const { candidates: out } = mergeCandidates(
    [{ id: "a", params: ["", "  ", "real"] }],
    { now: NOW },
  );
  assert.deepEqual(
    out.map((c) => c.param),
    ["real"],
  );
});

// ── T-08 (quarantine-surface #782): mergeCandidates emptyDropped ──────────────

test("T-08: mergeCandidates returns { candidates, emptyDropped }", () => {
  const result = mergeCandidates(
    [{ id: "x", params: new Set(["", "  ", "a"]) }],
    { now: NOW },
  );
  // Must return an object { candidates, emptyDropped }
  assert.ok(!Array.isArray(result), "mergeCandidates must return an object, not a bare array");
  assert.ok(Array.isArray(result.candidates), "result.candidates must be an array");
  assert.equal(result.candidates.length, 1, "candidates must contain 1 entry (only 'a')");
  assert.equal(result.candidates[0].param, "a");
  assert.equal(result.emptyDropped, 2, `emptyDropped must be 2 ('' and '  '), got ${result.emptyDropped}`);
});
