/**
 * MUGA — Docs compliance drift regression test
 *
 * Ensures:
 *   1. Version stamps in docs/transparency.html, docs/tos.html, and
 *      src/privacy/privacy.html match the canonical manifest version.
 *   2. Stale claims removed in the audit (v1.9.10) cannot silently revert:
 *      - The categorical "No network request is made to fetch or update them"
 *        string must not reappear in docs/transparency.html.
 *      - "Booking" and "AliExpress" must not reappear in the affiliate
 *        disclosure section of docs/tos.html (inactive programs).
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function readJSON(relPath) {
  return JSON.parse(read(relPath));
}

// Canonical version from manifest (already verified against package.json
// and manifest.v2.json by version-consistency.test.mjs and config-integrity.test.mjs).
const MANIFEST_VERSION = readJSON("src/manifest.json").version;

// ---------------------------------------------------------------------------
// Version stamps in doc files must match the manifest
// ---------------------------------------------------------------------------
describe("Docs version stamps must match manifest version", () => {

  test(`docs/transparency.html — Version stamp matches manifest (${MANIFEST_VERSION})`, () => {
    const html = read("docs/transparency.html");
    const matches = [...html.matchAll(/Version\s+(\d+\.\d+\.\d+)/g)];
    assert.ok(
      matches.length > 0,
      "docs/transparency.html must contain at least one Version X.Y.Z stamp"
    );
    for (const m of matches) {
      assert.equal(
        m[1],
        MANIFEST_VERSION,
        `docs/transparency.html has stale version stamp "${m[1]}", expected "${MANIFEST_VERSION}"`
      );
    }
  });

  test(`docs/transparency.html — at-a-glance version cell matches manifest (${MANIFEST_VERSION})`, () => {
    const html = read("docs/transparency.html");
    // Match the at-a-glance-value span that contains only a version number
    const match = html.match(/<span class="at-a-glance-value">(\d+\.\d+\.\d+)<\/span>/);
    assert.ok(match, "docs/transparency.html must have an at-a-glance version cell");
    assert.equal(
      match[1],
      MANIFEST_VERSION,
      `at-a-glance version cell shows "${match[1]}", expected "${MANIFEST_VERSION}"`
    );
  });

  test(`src/privacy/privacy.html — Version stamp matches manifest (${MANIFEST_VERSION})`, () => {
    const html = read("src/privacy/privacy.html");
    const match = html.match(/Version\s+(\d+\.\d+\.\d+)/);
    assert.ok(match, "src/privacy/privacy.html must contain a Version X.Y.Z stamp");
    assert.equal(
      match[1],
      MANIFEST_VERSION,
      `src/privacy/privacy.html has "${match[1]}", expected "${MANIFEST_VERSION}"`
    );
  });

});

// ---------------------------------------------------------------------------
// Stale claim guard — transparency.html
// ---------------------------------------------------------------------------
describe("docs/transparency.html — stale claim regression guards", () => {

  test('Does NOT contain the removed categorical claim "No network request is made to fetch or update them"', () => {
    const html = read("docs/transparency.html");
    assert.ok(
      !html.includes("No network request is made to fetch or update them"),
      [
        'docs/transparency.html contains the stale claim "No network request is made to fetch or update them".',
        "This claim was removed in v1.9.10 because Remote Rules (opt-in) was introduced.",
        "Update the bullet to accurately reflect the opt-in network fetch.",
      ].join(" ")
    );
  });

});

// ---------------------------------------------------------------------------
// Inactive affiliate program guard — tos.html
// ---------------------------------------------------------------------------
describe("docs/tos.html — inactive affiliate program regression guards", () => {

  test('Section 3 does NOT disclose "Booking" (Booking.com has no active affiliate tag)', () => {
    const html = read("docs/tos.html");
    assert.ok(
      !html.includes("Booking"),
      [
        'docs/tos.html discloses "Booking" in the affiliate section,',
        "but Booking.com has no active ourTag in src/lib/affiliates.js (empty string, TODO).",
        "Remove it from the disclosure until a valid Partner ID is registered.",
      ].join(" ")
    );
  });

  test('Section 3 does NOT disclose "AliExpress" (removed from affiliates.js for privacy reasons)', () => {
    const html = read("docs/tos.html");
    assert.ok(
      !html.includes("AliExpress"),
      [
        'docs/tos.html discloses "AliExpress" in the affiliate section,',
        "but AliExpress was removed from src/lib/affiliates.js because its redirect-based",
        "tracking model is incompatible with MUGA's privacy policy. Remove it from the disclosure.",
      ].join(" ")
    );
  });

});
