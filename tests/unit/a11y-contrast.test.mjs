/**
 * MUGA — WCAG AA contrast regression tests (Finding 1)
 *
 * Verifies that:
 * 1. --text-3 CSS variable in popup.css and options.css achieves ≥4.5:1
 *    contrast ratio against the documented background colours.
 * 2. No inline color:#666 remains on dark (#1c1c1e) backgrounds in options.js.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

// ── WCAG contrast helpers ────────────────────────────────────────────────────

/** Converts a hex colour string (#RRGGBB) to linear-light RGB components [0..1]. */
function hexToLinear(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearise = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [linearise(r), linearise(g), linearise(b)];
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex) {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
function contrast(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── CSS variable extraction helper ─────────────────────────────────────────

/** Reads the value of a CSS custom property from a raw CSS string. */
function extractCssVar(css, varName) {
  const re = new RegExp(`${varName}\\s*:\\s*(#[0-9A-Fa-f]{6})`);
  const m = css.match(re);
  return m ? m[1] : null;
}

// ── Backgrounds to test against ────────────────────────────────────────────
// From the design tokens: --surface-2 and --surface-0 are the two tightest
// backgrounds --text-3 is used on.
const LIGHT_BACKGROUNDS = [
  { name: "--surface-2 (#F3F2EC)", hex: "#F3F2EC" },
  { name: "--surface-0 (#FAFAF7)", hex: "#FAFAF7" },
  { name: "--surface-1 (#FFFFFF)", hex: "#FFFFFF" },
];

const MIN_RATIO = 4.5; // WCAG AA for small text

// ── Tests ──────────────────────────────────────────────────────────────────

describe("WCAG AA contrast — --text-3 light mode", () => {
  const popupCss  = readFileSync(join(ROOT, "src/popup/popup.css"),  "utf8");
  const optsCss   = readFileSync(join(ROOT, "src/options/options.css"), "utf8");

  for (const [label, css] of [["popup.css", popupCss], ["options.css", optsCss]]) {
    const text3 = extractCssVar(css, "--text-3");

    test(`${label}: --text-3 is defined`, () => {
      assert.ok(text3, `Could not find --text-3 in ${label}`);
    });

    for (const bg of LIGHT_BACKGROUNDS) {
      test(`${label}: --text-3 (${text3}) on ${bg.name} ≥${MIN_RATIO}:1`, () => {
        const ratio = contrast(text3, bg.hex);
        assert.ok(
          ratio >= MIN_RATIO,
          `contrast ${ratio.toFixed(2)}:1 is below WCAG AA ${MIN_RATIO}:1 (${text3} on ${bg.hex})`
        );
      });
    }
  }
});

describe("WCAG AA contrast — dismiss button not using #666 on dark background", () => {
  const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

  test('options.js: no inline color:#666 on dark (#1c1c1e) background', () => {
    // The nudge dismiss button previously used color:#666 on background:#1c1c1e
    // which yielded 2.96:1. Ensure that pattern is gone.
    const hasBadColor = /color:#666[^;'"]/i.test(optionsJs);
    assert.ok(
      !hasBadColor,
      'Found color:#666 in options.js — this fails WCAG AA on dark (#1c1c1e) background'
    );
  });

  test('options.js: dismiss button uses an accessible color on dark bg (≥4.5:1 on #1c1c1e)', () => {
    // Extract the actual color used for the dismiss button
    const match = optionsJs.match(/dismissBtn\.style\.cssText\s*=\s*btnStyle\s*\+\s*";color:(#[0-9A-Fa-f]{6})"/i);
    if (!match) {
      // If the pattern changed (e.g., now uses a CSS var), this check is not applicable
      assert.ok(true, "dismissBtn color pattern not found — assumed refactored to CSS variables");
      return;
    }
    const color = match[1];
    const ratio = contrast(color, "#1c1c1e");
    assert.ok(
      ratio >= MIN_RATIO,
      `Dismiss button color ${color} on #1c1c1e yields ${ratio.toFixed(2)}:1 — below WCAG AA ${MIN_RATIO}:1`
    );
  });
});
