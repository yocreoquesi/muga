/**
 * MUGA — CSP inline-style guard (#901)
 *
 * The manifest CSP for extension_pages uses `style-src 'self'`, which BLOCKS
 * both inline `<style>` blocks and inline `style="..."` attributes. Any page
 * that carries CSS inline will render completely unstyled in Chrome/Firefox.
 *
 * This test enforces two invariants:
 *
 *  (a) The manifest CSP still contains `style-src 'self'` WITHOUT
 *      `'unsafe-inline'` — so the test stays meaningful. If someone relaxes
 *      the CSP the test must be revisited (and the inline-style pages
 *      constraint can be dropped alongside it).
 *
 *  (b) Every HTML page under src/ that is loaded as an extension page
 *      (onboarding, privacy, tos, popup, options) contains:
 *        - NO inline `<style>` block  (blocked by style-src 'self')
 *        - NO inline `style="..."` attribute  (also blocked by style-src 'self')
 *      Styling must come from an external `<link rel="stylesheet">`.
 *
 * Root-caused and fixed in #901 / branch fix/csp-inline-style-pages.
 * Prior to the fix, onboarding.html, privacy.html, and tos.html carried all
 * their CSS in inline <style> blocks that Chrome silently dropped.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSrc(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// (a) Manifest CSP assertion
// ---------------------------------------------------------------------------

describe("Manifest CSP — style-src 'self' must be present and must NOT allow unsafe-inline", () => {
  const manifestText = readSrc("src/manifest.json");
  const manifest     = JSON.parse(manifestText);
  const csp          = manifest?.content_security_policy?.extension_pages ?? "";

  test("extension_pages CSP contains style-src 'self'", () => {
    assert.ok(
      csp.includes("style-src 'self'"),
      `Expected manifest CSP extension_pages to contain "style-src 'self'" but got: ${csp}`
    );
  });

  test("extension_pages CSP does NOT contain 'unsafe-inline' for styles (#901 — relaxing this breaks the guard)", () => {
    // We specifically check the style-src directive portion only.
    // A simple check: if 'unsafe-inline' appears anywhere in this CSP that
    // would mean inline styles are permitted and this test file must be
    // revisited (the inline-style ban in (b) would no longer be needed).
    const styleSrcDirective = csp
      .split(";")
      .map(d => d.trim())
      .find(d => d.startsWith("style-src")) ?? "";

    assert.ok(
      !styleSrcDirective.includes("'unsafe-inline'"),
      `style-src directive must NOT include 'unsafe-inline'. ` +
      `If you are relaxing the CSP intentionally, update this test and ` +
      `remove the inline-style ban in the sibling describe block. Got: ${styleSrcDirective}`
    );
  });
});

// ---------------------------------------------------------------------------
// (b) No inline <style> blocks or style="..." attributes in extension pages
// ---------------------------------------------------------------------------

const EXTENSION_PAGES = [
  "src/onboarding/onboarding.html",
  "src/privacy/privacy.html",
  "src/privacy/tos.html",
  "src/popup/popup.html",
  "src/options/options.html",
];

describe("Extension pages — no inline CSS (blocked by style-src 'self', #901)", () => {
  for (const pagePath of EXTENSION_PAGES) {
    const label = pagePath.replace("src/", "");

    test(`${label}: no inline <style> block`, () => {
      const htmlText = readSrc(pagePath);
      // Match opening <style> tags (with or without attributes like type="text/css")
      const hasInlineStyle = /<style[\s>]/i.test(htmlText);
      assert.ok(
        !hasInlineStyle,
        `${pagePath} contains an inline <style> block, which is blocked by the ` +
        `manifest CSP "style-src 'self'". Move all CSS to an external stylesheet ` +
        `and reference it via <link rel="stylesheet">. (#901)`
      );
    });

    test(`${label}: no inline style="..." attributes`, () => {
      const htmlText = readSrc(pagePath);
      // Match style=" or style=' attribute patterns
      const hasInlineAttr = /\bstyle\s*=/i.test(htmlText);
      assert.ok(
        !hasInlineAttr,
        `${pagePath} contains inline style="..." attributes, which are blocked by ` +
        `the manifest CSP "style-src 'self'". Move inline styles to a class in ` +
        `the external stylesheet and reference it via <link rel="stylesheet">. (#901)`
      );
    });
  }
});
