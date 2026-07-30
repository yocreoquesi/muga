/**
 * MUGA — Regression tests for #931 (popup i18n/aria gaps), #932 (missing CSS),
 * #933 (contrast), and the #934 housekeeping items landed alongside them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const POPUP_HTML = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");
const POPUP_JS = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");
const POPUP_CSS = readFileSync(join(ROOT, "src/popup/popup.css"), "utf8");
const ONBOARD_HTML = readFileSync(join(ROOT, "src/onboarding/onboarding.html"), "utf8");
const ONBOARD_CSS = readFileSync(join(ROOT, "src/onboarding/onboarding.css"), "utf8");

// ── browsewrap Phase 1 — the consent-gate modal is gone entirely ──────────
//
// #931.1 used to verify the consent-gate modal's aria-label was i18n-driven.
// Phase 1 removed the consent-gate overlay itself (popup.js no longer blocks
// on onboardingDone), so there is no gate element left to label. These tests
// guard the removal instead — the aria_consent_gate/consent_gate_msg/
// consent_gate_btn translation keys are left in place (unused, retired for a
// future Phase 3 cleanup) but must not be wired to any live DOM element.

describe("browsewrap Phase 1 — consent-gate modal removed from popup.js", () => {
  test("popup.js no longer creates a consent-gate element at all", () => {
    assert.ok(
      !/gate\.setAttribute\(/.test(POPUP_JS),
      "popup.js must not build a consent-gate element — the popup is never blocked",
    );
    assert.ok(
      !POPUP_JS.includes('t("aria_consent_gate"'),
      "popup.js must not resolve aria_consent_gate — the consent-gate modal no longer exists",
    );
  });
});

// ── #931.2 — migration-banner-dismiss reuses toast_dismiss ────────────────

describe("#931 — migration-banner-dismiss aria-label is i18n-driven", () => {
  test("popup.html: #migration-banner-dismiss has no literal aria-label", () => {
    const m = POPUP_HTML.match(/<button[^>]*id="migration-banner-dismiss"[^>]*>/);
    assert.ok(m, "#migration-banner-dismiss must exist");
    assert.ok(
      !/(?<!data-i18n-)aria-label="/.test(m[0]),
      "#migration-banner-dismiss must not carry a literal hardcoded aria-label",
    );
    assert.ok(
      m[0].includes('data-i18n-aria-label="toast_dismiss"'),
      "#migration-banner-dismiss must reuse the existing toast_dismiss key via data-i18n-aria-label",
    );
  });
});

// ── #931.3 — master toggle is declarative, no JS flash ─────────────────────

describe("#931 — master toggle title/aria-label are declarative (no JS flash)", () => {
  test("popup.html: .toggle label carries data-i18n-title, no literal title", () => {
    const m = POPUP_HTML.match(/<label class="toggle"[^>]*>/);
    assert.ok(m, ".toggle label must exist");
    assert.ok(
      m[0].includes('data-i18n-title="toggle_title"'),
      ".toggle label must carry data-i18n-title=\"toggle_title\"",
    );
    assert.ok(!/(?<!data-i18n-)title="/.test(m[0]), ".toggle label must not carry a literal title attribute");
  });

  test("popup.html: #enabled-toggle carries data-i18n-aria-label, no literal aria-label", () => {
    const m = POPUP_HTML.match(/<input[^>]*id="enabled-toggle"[^>]*>/);
    assert.ok(m, "#enabled-toggle must exist");
    assert.ok(
      m[0].includes('data-i18n-aria-label="toggle_enabled"'),
      "#enabled-toggle must carry data-i18n-aria-label=\"toggle_enabled\"",
    );
    assert.ok(
      !/(?<!data-i18n-)aria-label="/.test(m[0]),
      "#enabled-toggle must not carry a literal hardcoded aria-label",
    );
  });

  test("popup.js no longer imperatively sets title/aria-label on the master toggle", () => {
    assert.ok(
      !/enabledToggle\.setAttribute\(\s*["']aria-label["']/.test(POPUP_JS),
      "popup.js must not imperatively set aria-label on enabledToggle — it's now declarative via data-i18n-aria-label",
    );
    assert.ok(
      !/\.closest\(\s*["']\.toggle["']\s*\)\.setAttribute\(\s*["']title["']/.test(POPUP_JS),
      "popup.js must not imperatively set title on the .toggle wrapper — it's now declarative via data-i18n-title",
    );
  });
});

// ── #934 — decorative brand SVG has no redundant aria-label ────────────────

describe("#934 — decorative brand mark SVG has no redundant aria-label", () => {
  test("popup.html: brand-mark svg has no aria-label (parent is aria-hidden)", () => {
    const m = POPUP_HTML.match(/<span class="brand-mark" aria-hidden="true">\s*<svg[^>]*>/);
    assert.ok(m, "brand-mark svg must exist inside an aria-hidden parent");
    assert.ok(!m[0].includes("aria-label"), "brand-mark svg must not carry a redundant aria-label");
  });

  test("onboarding.html: logo-mark svg has no aria-label (parent is aria-hidden)", () => {
    const m = ONBOARD_HTML.match(/<span class="logo-mark" aria-hidden="true">\s*<svg[^>]*>/);
    assert.ok(m, "logo-mark svg must exist inside an aria-hidden parent");
    assert.ok(!m[0].includes("aria-label"), "logo-mark svg must not carry a redundant aria-label");
  });
});

// ── #934 — dead classes removed ─────────────────────────────────────────────

describe("#934 — dead CSS classes removed from markup", () => {
  test("popup.html: #popup-support-link no longer carries the unused popup-support-link class", () => {
    const m = POPUP_HTML.match(/<a[^>]*id="popup-support-link"[^>]*>/);
    assert.ok(m, "#popup-support-link must still exist");
    assert.ok(
      !/class="popup-support-link"/.test(m[0]),
      "#popup-support-link must not carry the dead .popup-support-link class",
    );
  });

  // drop-affiliate-injection (PR 1b): #affiliate-synced-note was removed
  // along with the affiliate onboarding step, so the dead-class regression
  // it guarded against no longer applies (the element itself is gone).
});

// ── #932 — missing CSS rules added ──────────────────────────────────────────

describe("#932 — missing CSS rules added", () => {
  test("popup.css defines a .preview-honored rule", () => {
    assert.ok(
      /\.preview-honored\s*\{/.test(POPUP_CSS),
      "popup.css must define a .preview-honored rule for the #preview-honored badge",
    );
  });

  test("onboarding.css defines a .sync-note rule", () => {
    assert.ok(
      /\.sync-note\s*\{/.test(ONBOARD_CSS),
      "onboarding.css must define a .sync-note rule for the browser-sync clarification note",
    );
  });
});

// ── #933 — contrast fix ─────────────────────────────────────────────────────

describe("#933 — .preview-url.before contrast fix", () => {
  test("popup.css light-mode --diff-strip is no longer the low-contrast #C94A2A", () => {
    assert.ok(
      !POPUP_CSS.includes("--diff-strip: #C94A2A;"),
      "the original #C94A2A value (~4.08:1 contrast) must be replaced with a darker, AA-compliant value",
    );
  });

  test("popup.css light-mode --diff-strip clears WCAG AA (>= 4.5:1) against --diff-strip-bg", () => {
    const m = POPUP_CSS.match(/--diff-strip:\s*(#[0-9A-Fa-f]{6});/);
    assert.ok(m, "--diff-strip must be defined as a hex value");
    const hex = m[1];

    function hexToRgb(h) {
      h = h.replace("#", "");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    function srgbToLin(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function relLum(rgb) {
      const [r, g, b] = rgb.map(srgbToLin);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function flatten(rgb, alpha, bgRgb) {
      return rgb.map((c, i) => c * alpha + bgRgb[i] * (1 - alpha));
    }
    function contrastRgb(rgb1, rgb2) {
      const L1 = relLum(rgb1);
      const L2 = relLum(rgb2);
      const lighter = Math.max(L1, L2);
      const darker = Math.min(L1, L2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // --diff-strip-bg: rgba(201, 74, 42, .10) flattened over the light-mode
    // --surface-1 (#FFFFFF), which is the effective background .preview-url.before renders on.
    const flattenedBg = flatten([201, 74, 42], 0.10, [255, 255, 255]);
    const ratio = contrastRgb(hexToRgb(hex), flattenedBg);
    assert.ok(
      ratio >= 4.5,
      `--diff-strip (${hex}) contrast against --diff-strip-bg is ${ratio.toFixed(2)}:1 — below WCAG AA (4.5:1)`,
    );
  });
});

// ── audit #1042: history disclosure aria-expanded stays in sync ──────────────
//
// aria-expanded on #stat-urls-wrap was updated only by its own click handler,
// so toggling the native <details> <summary> directly left it stale. A toggle
// listener must resync it, and aria-controls must link the trigger to the panel.
describe("audit #1042 — popup history aria-expanded resyncs with the native toggle", () => {
  test("a toggle listener on the history <details> resyncs aria-expanded", () => {
    assert.ok(
      /historySection\.addEventListener\(\s*["']toggle["']\s*,[\s\S]{0,180}aria-expanded/.test(POPUP_JS),
      "popup.js must resync aria-expanded on the history panel's toggle event",
    );
  });

  test("the stat trigger declares aria-controls for the history panel", () => {
    assert.ok(
      /statUrlsWrap\.setAttribute\(\s*["']aria-controls["']\s*,\s*["']history["']\s*\)/.test(POPUP_JS),
      'popup.js must set aria-controls="history" on the stat trigger',
    );
  });
});
