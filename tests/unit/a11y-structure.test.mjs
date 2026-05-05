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

// ── Consent gate aria-describedby ─────────────────────────────────────────

describe("Consent gate has aria-describedby pointing to the message paragraph", () => {
  test("popup.js: sets aria-describedby on consent gate", () => {
    assert.ok(
      popupJs.includes('aria-describedby'),
      'Consent gate in popup.js must have aria-describedby so screen readers announce the description'
    );
  });

  test("popup.js: consent gate message paragraph has id='consent-gate-msg'", () => {
    assert.ok(
      popupJs.includes("consent-gate-msg"),
      "The consent gate message <p> must have id='consent-gate-msg' to be referenced by aria-describedby"
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
