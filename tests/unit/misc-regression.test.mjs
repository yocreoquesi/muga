/**
 * MUGA — Miscellaneous Regression Tests
 *
 * Smaller regression/smoke checks that don't fit a dedicated area:
 * storage flush behavior, TRACKING_PARAM_CATEGORIES shape, and
 * options.js write-path routing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";

const _dir = dirname(fileURLToPath(import.meta.url));

describe("Regression: storage.js uses setTimeout for MV3-safe flush", () => {
  const storageSource = readFileSync(join(_dir, "../../src/lib/storage.js"), "utf8");
  test("flushStats uses setTimeout, not microtask", () => {
    assert.ok(storageSource.includes("setTimeout(_flushStats"), "Must use setTimeout for flush");
    assert.ok(!storageSource.includes("Promise.resolve().then(_flushStats"), "Must not use microtask flush");
  });
});

// ---------------------------------------------------------------------------
// TRACKING_PARAM_CATEGORIES smoke test (Task 3.2)
// ---------------------------------------------------------------------------
describe("TRACKING_PARAM_CATEGORIES — smoke test", () => {
  test("is a non-empty object and every category has a non-empty params array", () => {
    assert.ok(
      typeof TRACKING_PARAM_CATEGORIES === "object" && TRACKING_PARAM_CATEGORIES !== null,
      "TRACKING_PARAM_CATEGORIES must be an object"
    );
    assert.ok(
      Object.keys(TRACKING_PARAM_CATEGORIES).length > 0,
      "TRACKING_PARAM_CATEGORIES must have at least one category"
    );
    for (const [catKey, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
      assert.ok(
        Array.isArray(catData.params) && catData.params.length > 0,
        `Category "${catKey}" must have a non-empty params array`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: SW context menu labels come from lib/i18n.js, not inline objects
// ---------------------------------------------------------------------------
describe("Regression: SW syncContextMenus uses lib/i18n.js translations", () => {
  const swSource = readFileSync(join(_dir, "../../src/background/service-worker.js"), "utf8");

  test("SW imports t() from lib/i18n.js", () => {
    assert.ok(
      swSource.includes('from "../lib/i18n.js"'),
      "service-worker.js must import from lib/i18n.js"
    );
    assert.ok(
      swSource.includes("{ t }") || swSource.includes("t,") || swSource.match(/import\s*\{[^}]*\bt\b[^}]*\}/),
      "service-worker.js must import the t() function from lib/i18n.js"
    );
  });

  test("syncContextMenus uses t() for context menu titles", () => {
    const ctxBlock = swSource.slice(
      swSource.indexOf("syncContextMenus"),
      swSource.indexOf("muga-copy-clean-selection") + 200
    );
    assert.ok(
      ctxBlock.includes('t("ctx_copy_clean_link"'),
      "syncContextMenus must use t('ctx_copy_clean_link', lang) for copy title"
    );
    assert.ok(
      ctxBlock.includes('t("ctx_copy_clean_selection"'),
      "syncContextMenus must use t('ctx_copy_clean_selection', lang) for selection title"
    );
  });

  test("inline German translation 'Sauberen Link kopieren' is gone from SW", () => {
    assert.ok(
      !swSource.includes("Sauberen Link kopieren"),
      "SW must not contain the old inline German string 'Sauberen Link kopieren' — use t() from i18n.js"
    );
  });

  test("canonical German translation 'Bereinigten Link kopieren' lives only in i18n.js", () => {
    const i18nSource = readFileSync(join(_dir, "../../src/lib/i18n.js"), "utf8");
    assert.ok(
      i18nSource.includes("Bereinigten Link kopieren"),
      "lib/i18n.js must contain the canonical German translation"
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: options.js routes all sync writes through setPrefs()
// ---------------------------------------------------------------------------
describe("Regression: options.js uses setPrefs() for all sync writes", () => {
  const optionsSource = readFileSync(join(_dir, "../../src/options/options.js"), "utf8");

  test("options.js imports setPrefs from lib/storage.js", () => {
    assert.ok(
      optionsSource.includes("setPrefs") && optionsSource.includes('from "../lib/storage.js"'),
      "options.js must import setPrefs from lib/storage.js"
    );
  });

  test("options.js contains no direct chrome.storage.sync.set() calls", () => {
    // All writes must go through setPrefs() so future logic in setPrefs
    // (validation, quota guards, migration hooks) covers the options page too.
    assert.ok(
      !optionsSource.includes("chrome.storage.sync.set("),
      "options.js must not call chrome.storage.sync.set() directly — use setPrefs() instead"
    );
  });
});
