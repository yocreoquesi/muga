/**
 * MUGA: Cleaner-bundle ↔ source-of-truth sync invariants.
 *
 * Why this file exists: PRs #487/#488/#489/#490 each added new wrapper
 * entries to src/lib/wrapper-engine.js but no one re-ran
 * `npm run build:content`. The CI gate at .github/workflows/ci.yml:43-48
 * that runs the bundler and `git diff --exit-code` SHOULD have caught
 * each of those — it didn't, and the production bundle shipped awin-only
 * for ~6 PRs (fixed in #511 / PR #512). The CI investigation is tracked
 * in #513.
 *
 * These tests are a defense-in-depth: they re-establish the invariant
 * inside `npm test`, so an out-of-sync bundle is caught even when the
 * CI gate is misconfigured. If you see these fail after editing
 * wrapper-engine.js or affiliates.js, run:
 *
 *   npm run build:content
 *   git add src/content/cleaner-bundle.js
 *
 * and re-run the suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { WRAPPERS } from "../../src/lib/wrapper-engine.js";
import { TRACKING_PARAMS, AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, "..", "..", "src", "content", "cleaner-bundle.js");
const BUNDLE = readFileSync(BUNDLE_PATH, "utf8");

test("cleaner-bundle.js exposes detectWrapper, unwrap, WRAPPERS via __mugaCleaner", () => {
  assert.match(
    BUNDLE,
    /__mugaCleaner=Object\.freeze\(\{[^}]*detectWrapper:/,
    "bundle's __mugaCleaner namespace must expose detectWrapper",
  );
  assert.match(
    BUNDLE,
    /__mugaCleaner=Object\.freeze\(\{[^}]*unwrap:/,
    "bundle's __mugaCleaner namespace must expose unwrap",
  );
  assert.match(
    BUNDLE,
    /__mugaCleaner=Object\.freeze\(\{[^}]*WRAPPERS:/,
    "bundle's __mugaCleaner namespace must expose WRAPPERS",
  );
});

test("cleaner-bundle.js contains every wrapper id from wrapper-engine.js", () => {
  for (const wrapper of WRAPPERS) {
    assert.ok(
      BUNDLE.includes(`id:"${wrapper.id}"`),
      `bundle is missing wrapper id "${wrapper.id}" — run \`npm run build:content\``,
    );
  }
});

test("cleaner-bundle.js contains every wrapper string hostPattern from wrapper-engine.js", () => {
  // Skip RegExp host patterns — esbuild minifies them in ways that don't
  // round-trip via simple string includes (e.g. Impact's /^[a-z0-9-]+...$/).
  // The id check above already proves the entry survived bundling.
  for (const wrapper of WRAPPERS) {
    for (const host of wrapper.hostPatterns) {
      if (typeof host !== "string") continue;
      assert.ok(
        BUNDLE.includes(`"${host}"`),
        `bundle is missing host pattern "${host}" for wrapper "${wrapper.id}" — run \`npm run build:content\``,
      );
    }
  }
});

test("cleaner-bundle.js TRACKING_PARAMS array length matches source", () => {
  // Sanity: the bundled TRACKING_PARAMS array literal should contain
  // roughly the same number of entries as the source. Use a permissive
  // count check that matches the literal entries inside the bundle's
  // var-declaration, since esbuild may reorder/minify.
  const sourceCount = TRACKING_PARAMS.length;

  // Find the literal array — it's the longest sequence of "...","..." groups
  // in the bundle that contains "utm_source" (a stable anchor).
  const utmIdx = BUNDLE.indexOf('"utm_source"');
  assert.ok(utmIdx > -1, "bundle must contain utm_source — TRACKING_PARAMS not bundled?");

  // From utm_source, walk forward until we hit a closing bracket. Count
  // the comma-separated quoted strings.
  const tail = BUNDLE.slice(utmIdx);
  const closeIdx = tail.indexOf("]");
  assert.ok(closeIdx > -1, "bundle's TRACKING_PARAMS array literal not closed?");
  const arraySlice = tail.slice(0, closeIdx);
  // Match each "..." entry. ES strings inside are simple alphanum/_/-/. — no
  // escaped quotes to worry about.
  const matches = arraySlice.match(/"[a-zA-Z0-9_./-]+"/g) || [];
  // Allow a small tolerance for the bundled literal possibly differing
  // from the source by a couple of entries (e.g. esbuild dedup, future
  // multi-line literals). Off-by-many is the failure we care about.
  const tolerance = 5;
  assert.ok(
    Math.abs(matches.length - sourceCount) <= tolerance,
    `bundle has ~${matches.length} TRACKING_PARAMS entries; source has ${sourceCount}. Run \`npm run build:content\`.`,
  );
});

test("cleaner-bundle.js contains every AFFILIATE_PATTERNS id", () => {
  for (const pattern of AFFILIATE_PATTERNS) {
    assert.ok(
      BUNDLE.includes(`id:"${pattern.id}"`),
      `bundle is missing affiliate pattern id "${pattern.id}" — run \`npm run build:content\``,
    );
  }
});

// ---------------------------------------------------------------------------
// web-cleaner-tool (#1029, Phase 1): the web tool's adapter reads defaults
// and a version stamp straight off window.__mugaCleaner instead of hand-
// copying a literal that could silently drift from src/lib/prefs.js. These
// assertions guard that the bundle keeps exposing both keys.
// ---------------------------------------------------------------------------

test("cleaner-bundle.js exposes PREF_DEFAULTS via __mugaCleaner", () => {
  assert.match(
    BUNDLE,
    /__mugaCleaner=Object\.freeze\(\{[^}]*PREF_DEFAULTS:/,
    "bundle's __mugaCleaner namespace must expose PREF_DEFAULTS — run `npm run build:content`",
  );
});

test("cleaner-bundle.js exposes __version__ via __mugaCleaner", () => {
  assert.match(
    BUNDLE,
    /__mugaCleaner=Object\.freeze\(\{[^}]*__version__:/,
    "bundle's __mugaCleaner namespace must expose __version__ — run `npm run build:content`",
  );
});
