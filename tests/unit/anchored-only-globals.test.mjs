/**
 * MUGA — unit tests for tools/anchored-only-globals.mjs (#1228 automation).
 *
 * findAnchoredOnlyGlobals is the pure decision core: given MUGA's current
 * TRACKING_PARAMS and a parsed snapshot of both upstream sources, find every
 * entry that upstream ONLY ever anchors (to a host, via AdGuard's `scoped`/
 * `pathAnchored`, or to a ClearURLs host-scoped provider) and NEVER asserts
 * globally (AdGuard `bareNames`, or a ClearURLs `globalPatterns` full match).
 *
 * No network, no fs — every fixture is a hand-built object matching the
 * shape `parseRemoveparamRules` / `extractClearurlsScopeFacts` return.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  findAnchoredOnlyGlobals,
  renderIssueBody,
  buildExclusions,
  assertAdguardNotDegenerate,
  assertClearurlsNotDegenerate,
  MIN_ADGUARD_FACTS,
  MIN_CLEARURLS_GLOBAL_PATTERNS,
  MIN_CLEARURLS_ANCHORED,
} from "../../tools/anchored-only-globals.mjs";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";
import { PATH_ANCHORED_STAY_GLOBAL, ADJUDICATED_KEEP_GLOBAL } from "../../src/lib/affiliates-data.js";
import { HOT_PATH_REQUIRED } from "../../src/lib/hot-path-strip.js";

const emptyAdguard = () => ({ bareNames: new Set(), scoped: [], pathAnchored: [] });
const emptyClearurls = () => ({ globalPatterns: [], anchored: [] });
const emptyExclusions = () => ({
  guard: new Set(),
  denylist: new Set(),
  pathAnchoredStayGlobal: new Set(),
  hotPathRequired: new Set(),
  adjudicatedKeepGlobal: new Set(),
});

describe("findAnchoredOnlyGlobals (#1228)", () => {
  test("a param with an AdGuard host anchor and no global evidence anywhere is a candidate", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "napm", scope: "example.com" }], pathAnchored: [] };
    const clearurls = emptyClearurls();
    const result = findAnchoredOnlyGlobals(["napm"], adguard, clearurls, emptyExclusions());
    assert.deepEqual(result, [
      { param: "napm", evidence: [{ source: "adguard", host: "example.com" }] },
    ]);
  });

  test("a param with an AdGuard bareNames hit (global evidence) is NOT a candidate, even alongside an anchor", () => {
    const adguard = {
      bareNames: new Set(["cid"]),
      scoped: [{ param: "cid", scope: "example.com" }],
      pathAnchored: [],
    };
    const result = findAnchoredOnlyGlobals(["cid"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, []);
  });

  test("a param with a ClearURLs globalPatterns match is NOT a candidate, even with an AdGuard anchor", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "fbclid", scope: "example.com" }], pathAnchored: [] };
    const clearurls = { globalPatterns: [/^fbclid$/i], anchored: [] };
    const result = findAnchoredOnlyGlobals(["fbclid"], adguard, clearurls, emptyExclusions());
    assert.deepEqual(result, []);
  });

  // ── R3 review: an unanchored AdGuard REGEX removeparam rule is global
  // evidence too, same as bareNames and ClearURLs globalPatterns.
  test("a param matched by an AdGuard bareRegexes entry (global evidence) is NOT a candidate, even alongside an anchor", () => {
    const adguard = {
      bareNames: new Set(),
      scoped: [{ param: "at_custom1", scope: "example.com" }],
      pathAnchored: [],
      bareRegexes: [/^(?:at_custom\d+)$/i],
    };
    const result = findAnchoredOnlyGlobals(["at_custom1"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, []);
  });

  test("bareRegexes matching is case-insensitive and full-string, mirroring the ClearURLs side", () => {
    const adguard = {
      bareNames: new Set(),
      scoped: [{ param: "foo", scope: "example.com" }],
      pathAnchored: [],
      bareRegexes: [/^(?:foo)$/i],
    };
    const caseResult = findAnchoredOnlyGlobals(["FOO"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(caseResult, [], "case-insensitive match against the lowercased candidate");
  });

  test("missing bareRegexes on the adguard fixture defaults to no regex evidence (defensive)", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "napm", scope: "example.com" }], pathAnchored: [] };
    const result = findAnchoredOnlyGlobals(["napm"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, [
      { param: "napm", evidence: [{ source: "adguard", host: "example.com" }] },
    ]);
  });

  test("a param with NO anchored evidence at all is not reported (nothing to remove)", () => {
    // Not in TRACKING_PARAMS' upstream footprint at all — out of this class entirely.
    const result = findAnchoredOnlyGlobals(["mystery"], emptyAdguard(), emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, []);
  });

  test("a param anchored only via AdGuard pathAnchored (no host anchor) is still a candidate, with a path evidence entry", () => {
    const adguard = {
      bareNames: new Set(),
      scoped: [],
      pathAnchored: [{ param: "ved", host: "google.com", pathPrefix: "/search" }],
    };
    const result = findAnchoredOnlyGlobals(["ved"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, [
      { param: "ved", evidence: [{ source: "adguard", host: "google.com", path: "/search" }] },
    ]);
  });

  test("a param anchored only via ClearURLs (host-scoped provider) is a candidate, with a clearurls evidence entry", () => {
    const clearurls = { globalPatterns: [], anchored: [{ param: "si", scope: "youtube" }] };
    const result = findAnchoredOnlyGlobals(["si"], emptyAdguard(), clearurls, emptyExclusions());
    assert.deepEqual(result, [
      { param: "si", evidence: [{ source: "clearurls", host: "youtube" }] },
    ]);
  });

  test("evidence from both sources is combined for the same param", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "ref_", scope: "imdb.com" }], pathAnchored: [] };
    const clearurls = { globalPatterns: [], anchored: [{ param: "ref_", scope: "imdb" }] };
    const result = findAnchoredOnlyGlobals(["ref_"], adguard, clearurls, emptyExclusions());
    assert.deepEqual(result, [
      {
        param: "ref_",
        evidence: [
          { source: "adguard", host: "imdb.com" },
          { source: "clearurls", host: "imdb" },
        ],
      },
    ]);
  });

  test("AFFILIATE_PARAM_GUARD members are excluded even with anchored-only evidence", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "click_id", scope: "example.com" }], pathAnchored: [] };
    const exclusions = { guard: new Set(["click_id"]), denylist: new Set(), pathAnchoredStayGlobal: new Set() };
    const result = findAnchoredOnlyGlobals(["click_id"], adguard, emptyClearurls(), exclusions);
    assert.deepEqual(result, []);
  });

  test("REMOTE_PARAM_DENYLIST members are excluded even with anchored-only evidence", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "q", scope: "example.com" }], pathAnchored: [] };
    const exclusions = { guard: new Set(), denylist: new Set(["q"]), pathAnchoredStayGlobal: new Set() };
    const result = findAnchoredOnlyGlobals(["q"], adguard, emptyClearurls(), exclusions);
    assert.deepEqual(result, []);
  });

  test("PATH_ANCHORED_STAY_GLOBAL members are excluded even with anchored-only evidence", () => {
    const adguard = {
      bareNames: new Set(),
      scoped: [],
      pathAnchored: [{ param: "sprefix", host: "amazon.com", pathPrefix: "/stores" }],
    };
    const exclusions = { guard: new Set(), denylist: new Set(), pathAnchoredStayGlobal: new Set(["sprefix"]) };
    const result = findAnchoredOnlyGlobals(["sprefix"], adguard, emptyClearurls(), exclusions);
    assert.deepEqual(result, []);
  });

  // ── follow-up fix: the first live run surfaced 9 already-adjudicated
  // names (_sid, _ss, pk_kwd, spjobid/spmailingid/spreportid/spuserid,
  // tt_content, tt_medium) — noise the report must never repeat.
  test("HOT_PATH_REQUIRED members are excluded even with anchored-only evidence (Shopify _sid/_ss false positive)", () => {
    const adguard = { bareNames: new Set(), scoped: [], pathAnchored: [] };
    const clearurls = { globalPatterns: [], anchored: [{ param: "_sid", scope: "nordwolle.com" }] };
    const exclusions = {
      guard: new Set(),
      denylist: new Set(),
      pathAnchoredStayGlobal: new Set(),
      hotPathRequired: new Set(["_sid"]),
      adjudicatedKeepGlobal: new Set(),
    };
    const result = findAnchoredOnlyGlobals(["_sid"], adguard, clearurls, exclusions);
    assert.deepEqual(result, []);
  });

  test("ADJUDICATED_KEEP_GLOBAL members are excluded even with anchored-only evidence (pk_kwd / Silverpop / tt_* false positives)", () => {
    const clearurls = { globalPatterns: [], anchored: [{ param: "pk_kwd", scope: "vivaldi" }] };
    const exclusions = {
      guard: new Set(),
      denylist: new Set(),
      pathAnchoredStayGlobal: new Set(),
      hotPathRequired: new Set(),
      adjudicatedKeepGlobal: new Set(["pk_kwd"]),
    };
    const result = findAnchoredOnlyGlobals(["pk_kwd"], emptyAdguard(), clearurls, exclusions);
    assert.deepEqual(result, []);
  });

  test("comparison is case-insensitive on TRACKING_PARAMS entries", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "napm", scope: "example.com" }], pathAnchored: [] };
    const result = findAnchoredOnlyGlobals(["NaPm"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result, [
      { param: "napm", evidence: [{ source: "adguard", host: "example.com" }] },
    ]);
  });

  test("results are sorted by param name", () => {
    const adguard = {
      bareNames: new Set(),
      scoped: [
        { param: "zeta", scope: "z.example" },
        { param: "alpha", scope: "a.example" },
      ],
      pathAnchored: [],
    };
    const result = findAnchoredOnlyGlobals(["zeta", "alpha"], adguard, emptyClearurls(), emptyExclusions());
    assert.deepEqual(result.map((r) => r.param), ["alpha", "zeta"]);
  });

  test("a param appearing twice in trackingParams (defensive) is reported once", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "dup", scope: "example.com" }], pathAnchored: [] };
    const result = findAnchoredOnlyGlobals(["dup", "dup"], adguard, emptyClearurls(), emptyExclusions());
    assert.equal(result.length, 1);
  });

  test("missing exclusions argument defaults to no exclusions (defensive)", () => {
    const adguard = { bareNames: new Set(), scoped: [{ param: "napm", scope: "example.com" }], pathAnchored: [] };
    const result = findAnchoredOnlyGlobals(["napm"], adguard, emptyClearurls());
    assert.deepEqual(result, [
      { param: "napm", evidence: [{ source: "adguard", host: "example.com" }] },
    ]);
  });
});

describe("renderIssueBody (#1228)", () => {
  test("zero candidates renders a short all-clear body mentioning the counts", () => {
    const body = renderIssueBody({
      generated_at: "2026-09-24T00:00:00.000Z",
      tracking_params_count: 400,
      candidate_count: 0,
      candidates: [],
    });
    assert.match(body, /400/);
    assert.match(body, /no candidates/i);
  });

  test("non-zero candidates lists each param with its evidence and includes triage steps referencing #1374's method", () => {
    const body = renderIssueBody({
      generated_at: "2026-09-24T00:00:00.000Z",
      tracking_params_count: 400,
      candidate_count: 1,
      candidates: [
        {
          param: "napm",
          evidence: [
            { source: "adguard", host: "example.com" },
            { source: "clearurls", host: "provider-x" },
          ],
        },
      ],
    });
    assert.match(body, /napm/);
    assert.match(body, /example\.com/);
    assert.match(body, /provider-x/);
    assert.match(body, /#1374/);
    assert.match(body, /DO NOT auto/i);
  });

  test("mentions how to add a new ADJUDICATED_KEEP_GLOBAL entry after triage", () => {
    const body = renderIssueBody({
      generated_at: "2026-09-24T00:00:00.000Z",
      tracking_params_count: 400,
      candidate_count: 1,
      candidates: [{ param: "x", evidence: [{ source: "adguard", host: "example.com" }] }],
    });
    assert.match(body, /ADJUDICATED_KEEP_GLOBAL/);
  });
});

// ── R3 review: buildExclusions() ─────────────────────────────────────────────
describe("buildExclusions (#1228 R3)", () => {
  const exclusions = buildExclusions();

  test("includes a representative AFFILIATE_PARAM_GUARD member", () => {
    const member = [...AFFILIATE_PARAM_GUARD][0];
    assert.ok(exclusions.guard.has(member));
  });

  test("includes a representative REMOTE_PARAM_DENYLIST member", () => {
    const member = [...REMOTE_PARAM_DENYLIST][0];
    assert.ok(exclusions.denylist.has(member));
  });

  test("includes a representative PATH_ANCHORED_STAY_GLOBAL member", () => {
    assert.ok(exclusions.pathAnchoredStayGlobal.has(PATH_ANCHORED_STAY_GLOBAL[0].toLowerCase()));
  });

  test("includes a representative HOT_PATH_REQUIRED member", () => {
    assert.ok(exclusions.hotPathRequired.has(HOT_PATH_REQUIRED[0].toLowerCase()));
  });

  test("includes a representative ADJUDICATED_KEEP_GLOBAL member", () => {
    const member = Object.keys(ADJUDICATED_KEEP_GLOBAL)[0];
    assert.ok(exclusions.adjudicatedKeepGlobal.has(member.toLowerCase()));
  });

  test("end to end: findAnchoredOnlyGlobals excludes a real member of each set via buildExclusions()", () => {
    const guardMember = [...AFFILIATE_PARAM_GUARD][0];
    const denylistMember = [...REMOTE_PARAM_DENYLIST][0];
    const pathAnchoredMember = PATH_ANCHORED_STAY_GLOBAL[0];
    const hotPathMember = HOT_PATH_REQUIRED[0];
    const adjudicatedMember = Object.keys(ADJUDICATED_KEEP_GLOBAL)[0];

    const names = [guardMember, denylistMember, pathAnchoredMember, hotPathMember, adjudicatedMember];
    const adguard = {
      bareNames: new Set(),
      scoped: names.map((param) => ({ param: param.toLowerCase(), scope: "example.com" })),
      pathAnchored: [],
    };
    const result = findAnchoredOnlyGlobals(names, adguard, emptyClearurls(), exclusions);
    assert.deepEqual(result, [], "every representative member must be excluded end to end");
  });
});

// ── R3 review: degenerate-upstream refusal ───────────────────────────────────
//
// A "0 candidates" result must only ever come from real upstream data. If
// the fetch returns something degenerate — empty, truncated, or an HTML
// error page served with 200 for AdGuard; missing/empty providers or
// globalRules for ClearURLs — main() must refuse loudly (non-zero exit),
// never silently report "0 candidates".
describe("assertAdguardNotDegenerate (#1228 R3)", () => {
  test("throws on a completely empty parse result", () => {
    assert.throws(
      () => assertAdguardNotDegenerate({ bareNames: new Set(), scoped: [], pathAnchored: [] }),
      /degenerate/i,
    );
  });

  test("throws when the total fact count is below the conservative floor", () => {
    const belowFloor = MIN_ADGUARD_FACTS - 1;
    assert.throws(
      () =>
        assertAdguardNotDegenerate({
          bareNames: new Set(Array.from({ length: belowFloor }, (_, i) => `p${i}`)),
          scoped: [],
          pathAnchored: [],
        }),
      /degenerate/i,
    );
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

  test("counts bareNames + scoped + pathAnchored together, not any single field alone", () => {
    const third = Math.ceil(MIN_ADGUARD_FACTS / 3);
    assert.doesNotThrow(() =>
      assertAdguardNotDegenerate({
        bareNames: new Set(Array.from({ length: third }, (_, i) => `p${i}`)),
        scoped: Array.from({ length: third }, (_, i) => ({ param: `q${i}`, scope: "example.com" })),
        pathAnchored: Array.from({ length: third }, (_, i) => ({ param: `r${i}`, host: "example.com", pathPrefix: "/x" })),
      }),
    );
  });
});

describe("assertClearurlsNotDegenerate (#1228 R3)", () => {
  test("throws when providers/globalRules are missing (empty globalPatterns AND empty anchored)", () => {
    assert.throws(
      () => assertClearurlsNotDegenerate({ globalPatterns: [], anchored: [] }),
      /degenerate/i,
    );
  });

  test("throws when globalPatterns count is below its conservative floor", () => {
    const belowFloor = MIN_CLEARURLS_GLOBAL_PATTERNS - 1;
    assert.throws(
      () =>
        assertClearurlsNotDegenerate({
          globalPatterns: Array.from({ length: belowFloor }, () => /x/i),
          anchored: Array.from({ length: MIN_CLEARURLS_ANCHORED }, (_, i) => ({ param: `p${i}`, scope: "s" })),
        }),
      /degenerate/i,
    );
  });

  test("throws when anchored count is below its conservative floor", () => {
    assert.throws(
      () =>
        assertClearurlsNotDegenerate({
          globalPatterns: Array.from({ length: MIN_CLEARURLS_GLOBAL_PATTERNS }, () => /x/i),
          anchored: Array.from({ length: MIN_CLEARURLS_ANCHORED - 1 }, (_, i) => ({ param: `p${i}`, scope: "s" })),
        }),
      /degenerate/i,
    );
  });

  test("does NOT throw when both floors are met", () => {
    assert.doesNotThrow(() =>
      assertClearurlsNotDegenerate({
        globalPatterns: Array.from({ length: MIN_CLEARURLS_GLOBAL_PATTERNS }, () => /x/i),
        anchored: Array.from({ length: MIN_CLEARURLS_ANCHORED }, (_, i) => ({ param: `p${i}`, scope: "s" })),
      }),
    );
  });
});
