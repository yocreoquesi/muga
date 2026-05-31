/**
 * MUGA — deriveModeLabel unit tests (#453, B20 Phase 6.4)
 *
 * ADR-0004 phase 5 (2026-06-01): the Privacy Proxy feature was decommissioned.
 * deriveModeLabel now maps (honorCreatorMode) → i18n key only.
 * Truth table:
 *   false → "mode_strict_local"
 *   true  → "mode_honor_creator"
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveModeLabel } from "../../src/lib/mode-label.js";

describe("deriveModeLabel — two truth-table cases (proxy removed in phase 5)", () => {
  test("(false) → mode_strict_local", () => {
    assert.strictEqual(deriveModeLabel(false), "mode_strict_local");
  });

  test("(true) → mode_honor_creator", () => {
    assert.strictEqual(deriveModeLabel(true), "mode_honor_creator");
  });
});

describe("deriveModeLabel — truthy/falsy coercion", () => {
  test("truthy values work the same as true", () => {
    assert.strictEqual(deriveModeLabel(1), "mode_honor_creator");
    assert.strictEqual(deriveModeLabel(0), "mode_strict_local");
  });
});
