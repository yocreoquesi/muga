/**
 * MUGA — resolvePathRuleHostBase generator-level tests (#1467, #1490)
 *
 * `tools/generate-rules.mjs`'s `resolvePathRuleHostBase` computes the
 * removeParams set Chrome's OWN priority-1 rule applies to a domain today —
 * a tailored ancestor's rule if one exists (walking up label by label,
 * mirroring Chrome's subdomain-inclusive requestDomains/excludedRequestDomains
 * matching), else the global `trackingParams` rule. Every existing test for
 * this logic (`path-scoped-dnr-rules.test.mjs`) exercises it only indirectly,
 * through the real committed `src/rules/domain-rules.json` — so a walk-up
 * across more than one label, a tailored ancestor that emits no rule (empty
 * base), and the fallback to the global list are all covered only by
 * whatever the real data happens to contain today, not pinned.
 *
 * This file drives `computeTailoredDomainState` and `resolvePathRuleHostBase`
 * directly with small, synthetic `domainRules` arrays instead, so each case
 * is deliberate and controlled. Both functions were extracted from
 * `buildDnrRules` in #1490 without changing behavior — see
 * `tests/unit/dnr-rules-sync.test.mjs` and `tests/unit/path-scoped-dnr-rules.test.mjs`
 * (unchanged, still passing against the real rules) for that non-regression.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeTailoredDomainState, resolvePathRuleHostBase } from "../../tools/generate-rules.mjs";

// A small, fixed tracking-params universe — deliberately tiny so every case
// below is easy to verify by inspection. Real TRACKING_PARAMS is exercised
// elsewhere (rules-manifest-sync.test.mjs, dnr-rules-sync.test.mjs); this
// file is only about resolvePathRuleHostBase's walk-up/fallback logic, which
// does not depend on the real list's size or content.
const TRACKING = ["utm_source", "utm_medium", "fbclid", "gclid"];
const NO_GUARD = new Set();
const NO_DENY = new Set();

/** Convenience: computeTailoredDomainState + resolvePathRuleHostBase in one call. */
function hostBaseFor(domain, domainRules, { guard = NO_GUARD, deny = NO_DENY, trackingParams = TRACKING } = {}) {
  const { tailoredDomains, removeParamsByDomain } = computeTailoredDomainState(
    domainRules,
    guard,
    deny,
    trackingParams,
  );
  return resolvePathRuleHostBase(domain, tailoredDomains, removeParamsByDomain, trackingParams);
}

describe("computeTailoredDomainState + resolvePathRuleHostBase — controlled inputs (#1490)", () => {
  test("global TRACKING_PARAMS fallback: no domainRules entry anywhere in the chain", () => {
    const result = hostBaseFor("example.com", []);
    assert.deepEqual(result, TRACKING);
  });

  test("global fallback: domainRules has entries, but none for this host or any ancestor", () => {
    const domainRules = [{ domain: "unrelated.com", preserveParams: ["utm_source"] }];
    const result = hostBaseFor("example.com", domainRules);
    assert.deepEqual(result, TRACKING);
  });

  test("multi-label walk-up: a tailored grandparent 2 labels above the queried host", () => {
    // search.cc.naver.com -> cc.naver.com -> naver.com (tailored, 3rd hop).
    const domainRules = [{ domain: "naver.com", preserveParams: ["utm_source"] }];
    const result = hostBaseFor("search.cc.naver.com", domainRules);
    assert.deepEqual(result, ["utm_medium", "fbclid", "gclid"]);
  });

  test("multi-label walk-up stops at the NEAREST tailored ancestor, not a further one", () => {
    // a.b.example.com -> b.example.com (tailored, nearer) -> example.com
    // (also tailored, but must never be reached).
    const domainRules = [
      { domain: "example.com", preserveParams: ["fbclid"] },
      { domain: "b.example.com", preserveParams: ["gclid"] },
    ];
    const result = hostBaseFor("a.b.example.com", domainRules);
    // Must reflect b.example.com's preserve (gclid gone), NOT example.com's
    // (fbclid must still be present — proves it stopped at the nearer one).
    assert.deepEqual(result, ["utm_source", "utm_medium", "fbclid"]);
  });

  test("tailored ancestor with no emitted rule (empty base): preserves every tracking param", () => {
    // naver.com preserves 100% of TRACKING and adds no extra strips, so it is
    // tailored (excluded from the global rule) but emits NO profile rule
    // (computeTailoredDomainState's `perDomain.push` is skipped when
    // removeParams.length === 0). A descendant with only pathStrips must see
    // an EMPTY host base here, not silently fall through to the global list
    // (the pre-#1467 bug this whole feature guards against).
    const domainRules = [{ domain: "naver.com", preserveParams: [...TRACKING] }];
    const result = hostBaseFor("search.naver.com", domainRules);
    assert.deepEqual(result, []);
  });

  test("empty base is returned even for the tailored domain itself, not just its descendants", () => {
    const domainRules = [{ domain: "naver.com", preserveParams: [...TRACKING] }];
    const result = hostBaseFor("naver.com", domainRules);
    assert.deepEqual(result, []);
  });

  test("a tailored ancestor's own profile rule wins when the queried domain IS that ancestor", () => {
    const domainRules = [{ domain: "example.com", stripParams: ["extra_nav"] }];
    const result = hostBaseFor("example.com", domainRules);
    assert.deepEqual(result, [...TRACKING, "extra_nav"]);
  });

  test("extraStrips-only tailoring (no preserve) is picked up by the walk-up too", () => {
    const domainRules = [{ domain: "shop.example.com", stripParams: ["session_id"] }];
    const result = hostBaseFor("a.shop.example.com", domainRules);
    assert.deepEqual(result, [...TRACKING, "session_id"]);
  });

  test("a non-tailored entry (no preserve/strip effect) is never treated as an ancestor stop", () => {
    // An entry whose preserveParams don't intersect TRACKING and whose
    // stripParams are empty is NOT tailored (computeTailoredDomainState's
    // `!preservesTracked && extraStrips.length === 0` skip), so the walk must
    // continue past it to the real tailored ancestor above it.
    const domainRules = [
      { domain: "b.example.com", preserveParams: ["not_a_tracking_param"] },
      { domain: "example.com", preserveParams: ["gclid"] },
    ];
    const result = hostBaseFor("a.b.example.com", domainRules);
    assert.deepEqual(result, ["utm_source", "utm_medium", "fbclid"]);
  });

  test("guard/deny still gate extraStrips reached through the walk-up", () => {
    const guard = new Set(["affiliate_tag"]);
    const domainRules = [{ domain: "example.com", stripParams: ["affiliate_tag", "session_id"] }];
    const result = hostBaseFor("sub.example.com", domainRules, { guard });
    assert.deepEqual(result, [...TRACKING, "session_id"]);
    assert.ok(!result.includes("affiliate_tag"));
  });
});
