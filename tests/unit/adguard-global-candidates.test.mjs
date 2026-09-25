/**
 * MUGA — unit tests for tools/adguard-global-candidates.mjs (#1463 Area 5
 * automation).
 *
 * findNewGlobalCandidates is the pure decision core: given MUGA's current
 * TRACKING_PARAMS/TRACKING_PREFIXES and AdGuard's globally-asserted
 * (bareNames) param names, find every name not yet covered by
 * TRACKING_PARAMS, a TRACKING_PREFIXES prefix, or any structural/
 * adjudicated exclusion. Mirror of tests/unit/anchored-only-globals.test.mjs,
 * opposite direction.
 *
 * No network, no fs — every fixture is a hand-built object.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  findNewGlobalCandidates,
  renderIssueBody,
  buildExclusions,
} from "../../tools/adguard-global-candidates.mjs";
import { assertAdguardNotDegenerate, MIN_ADGUARD_FACTS } from "../../tools/anchored-only-globals.mjs";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";
import { TRACKING_PARAMS, TRACKING_PREFIXES, getAllLandingParams } from "../../src/lib/affiliates.js";
import { ADJUDICATED_SKIP_GLOBAL } from "../../src/lib/affiliates-data.js";

const emptyExclusions = () => ({
  guard: new Set(),
  denylist: new Set(),
  landingParams: new Set(),
  adjudicatedSkip: new Set(),
});

describe("findNewGlobalCandidates (#1463 Area 5)", () => {
  test("a bareName not in TRACKING_PARAMS and not prefixed is a candidate", () => {
    const result = findNewGlobalCandidates(["utm_source"], ["utm_"], new Set(["newparam"]), emptyExclusions());
    assert.deepEqual(result, ["newparam"]);
  });

  test("a bareName already in TRACKING_PARAMS is NOT a candidate", () => {
    const result = findNewGlobalCandidates(["fbclid"], [], new Set(["fbclid"]), emptyExclusions());
    assert.deepEqual(result, []);
  });

  test("a bareName covered by a TRACKING_PREFIXES prefix is NOT a candidate", () => {
    const result = findNewGlobalCandidates([], ["utm_"], new Set(["utm_roistat"]), emptyExclusions());
    assert.deepEqual(result, [], "utm_roistat is covered by the utm_ prefix even though it is not a literal TRACKING_PARAMS entry");
  });

  test("a guard-excluded name is NOT a candidate", () => {
    const result = findNewGlobalCandidates([], [], new Set(["awc"]), { ...emptyExclusions(), guard: new Set(["awc"]) });
    assert.deepEqual(result, []);
  });

  test("a denylist-excluded name is NOT a candidate", () => {
    const result = findNewGlobalCandidates([], [], new Set(["from"]), { ...emptyExclusions(), denylist: new Set(["from"]) });
    assert.deepEqual(result, []);
  });

  test("a landingParams-excluded name is NOT a candidate", () => {
    const result = findNewGlobalCandidates([], [], new Set(["cjevent"]), { ...emptyExclusions(), landingParams: new Set(["cjevent"]) });
    assert.deepEqual(result, [], "already stripped everywhere under stripAllAffiliates — landing it again globally would be redundant and unconditional");
  });

  test("an adjudicated-skip name is NOT a candidate", () => {
    const result = findNewGlobalCandidates([], [], new Set(["x-clickref"]), { ...emptyExclusions(), adjudicatedSkip: new Set(["x-clickref"]) });
    assert.deepEqual(result, []);
  });

  test("matching is case-insensitive", () => {
    const result = findNewGlobalCandidates(["FBCLID"], [], new Set(["fbclid"]), emptyExclusions());
    assert.deepEqual(result, []);
  });

  test("result is deduped and sorted", () => {
    const result = findNewGlobalCandidates([], [], new Set(["zeta", "alpha", "zeta"]), emptyExclusions());
    assert.deepEqual(result, ["alpha", "zeta"]);
  });

  test("empty bareNames yields no candidates", () => {
    const result = findNewGlobalCandidates(["a"], ["b_"], new Set(), emptyExclusions());
    assert.deepEqual(result, []);
  });
});

describe("buildExclusions (#1463 Area 5)", () => {
  const exclusions = buildExclusions();

  test("returns the live AFFILIATE_PARAM_GUARD set", () => {
    assert.equal(exclusions.guard, AFFILIATE_PARAM_GUARD);
  });

  test("returns the live REMOTE_PARAM_DENYLIST set", () => {
    assert.equal(exclusions.denylist, REMOTE_PARAM_DENYLIST);
  });

  test("returns the live getAllLandingParams() set", () => {
    assert.deepEqual([...exclusions.landingParams].sort(), [...getAllLandingParams()].sort());
  });

  test("adjudicatedSkip contains every ADJUDICATED_SKIP_GLOBAL key, lowercased", () => {
    for (const key of Object.keys(ADJUDICATED_SKIP_GLOBAL)) {
      assert.ok(exclusions.adjudicatedSkip.has(key.toLowerCase()), `missing ${key}`);
    }
  });

  test("end to end: findNewGlobalCandidates excludes a real member of each set via buildExclusions()", () => {
    const guardMember = [...AFFILIATE_PARAM_GUARD][0];
    const denylistMember = [...REMOTE_PARAM_DENYLIST][0];
    const landingMember = [...getAllLandingParams()][0];
    const adjudicatedMember = Object.keys(ADJUDICATED_SKIP_GLOBAL)[0];

    const names = new Set([guardMember, denylistMember, landingMember, adjudicatedMember].map((n) => n.toLowerCase()));
    const result = findNewGlobalCandidates(TRACKING_PARAMS, TRACKING_PREFIXES, names, exclusions);
    assert.deepEqual(result, [], "every representative member must be excluded end to end");
  });

  test("a genuinely new, unexcluded name still surfaces end to end", () => {
    const result = findNewGlobalCandidates(TRACKING_PARAMS, TRACKING_PREFIXES, new Set(["totally_new_unseen_param_xyz"]), exclusions);
    assert.deepEqual(result, ["totally_new_unseen_param_xyz"]);
  });
});

describe("renderIssueBody (#1463 Area 5)", () => {
  test("0 candidates renders the closed-issue body, mentions no action needed", () => {
    const body = renderIssueBody({ generated_at: "2026-09-24T00:00:00.000Z", tracking_params_count: 361, candidate_count: 0, candidates: [] });
    assert.match(body, /no new candidates/i);
    assert.match(body, /no action needed/i);
  });

  test("N candidates renders the candidate list and the DO NOT auto-land warning", () => {
    const body = renderIssueBody({
      generated_at: "2026-09-24T00:00:00.000Z",
      tracking_params_count: 361,
      candidate_count: 2,
      candidates: ["foo", "bar"],
    });
    assert.match(body, /`foo`/);
    assert.match(body, /`bar`/);
    assert.match(body, /DO NOT auto-land/);
    assert.match(body, /DO NOT open a PR/);
  });

  test("triage steps reference the #1463 Area 1 method and ADJUDICATED_SKIP_GLOBAL", () => {
    const body = renderIssueBody({ generated_at: "x", tracking_params_count: 1, candidate_count: 1, candidates: ["foo"] });
    assert.match(body, /ADJUDICATED_SKIP_GLOBAL/);
  });
});

// ── Reuse of the #1228 degenerate-upstream guard ─────────────────────────────
// This tool reuses assertAdguardNotDegenerate from anchored-only-globals.mjs
// directly rather than duplicating it — same AdGuard source, same failure
// mode (an empty/truncated/HTML-error-page-as-200 response must refuse
// loudly, never silently report "0 candidates").
describe("assertAdguardNotDegenerate reuse (#1463 Area 5)", () => {
  test("throws on a completely empty parse result", () => {
    assert.throws(() => assertAdguardNotDegenerate({ bareNames: new Set(), scoped: [], pathAnchored: [] }), /degenerate/i);
  });

  test("does NOT throw when the total fact count meets the conservative floor", () => {
    assert.doesNotThrow(() =>
      assertAdguardNotDegenerate({
        bareNames: new Set(Array.from({ length: MIN_ADGUARD_FACTS }, (_, i) => `p${i}`)),
        scoped: [],
        pathAnchored: [],
      }),
    );
  });
});
