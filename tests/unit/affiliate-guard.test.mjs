/** MUGA: test suite for GATE 1 — affiliate-guard (issue #775) */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreserveIndex,
  checkAffiliateGuard,
  partitionCandidates,
} from "../../tools/rule-ingestion/gates/affiliate-guard.mjs";
import {
  AFFILIATE_PATTERNS,
  REDIRECT_NETWORK_PATTERNS,
  TRACKING_PARAMS,
} from "../../src/lib/affiliates.js";

// ── T-02 / T-04: buildPreserveIndex — pure unit tests ───────────────────────

describe("affiliate-guard", () => {
  describe("buildPreserveIndex — pure", () => {
    it("builds a set from synthetic AFFILIATE_PATTERNS and REDIRECT_NETWORK_PATTERNS", () => {
      const affiliatePatterns = [{ id: "prog-a", param: "alpha" }];
      const redirectNetworks = [{ id: "net-a", landingParams: ["beta", "gamma"] }];
      const { set } = buildPreserveIndex(affiliatePatterns, redirectNetworks);
      assert.equal(set.has("alpha"), true);
      assert.equal(set.has("beta"), true);
      assert.equal(set.has("gamma"), true);
      assert.equal(set.size, 3);
    });

    // T-04: owner record shape + first-writer-wins + dedup
    it("assigns source: 'affiliate' for affiliate entries", () => {
      const { owners } = buildPreserveIndex(
        [{ id: "prog-a", param: "alpha" }],
        []
      );
      assert.equal(owners.get("alpha").source, "affiliate");
    });

    it("assigns source: 'redirect-network' for network entries", () => {
      const { owners } = buildPreserveIndex(
        [],
        [{ id: "net-a", landingParams: ["beta"] }]
      );
      assert.equal(owners.get("beta").source, "redirect-network");
    });

    it("first-writer-wins: affiliate beats redirect-network on shared param name", () => {
      const { owners } = buildPreserveIndex(
        [{ id: "prog-a", param: "shared" }],
        [{ id: "net-a", landingParams: ["shared"] }]
      );
      assert.equal(owners.get("shared").source, "affiliate");
    });

    it("deduplicates repeated names in landingParams", () => {
      const { set } = buildPreserveIndex(
        [],
        [{ id: "net-a", landingParams: ["x", "x"] }]
      );
      assert.equal(set.size, 1);
    });

    it("lowercases param names from affiliatePatterns", () => {
      const { set } = buildPreserveIndex(
        [{ id: "prog-a", param: "UPPER" }],
        []
      );
      assert.equal(set.has("upper"), true);
      assert.equal(set.has("UPPER"), false);
    });
  });

  // ── T-05: Live singleton derivation + count-agnostic auto-extension ────────

  describe("live singletons — auto-extension", () => {
    const { set } = buildPreserveIndex(AFFILIATE_PATTERNS, REDIRECT_NETWORK_PATTERNS);

    it("every AFFILIATE_PATTERNS[].param is in the preserve set (count-agnostic)", () => {
      for (const p of AFFILIATE_PATTERNS) {
        assert.equal(
          set.has(p.param.toLowerCase()),
          true,
          `Expected preserve set to include affiliate param '${p.param}' (id: ${p.id})`
        );
      }
    });

    it("every REDIRECT_NETWORK_PATTERNS[].landingParams entry is in the preserve set (count-agnostic)", () => {
      for (const net of REDIRECT_NETWORK_PATTERNS) {
        for (const lp of net.landingParams) {
          assert.equal(
            set.has(lp.toLowerCase()),
            true,
            `Expected preserve set to include landing param '${lp}' (network: ${net.id})`
          );
        }
      }
    });

    it("preserve set has exactly 32 unique names (update comment if manifest sync changes count)", () => {
      // update if manifest sync changes count
      assert.equal(set.size, 32);
    });
  });

  // ── T-06: Module shape — named exports, no default ────────────────────────

  describe("module shape", () => {
    it("checkAffiliateGuard is a function", () => {
      assert.equal(typeof checkAffiliateGuard, "function");
    });

    it("partitionCandidates is a function", () => {
      assert.equal(typeof partitionCandidates, "function");
    });

    it("buildPreserveIndex is a function (testability seam export)", () => {
      assert.equal(typeof buildPreserveIndex, "function");
    });

    it("there is no default export", async () => {
      const mod = await import("../../tools/rule-ingestion/gates/affiliate-guard.mjs");
      assert.equal(mod.default, undefined);
    });
  });

  // ── T-08: AFFILIATE_PATTERNS collision rejection — tag, ref, at ───────────

  describe("checkAffiliateGuard — AFFILIATE_PATTERNS collisions", () => {
    it("rejects 'tag' with id amazon-associates and source 'affiliate'", () => {
      const result = checkAffiliateGuard({ param: "tag" });
      assert.equal(result.rejected, true);
      assert.equal(result.reason, "affiliate-collision");
      assert.equal(result.collidingPrograms.length, 1);
      assert.equal(result.collidingPrograms[0].id, "amazon-associates");
      assert.equal(result.collidingPrograms[0].source, "affiliate");
    });

    it("rejects 'ref' with id vercel", () => {
      const result = checkAffiliateGuard({ param: "ref" });
      assert.equal(result.rejected, true);
      assert.equal(result.collidingPrograms[0].id, "vercel");
      // source uses the unified vocabulary "affiliate" (no internal/public mapping)
      assert.equal(result.collidingPrograms[0].source, "affiliate");
    });

    it("rejects 'at' with id apple-phg", () => {
      const result = checkAffiliateGuard({ param: "at" });
      assert.equal(result.rejected, true);
      assert.equal(result.collidingPrograms[0].id, "apple-phg");
      assert.equal(result.collidingPrograms[0].source, "affiliate");
    });
  });

  // ── T-09: Redirect-network collision — tduid, irclickid, cjevent ──────────

  describe("checkAffiliateGuard — redirect-network collisions", () => {
    it("rejects 'tduid' with id tradedoubler and source 'redirect-network'", () => {
      const result = checkAffiliateGuard({ param: "tduid" });
      assert.equal(result.rejected, true);
      assert.equal(result.collidingPrograms[0].id, "tradedoubler");
      assert.equal(result.collidingPrograms[0].source, "redirect-network");
    });

    it("rejects 'irclickid' with source 'redirect-network'", () => {
      const result = checkAffiliateGuard({ param: "irclickid" });
      assert.equal(result.rejected, true);
      assert.equal(result.collidingPrograms[0].source, "redirect-network");
    });

    it("rejects 'cjevent' with reason 'affiliate-collision'", () => {
      const result = checkAffiliateGuard({ param: "cjevent" });
      assert.equal(result.rejected, true);
      assert.equal(result.reason, "affiliate-collision");
    });
  });

  // ── T-10: Standard trackers ACCEPTED — fbclid, utm_source, ir_adid ────────

  describe("checkAffiliateGuard — acceptance", () => {
    it("accepts 'fbclid'", () => {
      const result = checkAffiliateGuard({ param: "fbclid" });
      assert.deepEqual(result, { rejected: false });
    });

    it("accepts 'utm_source'", () => {
      const result = checkAffiliateGuard({ param: "utm_source" });
      assert.deepEqual(result, { rejected: false });
    });

    it("accepts 'ir_adid' (Impact Radius ad ID, not a landingParam)", () => {
      const result = checkAffiliateGuard({ param: "ir_adid" });
      assert.deepEqual(result, { rejected: false });
    });
  });

  // ── T-11: eBay noise params ACCEPTED (wrong-source proof) ─────────────────

  describe("checkAffiliateGuard — eBay noise accepted (GATE 1 does NOT consume AFFILIATE_PARAM_GUARD)", () => {
    it("accepts 'mkevt'", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "mkevt" }), { rejected: false });
    });

    it("accepts 'mkcid'", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "mkcid" }), { rejected: false });
    });

    it("accepts 'mkrid'", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "mkrid" }), { rejected: false });
    });

    it("accepts 'toolid'", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "toolid" }), { rejected: false });
    });

    it("accepts 'customid'", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "customid" }), { rejected: false });
    });
  });

  // ── T-12: Case normalization ───────────────────────────────────────────────

  describe("checkAffiliateGuard — case normalization", () => {
    it("rejects 'TAG' (uppercase) — affiliate collision", () => {
      const result = checkAffiliateGuard({ param: "TAG" });
      assert.equal(result.rejected, true);
      assert.equal(result.reason, "affiliate-collision");
    });

    it("accepts 'FBCLID' (uppercase) — not a preserved param", () => {
      const result = checkAffiliateGuard({ param: "FBCLID" });
      assert.deepEqual(result, { rejected: false });
    });
  });

  // ── T-13: Malformed / missing param — returns accepted ────────────────────

  describe("checkAffiliateGuard — edge: malformed input", () => {
    it("accepts null candidate", () => {
      assert.deepEqual(checkAffiliateGuard(null), { rejected: false });
    });

    it("accepts undefined candidate", () => {
      assert.deepEqual(checkAffiliateGuard(undefined), { rejected: false });
    });

    it("accepts candidate with no param field", () => {
      assert.deepEqual(checkAffiliateGuard({}), { rejected: false });
    });

    it("accepts candidate with numeric param (non-string)", () => {
      assert.deepEqual(checkAffiliateGuard({ param: 123 }), { rejected: false });
    });

    it("accepts candidate with empty string param", () => {
      assert.deepEqual(checkAffiliateGuard({ param: "" }), { rejected: false });
    });
  });

  // ── T-14 / T-15: partitionCandidates — mixed list, order-preserving ───────

  describe("partitionCandidates", () => {
    it("partitions a mixed list preserving order", () => {
      const input = [
        { param: "fbclid" },
        { param: "tag" },
        { param: "utm_source" },
        { param: "awc" },
        { param: "mkevt" },
      ];
      const { accepted, rejected } = partitionCandidates(input);

      // accepted: fbclid, utm_source, mkevt (order preserved)
      assert.equal(accepted.length, 3);
      assert.deepEqual(accepted[0], { param: "fbclid" });
      assert.deepEqual(accepted[1], { param: "utm_source" });
      assert.deepEqual(accepted[2], { param: "mkevt" });

      // rejected: tag, awc
      assert.equal(rejected.length, 2);
      assert.deepEqual(rejected[0].candidate, { param: "tag" });
      assert.equal(rejected[0].reason, "affiliate-collision");
      assert.equal(Array.isArray(rejected[0].collidingPrograms), true);
      assert.equal(rejected[0].collidingPrograms.length > 0, true);
      assert.equal(rejected[1].candidate.param, "awc");
    });

    // T-16: empty input, all-accepted, all-rejected
    it("returns empty partitions for empty input", () => {
      const { accepted, rejected } = partitionCandidates([]);
      assert.deepEqual(accepted, []);
      assert.deepEqual(rejected, []);
    });

    it("all-accepted list produces empty rejected partition", () => {
      const input = [
        { param: "fbclid" },
        { param: "utm_source" },
        { param: "gclid" },
      ];
      const { accepted, rejected } = partitionCandidates(input);
      assert.equal(rejected.length, 0);
      assert.equal(accepted.length, 3);
    });

    it("all-rejected list produces empty accepted partition", () => {
      const input = [
        { param: "tag" },
        { param: "awc" },
        { param: "tduid" },
      ];
      const { accepted, rejected } = partitionCandidates(input);
      assert.equal(accepted.length, 0);
      assert.equal(rejected.length, 3);
    });
  });

  // ── T-17: Zero TRACKING_PARAMS mutation ───────────────────────────────────

  describe("GATE 1 zero mutation contract", () => {
    it("TRACKING_PARAMS length is unchanged after checkAffiliateGuard on a colliding param", () => {
      const lengthBefore = TRACKING_PARAMS.length;
      checkAffiliateGuard({ param: "tag" });
      assert.equal(TRACKING_PARAMS.length, lengthBefore);
    });

    it("TRACKING_PARAMS length is unchanged after partitionCandidates call", () => {
      const lengthBefore = TRACKING_PARAMS.length;
      partitionCandidates([
        { param: "tag" },
        { param: "fbclid" },
        { param: "awc" },
      ]);
      assert.equal(TRACKING_PARAMS.length, lengthBefore);
    });
  });

  // ── T-18: Result-shape stability assertion ────────────────────────────────

  describe("result shape stability", () => {
    it("rejection result has EXACTLY keys: rejected, reason, collidingPrograms", () => {
      const result = checkAffiliateGuard({ param: "tag" });
      const keys = Object.keys(result).sort();
      assert.deepEqual(keys, ["collidingPrograms", "reason", "rejected"]);
    });

    it("acceptance result has EXACTLY key: rejected (no reason, no collidingPrograms)", () => {
      const result = checkAffiliateGuard({ param: "fbclid" });
      const keys = Object.keys(result);
      assert.deepEqual(keys, ["rejected"]);
    });

    it("collidingPrograms[0] has EXACTLY keys: id and source (no domains, no extras)", () => {
      const result = checkAffiliateGuard({ param: "tag" });
      const programKeys = Object.keys(result.collidingPrograms[0]).sort();
      assert.deepEqual(programKeys, ["id", "source"]);
    });
  });
});

// ── #794 regression: static-guard third source ───────────────────────────────
//
// ascsubtag (Amazon SubTag) is affiliate attribution but appears in NEITHER
// AFFILIATE_PATTERNS (Amazon's param is "tag") NOR landingParams (Amazon is
// not a redirect network). AdGuard upstream emits $removeparam=ascsubtag, so
// without the static AFFILIATE_PARAM_GUARD source the gate would auto-merge
// it back into the strip list — the exact ADR-0005 catastrophic path.
describe("static-guard source (#794)", () => {
  it("ascsubtag is rejected by the live gate with source static-guard", () => {
    const result = checkAffiliateGuard({ param: "ascsubtag" });
    assert.equal(result.rejected, true, "ascsubtag must never auto-merge as a tracker");
    assert.equal(result.collidingPrograms[0].source, "static-guard");
  });

  it("AFFILIATE_PARAM_GUARD still contains ascsubtag (re-introduction defense)", async () => {
    const { AFFILIATE_PARAM_GUARD } = await import("../../src/lib/remote-rules.js");
    assert.ok(
      AFFILIATE_PARAM_GUARD.has("ascsubtag"),
      "ascsubtag left every strip list in #794 — the guard entry is what keeps upstream ingestion from re-adding it"
    );
  });

  it("buildPreserveIndex without staticGuard does not include ascsubtag (seam isolation)", async () => {
    const { buildPreserveIndex } = await import("../../tools/rule-ingestion/gates/affiliate-guard.mjs");
    const { set } = buildPreserveIndex([], []);
    assert.equal(set.has("ascsubtag"), false);
  });
});

// ── audit #1039: AFFILIATE_PARAM_GUARD covers every redirect-network landing
// param ──────────────────────────────────────────────────────────────────────
//
// AFFILIATE_PARAM_GUARD is the set validateParams() + isValidCustomParam() use
// to REFUSE adding a param to any strip list. It must cover every landingParam a
// redirect network declares (the click IDs a merchant tag reads on the FIRST
// post-redirect landing), or a future/compromised signed payload could add one
// and destroy attribution on a no-referrer landing (the exact thing #695
// prevented). Derived from REDIRECT_NETWORK_PATTERNS so new networks stay
// auto-guarded (count-agnostic).
describe("audit #1039 — AFFILIATE_PARAM_GUARD covers all redirect-network landing params", () => {
  it("every REDIRECT_NETWORK_PATTERNS[].landingParams entry is guarded", async () => {
    const { AFFILIATE_PARAM_GUARD } = await import("../../src/lib/remote-rules.js");
    for (const net of REDIRECT_NETWORK_PATTERNS) {
      for (const lp of net.landingParams) {
        assert.ok(
          AFFILIATE_PARAM_GUARD.has(lp.toLowerCase()),
          `AFFILIATE_PARAM_GUARD must contain landing param '${lp}' (network: ${net.id})`,
        );
      }
    }
  });

  it("isValidCustomParam rejects redirect-network landing params (tduid, wt_mc, cjdata)", async () => {
    const { isValidCustomParam } = await import("../../src/lib/validation.js");
    assert.ok(!isValidCustomParam("tduid"), "tduid (Tradedoubler) must be rejected");
    assert.ok(!isValidCustomParam("wt_mc"), "wt_mc (Awin) must be rejected");
    assert.ok(!isValidCustomParam("cjdata"), "cjdata (Commission Junction) must be rejected");
  });
});
