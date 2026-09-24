/**
 * MUGA — ADJUDICATED_KEEP_GLOBAL invariants (#1228 anchored-only-globals).
 *
 * ADJUDICATED_KEEP_GLOBAL (src/lib/affiliates-data.js) pins names the
 * anchored-only-globals monthly report must never re-surface, because a
 * human already triaged them and decided they must stay global. Two things
 * must always hold, or the exclusion silently rots:
 *
 *   1. Every entry has a non-empty reason — a bare name with no citation is
 *      not an auditable triage decision.
 *   2. Every key is still in TRACKING_PARAMS — if the param later leaves
 *      TRACKING_PARAMS (e.g. an unrelated future removal), a stale entry
 *      here would be a silent no-op forever, and nobody would notice this
 *      map no longer describes anything real.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TRACKING_PARAMS, ADJUDICATED_KEEP_GLOBAL } from "../../src/lib/affiliates-data.js";

describe("ADJUDICATED_KEEP_GLOBAL (#1228)", () => {
  const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  test("is a non-empty object", () => {
    assert.ok(Object.keys(ADJUDICATED_KEEP_GLOBAL).length > 0);
  });

  for (const [param, reason] of Object.entries(ADJUDICATED_KEEP_GLOBAL)) {
    test(`"${param}" has a non-empty reason`, () => {
      assert.equal(typeof reason, "string");
      assert.ok(reason.trim().length > 0, `"${param}"'s reason must not be empty`);
    });

    test(`"${param}" is still in TRACKING_PARAMS`, () => {
      assert.ok(
        trackingLc.has(param.toLowerCase()),
        `"${param}" is in ADJUDICATED_KEEP_GLOBAL but absent from TRACKING_PARAMS — this entry is ` +
          "stale. Either the param belongs in TRACKING_PARAMS again, or this exclusion entry must " +
          "be removed (it is a silent no-op otherwise).",
      );
    });
  }
});
