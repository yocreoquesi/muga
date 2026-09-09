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

// The #740 re-onboard banner assertions lived here. Both banners were deleted
// along with the versioned-consent engine when MUGA adopted the uBlock Origin
// model — the onboarding page has a single informational mode now, so there is
// no reveal to announce and no focus to move.

// ── Reduced motion (#1260) ─────────────────────────────────────────
//
// "reduce" is a stated OS-level preference, and motion is a vestibular
// trigger, so a surface that animates through it is not a style choice.
// popup.css honoured it; options.css and onboarding.css did not, and both
// animate every toggle, focus ring and card they own.
//
// Asserted per STYLESHEET rather than once, because the gap was exactly this:
// one of three files had the media query and the other two were never
// noticed.

describe("every extension stylesheet honours prefers-reduced-motion", () => {
  const sheets = [
    { name: "popup.css", path: join(ROOT, "src/popup/popup.css") },
    { name: "options.css", path: join(ROOT, "src/options/options.css") },
    { name: "onboarding.css", path: join(ROOT, "src/onboarding/onboarding.css") },
  ];

  for (const { name, path } of sheets) {
    test(`${name}: has a prefers-reduced-motion block`, () => {
      const css = readFileSync(path, "utf8");
      assert.ok(
        /@media[^{]*prefers-reduced-motion/.test(css),
        `${name} animates without honouring prefers-reduced-motion`,
      );
    });
  }
});

// ── Destructive actions are guarded consistently (#1260) ───────────────
//
// "Reset stats" and "Forget reported params" sit in the same card, one under
// the other, and both wipe local state with no undo. Only the first asked for
// confirmation, which is worse than neither would be: it teaches that buttons
// in this card are safe to press, and then one of them is not.
//
// The assertion is on the handler body, not on the file, because a
// showConfirm() somewhere else in options.js is what made this pass by
// accident for as long as it did.

describe("both destructive buttons in the stats card confirm first", () => {
  const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

  for (const id of ["reset-stats-btn", "forget-reported-params-btn"]) {
    test(`${id}'s click handler calls showConfirm before writing`, () => {
      const at = optionsJs.indexOf(id);
      assert.ok(at > -1, `${id} handler not found in options.js`);
      const handler = optionsJs.slice(at, at + 900);
      const confirmAt = handler.indexOf("showConfirm(");
      const writeAt = handler.indexOf("chrome.storage.local.set");
      assert.ok(confirmAt > -1, `${id} wipes local state with no confirmation`);
      assert.ok(
        writeAt > -1 && confirmAt < writeAt,
        `${id} must confirm BEFORE it writes, not after`,
      );
    });
  }
});
