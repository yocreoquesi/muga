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

// ── Slice 2 (rules-scope-normalization): candidate carries an optional scope ──
// A.10-A.14: `scope` is added only when truthy (conditional spread); dedup key
// becomes (scope, param); `mergeCandidates` also folds `scopedParams`.

test("A.10: makeCandidate with no scope deep-equals today's unscoped shape (regression pin)", () => {
  const c = makeCandidate("UTM_Source", "adguard-tp", { now: NOW });
  assert.deepEqual(c, {
    param: "utm_source",
    signals: ["adguard-tp"],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: NOW,
  });
  assert.ok(!("scope" in c), "unscoped candidate must not carry a scope key at all");
});

test("A.10: makeCandidate with a truthy scope carries it alongside the existing fields", () => {
  const c = makeCandidate("si", "adguard-tp", { now: NOW, scope: "youtube.com" });
  assert.deepEqual(c, {
    param: "si",
    signals: ["adguard-tp"],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: NOW,
    scope: "youtube.com",
  });
});

test("A.11/A.14: same param unscoped + scoped to a host produce two independent candidates", () => {
  const { candidates: out } = mergeCandidates(
    [
      { id: "adguard-tp", params: ["si"], scopedParams: [{ param: "si", scope: "youtube.com" }] },
    ],
    { now: NOW },
  );
  assert.equal(out.length, 2);
  const global = out.find((c) => !("scope" in c));
  const scoped = out.find((c) => c.scope === "youtube.com");
  assert.ok(global, "unscoped 'si' candidate must exist");
  assert.ok(scoped, "scoped 'si'@youtube.com candidate must exist");
  assert.equal(global.param, "si");
  assert.equal(scoped.param, "si");
  // Independent accumulation: each carries its own signals array.
  assert.deepEqual(global.signals, ["adguard-tp"]);
  assert.deepEqual(scoped.signals, ["adguard-tp"]);
});

test("A.14: same (param, host) pair from two adapters merges into one candidate with two signals", () => {
  const { candidates: out } = mergeCandidates(
    [
      { id: "adguard-tp", params: [], scopedParams: [{ param: "si", scope: "youtube.com" }] },
      { id: "other-source", params: [], scopedParams: [{ param: "si", scope: "youtube.com" }] },
    ],
    { now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].param, "si");
  assert.equal(out[0].scope, "youtube.com");
  assert.deepEqual(out[0].signals, ["adguard-tp", "other-source"]);
});

test("A.12: sort tiebreak by scope leaves today's no-scope order bit-identical", () => {
  // With zero scoped candidates present, output order must be unaffected by
  // the new tiebreak (it only ever activates when signals.length AND param
  // both tie, which is already covered by existing sort tests).
  const { candidates: out } = mergeCandidates(
    [{ id: "a", params: ["zeta", "shared"] }, { id: "b", params: ["shared", "alpha"] }],
    { now: NOW },
  );
  assert.deepEqual(
    out.map((c) => c.param),
    ["shared", "alpha", "zeta"],
  );
});

test("A.12: scoped candidates sharing signal count + param sort by scope (tiebreak)", () => {
  const { candidates: out } = mergeCandidates(
    [
      {
        id: "a",
        params: [],
        scopedParams: [
          { param: "x", scope: "zzz.example" },
          { param: "x", scope: "aaa.example" },
        ],
      },
    ],
    { now: NOW },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => c.scope),
    ["aaa.example", "zzz.example"],
  );
});

// ── WARNING-2 (verify-report-slice-2, obs #1527): the GLOBAL sentinel must ──
// never collide with a LEGAL wildcard scope value. Before the fix, the dedup
// key was `${scope || GLOBAL}${KEY_SEP}${param}` — since GLOBAL is itself the
// string "*", a candidate whose `scope` happened to BE "*" produced the exact
// same key as an unscoped candidate (`"*" || "*"` is `"*"`, same as
// `undefined || "*"`). That silently merged two candidates a downstream guard
// (orchestrate.mjs#isScoped, which treats scope:"*" as scoped-and-excluded)
// intends to keep apart, inflating a GATE 2 signal count from 1 to 2 — exactly
// the MIN_SIGNALS floor. Unreachable via the real AdGuard adapter today (the
// host regex rejects "*"), but reachable by any future scopedParams producer,
// including a hand-built fixture or a future Slice 3 source.

test("WARNING-2: a global param and a wildcard-scoped param sharing a name do NOT merge", () => {
  const { candidates: out } = mergeCandidates(
    [
      { id: "adapter-a", params: ["utm_source"] },
      { id: "adapter-b", params: [], scopedParams: [{ param: "utm_source", scope: "*" }] },
    ],
    { now: NOW },
  );
  // Two DISTINCT candidates, not one merged candidate with 2 signals.
  assert.equal(out.length, 2, "a wildcard-scoped candidate must not collapse into the unscoped one");
  const global = out.find((c) => !("scope" in c));
  const wildcardScoped = out.find((c) => c.scope === "*");
  assert.ok(global, "the unscoped candidate must still exist on its own");
  assert.ok(wildcardScoped, "the wildcard-scoped candidate must still exist on its own");
  assert.deepEqual(global.signals, ["adapter-a"]);
  assert.deepEqual(wildcardScoped.signals, ["adapter-b"]);
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
