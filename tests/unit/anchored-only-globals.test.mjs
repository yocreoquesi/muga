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

import { findAnchoredOnlyGlobals, renderIssueBody } from "../../tools/anchored-only-globals.mjs";

const emptyAdguard = () => ({ bareNames: new Set(), scoped: [], pathAnchored: [] });
const emptyClearurls = () => ({ globalPatterns: [], anchored: [] });
const emptyExclusions = () => ({ guard: new Set(), denylist: new Set(), pathAnchoredStayGlobal: new Set() });

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
});
