/**
 * MUGA, unit tests for the import-candidate triage classifier (#998, Phase 0, v2.1)
 *
 * Pins the v2.1 bucketing logic of annotateCandidate()/classifyCandidate() in
 * tools/import-candidates/triage.mjs against fixture names, without any
 * network access. Each fixture supplies synthetic external signals
 * (clearurls_global, adguard_scoped_domains, and so on) so the classifier
 * itself is exercised the same way the real pipeline would call it, while
 * staying fully offline and deterministic.
 *
 * v1 had three safety defects: irclickid was promoted to
 * universal_high_confidence, and cjevent/awc landed in needs_human -- all
 * three are redirect-network landing params that a real integration reads at
 * landing to populate the merchant's first-party attribution cookie
 * (protected by the #815 strip-table parity guard). v2 fixed this with a
 * hard affiliate-preserve exclusion (FIX 1) that runs before any other
 * check.
 *
 * v2 had its own defect: its single vendor-signal list conflated pure
 * tracking/ad-platform vendors with affiliate-NETWORK vendors, so it
 * promoted affiliate-network attribution params (cj_aid, cj_pid, awinaffid,
 * af_id, af_channel, adj_adgroup, adj_deeplink, impact_click_id,
 * impact_ad_id) straight to universal_high_confidence. impact_click_id was
 * especially dangerous: same network (Impact Radius) as the preserved
 * irclickid. v2.1 fixes this by splitting the vendor-signal list into
 * TRACKING_VENDOR_PATTERNS (safe for universal) and
 * AFFILIATE_NETWORK_PATTERNS (routed to a new affiliate_network_review
 * bucket, never universal), with the affiliate-network gate checked before
 * the universal path.
 *
 * Coverage:
 *   - FIX 1: irclickid, cjevent, awc must land in excluded_affiliate_preserve
 *     and must NEVER be universal_high_confidence (the v1 regression).
 *   - FIX 2: a danger-list name with only global attribution (no domain
 *     scope) must land in likely_reject; a danger-list name WITH scoped
 *     attribution must land in domain_scoped with caution: "functional-name".
 *   - v2.1 NEW GATE: cj_aid, awinaffid, impact_click_id, af_id, and
 *     adj_adgroup must land in affiliate_network_review and must NEVER be
 *     universal_high_confidence (the v2 regression). taboola_click_id is a
 *     pure ad-platform tracking vendor, not an affiliate network, so it
 *     stays in universal_high_confidence.
 *   - FIX 3: two-source agreement (adguard_global AND clearurls_global)
 *     reaches universal_high_confidence; a tracking-vendor match combined
 *     with adguard_global-only also reaches universal_high_confidence; a
 *     ClearURLs-only vendor match (no adguard_global) does not.
 *   - Legacy v1/v2 coverage retained where still valid under v2.1
 *     precedence: one clean example per remaining bucket, plus the
 *     short-but-domain-scoped and functional-name-with-zero-evidence edge
 *     cases.
 *
 * All names used below (irclickid, cjevent, awc, q, code, utm, adj_adgroup,
 * gclid, cj_aid, awinaffid, impact_click_id, af_id, taboola_click_id) are
 * real names present in the 2026-07-05 candidate batch
 * (tools/import-candidates/triage-2026-07-05.json); the external signals
 * passed to annotateCandidate() are synthetic fixtures matching what the
 * real pipeline computed for each, kept here for offline determinism.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { annotateCandidate, classifyCandidate } from "../../tools/import-candidates/triage.mjs";

describe("FIX 1: affiliate-preserve exclusion runs first and stops all other buckets", () => {
  test("irclickid: excluded_affiliate_preserve, never universal_high_confidence", () => {
    const r = annotateCandidate("irclickid", {
      adguard_global: true,
      clearurls_scoped_domains: ["bestbuy.com"],
    });
    assert.strictEqual(r.is_affiliate_preserve, true);
    assert.strictEqual(r.bucket, "excluded_affiliate_preserve");
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("cjevent: excluded_affiliate_preserve, never universal_high_confidence", () => {
    const r = annotateCandidate("cjevent", { adguard_global: true });
    assert.strictEqual(r.is_affiliate_preserve, true);
    assert.strictEqual(r.bucket, "excluded_affiliate_preserve");
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("awc: excluded_affiliate_preserve, never universal_high_confidence", () => {
    const r = annotateCandidate("awc", { adguard_global: true });
    assert.strictEqual(r.is_affiliate_preserve, true);
    assert.strictEqual(r.bucket, "excluded_affiliate_preserve");
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("an affiliate-preserve name is excluded even with strong corroborating signals", () => {
    // Even both-global attribution must not pull a preserve-set name toward
    // universal_high_confidence: FIX 1 stops processing before FIX 3 runs.
    const r = annotateCandidate("tduid", {
      adguard_global: true,
      clearurls_global: true,
    });
    assert.strictEqual(r.bucket, "excluded_affiliate_preserve");
  });
});

describe("FIX 2: hard danger list of load-bearing functional names", () => {
  // "q" is a real name from the 2026-07-05 batch: AdGuard-global only, no
  // scoped domains anywhere. A load-bearing name with only global (or no)
  // attribution is unsafe to strip anywhere without a human decision.
  test("q: danger name, global-only, no scoped domains -> likely_reject", () => {
    const r = annotateCandidate("q", { adguard_global: true });
    assert.strictEqual(r.is_danger_name, true);
    assert.strictEqual(r.bucket, "likely_reject");
    assert.match(r.reason, /load-bearing functional name/);
  });

  // "code" is a real name from the 2026-07-05 batch: AdGuard-global plus a
  // ClearURLs scoped-domain hit. The domain scope limits the blast radius,
  // so this becomes a reviewable domain_scoped candidate instead of an
  // outright reject, flagged with caution: "functional-name" so a reviewer
  // knows this name is also commonly load-bearing elsewhere.
  test("code: danger name WITH scoped domains -> domain_scoped, caution functional-name", () => {
    const r = annotateCandidate("code", {
      adguard_global: true,
      clearurls_scoped_domains: ["alibaba cloud arms"],
    });
    assert.strictEqual(r.is_danger_name, true);
    assert.strictEqual(r.bucket, "domain_scoped");
    assert.strictEqual(r.caution, "functional-name");
  });

  test("danger name never reaches universal_high_confidence even with full corroboration", () => {
    const r = annotateCandidate("token", {
      adguard_global: true,
      clearurls_global: true,
    });
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });
});

describe("v2.1 NEW GATE: affiliate-network params route to human review, never universal", () => {
  // cj_aid, awinaffid, impact_click_id, af_id, adj_adgroup were all
  // confirmed in universal_high_confidence under v2. This is the exact
  // regression v2.1 fixes.
  test("cj_aid: affiliate_network_review (CJ Affiliate), never universal_high_confidence", () => {
    const r = annotateCandidate("cj_aid", { adguard_global: true });
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /CJ Affiliate/);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("awinaffid: affiliate_network_review (Awin), never universal_high_confidence", () => {
    const r = annotateCandidate("awinaffid", { adguard_global: true });
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /Awin/);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  // impact_click_id: same network (Impact Radius) as the preserved
  // irclickid -- the single most dangerous case v2 got wrong.
  test("impact_click_id: affiliate_network_review (Impact Radius), never universal_high_confidence", () => {
    const r = annotateCandidate("impact_click_id", {
      adguard_global: true,
      clearurls_global: true,
    });
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /Impact Radius/);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("af_id: affiliate_network_review (AppsFlyer), never universal_high_confidence", () => {
    const r = annotateCandidate("af_id", { adguard_global: true });
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /AppsFlyer/);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  test("adj_adgroup: affiliate_network_review (Adjust), never universal_high_confidence", () => {
    const r = annotateCandidate("adj_adgroup", {
      adguard_global: true,
      clearurls_global: false,
    });
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /Adjust/);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
  });

  // taboola_click_id is a pure ad-platform tracking vendor, not an
  // affiliate network: it must stay in universal_high_confidence, proving
  // the split doesn't over-broadly demote every "click_id"-shaped name.
  test("taboola_click_id: tracking vendor, stays universal_high_confidence", () => {
    const r = annotateCandidate("taboola_click_id", { adguard_global: true });
    assert.strictEqual(r.affiliate_network_match.matched, false);
    assert.strictEqual(r.tracking_vendor_match.matched, true);
    assert.strictEqual(r.bucket, "universal_high_confidence");
  });

  test("affiliate-network match wins over scoped attribution (routes to review, not domain_scoped)", () => {
    // Sanity: an affiliate-network name with scoped attribution still goes
    // to affiliate_network_review, not domain_scoped, because the gate
    // runs before FIX 3's scoped-attribution fallback. "rakuten_mid" is not
    // itself in the FIX 1 preserve set (ranmid/ransiteid/raneaid are), so
    // this exercises the affiliate-network gate specifically, not FIX 1.
    const r = annotateCandidate("rakuten_mid", {
      adguard_scoped_domains: ["example.com"],
    });
    assert.strictEqual(r.is_affiliate_preserve, false);
    assert.strictEqual(r.affiliate_network_match.matched, true);
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /Rakuten/);
  });
});

describe("FIX 3: source agreement and tracking-vendor corroboration", () => {
  // "utm" is a real name from the 2026-07-05 batch with BOTH adguard_global
  // and clearurls_global true, not in the preserve, danger, or
  // affiliate-network lists.
  test("utm: two-source agreement (adguard_global AND clearurls_global) -> universal_high_confidence", () => {
    const r = annotateCandidate("utm", {
      adguard_global: true,
      clearurls_global: true,
    });
    assert.strictEqual(r.is_affiliate_preserve, false);
    assert.strictEqual(r.is_danger_name, false);
    assert.strictEqual(r.affiliate_network_match.matched, false);
    assert.strictEqual(r.bucket, "universal_high_confidence");
  });

  test("clearurls_global-only vendor match without adguard_global does not reach universal_high_confidence", () => {
    // FIX 3's universal path requires adguard_global specifically (either
    // both-source agreement or adguard_global + tracking-vendor signal); a
    // ClearURLs-only vendor match falls through to needs_human instead.
    const r = annotateCandidate("gclid", { clearurls_global: true });
    assert.strictEqual(r.tracking_vendor_match.matched, true);
    assert.notStrictEqual(r.bucket, "universal_high_confidence");
    assert.strictEqual(r.bucket, "needs_human");
  });
});

describe("annotateCandidate, remaining bucket coverage retained from v1/v2", () => {
  test("s-id: AdGuard scoped-domain attribution, no vendor signal -> domain_scoped, domains captured", () => {
    const r = annotateCandidate("s-id", {
      adguard_scoped_domains: ["item.rakuten.co.jp", "www.rakuten.co.jp"],
    });
    assert.strictEqual(r.bucket, "domain_scoped");
    assert.deepEqual(r.adguard_scoped_domains, ["item.rakuten.co.jp", "www.rakuten.co.jp"]);
  });

  test("needs_human: global claim exists but no corroborating vendor signal (source)", () => {
    const r = annotateCandidate("source", { clearurls_global: true });
    assert.strictEqual(r.is_danger_name, false);
    assert.strictEqual(r.affiliate_network_match.matched, false);
    assert.strictEqual(r.tracking_vendor_match.matched, false);
    assert.strictEqual(r.bucket, "needs_human");
  });

  test("likely_reject: no corroborating evidence in either source at all (___from_store)", () => {
    const r = annotateCandidate("___from_store", {});
    assert.strictEqual(r.bucket, "likely_reject");
    assert.match(r.reason, /no corroborating tracking evidence/);
  });

  test("hsa_acc: AdGuard global attribution + hubspot tracking-vendor signal -> universal_high_confidence", () => {
    const r = annotateCandidate("hsa_acc", { adguard_global: true });
    assert.strictEqual(r.bucket, "universal_high_confidence");
    assert.strictEqual(r.tracking_vendor_match.pattern, "hubspot");
  });
});

describe("classifyCandidate, precedence order is checked independently of annotateCandidate", () => {
  test("affiliate preserve wins over every other signal", () => {
    const result = classifyCandidate({
      is_affiliate_preserve: true,
      is_danger_name: true,
      clearurls_global: true,
      clearurls_scoped_domains: ["example.com"],
      adguard_global: true,
      adguard_scoped_domains: ["example.com"],
      affiliate_network_match: { matched: true, pattern: "cj-prefix", network: "CJ Affiliate (Commission Junction)" },
      tracking_vendor_match: { matched: true, pattern: "utm" },
    });
    assert.strictEqual(result.bucket, "excluded_affiliate_preserve");
  });

  test("danger name with scoped domains wins over lack of global attribution", () => {
    const result = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: true,
      clearurls_global: false,
      clearurls_scoped_domains: [],
      adguard_global: false,
      adguard_scoped_domains: ["example.com"],
      affiliate_network_match: { matched: false, pattern: null, network: null },
      tracking_vendor_match: { matched: false, pattern: null },
    });
    assert.strictEqual(result.bucket, "domain_scoped");
    assert.strictEqual(result.caution, "functional-name");
  });

  test("affiliate-network match wins over danger name being false and over universal-qualifying signals", () => {
    const result = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: false,
      clearurls_global: true,
      clearurls_scoped_domains: [],
      adguard_global: true,
      adguard_scoped_domains: [],
      affiliate_network_match: { matched: true, pattern: "impact-prefix", network: "Impact Radius" },
      tracking_vendor_match: { matched: true, pattern: "generic-click_id" },
    });
    assert.strictEqual(result.bucket, "affiliate_network_review");
    assert.strictEqual(result.network, "Impact Radius");
  });

  test("universal_high_confidence requires adguard_global in every qualifying path", () => {
    const result = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: false,
      clearurls_global: true,
      clearurls_scoped_domains: [],
      adguard_global: false,
      adguard_scoped_domains: [],
      affiliate_network_match: { matched: false, pattern: null, network: null },
      tracking_vendor_match: { matched: true, pattern: "utm" },
    });
    assert.notStrictEqual(result.bucket, "universal_high_confidence");
  });
});

describe("v2.3 guard cross-check: remote-rules guard/denylist can never reach universal", () => {
  test("ascsubtag (AFFILIATE_PARAM_GUARD, no vendor pattern) -> affiliate_network_review, never universal even with two-source agreement", () => {
    // ascsubtag is the Amazon Associates SubTag the remote guard protects
    // (the ADR-0005 catastrophic path). Two full sources agreeing must NOT
    // promote it.
    const r = annotateCandidate("ascsubtag", { adguard_global: true, clearurls_global: true });
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.strictEqual(r.network, "remote-rules AFFILIATE_PARAM_GUARD");
  });

  test("campid (AFFILIATE_PARAM_GUARD) -> affiliate_network_review, not universal", () => {
    const r = annotateCandidate("campid", { adguard_global: true });
    assert.strictEqual(r.bucket, "affiliate_network_review");
  });

  test("af_id (guard AND AppsFlyer vendor) keeps the richer vendor label", () => {
    // The specific-vendor gate runs before the generic guard catch-all.
    const r = annotateCandidate("af_id", { adguard_global: true });
    assert.strictEqual(r.bucket, "affiliate_network_review");
    assert.match(r.network, /AppsFlyer/);
  });

  test("classifyCandidate: guard flag beats two-source universal promotion", () => {
    const r = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: false,
      is_remote_affiliate_guard: true,
      is_remote_denylist: false,
      clearurls_global: true,
      clearurls_scoped_domains: [],
      adguard_global: true,
      adguard_scoped_domains: [],
      affiliate_network_match: { matched: false, pattern: null, network: null },
      tracking_vendor_match: { matched: true, pattern: "utm" },
    });
    assert.strictEqual(r.bucket, "affiliate_network_review");
  });

  test("classifyCandidate: remote-denylist functional name -> likely_reject (global-only), never universal", () => {
    const r = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: false,
      is_remote_affiliate_guard: false,
      is_remote_denylist: true,
      clearurls_global: true,
      clearurls_scoped_domains: [],
      adguard_global: true,
      adguard_scoped_domains: [],
      affiliate_network_match: { matched: false, pattern: null, network: null },
      tracking_vendor_match: { matched: true, pattern: "utm" },
    });
    assert.strictEqual(r.bucket, "likely_reject");
  });

  test("classifyCandidate: remote-denylist functional name with scope -> domain_scoped, not universal", () => {
    const r = classifyCandidate({
      is_affiliate_preserve: false,
      is_danger_name: false,
      is_remote_affiliate_guard: false,
      is_remote_denylist: true,
      clearurls_global: false,
      clearurls_scoped_domains: ["example.com"],
      adguard_global: false,
      adguard_scoped_domains: [],
      affiliate_network_match: { matched: false, pattern: null, network: null },
      tracking_vendor_match: { matched: false, pattern: null },
    });
    assert.strictEqual(r.bucket, "domain_scoped");
    assert.strictEqual(r.caution, "functional-name");
  });
});
