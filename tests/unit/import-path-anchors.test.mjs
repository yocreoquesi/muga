/**
 * MUGA — Unit tests for tools/import-path-anchors.mjs (#1326 slice 3)
 *
 * Run with: npm test
 *
 * Coverage:
 *   - filterLandablePathAnchors excludes already-global, AFFILIATE_PARAM_GUARD,
 *     REMOTE_PARAM_DENYLIST, and host-preserved facts — same absolute guards
 *     land-scoped.mjs applies to host-scoped facts, never weaker here.
 *   - groupPathAnchors groups by (host, pathPrefix), sorted deterministically.
 *   - selectNewGroups is idempotent (already-landed re-offer is a no-op) and
 *     respects DNR_PATH_SCOPED_MAX_RULES, dropping overflow rather than
 *     raising the cap.
 *   - applyPathAnchorGroups never mutates its input and produces a
 *     domain-rules.json-shaped array a brand new or an existing host can use.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filterLandablePathAnchors,
  groupPathAnchors,
  selectNewGroups,
  applyPathAnchorGroups,
  computeLanding,
  DEFAULT_NOTE,
} from "../../tools/import-path-anchors.mjs";

describe("filterLandablePathAnchors", () => {
  test("drops a param already in the global TRACKING_PARAMS list", () => {
    const pathAnchored = [{ param: "utm_source", host: "example.com", pathPrefix: "/search" }];
    const { landable, excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: ["utm_source"],
      affiliateGuard: [],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.deepEqual(landable, []);
    assert.equal(excluded.alreadyGlobal.length, 1);
  });

  test("drops a param in AFFILIATE_PARAM_GUARD — absolute, same as land-scoped.mjs", () => {
    const pathAnchored = [{ param: "clickref", host: "example.com", pathPrefix: "/go" }];
    const { landable, excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: ["clickref"],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.deepEqual(landable, []);
    assert.equal(excluded.guard.length, 1);
  });

  test("drops a param in REMOTE_PARAM_DENYLIST — functional on any host, path scope does not help", () => {
    const pathAnchored = [{ param: "q", host: "example.com", pathPrefix: "/search" }];
    const { landable, excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: [],
      denylist: ["q"],
      hostPreservesParamFn: () => false,
    });
    assert.deepEqual(landable, []);
    assert.equal(excluded.denylist.length, 1);
  });

  test("drops a (host, param) the host's own preserve list protects", () => {
    const pathAnchored = [{ param: "cid", host: "google.com", pathPrefix: "/maps" }];
    const { landable, excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: [],
      denylist: [],
      hostPreservesParamFn: (host, param) => host === "google.com" && param === "cid",
    });
    assert.deepEqual(landable, []);
    assert.equal(excluded.hostPreserve.length, 1);
  });

  test("keeps a fact that passes every gate", () => {
    const pathAnchored = [{ param: "tid", host: "blu-ray.com", pathPrefix: "/link/click.php" }];
    const { landable, excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: [],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.deepEqual(landable, [{ param: "tid", host: "blu-ray.com", pathPrefix: "/link/click.php" }]);
    assert.equal(excluded.alreadyGlobal.length, 0);
    assert.equal(excluded.guard.length, 0);
    assert.equal(excluded.denylist.length, 0);
    assert.equal(excluded.hostPreserve.length, 0);
  });

  test("deduplicates an identical (host, pathPrefix, param) triple", () => {
    const pathAnchored = [
      { param: "cid", host: "123chat.jp", pathPrefix: "/promotion" },
      { param: "cid", host: "123chat.jp", pathPrefix: "/promotion" },
    ];
    const { landable } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: [],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.equal(landable.length, 1);
  });

  test("matches guard/denylist case-insensitively", () => {
    const pathAnchored = [{ param: "CID", host: "example.com", pathPrefix: "/x" }];
    const { excluded } = filterLandablePathAnchors(pathAnchored, {
      trackingParams: [],
      affiliateGuard: ["cid"],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.equal(excluded.guard.length, 1);
  });
});

describe("groupPathAnchors", () => {
  test("groups multiple params under the same (host, pathPrefix) into one group", () => {
    const landable = [
      { param: "d", host: "coco.fun", pathPrefix: "/share" },
      { param: "m", host: "coco.fun", pathPrefix: "/share" },
      { param: "share_to", host: "coco.fun", pathPrefix: "/share" },
    ];
    const groups = groupPathAnchors(landable);
    assert.deepEqual(groups, [
      { domain: "coco.fun", pathPrefixes: ["/share"], params: ["d", "m", "share_to"] },
    ]);
  });

  test("keeps distinct pathPrefixes on the same host as separate groups", () => {
    const landable = [
      { param: "tid", host: "ca.indeed.com", pathPrefix: "/viewjob" },
      { param: "cmp", host: "ca.indeed.com", pathPrefix: "/rc/clk" },
    ];
    const groups = groupPathAnchors(landable);
    assert.deepEqual(groups, [
      { domain: "ca.indeed.com", pathPrefixes: ["/rc/clk"], params: ["cmp"] },
      { domain: "ca.indeed.com", pathPrefixes: ["/viewjob"], params: ["tid"] },
    ]);
  });

  test("sorts groups deterministically by domain then prefix", () => {
    const landable = [
      { param: "a", host: "z.example", pathPrefix: "/b" },
      { param: "b", host: "a.example", pathPrefix: "/z" },
      { param: "c", host: "a.example", pathPrefix: "/a" },
    ];
    const groups = groupPathAnchors(landable);
    assert.deepEqual(
      groups.map((g) => `${g.domain}${g.pathPrefixes[0]}`),
      ["a.example/a", "a.example/z", "z.example/b"]
    );
  });
});

describe("selectNewGroups", () => {
  test("a group with no existing (domain, prefix) match is new", () => {
    const candidates = [{ domain: "example.com", pathPrefixes: ["/x"], params: ["a"] }];
    const { toAdd, alreadyLanded, overflow, existingRuleCount } = selectNewGroups(candidates, []);
    assert.deepEqual(toAdd, candidates);
    assert.deepEqual(alreadyLanded, []);
    assert.deepEqual(overflow, []);
    assert.equal(existingRuleCount, 0);
  });

  test("re-offering an identical, already-landed group is a no-op (idempotent re-run)", () => {
    const existingDomainRules = [
      { domain: "google.com", pathStrips: [{ pathPrefixes: ["/search"], params: ["ved"] }] },
    ];
    const candidates = [{ domain: "google.com", pathPrefixes: ["/search"], params: ["ved"] }];
    const { toAdd, alreadyLanded, existingRuleCount } = selectNewGroups(candidates, existingDomainRules);
    assert.deepEqual(toAdd, []);
    assert.equal(alreadyLanded.length, 1);
    assert.equal(existingRuleCount, 1);
  });

  test("a NEW param on an already-landed (domain, prefix) merges without costing a rule", () => {
    const existingDomainRules = [
      { domain: "google.com", pathStrips: [{ pathPrefixes: ["/search"], params: ["ved"] }] },
    ];
    const candidates = [{ domain: "google.com", pathPrefixes: ["/search"], params: ["ved", "sca_esv"] }];
    const { toAdd, existingRuleCount } = selectNewGroups(candidates, existingDomainRules, {
      maxTotalRules: 1,
    });
    // maxTotalRules is already exhausted by the one existing rule, yet the
    // merge still succeeds — it is not a NEW rule, so the budget does not
    // apply to it.
    assert.deepEqual(toAdd, [
      { domain: "google.com", pathPrefixes: ["/search"], params: ["sca_esv"], mergeIntoExisting: true },
    ]);
    assert.equal(existingRuleCount, 1);
  });

  test("drops overflow once the DNR rule cap is reached, deterministically (input order)", () => {
    const candidates = [
      { domain: "a.example", pathPrefixes: ["/x"], params: ["p1"] },
      { domain: "b.example", pathPrefixes: ["/x"], params: ["p2"] },
      { domain: "c.example", pathPrefixes: ["/x"], params: ["p3"] },
    ];
    const { toAdd, overflow } = selectNewGroups(candidates, [], { maxTotalRules: 2 });
    assert.deepEqual(toAdd.map((g) => g.domain), ["a.example", "b.example"]);
    assert.deepEqual(overflow.map((g) => g.domain), ["c.example"]);
  });

  test("existing rule count spans every prefix in every pathStrips group across every domain", () => {
    const existingDomainRules = [
      { domain: "google.com", pathStrips: [{ pathPrefixes: ["/search", "/webhp"], params: ["ved"] }] },
      { domain: "other.example", pathStrips: [{ pathPrefixes: ["/x"], params: ["y"] }] },
    ];
    const { existingRuleCount } = selectNewGroups([], existingDomainRules);
    assert.equal(existingRuleCount, 3);
  });
});

describe("applyPathAnchorGroups", () => {
  test("creates a brand new domain entry with preserveParams: [], no stripParams, and a note", () => {
    const result = applyPathAnchorGroups([], [
      { domain: "example.com", pathPrefixes: ["/search"], params: ["a", "b"] },
    ]);
    assert.deepEqual(result, [
      {
        domain: "example.com",
        preserveParams: [],
        pathStrips: [{ pathPrefixes: ["/search"], params: ["a", "b"] }],
        note: DEFAULT_NOTE,
      },
    ]);
    assert.ok(!Object.hasOwn(result[0], "stripParams"), "a path-only host must not emit stripParams");
  });

  test("appends a new pathStrips group to an existing domain, preserving its other fields", () => {
    const existing = [
      { domain: "example.com", preserveParams: ["q"], stripParams: ["utm_x"], note: "hand-curated" },
    ];
    const result = applyPathAnchorGroups(existing, [
      { domain: "example.com", pathPrefixes: ["/search"], params: ["a"] },
    ]);
    assert.deepEqual(result, [
      {
        domain: "example.com",
        preserveParams: ["q"],
        stripParams: ["utm_x"],
        note: "hand-curated",
        pathStrips: [{ pathPrefixes: ["/search"], params: ["a"] }],
      },
    ]);
  });

  test("merges new params into an existing pathStrips group (mergeIntoExisting)", () => {
    const existing = [
      { domain: "google.com", preserveParams: [], pathStrips: [{ pathPrefixes: ["/search"], params: ["ved"] }], note: "n" },
    ];
    const result = applyPathAnchorGroups(existing, [
      { domain: "google.com", pathPrefixes: ["/search"], params: ["sca_esv"], mergeIntoExisting: true },
    ]);
    assert.deepEqual(result[0].pathStrips, [{ pathPrefixes: ["/search"], params: ["sca_esv", "ved"] }]);
  });

  test("never mutates the input array or its entries", () => {
    const existing = [
      { domain: "example.com", preserveParams: [], pathStrips: [{ pathPrefixes: ["/a"], params: ["x"] }], note: "n" },
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));
    applyPathAnchorGroups(existing, [{ domain: "example.com", pathPrefixes: ["/a"], params: ["y"], mergeIntoExisting: true }]);
    assert.deepEqual(existing, snapshot);
  });

  test("two new groups on the SAME new host land under one entry", () => {
    const result = applyPathAnchorGroups([], [
      { domain: "ca.indeed.com", pathPrefixes: ["/viewjob"], params: ["tid"] },
      { domain: "ca.indeed.com", pathPrefixes: ["/rc/clk"], params: ["cmp"] },
    ]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].pathStrips, [
      { pathPrefixes: ["/viewjob"], params: ["tid"] },
      { pathPrefixes: ["/rc/clk"], params: ["cmp"] },
    ]);
  });
});

describe("computeLanding — end-to-end pure core", () => {
  test("wires filter -> group -> select -> apply together", () => {
    const pathAnchored = [
      { param: "utm_source", host: "example.com", pathPrefix: "/search" }, // already global
      { param: "clickref", host: "example.com", pathPrefix: "/search" }, // guard
      { param: "tid", host: "example.com", pathPrefix: "/search" }, // landable
      { param: "tid", host: "example.com", pathPrefix: "/search" }, // dup
    ];
    const result = computeLanding(pathAnchored, [], {
      trackingParams: ["utm_source"],
      affiliateGuard: ["clickref"],
      denylist: [],
      hostPreservesParamFn: () => false,
    });
    assert.equal(result.excluded.alreadyGlobal.length, 1);
    assert.equal(result.excluded.guard.length, 1);
    assert.equal(result.candidateGroups.length, 1);
    assert.equal(result.toAdd.length, 1);
    assert.equal(result.alreadyLanded.length, 0);
    assert.equal(result.overflow.length, 0);
    assert.deepEqual(result.nextDomainRules, [
      {
        domain: "example.com",
        preserveParams: [],
        pathStrips: [{ pathPrefixes: ["/search"], params: ["tid"] }],
        note: DEFAULT_NOTE,
      },
    ]);
  });

  test("re-running against its own output is a no-op — nextDomainRules is unchanged", () => {
    const pathAnchored = [{ param: "tid", host: "example.com", pathPrefix: "/search" }];
    const opts = {
      trackingParams: [],
      affiliateGuard: [],
      denylist: [],
      hostPreservesParamFn: () => false,
    };
    const first = computeLanding(pathAnchored, [], opts);
    const second = computeLanding(pathAnchored, first.nextDomainRules, opts);
    assert.deepEqual(second.nextDomainRules, first.nextDomainRules);
    assert.equal(second.toAdd.length, 0);
    assert.equal(second.alreadyLanded.length, 1);
  });
});

// Native review (A+B) findings: a single-prefix candidate merging into a
// multi-prefix group, own `pathStrips: undefined` keys, and locale-dependent
// ordering.
describe("review follow-ups (#1326 slice 3)", () => {
  test("a single-prefix candidate merges into an existing MULTI-prefix group instead of crashing", () => {
    const existing = [
      {
        domain: "google.com",
        preserveParams: [],
        pathStrips: [{ pathPrefixes: ["/search", "/webhp"], params: ["ved"] }],
        note: "n",
      },
    ];
    const { toAdd } = selectNewGroups([{ domain: "google.com", pathPrefixes: ["/search"], params: ["aqs"] }], existing);
    const result = applyPathAnchorGroups(existing, toAdd);
    assert.deepEqual(result[0].pathStrips, [{ pathPrefixes: ["/search", "/webhp"], params: ["aqs", "ved"] }]);
  });

  test("an untouched rule without pathStrips gets no own pathStrips key", () => {
    const existing = [{ domain: "example.com", preserveParams: ["q"], note: "n" }];
    const result = applyPathAnchorGroups(existing, [{ domain: "other.example", pathPrefixes: ["/x"], params: ["a"] }]);
    assert.equal(Object.hasOwn(result[0], "pathStrips"), false);
  });

  test("ordering is ordinal (code unit), not locale-dependent", () => {
    const groups = groupPathAnchors([
      { param: "a", host: "a.example", pathPrefix: "/b" },
      { param: "b", host: "a.example", pathPrefix: "/B" },
      { param: "c", host: "a.example", pathPrefix: "/_" },
    ]);
    // Code-unit order: "B" (0x42) < "_" (0x5F) < "b" (0x62).
    assert.deepEqual(groups.map((g) => g.pathPrefixes[0]), ["/B", "/_", "/b"]);
  });
});
