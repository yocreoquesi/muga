/**
 * MUGA — Unit tests for GATE 4: functional-bias-gate (#778).
 *
 * Exercises the full behavioral contract of checkFunctionalBiasGate and
 * partitionCandidates: rejection of functional roster members, acceptance
 * of real trackers, case normalization, fail-safe acceptance of malformed
 * inputs, disjointness invariant against live TRACKING_PARAMS, opts
 * injection seam, batch partition, zero side-effects (pure), and module
 * shape.
 *
 * RED first: functional-bias-gate.mjs does not exist at write time →
 * all test cases fail on import. Pre-existing suite remains unaffected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FUNCTIONAL_PARAM_NAMES,
  checkFunctionalBiasGate,
  partitionCandidates,
} from "../../tools/rule-ingestion/gates/functional-bias-gate.mjs";

import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";

// ---------------------------------------------------------------------------
// T-01 — module shape
// ---------------------------------------------------------------------------

describe("functional-bias-gate — module shape", () => {
  test("FUNCTIONAL_PARAM_NAMES is a Set", () => {
    assert.ok(
      FUNCTIONAL_PARAM_NAMES instanceof Set,
      "FUNCTIONAL_PARAM_NAMES must be a Set"
    );
  });

  test("checkFunctionalBiasGate is a function", () => {
    assert.equal(typeof checkFunctionalBiasGate, "function");
  });

  test("partitionCandidates is a function", () => {
    assert.equal(typeof partitionCandidates, "function");
  });

  test("no default export", async () => {
    // Dynamic import to inspect the raw namespace object.
    const mod = await import(
      "../../tools/rule-ingestion/gates/functional-bias-gate.mjs"
    );
    assert.equal(
      mod.default,
      undefined,
      "functional-bias-gate must NOT have a default export"
    );
  });
});

// ---------------------------------------------------------------------------
// T-02 — functional-param rejection — one member from each roster family
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — functional-param rejection — roster members", () => {
  test("{ param: 'q' } → rejected, reason functional-param, detail.param='q'", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "q" }), {
      rejected: true,
      reason: "functional-param",
      detail: { param: "q" },
    });
  });

  test("{ param: 'page' } → rejected, detail.param='page'", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "page" }), {
      rejected: true,
      reason: "functional-param",
      detail: { param: "page" },
    });
  });

  test("{ param: 'lang' } → rejected, detail.param='lang'", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "lang" }), {
      rejected: true,
      reason: "functional-param",
      detail: { param: "lang" },
    });
  });

  test("{ param: 'id' } → rejected, detail.param='id'", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "id" }), {
      rejected: true,
      reason: "functional-param",
      detail: { param: "id" },
    });
  });

  test("{ param: 's' } → rejected, detail.param='s'", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "s" }), {
      rejected: true,
      reason: "functional-param",
      detail: { param: "s" },
    });
  });
});

// ---------------------------------------------------------------------------
// T-03 — non-functional acceptance — real trackers confirmed NOT in roster
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — non-functional acceptance — real trackers", () => {
  test("{ param: 'fbclid' } → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "fbclid" }), {
      rejected: false,
    });
  });

  test("{ param: 'utm_source' } → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "utm_source" }), {
      rejected: false,
    });
  });

  test("{ param: 'gclid' } → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "gclid" }), {
      rejected: false,
    });
  });
});

// ---------------------------------------------------------------------------
// T-04 — case normalization — uppercase/mixed-case param names
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — case normalization", () => {
  test("{ param: 'Q' } → rejected, detail.param is lowercased 'q'", () => {
    const result = checkFunctionalBiasGate({ param: "Q" });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "functional-param");
    assert.deepStrictEqual(result.detail, { param: "q" });
  });

  test("{ param: 'PAGE' } → rejected, detail.param is lowercased 'page'", () => {
    const result = checkFunctionalBiasGate({ param: "PAGE" });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, "functional-param");
    assert.deepStrictEqual(result.detail, { param: "page" });
  });
});

// ---------------------------------------------------------------------------
// T-05 — malformed input — fail-safe acceptance (5 cases)
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — malformed input — fail-safe acceptance", () => {
  test("null → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate(null), { rejected: false });
  });

  test("undefined → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate(undefined), {
      rejected: false,
    });
  });

  test("{} (missing param) → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({}), { rejected: false });
  });

  test("{ param: 42 } (non-string) → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: 42 }), {
      rejected: false,
    });
  });

  test("{ param: '' } (empty string) → { rejected: false }", () => {
    assert.deepStrictEqual(checkFunctionalBiasGate({ param: "" }), {
      rejected: false,
    });
  });
});

// ---------------------------------------------------------------------------
// T-06 — DISJOINTNESS INVARIANT — TRACKING_PARAMS (load-bearing drift guard)
// ---------------------------------------------------------------------------
// WHY: no GATE 4 roster member may ever appear in the global TRACKING_PARAMS
// strip list. If it did, that param would be silently stripped at runtime —
// catastrophically breaking search/pagination/i18n across the web. This test
// imports the LIVE TRACKING_PARAMS (not a snapshot) so any future drift that
// introduces an overlap immediately breaks the build (fail-closed).

describe("DISJOINTNESS INVARIANT — FUNCTIONAL_PARAM_NAMES vs TRACKING_PARAMS", () => {
  test("zero overlap between FUNCTIONAL_PARAM_NAMES and TRACKING_PARAMS (fail-closed)", () => {
    const trackingSet = new Set(TRACKING_PARAMS);
    const overlapping = [...FUNCTIONAL_PARAM_NAMES].filter((n) =>
      trackingSet.has(n)
    );
    assert.deepStrictEqual(
      overlapping,
      [],
      `DISJOINTNESS VIOLATED — these names appear in both FUNCTIONAL_PARAM_NAMES and TRACKING_PARAMS: ${overlapping.join(", ")}. ` +
        `Fix by removing them from one list. Any overlap means a functional param would be silently stripped at runtime.`
    );
  });
});

// ---------------------------------------------------------------------------
// T-07 — opts injection seam
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — opts injection seam", () => {
  test("custom functionalNames set → 'custom' rejected", () => {
    assert.deepStrictEqual(
      checkFunctionalBiasGate(
        { param: "custom" },
        { functionalNames: new Set(["custom"]) }
      ),
      {
        rejected: true,
        reason: "functional-param",
        detail: { param: "custom" },
      }
    );
  });

  test("custom functionalNames set → production roster member 'q' accepted (roster bypassed)", () => {
    assert.deepStrictEqual(
      checkFunctionalBiasGate(
        { param: "q" },
        { functionalNames: new Set(["custom"]) }
      ),
      { rejected: false }
    );
  });
});

// ---------------------------------------------------------------------------
// T-08 — partitionCandidates — batch processing
// ---------------------------------------------------------------------------

describe("partitionCandidates — mixed batch — order preserved", () => {
  test("fbclid/q/gclid/page → accepted=[fbclid,gclid], rejected=[q,page] in input order", () => {
    const candidates = [
      { param: "fbclid" },
      { param: "q" },
      { param: "gclid" },
      { param: "page" },
    ];
    const { accepted, rejected } = partitionCandidates(candidates);

    assert.deepStrictEqual(accepted, [
      { param: "fbclid" },
      { param: "gclid" },
    ]);

    assert.equal(rejected.length, 2);
    assert.deepStrictEqual(rejected[0].candidate, { param: "q" });
    assert.equal(rejected[0].reason, "functional-param");
    assert.deepStrictEqual(rejected[0].detail, { param: "q" });
    assert.deepStrictEqual(rejected[1].candidate, { param: "page" });
    assert.equal(rejected[1].reason, "functional-param");
    assert.deepStrictEqual(rejected[1].detail, { param: "page" });
  });
});

describe("partitionCandidates — empty input", () => {
  test("[] → { accepted: [], rejected: [] }", () => {
    assert.deepStrictEqual(partitionCandidates([]), {
      accepted: [],
      rejected: [],
    });
  });
});

describe("partitionCandidates — all accepted", () => {
  test("[fbclid, utm_source] → rejected.length === 0", () => {
    const { accepted, rejected } = partitionCandidates([
      { param: "fbclid" },
      { param: "utm_source" },
    ]);
    assert.equal(rejected.length, 0);
    assert.equal(accepted.length, 2);
  });
});

describe("partitionCandidates — all rejected", () => {
  test("[q, page] → accepted.length === 0", () => {
    const { accepted, rejected } = partitionCandidates([
      { param: "q" },
      { param: "page" },
    ]);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 2);
  });
});

describe("partitionCandidates — opts forwarded to inner check", () => {
  test("custom set: 'q' accepted, 'custom' rejected", () => {
    const opts = { functionalNames: new Set(["custom"]) };
    const { accepted, rejected } = partitionCandidates(
      [{ param: "custom" }, { param: "q" }],
      opts
    );
    assert.deepStrictEqual(accepted, [{ param: "q" }]);
    assert.equal(rejected.length, 1);
    assert.deepStrictEqual(rejected[0].candidate, { param: "custom" });
  });
});

// ---------------------------------------------------------------------------
// T-09 — zero side-effects (pure) + FUNCTIONAL_PARAM_NAMES.size === 43
// ---------------------------------------------------------------------------

describe("checkFunctionalBiasGate — zero side-effects (pure)", () => {
  test("input candidate object is NOT mutated by checkFunctionalBiasGate", () => {
    const candidate = { param: "q", extra: "data" };
    checkFunctionalBiasGate(candidate);
    assert.deepStrictEqual(candidate, { param: "q", extra: "data" });
  });

  test("FUNCTIONAL_PARAM_NAMES.size is unchanged after calls to gate and partition", () => {
    const sizeBefore = FUNCTIONAL_PARAM_NAMES.size;
    checkFunctionalBiasGate({ param: "q" });
    checkFunctionalBiasGate({ param: "fbclid" });
    partitionCandidates([{ param: "q" }, { param: "gclid" }, { param: "page" }]);
    assert.equal(
      FUNCTIONAL_PARAM_NAMES.size,
      sizeBefore,
      "FUNCTIONAL_PARAM_NAMES must not be mutated by gate calls"
    );
  });

  test("FUNCTIONAL_PARAM_NAMES.size === 43 (authoritative roster)", () => {
    assert.equal(
      FUNCTIONAL_PARAM_NAMES.size,
      43,
      `Expected exactly 43 functional param names, got ${FUNCTIONAL_PARAM_NAMES.size}`
    );
  });
});
