/**
 * MUGA — Unit tests for GATE 3: canary-gate (#777).
 *
 * PURE layer: synthetic canaries + fake processUrlFn via the seam opts.
 *   Exercises rejection, collect-all, malformed input, processUrlFn throws,
 *   partitionCandidates order-preservation, zero TRACKING_PARAMS mutation,
 *   and module shape.
 *
 * LIVE layer: real PRESERVE_CANARIES + real processUrl (no opts override).
 *   Proves realistic params are ACCEPTED and documents GATE-1 complementarity.
 *   WHY a live break is unconstructable: every mustSurvive key (tag, campid, …)
 *   is affiliate-protected at cleaner.js:303 and immune to remoteParams stripping.
 *   Rejection-path tests must therefore use the PURE layer (synthetic + fake fn).
 *
 * RED first: canary-gate.mjs does not exist at write time → all 21 cases fail on import.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkCanaryGate, partitionCandidates } from "../../tools/rule-ingestion/gates/canary-gate.mjs";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";

// ---------------------------------------------------------------------------
// Shared synthetic fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal preserve-style canary used across all PURE-layer tests.
 * mustSurvive: { keepme: "v1" } — the fake processUrlFn strips any param
 * that appears in prefs.remoteParams, so { param: "keepme" } will break it.
 */
const syntheticCanary = {
  name: "synthetic-A",
  url: "https://example.com/p?keepme=v1",
  prefs: {},
  mustSurvive: { keepme: "v1" },
  mustStrip: [],
};

/**
 * Fake processUrlFn: strips any param listed in prefs.remoteParams and returns
 * the remaining URL. Mimics the cleaner's remoteParams path without live deps.
 *
 * @param {string} url
 * @param {{ remoteParams?: string[] }} prefs
 * @returns {{ cleanUrl: string }}
 */
const fakeFn = (url, prefs) => {
  const u = new URL(url);
  for (const rp of (prefs.remoteParams || [])) {
    u.searchParams.delete(rp);
  }
  return { cleanUrl: u.toString() };
};

// ---------------------------------------------------------------------------
// PURE layer — synthetic canaries + fake processUrlFn
// ---------------------------------------------------------------------------

describe("checkCanaryGate — PURE layer: safe param accepted", () => {
  test("unrelated param returns { rejected: false }", () => {
    const result = checkCanaryGate(
      { param: "unrelated" },
      { canaries: [syntheticCanary], processUrlFn: fakeFn }
    );
    assert.deepEqual(result, { rejected: false });
  });
});

describe("checkCanaryGate — PURE layer: breaking param rejected", () => {
  test("{ param: 'keepme' } with synthetic canary returns rejected:true, reason:'canary-break'", () => {
    const result = checkCanaryGate(
      { param: "keepme" },
      { canaries: [syntheticCanary], processUrlFn: fakeFn }
    );
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "canary-break");
    assert.ok(Array.isArray(result.brokenCanaries), "brokenCanaries must be an array");
    assert.equal(result.brokenCanaries.length, 1);
    const [f] = result.brokenCanaries;
    assert.equal(f.name, "synthetic-A");
    assert.equal(f.kind, "preserve");
    // reason format: `${param} expected "${value}", got "${got}"`
    assert.match(f.reason, /keepme expected/);
  });
});

describe("checkCanaryGate — PURE layer: collect-all (two canaries broken)", () => {
  test("two synthetic canaries both mustSurvive keepme → brokenCanaries.length === 2", () => {
    const canaryB = { ...syntheticCanary, name: "synthetic-B" };
    const result = checkCanaryGate(
      { param: "keepme" },
      { canaries: [syntheticCanary, canaryB], processUrlFn: fakeFn }
    );
    assert.equal(result.rejected, true);
    assert.equal(result.brokenCanaries.length, 2, "must collect ALL broken canaries, no short-circuit");
  });
});

describe("checkCanaryGate — PURE layer: malformed input returns { rejected: false }", () => {
  test("null → { rejected: false }", () => {
    const result = checkCanaryGate(null, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { rejected: false });
  });

  test("undefined → { rejected: false }", () => {
    const result = checkCanaryGate(undefined, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { rejected: false });
  });

  test("{} → { rejected: false }", () => {
    const result = checkCanaryGate({}, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { rejected: false });
  });

  test("{ param: 42 } → { rejected: false }", () => {
    const result = checkCanaryGate({ param: 42 }, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { rejected: false });
  });

  test("{ param: '' } → { rejected: false }", () => {
    const result = checkCanaryGate({ param: "" }, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { rejected: false });
  });
});

describe("checkCanaryGate — PURE layer: processUrlFn throws", () => {
  test("throwing processUrlFn is recorded as broken canary, gate does not crash", () => {
    const throwingFn = () => { throw new Error("boom"); };
    const result = checkCanaryGate(
      { param: "k" },
      { canaries: [syntheticCanary], processUrlFn: throwingFn }
    );
    assert.equal(result.rejected, true);
    assert.ok(Array.isArray(result.brokenCanaries));
    assert.equal(result.brokenCanaries.length, 1);
    const [f] = result.brokenCanaries;
    assert.equal(f.kind, "preserve");
    assert.match(f.reason, /processUrl threw/);
  });
});

describe("partitionCandidates — PURE layer: mixed list partitioned, order preserved", () => {
  test("accepted and rejected preserve input order", () => {
    const candidates = [
      { param: "unrelated" },
      { param: "keepme" },
      { param: "also-safe" },
    ];
    const { accepted, rejected } = partitionCandidates(candidates, {
      canaries: [syntheticCanary],
      processUrlFn: fakeFn,
    });
    assert.deepEqual(accepted, [{ param: "unrelated" }, { param: "also-safe" }]);
    assert.equal(rejected.length, 1);
    assert.deepEqual(rejected[0].candidate, { param: "keepme" });
    assert.equal(rejected[0].reason, "canary-break");
    assert.ok(Array.isArray(rejected[0].brokenCanaries));
  });
});

describe("partitionCandidates — PURE layer: empty input", () => {
  test("returns { accepted: [], rejected: [] }", () => {
    const result = partitionCandidates([], { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.deepEqual(result, { accepted: [], rejected: [] });
  });
});

describe("partitionCandidates — PURE layer: all accepted", () => {
  test("rejected is [] when no candidate breaks any canary", () => {
    const candidates = [{ param: "utm_source" }, { param: "gclid" }];
    const { accepted, rejected } = partitionCandidates(candidates, {
      canaries: [syntheticCanary],
      processUrlFn: fakeFn,
    });
    assert.equal(rejected.length, 0);
    assert.equal(accepted.length, 2);
  });
});

describe("partitionCandidates — PURE layer: all rejected", () => {
  test("accepted is [] when every candidate breaks at least one synthetic canary", () => {
    // Both params are in syntheticCanary.mustSurvive... actually synthetic has only "keepme".
    // Use two separate canaries so both params cause breaks.
    const canaryB = {
      name: "synthetic-B",
      url: "https://example.com/q?other=v2",
      prefs: {},
      mustSurvive: { other: "v2" },
      mustStrip: [],
    };
    const { accepted, rejected } = partitionCandidates(
      [{ param: "keepme" }, { param: "other" }],
      { canaries: [syntheticCanary, canaryB], processUrlFn: fakeFn }
    );
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 2);
  });
});

describe("checkCanaryGate — PURE layer: seam honored", () => {
  test("only synthetic canary is iterated and fakeFn is called when seam opts supplied", () => {
    let fnCallCount = 0;
    const countingFn = (url, prefs) => {
      fnCallCount++;
      return fakeFn(url, prefs);
    };
    checkCanaryGate(
      { param: "unrelated" },
      { canaries: [syntheticCanary], processUrlFn: countingFn }
    );
    // exactly 1 canary in seam → fn must be called exactly once
    assert.equal(fnCallCount, 1, "countingFn must be called once per canary in the seam");
  });
});

describe("checkCanaryGate — PURE layer: zero-mutation of TRACKING_PARAMS", () => {
  test("TRACKING_PARAMS.length is unchanged after checkCanaryGate", () => {
    const before = TRACKING_PARAMS.length;
    checkCanaryGate({ param: "keepme" }, { canaries: [syntheticCanary], processUrlFn: fakeFn });
    assert.equal(TRACKING_PARAMS.length, before, "TRACKING_PARAMS must never be mutated");
  });
});

describe("partitionCandidates — PURE layer: zero-mutation of TRACKING_PARAMS", () => {
  test("TRACKING_PARAMS.length is unchanged after partitionCandidates", () => {
    const before = TRACKING_PARAMS.length;
    partitionCandidates(
      [{ param: "keepme" }, { param: "unrelated" }],
      { canaries: [syntheticCanary], processUrlFn: fakeFn }
    );
    assert.equal(TRACKING_PARAMS.length, before, "TRACKING_PARAMS must never be mutated");
  });
});

describe("canary-gate — module shape", () => {
  test("checkCanaryGate and partitionCandidates are exported functions", async () => {
    // Re-import to inspect namespace without relying on top-level bindings
    const mod = await import("../../tools/rule-ingestion/gates/canary-gate.mjs");
    assert.equal(typeof mod.checkCanaryGate, "function");
    assert.equal(typeof mod.partitionCandidates, "function");
  });

  test("no default export", async () => {
    const mod = await import("../../tools/rule-ingestion/gates/canary-gate.mjs");
    assert.ok(!("default" in mod), "canary-gate must not have a default export");
  });
});

// ---------------------------------------------------------------------------
// LIVE layer — real PRESERVE_CANARIES + real processUrl (no opts override)
// ---------------------------------------------------------------------------
// WHY: a live break is unconstructable because every mustSurvive key (tag,
// campid, cjevent, awc, …) is affiliate-protected at cleaner.js:303 and
// therefore immune to remoteParams stripping. LIVE tests prove realistic
// params are ACCEPTED and document the GATE-1 complementarity relationship.

describe("checkCanaryGate — LIVE layer: fbclid accepted", () => {
  test("{ param: 'fbclid' } returns { rejected: false } with real processUrl", () => {
    const result = checkCanaryGate({ param: "fbclid" });
    assert.deepEqual(result, { rejected: false });
  });
});

describe("checkCanaryGate — LIVE layer: tag accepted (GATE-1 complementarity proof)", () => {
  test("{ param: 'tag' } returns { rejected: false } with real processUrl", () => {
    // WHY: cleaner.js:303 `if (affiliateParamSet.has(lower)) continue;` fires BEFORE
    // isTrackingParam during processUrl — affiliate-protected params like Amazon `tag`
    // survive even when injected via remoteParams. GATE 3 alone returns { rejected: false }.
    // GATE 1 separately rejects { param: "tag" } for structural reasons (affiliate-collision).
    // These gates are COMPLEMENTARY (GATE 1 = structural; GATE 3 = behavioral), not redundant.
    const result = checkCanaryGate({ param: "tag" });
    assert.deepEqual(result, { rejected: false });
  });
});

describe("checkCanaryGate — LIVE layer: campid accepted", () => {
  test("{ param: 'campid' } returns { rejected: false } with real processUrl", () => {
    const result = checkCanaryGate({ param: "campid" });
    assert.deepEqual(result, { rejected: false });
  });
});
