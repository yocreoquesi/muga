/**
 * MUGA: unit tests for the popup length-reduction math (#1062).
 *
 * Pure module (src/lib/length-reduction.js), ported from web/ui-view.js, so it
 * is directly importable under node:test. Asserts the honest LENGTH-only
 * contract popup.js depends on: a clamped "% shorter" that never rounds a real
 * reduction down to 0, and a kept/removed bar whose widths always sum to 100.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLengthReduction, computeLengthBar } from "../../src/lib/length-reduction.js";

test("computeLengthReduction: an unchanged URL is isClean at 0%", () => {
  const v = computeLengthReduction("https://a.com/x", "https://a.com/x");
  assert.equal(v.isClean, true);
  assert.equal(v.shorterPercent, 0);
  assert.equal(v.removedLen, 0);
});

test("computeLengthReduction: reports removedLen, keptLen and a nonzero percent", () => {
  const original = "https://a.com/x?utm_source=y&utm_medium=z";
  const clean = "https://a.com/x";
  const v = computeLengthReduction(original, clean);
  assert.equal(v.isClean, false);
  assert.equal(v.removedLen, original.length - clean.length);
  assert.equal(v.keptLen, clean.length);
  assert.ok(v.shorterPercent >= 1);
});

test("computeLengthReduction: a tiny reduction never rounds down to 0%", () => {
  // 200-char original, 1 char removed => 0.5% which must clamp up to 1%.
  const original = "https://a.com/" + "a".repeat(187);
  const clean = original.slice(0, -1);
  const v = computeLengthReduction(original, clean);
  assert.equal(v.shorterPercent, 1);
});

test("computeLengthReduction: non-string inputs degrade to isClean, not a throw", () => {
  const v = computeLengthReduction(null, undefined);
  assert.equal(v.isClean, true);
  assert.equal(v.shorterPercent, 0);
});

test("computeLengthBar: kept and removed widths sum to 100", () => {
  const view = computeLengthReduction("https://a.com/x?utm_source=y", "https://a.com/x");
  const bar = computeLengthBar(view);
  assert.equal(Math.round(bar.keptPercent + bar.removedPercent), 100);
  assert.ok(bar.removedPercent > 0);
});

test("computeLengthBar: nothing removed => fully kept", () => {
  const bar = computeLengthBar({ keptLen: 20, removedLen: 0 });
  assert.equal(bar.keptPercent, 100);
  assert.equal(bar.removedPercent, 0);
});

test("computeLengthBar: zero total length never divides by zero", () => {
  const bar = computeLengthBar({ keptLen: 0, removedLen: 0 });
  assert.equal(bar.keptPercent, 100);
  assert.equal(bar.removedPercent, 0);
});
