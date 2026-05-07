/**
 * MUGA — deriveModeLabel unit tests (#453, B20 Phase 6.4)
 *
 * Pure function: maps (honorCreatorMode, privacyProxyEnabled) → i18n key.
 * Truth table:
 *   (F, F) → "mode_strict_local"
 *   (T, F) → "mode_honor_creator"
 *   (F, T) → "mode_privacy_proxy"
 *   (T, T) → "mode_honor_plus_proxy"
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveModeLabel } from "../../src/lib/mode-label.js";

describe("deriveModeLabel — all 4 truth-table cases", () => {
  test("(false, false) → mode_strict_local", () => {
    assert.strictEqual(deriveModeLabel(false, false), "mode_strict_local");
  });

  test("(true, false) → mode_honor_creator", () => {
    assert.strictEqual(deriveModeLabel(true, false), "mode_honor_creator");
  });

  test("(false, true) → mode_privacy_proxy", () => {
    assert.strictEqual(deriveModeLabel(false, true), "mode_privacy_proxy");
  });

  test("(true, true) → mode_honor_plus_proxy", () => {
    assert.strictEqual(deriveModeLabel(true, true), "mode_honor_plus_proxy");
  });
});

describe("deriveModeLabel — truthy/falsy coercion", () => {
  test("truthy values work the same as true", () => {
    assert.strictEqual(deriveModeLabel(1, 1), "mode_honor_plus_proxy");
    assert.strictEqual(deriveModeLabel(1, 0), "mode_honor_creator");
    assert.strictEqual(deriveModeLabel(0, 1), "mode_privacy_proxy");
    assert.strictEqual(deriveModeLabel(0, 0), "mode_strict_local");
  });
});
