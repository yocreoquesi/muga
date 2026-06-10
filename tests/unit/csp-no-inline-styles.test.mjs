/**
 * MUGA — CSP inline-style guard (#858)
 *
 * Verifies:
 * 1. No extension HTML page contains a `style="..."` attribute.
 * 2. Neither manifest's style-src contains 'unsafe-inline'.
 *
 * If this test fails it means someone re-introduced an inline style attribute
 * (which would be silently ignored by the browser once 'unsafe-inline' is
 * absent from style-src) or re-added 'unsafe-inline' to the CSP (regression
 * against the security hardening done in #858).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

// ── HTML pages to check ──────────────────────────────────────────────────────

const EXTENSION_PAGES = [
  "src/options/options.html",
  "src/popup/popup.html",
  "src/onboarding/onboarding.html",
  "src/background/background.html",
  "src/privacy/privacy.html",
  "src/privacy/tos.html",
];

// ── Manifests ────────────────────────────────────────────────────────────────

const mv3Manifest = JSON.parse(readFileSync(join(ROOT, "src/manifest.json"), "utf8"));
const mv2Manifest = JSON.parse(readFileSync(join(ROOT, "src/manifest.v2.json"), "utf8"));

// ── Guard 1: no `style=` attributes in any extension page ───────────────────

describe("no inline style= attributes in extension HTML pages (#858)", () => {
  for (const pagePath of EXTENSION_PAGES) {
    test(`${pagePath}: must not contain any style="..." attribute`, () => {
      const html = readFileSync(join(ROOT, pagePath), "utf8");
      // Match style= that is an HTML attribute (not inside a comment or <style> tag).
      // A simple scan for `style=` is sufficient: the pages are extension HTML,
      // not arbitrary third-party content, so any match IS an inline attribute.
      const matches = html.match(/\bstyle\s*=/g);
      assert.strictEqual(
        matches,
        null,
        `${pagePath} contains ${matches?.length} inline style= attribute(s) — ` +
        "move them to CSS classes (required for CSP style-src without 'unsafe-inline')"
      );
    });
  }
});

// ── Guard 2: manifests' style-src must not contain 'unsafe-inline' ──────────

describe("manifests must not contain 'unsafe-inline' in style-src (#858)", () => {
  test("src/manifest.json (MV3): style-src has no 'unsafe-inline'", () => {
    const csp = mv3Manifest?.content_security_policy?.extension_pages ?? "";
    assert.ok(
      !csp.includes("'unsafe-inline'"),
      `manifest.json CSP extension_pages still contains 'unsafe-inline': "${csp}"`
    );
  });

  test("src/manifest.v2.json (MV2): style-src has no 'unsafe-inline'", () => {
    const csp = mv2Manifest?.content_security_policy ?? "";
    assert.ok(
      !csp.includes("'unsafe-inline'"),
      `manifest.v2.json content_security_policy still contains 'unsafe-inline': "${csp}"`
    );
  });
});
