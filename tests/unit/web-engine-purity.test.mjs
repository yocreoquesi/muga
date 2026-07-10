/**
 * MUGA: Web-cleaner-tool engine boundary — purity guard (#1029, Phase 1).
 *
 * The standalone web/ tool (later phases) vendors a byte-identical copy of
 * this bundle and loads it directly as a `<script>` in a page with no
 * WebExtension APIs available. If the bundle ever references `chrome.`,
 * `browser.`, `fetch(`, or `XMLHttpRequest` it will throw at load time on
 * that page.
 *
 * ADR-4 (design): PREF_DEFAULTS is imported from src/lib/prefs.js and
 * exposed on window.__mugaCleaner so the web tool builds its pure-cleaner
 * prefs from the REAL defaults instead of a hand-copied literal that could
 * drift. prefs.js's only chrome-touchers (getPrefs/setPrefs) are never
 * called at module load, so esbuild tree-shakes them away when only the
 * named PREF_DEFAULTS export is used. This test is the guard for that
 * tree-shaking assumption — see ADR-4's fallback (extract PREF_DEFAULTS
 * into a zero-import leaf module) if it ever goes red.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { engine } from "./helpers/load-web-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, "..", "..", "src", "content", "cleaner-bundle.js");
const BUNDLE = readFileSync(BUNDLE_PATH, "utf8");

test("cleaner-bundle.js contains no chrome. reference", () => {
  assert.equal(
    BUNDLE.includes("chrome."),
    false,
    "bundle must not reference chrome. — a WebExtension API leaked into the pure engine",
  );
});

test("cleaner-bundle.js contains no browser. reference", () => {
  assert.equal(
    BUNDLE.includes("browser."),
    false,
    "bundle must not reference browser. — a WebExtension API leaked into the pure engine",
  );
});

test("cleaner-bundle.js contains no fetch( call", () => {
  assert.equal(
    BUNDLE.includes("fetch("),
    false,
    "bundle must not call fetch( — the pure engine must never issue network requests",
  );
});

test("cleaner-bundle.js contains no XMLHttpRequest reference", () => {
  assert.equal(
    BUNDLE.includes("XMLHttpRequest"),
    false,
    "bundle must not reference XMLHttpRequest — the pure engine must never issue network requests",
  );
});

test("loading the bundle under a window shim attaches window.__mugaCleaner", () => {
  assert.equal(typeof engine, "object", "window.__mugaCleaner must be attached after loading the bundle");
  assert.notEqual(engine, null);
});

test("window.__mugaCleaner exposes processUrl as a function", () => {
  assert.equal(typeof engine.processUrl, "function");
});

test("window.__mugaCleaner exposes PREF_DEFAULTS as an object with key 'enabled'", () => {
  assert.equal(typeof engine.PREF_DEFAULTS, "object");
  assert.notEqual(engine.PREF_DEFAULTS, null);
  assert.ok("enabled" in engine.PREF_DEFAULTS, "PREF_DEFAULTS must have key 'enabled'");
});

test("window.__mugaCleaner exposes __version__ as a non-empty string", () => {
  assert.equal(typeof engine.__version__, "string");
  assert.ok(engine.__version__.length > 0, "__version__ must not be empty");
});
