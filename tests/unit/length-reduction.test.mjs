/**
 * MUGA — Unit tests for src/lib/length-reduction.js (#1062)
 *
 * Pure length-reduction view-model shared by the popup preview and mirrored
 * from the web tool's computeLengthReduction. Browser wiring (popup.js) is
 * a thin renderer over these functions and is covered by a source guard.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeLengthReduction, computeLengthBar } from "../../src/lib/length-reduction.js";

describe("computeLengthReduction()", () => {
  test("reports a positive percent for a shortened URL", () => {
    const original = "https://example.com/item?id=42&utm_source=news&utm_medium=email&fbclid=abc123";
    const clean = "https://example.com/item?id=42";
    const view = computeLengthReduction(original, clean);
    assert.ok(view.shorterPercent > 0);
    assert.equal(view.isClean, false);
    assert.equal(view.keptLen, clean.length);
    assert.equal(view.removedLen, original.length - clean.length);
  });

  test("isClean with 0% when nothing was removed", () => {
    const url = "https://example.com/already-clean?id=42";
    const view = computeLengthReduction(url, url);
    assert.equal(view.isClean, true);
    assert.equal(view.shorterPercent, 0);
    assert.equal(view.removedLen, 0);
  });

  test("never renders 0% while a real (tiny) reduction happened", () => {
    const original = "a".repeat(1000) + "x";
    const clean = "a".repeat(1000);
    const view = computeLengthReduction(original, clean);
    assert.equal(view.removedLen, 1);
    assert.ok(view.shorterPercent > 0);
  });

  test("non-string inputs collapse to a clean, zero-length view", () => {
    const view = computeLengthReduction(undefined, null);
    assert.equal(view.isClean, true);
    assert.equal(view.shorterPercent, 0);
    assert.equal(view.keptLen, 0);
    assert.equal(view.removedLen, 0);
  });
});

describe("computeLengthBar()", () => {
  test("splits kept vs removed as a share of the total original length", () => {
    // 80 kept + 20 removed = 100 total → 80% green, 20% red.
    const bar = computeLengthBar({ keptLen: 80, removedLen: 20, shorterPercent: 20, isClean: false });
    assert.equal(bar.keptPercent, 80);
    assert.equal(bar.removedPercent, 20);
  });

  test("segments always sum to 100 for any non-empty input", () => {
    const bar = computeLengthBar({ keptLen: 137, removedLen: 41 });
    assert.equal(Math.round(bar.keptPercent + bar.removedPercent), 100);
  });

  test("empty input yields 0/0 (no divide-by-zero)", () => {
    const bar = computeLengthBar({ keptLen: 0, removedLen: 0 });
    assert.equal(bar.keptPercent, 100);
    assert.equal(bar.removedPercent, 0);
  });

  test("defensively handles a malformed view", () => {
    const bar = computeLengthBar(null);
    assert.equal(bar.removedPercent, 0);
    assert.equal(bar.keptPercent, 100);
  });
});
