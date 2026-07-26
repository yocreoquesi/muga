/**
 * MUGA — Cookie Consent Minimizer: cmp-tier2-save-invariant.js
 * (cookie-consent-toggle-reject, PR 1 — safety core)
 *
 * Pure-logic tests for the toggle-reject save invariant and the reject-only
 * actuation planner — the load-bearing safety math described in design.md
 * ADR-2/ADR-3. No DOM, no chrome.*, no globals; toggle state is injected as
 * plain-object fixtures, matching the pure-module contract described in
 * src/lib/cmp-tier2-save-invariant.js.
 *
 * This PR (PR 1) is BEHAVIOR-INERT: neither function is wired to any
 * dispatcher yet (that is PR 2). This suite exists so the safety math is
 * reviewable and adversarially proven before any DOM actuation exists.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeSaveInvariant, planToggleActuation } from "../../src/lib/cmp-tier2-save-invariant.js";

// ── computeSaveInvariant — satisfied cases ───────────────────────────────

describe("computeSaveInvariant — satisfied", () => {
  test("every non-locked toggle off + a locked toggle present + zero backstop -> satisfied", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: false, checked: false, readable: true },
      { locked: true, checked: true, readable: true },
    ];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, true);
    assert.equal(result.reason, "ok");
  });

  test("a single locked-only scope (no non-locked toggles at all) with zero backstop -> satisfied", () => {
    const readout = [{ locked: true, checked: true, readable: true }];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, true);
  });
});

// ── computeSaveInvariant — adversarial unsatisfied cases ─────────────────

describe("computeSaveInvariant — adversarial fail-closed cases", () => {
  test("one non-locked toggle still on -> unsatisfied (toggle-still-on)", () => {
    const readout = [
      { locked: false, checked: true, readable: true },
      { locked: true, checked: true, readable: true },
    ];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "toggle-still-on");
  });

  test("backstopCheckedCount > 0 (an unmapped checked control) -> unsatisfied (backstop-checked), even with all mapped toggles off", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: true, checked: true, readable: true },
    ];
    const result = computeSaveInvariant(readout, 1);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "backstop-checked");
  });

  test("readout is not an array (unreadable) -> unsatisfied (unreadable-toggle), never throws", () => {
    for (const garbage of [null, undefined, "x", 42, {}]) {
      assert.doesNotThrow(() => computeSaveInvariant(garbage, 0));
      const result = computeSaveInvariant(garbage, 0);
      assert.equal(result.satisfied, false);
      assert.equal(result.reason, "unreadable-toggle");
    }
  });

  test("empty scope (empty array) -> unsatisfied (empty-scope)", () => {
    const result = computeSaveInvariant([], 0);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "empty-scope");
  });

  test("no locked/necessary toggle present anywhere in scope -> unsatisfied (no-locked)", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: false, checked: false, readable: true },
    ];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "no-locked");
  });

  test("a non-locked entry with readable: false (DOM read failed) -> unsatisfied (unreadable-toggle), never guessed as off", () => {
    const readout = [
      { locked: false, checked: false, readable: false },
      { locked: true, checked: true, readable: true },
    ];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "unreadable-toggle");
  });

  test("a malformed entry (null / non-object) anywhere in the readout -> unsatisfied (unreadable-toggle), never throws", () => {
    for (const garbageEntry of [null, undefined, "x", 42, []]) {
      const readout = [garbageEntry, { locked: true, checked: true, readable: true }];
      assert.doesNotThrow(() => computeSaveInvariant(readout, 0));
      const result = computeSaveInvariant(readout, 0);
      assert.equal(result.satisfied, false);
      assert.equal(result.reason, "unreadable-toggle");
    }
  });

  test("backstopCheckedCount is non-numeric / NaN / negative -> unsatisfied (backstop-checked), fails closed rather than coercing", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: true, checked: true, readable: true },
    ];
    for (const garbage of [NaN, "0", null, undefined, -1, Infinity]) {
      const result = computeSaveInvariant(readout, garbage);
      assert.equal(result.satisfied, false, `backstopCheckedCount=${String(garbage)} must not be treated as zero`);
      assert.equal(result.reason, "backstop-checked");
    }
  });

  test("one missed/dynamic toggle still on among several otherwise-off toggles -> unsatisfied", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: false, checked: false, readable: true },
      { locked: false, checked: true, readable: true }, // the missed one
      { locked: true, checked: true, readable: true },
    ];
    const result = computeSaveInvariant(readout, 0);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "toggle-still-on");
  });
});

// ── planToggleActuation — never-turn-ON battery (task 1.3) ───────────────
//
// For every fixture below, the plan must never contain any representation
// of an "on"/enable action — the function's entire return shape is a list
// of force-off indices, so this is really proving "the output never
// includes a locked index and never includes an already-off/unreadable
// index", which together exhaust every way an "on" action could sneak in.

describe("planToggleActuation — never emits an on-action, for any fixture", () => {
  function assertNeverOn(readout, expectedIndices, label) {
    const plan = planToggleActuation(readout);
    assert.deepEqual(plan, expectedIndices, `${label}: unexpected plan`);
    // Structural proof: every planned index must reference a non-locked,
    // readable, currently-checked (i.e. force-OFF-eligible) entry — never a
    // locked entry, and the function returns bare indices with no "action
    // type" field at all, so there is no field a future edit could flip to
    // express "on".
    for (const idx of plan) {
      const entry = readout[idx];
      assert.notEqual(entry.locked, true, `${label}: plan must never include a locked index`);
      assert.equal(entry.checked, true, `${label}: plan must only include entries that were actually on`);
    }
  }

  test("already-off fixture -> empty plan (no redundant write)", () => {
    const readout = [
      { locked: false, checked: false, readable: true },
      { locked: false, checked: false, readable: true },
    ];
    assertNeverOn(readout, [], "already-off");
  });

  test("pre-checked fixture -> plans only the pre-checked indices", () => {
    const readout = [
      { locked: false, checked: true, readable: true },
      { locked: false, checked: true, readable: true },
    ];
    assertNeverOn(readout, [0, 1], "pre-checked");
  });

  test("mixed on/off fixture -> plans only the on indices", () => {
    const readout = [
      { locked: false, checked: true, readable: true },
      { locked: false, checked: false, readable: true },
      { locked: false, checked: true, readable: true },
    ];
    assertNeverOn(readout, [0, 2], "mixed");
  });

  test("locked-present fixture -> the locked index is never planned even though it reads checked:true", () => {
    const readout = [
      { locked: false, checked: true, readable: true },
      { locked: true, checked: true, readable: true },
    ];
    assertNeverOn(readout, [0], "locked-present");
  });

  test("malformed/unreadable fixture -> unreadable and non-object entries are skipped, never guessed into the plan", () => {
    const readout = [
      { locked: false, checked: true, readable: false },
      null,
      undefined,
      { locked: false, checked: true, readable: true },
    ];
    assertNeverOn(readout, [3], "malformed");
  });

  test("non-array input -> empty plan, never throws", () => {
    for (const garbage of [null, undefined, "x", 42, {}]) {
      assert.doesNotThrow(() => planToggleActuation(garbage));
      assert.deepEqual(planToggleActuation(garbage), []);
    }
  });

  test("empty readout -> empty plan", () => {
    assert.deepEqual(planToggleActuation([]), []);
  });

  test("across every fixture in this battery, the plan is always a plain number[] — no object, no {action} field, nothing an 'on' branch could hide inside", () => {
    const fixtures = [
      [],
      [{ locked: false, checked: true, readable: true }],
      [{ locked: true, checked: true, readable: true }],
      [{ locked: false, checked: false, readable: true }],
      [{ locked: false, checked: true, readable: false }],
    ];
    for (const readout of fixtures) {
      const plan = planToggleActuation(readout);
      assert.ok(Array.isArray(plan));
      for (const entry of plan) {
        assert.equal(typeof entry, "number", "every plan entry must be a bare numeric index, not an object/action");
      }
    }
  });
});
