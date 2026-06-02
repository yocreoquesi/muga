/**
 * MUGA — ClearURLs adapter tests (#776).
 *
 * Tests the clearurls adapter shape, literal extraction, referralMarketing
 * safety exclusion (SAFETY-CRITICAL: affiliate tokens must NEVER reach the
 * output Set), lowercasing, dedup, malformed-input handling, and fetchRaw
 * with injectable fetchImpl (no real network).
 *
 * All ClearURLs JSON is supplied as synthetic fixture STRINGS — no network.
 *
 * CRITICAL correctness: T-13 covers the GLOBAL referralMarketing exclusion
 * algorithm: a param in rules[] of provider A but referralMarketing[] of
 * provider B MUST be excluded. The two-pass global-union algorithm ensures this.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  clearurls,
  extractClearurlsLiterals,
} from "../../tools/rule-ingestion/adapters/clearurls.mjs";

// ── Synthetic ClearURLs JSON fixtures ─────────────────────────────────────────

/**
 * Standard fixture: two providers covering the common extraction scenarios.
 * - Provider A: mix of literals, patterns, UPPERCASE (for lowercasing test),
 *   empty string; referralMarketing contains known affiliate tokens.
 * - Provider B: literal overlap (utm_source dedup test), cross-provider
 *   referralMarketing token (cjevent).
 */
const FIXTURE_STANDARD = JSON.stringify({
  providers: {
    providerA: {
      rules: ["utm_source", "^gclid$", "(ref)", ".*sess.*", "FBCLID", ""],
      referralMarketing: ["tag", "awc"],
    },
    providerB: {
      rules: ["utm_source", "mc_eid"],
      referralMarketing: ["cjevent"],
    },
  },
});

/**
 * Cross-provider exclusion fixture (T-13 LOCKED DECISION):
 * param "ref" is in rules[] of provider A but referralMarketing[] of provider B.
 * The global-union algorithm must exclude it regardless of which provider
 * it appears in — per-provider-scoped exclusion would incorrectly admit it.
 */
const FIXTURE_CROSS_PROVIDER = JSON.stringify({
  providers: {
    providerA: {
      rules: ["ref"],
      referralMarketing: [],
    },
    providerB: {
      rules: [],
      referralMarketing: ["ref"],
    },
  },
});

// ── T-09: Adapter shape ───────────────────────────────────────────────────────

describe("clearurls adapter shape", () => {
  test("id is 'clearurls'", () => {
    assert.equal(clearurls.id, "clearurls");
  });

  test("license is 'LGPL-3.0'", () => {
    assert.equal(clearurls.license, "LGPL-3.0");
  });

  test("parse is a function", () => {
    assert.equal(typeof clearurls.parse, "function");
  });

  test("fetchRaw is a function", () => {
    assert.equal(typeof clearurls.fetchRaw, "function");
  });

  test("no default export", async () => {
    const mod = await import(
      "../../tools/rule-ingestion/adapters/clearurls.mjs"
    );
    assert.equal(mod.default, undefined);
  });
});

// ── T-10: Literal extraction from standard fixture ───────────────────────────

describe("extractClearurlsLiterals — standard fixture", () => {
  test("Set contains utm_source", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(params.has("utm_source"), "utm_source must be in params");
  });

  test("Set contains gclid (stripped from ^gclid$)", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(params.has("gclid"), "gclid must be in params after anchor stripping");
  });

  test("Set contains fbclid (lowercased from FBCLID)", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(params.has("fbclid"), "fbclid must be in params (lowercased)");
  });

  test("Set contains mc_eid", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(params.has("mc_eid"), "mc_eid must be in params");
  });

  test("Set does NOT contain (ref) pattern", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(!params.has("(ref)"), "(ref) is a regex pattern — must be skipped");
  });

  test("Set does NOT contain .*sess.* pattern", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(!params.has(".*sess.*"), ".*sess.* is a regex pattern — must be skipped");
  });

  test("skipped count is >= 2 (at least (ref) and .*sess.* are skipped)", () => {
    const { skipped } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(skipped >= 2, `expected skipped >= 2, got ${skipped}`);
  });
});

// ── T-11: Lowercasing ────────────────────────────────────────────────────────

describe("extractClearurlsLiterals — lowercasing", () => {
  test("FBCLID in rules → fbclid in Set (not FBCLID)", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(params.has("fbclid"));
    assert.ok(!params.has("FBCLID"));
  });
});

// ── T-12: referralMarketing exclusion (per-provider) ────────────────────────

describe("extractClearurlsLiterals — referralMarketing exclusion", () => {
  test("'tag' (affiliate token) is NOT in params", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(!params.has("tag"), "affiliate token 'tag' must not be in params");
  });

  test("'awc' (affiliate token) is NOT in params", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(!params.has("awc"), "affiliate token 'awc' must not be in params");
  });

  test("'cjevent' (cross-provider affiliate token) is NOT in params", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    assert.ok(!params.has("cjevent"), "affiliate token 'cjevent' must not be in params");
  });
});

// ── T-13: CROSS-PROVIDER exclusion (GLOBAL union algorithm — LOCKED DECISION) ─

describe("extractClearurlsLiterals — global referralMarketing union", () => {
  test("'ref' in rules[A] but referralMarketing[B] → NOT in params (global exclusion)", () => {
    // WHY this test is LOCKED: a per-provider exclusion would admit 'ref' from
    // provider A (because A.referralMarketing is empty). The global-union
    // algorithm first collects ALL referralMarketing names across ALL providers,
    // then subtracts the entire union — so 'ref' is excluded from the output Set
    // regardless of which provider's rules[] listed it.
    const { params } = extractClearurlsLiterals(FIXTURE_CROSS_PROVIDER);
    assert.ok(
      !params.has("ref"),
      "'ref' must not be in params: it is referralMarketing in provider B and therefore globally excluded"
    );
  });

  test("anchored referralMarketing entry ('^tag$') still excludes a bare 'tag' rule (normalization symmetry)", () => {
    // Hardening regression: referralMarketing names are normalized IDENTICALLY
    // to rules[] (anchor-strip + lowercase). An anchored affiliate entry must
    // not slip past the exclusion due to normalization drift.
    const fixture = JSON.stringify({
      providers: {
        anchored: {
          rules: ["tag", "utm_term"],
          referralMarketing: ["^tag$"],
        },
      },
    });
    const { params } = extractClearurlsLiterals(fixture);
    assert.ok(
      !params.has("tag"),
      "'tag' must be excluded: '^tag$' in referralMarketing normalizes to 'tag'"
    );
    assert.ok(params.has("utm_term"), "non-affiliate literal still extracted");
  });
});

// ── T-14: Dedup across providers ─────────────────────────────────────────────

describe("extractClearurlsLiterals — dedup", () => {
  test("utm_source appears in both providers → Set has exactly one entry for it", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_STANDARD);
    // Set membership is inherently deduped; verify it is present exactly once
    // by checking the Set size difference when removing it.
    const sizeBefore = params.size;
    params.delete("utm_source");
    const sizeAfter = params.size;
    assert.equal(sizeBefore - sizeAfter, 1, "utm_source should contribute exactly 1 slot in the Set");
  });
});

// ── T-15: Malformed JSON ──────────────────────────────────────────────────────

describe("clearurls.parse — malformed JSON", () => {
  test("parse('{bad json}') throws", () => {
    assert.throws(
      () => clearurls.parse("{bad json}"),
      /ClearURLs parse failed/,
    );
  });
});

// ── T-16: Missing providers ───────────────────────────────────────────────────

describe("clearurls.parse — missing providers", () => {
  test("parse('{}') returns { params, skipped, affiliateExcluded } with empty params (no throw)", () => {
    const result = clearurls.parse("{}");
    // After T-02: parse() returns { params, skipped, affiliateExcluded }
    assert.ok(result.params instanceof Set);
    assert.equal(result.params.size, 0);
    assert.equal(result.affiliateExcluded, 0);
  });
});

// ── T-01 (quarantine-surface #782): affiliateExcluded count ──────────────────

describe("extractClearurlsLiterals — affiliateExcluded (T-01)", () => {
  // Fixture: 3 literal rules, 2 non-literal (skipped), 1 referralMarketing (affiliateExcluded)
  const FIXTURE_AFFILIATE = JSON.stringify({
    providers: {
      main: {
        rules: ["utm_source", "gclid", "(regex-only)", ".*complex.*", "fbclid", "tag"],
        referralMarketing: ["tag"],
      },
    },
  });

  test("affiliateExcluded counts referralMarketing hits (T-01)", () => {
    const { params, skipped, affiliateExcluded } = extractClearurlsLiterals(FIXTURE_AFFILIATE);
    assert.equal(params.size, 3, `expected 3 admitted params, got ${params.size}`);
    assert.ok(skipped >= 2, `expected skipped >= 2 (regex patterns), got ${skipped}`);
    assert.equal(affiliateExcluded, 1, `expected affiliateExcluded === 1, got ${affiliateExcluded}`);
  });

  test("affiliateExcluded param is absent from params Set (T-01)", () => {
    const { params } = extractClearurlsLiterals(FIXTURE_AFFILIATE);
    assert.ok(!params.has("tag"), "'tag' is referralMarketing — must not be in params");
    assert.ok(params.has("utm_source"), "utm_source must be admitted");
    assert.ok(params.has("gclid"), "gclid must be admitted");
    assert.ok(params.has("fbclid"), "fbclid must be admitted");
  });
});

describe("clearurls.parse — returns { params, skipped, affiliateExcluded } (T-01)", () => {
  const FIXTURE_MIXED = JSON.stringify({
    providers: {
      p: {
        rules: ["utm_source", "(skip-me)", "aff_tag"],
        referralMarketing: ["aff_tag"],
      },
    },
  });

  test("parse() returns object with params Set, skipped number, affiliateExcluded number", () => {
    const result = clearurls.parse(FIXTURE_MIXED);
    assert.ok(result.params instanceof Set, "params must be a Set");
    assert.equal(typeof result.skipped, "number", "skipped must be a number");
    assert.equal(typeof result.affiliateExcluded, "number", "affiliateExcluded must be a number");
    assert.ok(result.params.has("utm_source"), "utm_source must be admitted");
    assert.ok(!result.params.has("aff_tag"), "aff_tag is referralMarketing — excluded");
    assert.equal(result.affiliateExcluded, 1, "affiliateExcluded must be 1");
    assert.ok(result.skipped >= 1, "skipped must be >= 1 (regex pattern)");
  });
});

// ── T-17: fetchRaw injectable seam ───────────────────────────────────────────

describe("clearurls.fetchRaw — injectable fetchImpl", () => {
  test("fetchImpl returning ok:false throws with 'ClearURLs fetch failed'", async () => {
    const badFetch = async () => ({ ok: false, status: 500, statusText: "Internal Server Error" });
    await assert.rejects(
      () => clearurls.fetchRaw({ fetchImpl: badFetch }),
      /ClearURLs fetch failed/,
    );
  });

  test("fetchImpl returning ok:true returns raw text", async () => {
    const goodFetch = async () => ({ ok: true, text: async () => "rawtext" });
    const result = await clearurls.fetchRaw({ fetchImpl: goodFetch });
    assert.equal(result, "rawtext");
  });
});
