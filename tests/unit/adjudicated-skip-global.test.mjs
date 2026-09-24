/**
 * MUGA — ADJUDICATED_SKIP_GLOBAL invariants (#1463 Area 5 automation).
 *
 * ADJUDICATED_SKIP_GLOBAL (src/lib/affiliates-data.js) pins names the
 * adguard-global-candidates monthly report must never re-surface, because a
 * human already triaged them and decided they must NOT land in
 * TRACKING_PARAMS. Mirror of adjudicated-keep-global.test.mjs, opposite
 * direction. Two things must always hold, or the exclusion silently rots:
 *
 *   1. Every entry has a non-empty reason — a bare name with no citation is
 *      not an auditable triage decision.
 *   2. Every key is still ABSENT from TRACKING_PARAMS — if the param is
 *      later added there by an unrelated future change (contradicting this
 *      SKIP decision), a stale entry here would silently exclude a real
 *      global entry from ever being re-examined, which is backwards.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TRACKING_PARAMS, ADJUDICATED_SKIP_GLOBAL } from "../../src/lib/affiliates-data.js";

describe("ADJUDICATED_SKIP_GLOBAL (#1463)", () => {
  const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  test("is a non-empty object", () => {
    assert.ok(Object.keys(ADJUDICATED_SKIP_GLOBAL).length > 0);
  });

  for (const [param, reason] of Object.entries(ADJUDICATED_SKIP_GLOBAL)) {
    test(`"${param}" has a non-empty reason`, () => {
      assert.equal(typeof reason, "string");
      assert.ok(reason.trim().length > 0, `"${param}"'s reason must not be empty`);
    });

    test(`"${param}" is NOT in TRACKING_PARAMS`, () => {
      assert.ok(
        !trackingLc.has(param.toLowerCase()),
        `"${param}" is in ADJUDICATED_SKIP_GLOBAL (decided NOT to land) but is now ALSO in ` +
          "TRACKING_PARAMS — this is a contradiction. Either the later addition was a mistake, or " +
          "this exclusion entry is stale and must be removed.",
      );
    });
  }
});
