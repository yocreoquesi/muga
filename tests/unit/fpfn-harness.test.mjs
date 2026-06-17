/**
 * MUGA FP/FN harness gate test (#890)
 *
 * Hard gate: FP == 0 (preserve violations are catastrophic — catches the class
 * of bug that produced #885). FN count is informational only.
 *
 * Coverage gate: total entries >= 30 (corpus + 10 affiliate fixture landing_samples).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runHarness } from "../../tools/fpfn-harness/run.mjs";

describe("fpfn-harness — FP==0 gate (asymmetric-risk hard line)", () => {
  const result = runHarness();

  test("total false positives == 0 (preserve violations are catastrophic)", () => {
    assert.strictEqual(
      result.totalFP,
      0,
      `False positives detected — ${result.totalFP} preserve violation(s):\n` +
      result.fpViolations.map(v =>
        `  ${v.url}: param "${v.param}" was expected to be preserved but was stripped`
      ).join("\n")
    );
  });

  test("false negative count is informational (reported, not fatal)", () => {
    if (result.totalFN > 0) {
      console.log(
        `[fpfn-harness] ${result.totalFN} false negative(s) found ` +
        `(FN = tracker not stripped, informational):`
      );
      for (const entry of result.entries) {
        if (entry.fn.length > 0) {
          console.log(
            `  [${entry.note}] tracker(s) not stripped: ${entry.fn.join(", ")} — ${entry.url}`
          );
        }
      }
    }
    assert.ok(true, "FN reported above, not a gate failure");
  });

  test("corpus coverage: total entries meets minimum threshold", () => {
    assert.ok(
      result.totalEntries >= 30,
      `corpus has only ${result.totalEntries} entries; expected ≥30 (fixtures + new corpus)`
    );
  });
});
