/**
 * MUGA — Semantic / a11y structure regression tests (Finding 4)
 *
 * Verifies:
 * 1. <main> landmark is present in popup.html, options.html, onboarding.html.
 * 2. Consent gate has aria-describedby wired to the message paragraph.
 * 3. #open-options is a <button> (not <a>), so Space key activates it.
 * 4. Decorative feature icons in onboarding.html have aria-hidden="true".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

const popupHtml     = readFileSync(join(ROOT, "src/popup/popup.html"),     "utf8");
const optionsHtml   = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const onboardHtml   = readFileSync(join(ROOT, "src/onboarding/onboarding.html"), "utf8");
const popupJs       = readFileSync(join(ROOT, "src/popup/popup.js"),       "utf8");

// ── <main> landmark ─────────────────────────────────────────────────────────

describe("<main> landmark present in all primary pages", () => {
  const pages = [
    { name: "popup.html",      html: popupHtml },
    { name: "options.html",    html: optionsHtml },
    { name: "onboarding.html", html: onboardHtml },
  ];

  for (const { name, html } of pages) {
    test(`${name}: contains <main>`, () => {
      assert.ok(
        html.includes("<main>") || html.includes("<main "),
        `${name} is missing a <main> landmark — screen reader users cannot jump to primary content`
      );
    });
  }
});

// ── Consent gate removed (browsewrap Phase 1) ─────────────────────────────
//
// popup.js used to render a consent-gate overlay with aria-describedby
// wiring to its message paragraph. Phase 1 removed the overlay entirely —
// the popup never blocks on onboardingDone — so there is no gate element
// left to carry that wiring. Guard the removal instead.

describe("browsewrap Phase 1 — no consent-gate overlay remains in popup.js", () => {
  test("popup.js does not construct a consent-gate element", () => {
    assert.ok(
      !popupJs.includes("consent-gate"),
      "popup.js must not reference a consent-gate element — the popup is never blocked"
    );
  });
});

// ── #open-options is a <button> ──────────────────────────────────────────────

describe("#open-options is a button element (not an anchor)", () => {
  test("popup.html: #open-options is <button>, not <a>", () => {
    // Must contain a button with id="open-options"
    assert.ok(
      popupHtml.includes('<button') && popupHtml.includes('id="open-options"'),
      '#open-options must be a <button> so Space key activates it — <a href="#"> only responds to Enter'
    );
  });

  test("popup.html: no <a href='#' id='open-options'>", () => {
    assert.ok(
      !popupHtml.includes('<a href="#" id="open-options"'),
      '#open-options must not be an <a> element — it triggers JS navigation (button semantics)'
    );
  });
});

// ── Decorative icons are aria-hidden ──────────────────────────────────────────

describe("Decorative feature icons in onboarding.html are aria-hidden", () => {
  test("every .feature-icon container is aria-hidden", () => {
    // Match any opening tag with class="feature-icon" (e.g. <div> or <span>).
    const allIcons = onboardHtml.match(/<\w+[^>]*class="feature-icon"[^>]*>/g) || [];
    assert.ok(allIcons.length > 0, "Expected at least one .feature-icon in onboarding.html");

    const ariaHidden = allIcons.filter(tag => /aria-hidden="true"/.test(tag));
    assert.strictEqual(
      ariaHidden.length,
      allIcons.length,
      `All .feature-icon containers must carry aria-hidden="true" — ` +
      `found ${allIcons.length}, ${ariaHidden.length} aria-hidden`
    );
  });
});

// ── Re-onboard banners are announced + focused (#740) ────────────────────────
//
// In delta/material re-onboard mode the JS only reveals a static banner. With
// no role/aria-live and no focus move, the change is silent for screen-reader
// users — and material mode is a hard gate they MUST act on.
const onboardJs = readFileSync(join(ROOT, "src/onboarding/onboarding.js"), "utf8");

describe("re-onboard banners are announced and focused (#740)", () => {
  test("reonboard-delta banner carries a live role and is focusable", () => {
    const m = onboardHtml.match(/<div[^>]*id="reonboard-delta"[^>]*>/);
    assert.ok(m, "reonboard-delta banner must exist");
    const tag = m[0];
    assert.ok(/role="(status|alert)"/.test(tag), "delta banner must have a live role");
    assert.ok(tag.includes('tabindex="-1"'), "delta banner must be focusable (tabindex=-1)");
  });

  test("reonboard-material banner carries role=alert and is focusable", () => {
    const m = onboardHtml.match(/<div[^>]*id="reonboard-material"[^>]*>/);
    assert.ok(m, "reonboard-material banner must exist");
    const tag = m[0];
    assert.ok(tag.includes('role="alert"'), "material banner (hard gate) must have role=alert");
    assert.ok(tag.includes('tabindex="-1"'), "material banner must be focusable (tabindex=-1)");
  });

  test("onboarding.js moves focus to each revealed banner", () => {
    assert.ok(/reonboardDelta\.focus\(\)/.test(onboardJs), "must focus the delta banner on reveal");
    assert.ok(/reonboardMaterial\.focus\(\)/.test(onboardJs), "must focus the material banner on reveal");
  });
});
