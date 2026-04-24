/**
 * MUGA — Unit tests for src/lib/browser-detect.js
 *
 * Browser detection logic is pure (no DOM/chrome dependencies) and can be
 * tested directly. We verify:
 *   - isFirefox() returns false in a Node.js environment (no `browser` global)
 *   - isFirefox() respects the typeof browser / typeof chrome primary signal
 *   - source uses the capability-based check, not just navigator.userAgent
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isFirefox } from "../../src/lib/browser-detect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_DETECT_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/browser-detect.js"),
  "utf8"
);

describe("isFirefox() — in Node.js test environment", () => {
  test("returns false in Node.js (no browser globals)", () => {
    // In Node.js, typeof browser === 'undefined', typeof chrome === 'undefined'
    // The UA fallback also returns false (Node has no navigator)
    assert.strictEqual(isFirefox(), false);
  });
});

describe("isFirefox() — source-level verification", () => {
  test("isFirefox is exported", () => {
    assert.ok(
      BROWSER_DETECT_SOURCE.includes("export function isFirefox()"),
      "isFirefox must be exported from browser-detect.js"
    );
  });

  test("uses typeof browser check (capability-based, not just UA)", () => {
    assert.ok(
      BROWSER_DETECT_SOURCE.includes('typeof browser !== "undefined"'),
      "isFirefox must check typeof browser for capability-based detection"
    );
  });

  test("includes typeof chrome === undefined to distinguish Firefox from Chromium forks", () => {
    assert.ok(
      BROWSER_DETECT_SOURCE.includes('typeof chrome === "undefined"'),
      "isFirefox must check that chrome is absent to distinguish Firefox from forks"
    );
  });

  test("falls back to navigator.userAgent.includes('Firefox') as secondary check", () => {
    assert.ok(
      BROWSER_DETECT_SOURCE.includes('navigator.userAgent.includes("Firefox")'),
      "isFirefox must include navigator.userAgent fallback for edge cases"
    );
  });
});

describe("isFirefox() — popup.js and options.js use isFirefox() from browser-detect.js", () => {
  const popupSource = readFileSync(join(__dirname, "../../src/popup/popup.js"), "utf8");
  const optionsSource = readFileSync(join(__dirname, "../../src/options/options.js"), "utf8");

  test("popup.js imports isFirefox from browser-detect.js", () => {
    assert.ok(
      popupSource.includes('from "../lib/browser-detect.js"'),
      "popup.js must import from lib/browser-detect.js"
    );
  });

  test("options.js imports isFirefox from browser-detect.js", () => {
    assert.ok(
      optionsSource.includes('from "../lib/browser-detect.js"'),
      "options.js must import from lib/browser-detect.js"
    );
  });

  test("popup.js does not use navigator.userAgent.includes('Firefox') directly", () => {
    assert.ok(
      !popupSource.includes('navigator.userAgent.includes("Firefox")'),
      "popup.js must not use navigator.userAgent.includes('Firefox') — use isFirefox() instead"
    );
  });

  test("options.js does not use navigator.userAgent.includes('Firefox') directly for browser detection", () => {
    // options.js still uses navigator.userAgent in the UA trimming logic (debug export).
    // The Firefox DETECTION (isFirefox()) must use browser-detect.js, not UA checks.
    // We verify no standalone isFirefox = navigator.userAgent.includes pattern exists.
    assert.ok(
      !optionsSource.includes('navigator.userAgent.includes("Firefox")'),
      "options.js must not use navigator.userAgent.includes('Firefox') for Firefox detection — use isFirefox() instead"
    );
  });
});
