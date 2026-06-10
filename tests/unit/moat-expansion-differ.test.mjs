/**
 * MUGA — moat-expansion differ tests (#793).
 *
 * Tests for diffMoat(signals, snapshot, lookup):
 *   - Coverage source (a): AFFILIATE_PATTERNS param+domain match → COVERED
 *   - Coverage source (b): REDIRECT_NETWORK_PATTERNS landingParams → COVERED
 *   - Coverage source (c): AFFILIATE_PARAM_GUARD case-insensitive → COVERED
 *   - CRITICAL: ascsubtag must be COVERED by source (c) — MUST NOT resurface as gap
 *   - Unknown param on known provider → newOnKnown gap
 *   - Unknown provider → unknownProvider section with raw urlPattern, no domain inference
 *   - already-covered: count incremented, not enumerated
 *   - Deterministic ordering: stable across runs (programId+param sort, provider sort)
 *
 * Approach: injected snapshot fixtures for deterministic unit coverage.
 * One real-moat test for the ascsubtag scenario to verify against AFFILIATE_PARAM_GUARD.
 *
 * No upstream content — muga-authored fixtures only.
 * No source-file grep assertions (project convention, #824).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { diffMoat } from "../../tools/moat-expansion/differ.mjs";
import { loadMoatSnapshot } from "../../tools/moat-expansion/moat-snapshot.mjs";

// ── Injected fixture helpers ──────────────────────────────────────────────────

/**
 * Build a minimal injected snapshot for unit testing.
 * Simulates the shape returned by loadMoatSnapshot().
 *
 * @param {object} opts
 * @param {Map<string, Set<string>>} [opts.coveredByDomain]
 * @param {Set<string>} [opts.guardParams]  — already lowercased
 * @param {Map<string, {param: string, domains: string[]}>} [opts.knownByProgramId]
 * @param {Set<string>} [opts.landingParamSet]
 */
function makeSnapshot({
  coveredByDomain = new Map(),
  guardParams = new Set(),
  knownByProgramId = new Map(),
  landingParamSet = new Set(),
} = {}) {
  return { coveredByDomain, guardParams, knownByProgramId, landingParamSet };
}

/**
 * Build a minimal KNOWN_PROGRAMS-shaped lookup for unit tests.
 * Only the keys that the test needs.
 */
function makeLookup(overrides = {}) {
  return {
    amazon: {
      programId: "amazon-associates",
      domains: ["amazon.com", "amazon.es", "amazon.de"],
      note: "test",
    },
    ebay: {
      programId: "ebay-partner-network",
      domains: ["ebay.com", "ebay.es"],
      note: "test",
    },
    awin: {
      programId: "awin",
      domains: ["awin1.com"],
      note: "test",
    },
    ...overrides,
  };
}

// ── Signals derived from clearurls-mini.json shape ────────────────────────────

/** Signals that the differ receives: output of extractReferralSignals on the fixture. */
const AMAZON_SIGNAL = {
  provider: "amazon",
  urlPattern: "^https?://([a-z0-9-]+\\.)?amazon\\.(com|es|de|fr|it|co\\.uk)/",
  referralMarketing: ["tag", "newparam"],
};

const EBAY_SIGNAL = {
  provider: "ebay",
  urlPattern: "^https?://([a-z0-9-]+\\.)?ebay\\.(com|es|de|co\\.uk|fr|it)/",
  referralMarketing: ["campid"],
};

const UNKNOWN_FOO_SIGNAL = {
  provider: "unknown-foo",
  urlPattern: "^https?://([a-z0-9-]+\\.)?unknown-foo\\.example\\.com/",
  referralMarketing: ["xparam"],
};

const ASCSUBTAG_SIGNAL = {
  provider: "amazon",
  urlPattern: "^https?://([a-z0-9-]+\\.)?amazon\\.(com|es|de|fr|it|co\\.uk)/",
  referralMarketing: ["ascsubtag"],
};

// ── Core: coverage source (a) — AFFILIATE_PATTERNS ────────────────────────────

describe("diffMoat — coverage source (a): AFFILIATE_PATTERNS param+domain match", () => {
  test("param 'tag' on amazon is COVERED when domains overlap with knownByProgramId", () => {
    // amazon-associates has param:'tag', domains:['amazon.com',...]
    // signal for amazon has param 'tag'
    // coveredByDomain has 'amazon.com' -> Set{'tag'}
    const coveredByDomain = new Map([["amazon.com", new Set(["tag"])]]);
    const knownByProgramId = new Map([
      ["amazon-associates", { param: "tag", domains: ["amazon.com", "amazon.es"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup();

    const result = diffMoat([AMAZON_SIGNAL], snapshot, lookup);

    // 'tag' must be covered — it should NOT appear in newOnKnown
    const tagGap = result.newOnKnown.find(
      (g) => g.param === "tag" && g.programId === "amazon-associates"
    );
    assert.strictEqual(tagGap, undefined, "'tag' must not be a gap when covered by AFFILIATE_PATTERNS");
    // alreadyCoveredCount must reflect at least 1 covered param
    assert.ok(result.alreadyCoveredCount >= 1, "alreadyCoveredCount must be at least 1");
  });

  test("param 'campid' on ebay is COVERED when covered by coveredByDomain", () => {
    const coveredByDomain = new Map([["ebay.com", new Set(["campid"])]]);
    const knownByProgramId = new Map([
      ["ebay-partner-network", { param: "campid", domains: ["ebay.com"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup();

    const result = diffMoat([EBAY_SIGNAL], snapshot, lookup);

    const campidGap = result.newOnKnown.find(
      (g) => g.param === "campid" && g.programId === "ebay-partner-network"
    );
    assert.strictEqual(campidGap, undefined, "'campid' must not be a gap when covered");
    assert.ok(result.alreadyCoveredCount >= 1, "alreadyCoveredCount must be at least 1");
  });
});

// ── Core: coverage source (b) — REDIRECT_NETWORK_PATTERNS landingParams ──────

describe("diffMoat — coverage source (b): REDIRECT_NETWORK_PATTERNS landingParams", () => {
  test("param 'awc' on awin is COVERED via landingParamSet", () => {
    // awc is in REDIRECT_NETWORK_PATTERNS awin.landingParams
    const landingParamSet = new Set(["awc"]);
    const snapshot = makeSnapshot({ landingParamSet });
    const lookup = makeLookup();

    const awinSignal = {
      provider: "awin",
      urlPattern: "^https?://([a-z0-9-]+\\.)?awin1\\.com/",
      referralMarketing: ["awc"],
    };

    const result = diffMoat([awinSignal], snapshot, lookup);

    const awcGap = result.newOnKnown.find((g) => g.param === "awc");
    assert.strictEqual(awcGap, undefined, "'awc' must not be a gap when in landingParamSet");
    assert.ok(result.alreadyCoveredCount >= 1, "alreadyCoveredCount must reflect covered param");
  });

  test("landingParam coverage applies regardless of domain (no domain constraint)", () => {
    // landingParams coverage has NO domain constraint per spec §(b)
    const landingParamSet = new Set(["testlanding"]);
    const snapshot = makeSnapshot({ landingParamSet });
    const lookup = makeLookup();

    const signal = {
      provider: "amazon",
      urlPattern: "^https?://amazon\\.com/",
      referralMarketing: ["testlanding"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    const gap = result.newOnKnown.find((g) => g.param === "testlanding");
    assert.strictEqual(gap, undefined, "landingParam must be covered without domain constraint");
    assert.ok(result.alreadyCoveredCount >= 1);
  });
});

// ── Core: coverage source (c) — AFFILIATE_PARAM_GUARD case-insensitive ────────

describe("diffMoat — coverage source (c): AFFILIATE_PARAM_GUARD (case-insensitive)", () => {
  test("CRITICAL: ascsubtag is COVERED by guardParams — must NOT appear in newOnKnown", () => {
    // guardParams is lowercased in loadMoatSnapshot; inject 'ascsubtag' directly
    const guardParams = new Set(["ascsubtag"]);
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup();

    const result = diffMoat([ASCSUBTAG_SIGNAL], snapshot, lookup);

    const ascsubtag = result.newOnKnown.find((g) => g.param === "ascsubtag");
    assert.strictEqual(ascsubtag, undefined, "ascsubtag MUST NOT appear in newOnKnown (guard coverage)");

    const inUnknown = result.unknownProvider.some((p) => p.provider === "amazon");
    assert.strictEqual(inUnknown, false, "amazon with only guard-covered params must not appear in unknownProvider");

    assert.ok(result.alreadyCoveredCount >= 1, "ascsubtag must increment alreadyCoveredCount");
  });

  test("guard coverage is case-insensitive: ASCSUBTAG (uppercase) is still COVERED", () => {
    const guardParams = new Set(["ascsubtag"]); // stored lowercase
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup();

    const upperCaseSignal = {
      provider: "amazon",
      urlPattern: "^https?://amazon\\.com/",
      referralMarketing: ["ASCSUBTAG"],
    };

    const result = diffMoat([upperCaseSignal], snapshot, lookup);

    const gap = result.newOnKnown.find((g) => g.param.toLowerCase() === "ascsubtag");
    assert.strictEqual(gap, undefined, "ASCSUBTAG (uppercase) must be COVERED case-insensitively");
    assert.ok(result.alreadyCoveredCount >= 1);
  });

  test("guard coverage works for arbitrary params in guardParams", () => {
    const guardParams = new Set(["partner", "affid"]);
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup();

    const signal = {
      provider: "amazon",
      urlPattern: "^https?://amazon\\.com/",
      referralMarketing: ["partner", "newparam"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    const partnerGap = result.newOnKnown.find((g) => g.param === "partner");
    assert.strictEqual(partnerGap, undefined, "'partner' in guardParams must be COVERED");

    // newparam has no coverage → should be a gap
    const newparamGap = result.newOnKnown.find(
      (g) => g.param === "newparam" && g.programId === "amazon-associates"
    );
    assert.ok(newparamGap !== undefined, "'newparam' not in guard must be a gap");
  });
});

// ── Core: GAP — unknown param on known provider ────────────────────────────────

describe("diffMoat — GAP: unknown param on known program", () => {
  test("'newparam' on amazon is a GAP when not in any coverage source", () => {
    // empty snapshot — nothing covered
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([AMAZON_SIGNAL], snapshot, lookup);

    const newparamGap = result.newOnKnown.find(
      (g) => g.param === "newparam" && g.programId === "amazon-associates"
    );
    assert.ok(newparamGap !== undefined, "'newparam' must be in newOnKnown when not covered");
    assert.ok(
      Array.isArray(newparamGap.domains) && newparamGap.domains.length > 0,
      "gap entry must include domains from lookup table"
    );
    assert.strictEqual(newparamGap.provider, "amazon", "gap entry must carry provider key");
    assert.strictEqual(newparamGap.programId, "amazon-associates", "gap entry must carry programId");
  });

  test("gap entry domains come from the lookup table, not from inferred urlPattern", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([AMAZON_SIGNAL], snapshot, lookup);

    const newparamGap = result.newOnKnown.find((g) => g.param === "newparam");
    assert.ok(newparamGap, "'newparam' must be in newOnKnown");
    // Domains must match the lookup table's canonical set for amazon
    const expectedDomains = lookup.amazon.domains;
    assert.deepStrictEqual(
      newparamGap.domains.slice().sort(),
      expectedDomains.slice().sort(),
      "gap entry domains must match the lookup table, not inferred from urlPattern"
    );
  });

  test("a fully uncovered known provider emits one gap per uncovered param", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    // AMAZON_SIGNAL has two params: 'tag' and 'newparam' — both uncovered
    const result = diffMoat([AMAZON_SIGNAL], snapshot, lookup);

    const amazonGaps = result.newOnKnown.filter(
      (g) => g.programId === "amazon-associates"
    );
    assert.strictEqual(amazonGaps.length, 2, "both uncovered params on amazon must be in newOnKnown");
  });
});

// ── Core: unknown provider ────────────────────────────────────────────────────

describe("diffMoat — unknown provider passes through to unknownProvider section", () => {
  test("provider not in lookup table appears in unknownProvider section", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup(); // unknown-foo is NOT in this lookup

    const result = diffMoat([UNKNOWN_FOO_SIGNAL], snapshot, lookup);

    assert.strictEqual(result.newOnKnown.length, 0, "unknown provider must not produce newOnKnown entries");

    const unknownEntry = result.unknownProvider.find((u) => u.provider === "unknown-foo");
    assert.ok(unknownEntry !== undefined, "unknown-foo must appear in unknownProvider");
  });

  test("unknownProvider entry contains raw urlPattern verbatim", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([UNKNOWN_FOO_SIGNAL], snapshot, lookup);

    const entry = result.unknownProvider.find((u) => u.provider === "unknown-foo");
    assert.ok(entry, "unknown-foo must be present");
    assert.strictEqual(
      entry.urlPattern,
      UNKNOWN_FOO_SIGNAL.urlPattern,
      "urlPattern must be the raw value from ClearURLs, unchanged"
    );
  });

  test("unknownProvider entry contains referralMarketing array", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([UNKNOWN_FOO_SIGNAL], snapshot, lookup);

    const entry = result.unknownProvider.find((u) => u.provider === "unknown-foo");
    assert.ok(Array.isArray(entry.referralMarketing), "unknownProvider entry must carry referralMarketing");
    assert.ok(entry.referralMarketing.includes("xparam"), "referralMarketing must include xparam");
  });

  test("no domain inference is applied to unknown providers", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([UNKNOWN_FOO_SIGNAL], snapshot, lookup);

    const entry = result.unknownProvider.find((u) => u.provider === "unknown-foo");
    assert.ok(entry, "unknown-foo must be present");
    // The entry must NOT have a domains field (no inferred domains)
    assert.strictEqual(
      entry.domains,
      undefined,
      "unknownProvider entry must NOT have a domains field"
    );
  });
});

// ── Core: already-covered count ───────────────────────────────────────────────

describe("diffMoat — already-covered count", () => {
  test("alreadyCoveredCount is zero when nothing is covered", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([AMAZON_SIGNAL], snapshot, lookup);
    // If no coverage exists, count must be 0
    assert.strictEqual(result.alreadyCoveredCount, 0, "count must be 0 with empty snapshot");
  });

  test("alreadyCoveredCount increments once per covered param, not per provider", () => {
    // Make tag and campid both covered
    const coveredByDomain = new Map([
      ["amazon.com", new Set(["tag"])],
      ["ebay.com", new Set(["campid"])],
    ]);
    const knownByProgramId = new Map([
      ["amazon-associates", { param: "tag", domains: ["amazon.com"] }],
      ["ebay-partner-network", { param: "campid", domains: ["ebay.com"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup();

    // tag is covered (amazon), campid is covered (ebay), newparam is NOT covered
    const result = diffMoat([AMAZON_SIGNAL, EBAY_SIGNAL], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 2, "two covered params must give count of 2");

    // newparam is still a gap
    const newparamGap = result.newOnKnown.find((g) => g.param === "newparam");
    assert.ok(newparamGap, "'newparam' must still be a gap");
  });
});

// ── Deterministic ordering ────────────────────────────────────────────────────

describe("diffMoat — deterministic ordering", () => {
  test("newOnKnown is sorted by programId then param", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    // Two signals for amazon: tag and newparam (both uncovered)
    // Plus ebay campid (uncovered)
    const result = diffMoat([AMAZON_SIGNAL, EBAY_SIGNAL], snapshot, lookup);

    const programIds = result.newOnKnown.map((g) => g.programId);
    // Should be sorted: amazon-associates, amazon-associates, ebay-partner-network
    const sorted = [...programIds].sort();
    assert.deepStrictEqual(programIds, sorted, "newOnKnown must be sorted by programId");

    // Within same programId, params must be sorted
    const amazonGaps = result.newOnKnown.filter((g) => g.programId === "amazon-associates");
    if (amazonGaps.length > 1) {
      const params = amazonGaps.map((g) => g.param);
      assert.deepStrictEqual(
        params,
        [...params].sort(),
        "within a programId, params must be sorted alphabetically"
      );
    }
  });

  test("unknownProvider is sorted by provider key", () => {
    const snapshot = makeSnapshot();
    const lookup = {}; // empty lookup → all providers are unknown

    const signals = [
      { provider: "zzz-provider", urlPattern: "^https?://zzz/", referralMarketing: ["p1"] },
      { provider: "aaa-provider", urlPattern: "^https?://aaa/", referralMarketing: ["p2"] },
      { provider: "mmm-provider", urlPattern: "^https?://mmm/", referralMarketing: ["p3"] },
    ];

    const result = diffMoat(signals, snapshot, lookup);

    const providers = result.unknownProvider.map((u) => u.provider);
    assert.deepStrictEqual(
      providers,
      [...providers].sort(),
      "unknownProvider must be sorted alphabetically by provider key"
    );
  });

  test("same input produces identical output on two calls (determinism)", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const signals = [AMAZON_SIGNAL, EBAY_SIGNAL, UNKNOWN_FOO_SIGNAL];
    const r1 = diffMoat(signals, snapshot, lookup);
    const r2 = diffMoat(signals, snapshot, lookup);

    assert.deepStrictEqual(r1, r2, "two calls with same inputs must produce identical results");
  });
});

// ── Output shape ──────────────────────────────────────────────────────────────

describe("diffMoat — return value shape", () => {
  test("returns an object with newOnKnown, unknownProvider, alreadyCoveredCount", () => {
    const result = diffMoat([], makeSnapshot(), {});
    assert.ok(Array.isArray(result.newOnKnown), "newOnKnown must be an array");
    assert.ok(Array.isArray(result.unknownProvider), "unknownProvider must be an array");
    assert.ok(
      typeof result.alreadyCoveredCount === "number",
      "alreadyCoveredCount must be a number"
    );
  });

  test("empty signals input produces empty arrays and zero count", () => {
    const result = diffMoat([], makeSnapshot(), {});
    assert.strictEqual(result.newOnKnown.length, 0);
    assert.strictEqual(result.unknownProvider.length, 0);
    assert.strictEqual(result.alreadyCoveredCount, 0);
  });
});

// ── FIX-1: else fallback branch must require param-equality (WARNING-1) ────────
// When a lookup programId is NOT in knownByProgramId, source (a) coverage CANNOT
// apply (there is no program `param` field to establish equality against). A param
// that happens to live in coveredByDomain for a SHARED domain (carried by a
// DIFFERENT program) must NOT be treated as covered by source (a) — that is a
// cross-program false-cover in the costly (silent-gap) direction.

describe("diffMoat — FIX-1: unknown-programId fallback must not false-cover via source (a)", () => {
  test("param shared on a domain by a DIFFERENT program is a GAP (cross-program false-cover guard)", () => {
    // Probe from WARNING-1: programId not in knownByProgramId, domain shared with amazon.
    // 'tag' lives in coveredByDomain['amazon.com'] because amazon-associates put it there.
    // But this lookup program ('x-not-in-caps') is NOT that program → source (a) must not cover.
    const coveredByDomain = new Map([["amazon.com", new Set(["tag"])]]);
    const knownByProgramId = new Map([
      ["amazon-associates", { param: "tag", domains: ["amazon.com"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup({
      "x-provider": {
        programId: "x-not-in-caps", // NOT present in knownByProgramId
        domains: ["amazon.com"],
        note: "test",
      },
    });

    const signal = {
      provider: "x-provider",
      urlPattern: "^https?://x-provider/",
      referralMarketing: ["tag"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    const gap = result.newOnKnown.find(
      (g) => g.param === "tag" && g.programId === "x-not-in-caps"
    );
    assert.ok(
      gap !== undefined,
      "'tag' on an unknown-programId provider must be a GAP — no source (a) cross-program cover"
    );
    assert.strictEqual(
      result.alreadyCoveredCount,
      0,
      "no param must be counted as covered in the cross-program probe"
    );
  });

  test("positive: known programId with matching param+domain IS covered via source (a)", () => {
    // Primary path: programId IS in knownByProgramId, param equals program's param,
    // and the domain is carried in coveredByDomain → COVERED.
    const coveredByDomain = new Map([["amazon.com", new Set(["tag"])]]);
    const knownByProgramId = new Map([
      ["amazon-associates", { param: "tag", domains: ["amazon.com"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup();

    const signal = {
      provider: "amazon",
      urlPattern: "^https?://amazon\\.com/",
      referralMarketing: ["tag"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    const gap = result.newOnKnown.find((g) => g.param === "tag");
    assert.strictEqual(gap, undefined, "'tag' must be covered when param+domain match a known program");
    assert.strictEqual(result.alreadyCoveredCount, 1, "the matching param must be counted as covered");
  });
});

// ── FIX-2: unknown providers filter against domain-free coverage (WARNING-2) ───
// Unknown providers (absent from the lookup table) must still have each param
// filtered against the DOMAIN-FREE coverage sources: (b) landingParamSet and
// (c) guardParams (case-insensitive). Source (a) is domain-scoped and cannot
// apply to unknown domains. Covered params increment alreadyCoveredCount; the
// provider appears in unknownProvider ONLY with its remaining uncovered params;
// if none remain, the provider does not appear at all.

describe("diffMoat — FIX-2: unknown providers filter against domain-free coverage", () => {
  test("guard-covered param (ascsubtag) on an UNKNOWN provider is counted, not surfaced", () => {
    const guardParams = new Set(["ascsubtag"]);
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup(); // 'mystery' is NOT in the lookup

    const signal = {
      provider: "mystery",
      urlPattern: "^https?://mystery/",
      referralMarketing: ["ascsubtag"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 1, "guard-covered param on unknown provider must count");
    const surfaced = result.unknownProvider.find((u) => u.provider === "mystery");
    assert.strictEqual(
      surfaced,
      undefined,
      "unknown provider whose only param is guard-covered must NOT surface at all"
    );
  });

  test("guard coverage on unknown provider is case-insensitive", () => {
    const guardParams = new Set(["ascsubtag"]); // stored lowercase
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup();

    const signal = {
      provider: "mystery",
      urlPattern: "^https?://mystery/",
      referralMarketing: ["ASCSUBTAG"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 1, "uppercase guard param on unknown provider must count");
    assert.strictEqual(
      result.unknownProvider.find((u) => u.provider === "mystery"),
      undefined,
      "case-insensitive guard cover must suppress the unknown provider"
    );
  });

  test("landingParam-covered param on unknown provider is counted, not surfaced", () => {
    const landingParamSet = new Set(["awc"]);
    const snapshot = makeSnapshot({ landingParamSet });
    const lookup = makeLookup();

    const signal = {
      provider: "mystery",
      urlPattern: "^https?://mystery/",
      referralMarketing: ["awc"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 1, "landingParam-covered param on unknown provider must count");
    assert.strictEqual(
      result.unknownProvider.find((u) => u.provider === "mystery"),
      undefined,
      "landingParam cover must suppress the unknown provider"
    );
  });

  test("mixed params on unknown provider: only the uncovered one surfaces", () => {
    const guardParams = new Set(["ascsubtag"]);
    const snapshot = makeSnapshot({ guardParams });
    const lookup = makeLookup();

    const signal = {
      provider: "mystery",
      urlPattern: "^https?://mystery/",
      referralMarketing: ["ascsubtag", "uncovered"],
    };

    const result = diffMoat([signal], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 1, "the covered param must count once");

    const entry = result.unknownProvider.find((u) => u.provider === "mystery");
    assert.ok(entry !== undefined, "unknown provider with a remaining uncovered param must surface");
    assert.deepStrictEqual(
      entry.referralMarketing,
      ["uncovered"],
      "only the uncovered param must remain in referralMarketing"
    );
    assert.strictEqual(
      entry.urlPattern,
      signal.urlPattern,
      "raw urlPattern must be preserved verbatim"
    );
  });

  test("unknown provider with no covered params surfaces unchanged", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const result = diffMoat([UNKNOWN_FOO_SIGNAL], snapshot, lookup);

    const entry = result.unknownProvider.find((u) => u.provider === "unknown-foo");
    assert.ok(entry, "unknown-foo must surface");
    assert.deepStrictEqual(entry.referralMarketing, ["xparam"], "uncovered params pass through");
    assert.strictEqual(result.alreadyCoveredCount, 0, "no param covered → count stays 0");
  });
});

// ── FIX-3: de-duplication of duplicate tuples (SUGGESTION-2) ───────────────────
// Duplicate tuples / duplicate (program,param) or (provider,param) pairs must
// collapse to one entry and count once in alreadyCoveredCount.

describe("diffMoat — FIX-3: duplicate tuples collapse to one entry", () => {
  test("duplicate (program,param) gap collapses to a single newOnKnown entry", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    // Two identical amazon signals → 'newparam' would otherwise duplicate.
    const result = diffMoat([AMAZON_SIGNAL, AMAZON_SIGNAL], snapshot, lookup);

    const newparamGaps = result.newOnKnown.filter(
      (g) => g.param === "newparam" && g.programId === "amazon-associates"
    );
    assert.strictEqual(newparamGaps.length, 1, "duplicate (program,param) gap must collapse to one entry");
  });

  test("duplicate covered (program,param) counts once in alreadyCoveredCount", () => {
    const coveredByDomain = new Map([["amazon.com", new Set(["tag"])]]);
    const knownByProgramId = new Map([
      ["amazon-associates", { param: "tag", domains: ["amazon.com"] }],
    ]);
    const snapshot = makeSnapshot({ coveredByDomain, knownByProgramId });
    const lookup = makeLookup();

    const signal = {
      provider: "amazon",
      urlPattern: "^https?://amazon\\.com/",
      referralMarketing: ["tag", "tag"],
    };

    const result = diffMoat([signal, signal], snapshot, lookup);

    assert.strictEqual(result.alreadyCoveredCount, 1, "a duplicated covered (program,param) must count once");
  });

  test("duplicate unknown (provider,param) collapses to a single surfaced param", () => {
    const snapshot = makeSnapshot();
    const lookup = makeLookup();

    const dupSignal = {
      provider: "mystery",
      urlPattern: "^https?://mystery/",
      referralMarketing: ["dup", "dup"],
    };

    const result = diffMoat([dupSignal, dupSignal], snapshot, lookup);

    const entries = result.unknownProvider.filter((u) => u.provider === "mystery");
    assert.strictEqual(entries.length, 1, "duplicate unknown provider must collapse to one entry");
    assert.deepStrictEqual(
      entries[0].referralMarketing,
      ["dup"],
      "duplicate (provider,param) must collapse to a single surfaced param"
    );
  });
});

// ── Real moat: ascsubtag via loadMoatSnapshot ─────────────────────────────────
// These tests hit the REAL affiliate moat sources to verify the critical
// ascsubtag-is-covered invariant as specified.

describe("diffMoat — real moat snapshot: ascsubtag must stay COVERED (#794)", () => {
  test("ascsubtag on amazon is COVERED by AFFILIATE_PARAM_GUARD (real snapshot)", async () => {
    // Use the REAL moat snapshot to confirm AFFILIATE_PARAM_GUARD has ascsubtag
    const snapshot = loadMoatSnapshot();
    const { KNOWN_PROGRAMS } = await import("../../tools/moat-expansion/lookup-table.mjs");

    const result = diffMoat([ASCSUBTAG_SIGNAL], snapshot, KNOWN_PROGRAMS);

    const ascsubtagGap = result.newOnKnown.find((g) => g.param === "ascsubtag");
    assert.strictEqual(
      ascsubtagGap,
      undefined,
      "CRITICAL: ascsubtag must NOT be in newOnKnown — it is protected by AFFILIATE_PARAM_GUARD (#794)"
    );

    assert.ok(
      result.alreadyCoveredCount >= 1,
      "ascsubtag must increment alreadyCoveredCount"
    );
  });

  test("ascsubtag absent from unknownProvider section (real snapshot)", async () => {
    const snapshot = loadMoatSnapshot();
    const { KNOWN_PROGRAMS } = await import("../../tools/moat-expansion/lookup-table.mjs");

    const result = diffMoat([ASCSUBTAG_SIGNAL], snapshot, KNOWN_PROGRAMS);

    // amazon is a known provider, so nothing about amazon should be in unknownProvider
    const inUnknown = result.unknownProvider.some((u) => u.provider === "amazon");
    assert.strictEqual(
      inUnknown,
      false,
      "amazon with only guard-covered params must not be in unknownProvider"
    );
  });

  test("newparam on amazon IS a gap in the real moat snapshot", async () => {
    // Verify the fixture scenario: newparam is NOT in any moat source
    const snapshot = loadMoatSnapshot();
    const { KNOWN_PROGRAMS } = await import("../../tools/moat-expansion/lookup-table.mjs");

    const result = diffMoat([AMAZON_SIGNAL], snapshot, KNOWN_PROGRAMS);

    const newparamGap = result.newOnKnown.find((g) => g.param === "newparam");
    assert.ok(
      newparamGap !== undefined,
      "'newparam' must be a gap in the real moat (not in any coverage source)"
    );
  });
});
