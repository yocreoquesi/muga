/**
 * MUGA — Structural guard for #1062 Slice 1 (popup length-reduction insight).
 *
 * popup.html/popup.js are browser-only (DOM/chrome.* access) so, mirroring
 * tests/unit/web-ui-source-guard.test.mjs's approach for the web tool, these
 * tests scan the committed source text directly instead of executing it
 * under node:test. Covers:
 *   - the "% shorter" line + green/red length bar markup exists and starts
 *     hidden;
 *   - popup.js imports and uses the pure length-reduction helpers, wires the
 *     bar widths, and never touches innerHTML for these slots;
 *   - _resetPreviewDom clears the new slots so re-renders stay idempotent;
 *   - every locale defines preview_shorter + the reworded preview_count_clean,
 *     and neither value contains an em-dash or "--" (repo copy-style rule).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const POPUP_HTML = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");
const POPUP_JS = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");
const POPUP_CSS = readFileSync(join(ROOT, "src/popup/popup.css"), "utf8");

describe("#1062 slice 1 — popup.html markup", () => {
  test("the % line and bar elements exist, inside #preview, after #preview-count", () => {
    assert.match(POPUP_HTML, /id="preview-shorter"/, "popup.html must contain #preview-shorter");
    assert.match(POPUP_HTML, /id="preview-length-bar"/, "popup.html must contain #preview-length-bar");
    assert.match(POPUP_HTML, /id="preview-length-kept"/, "popup.html must contain #preview-length-kept");
    assert.match(POPUP_HTML, /id="preview-length-removed"/, "popup.html must contain #preview-length-removed");

    const countIdx = POPUP_HTML.indexOf('id="preview-count"');
    const shorterIdx = POPUP_HTML.indexOf('id="preview-shorter"');
    const barIdx = POPUP_HTML.indexOf('id="preview-length-bar"');
    assert.ok(countIdx !== -1 && shorterIdx !== -1 && barIdx !== -1, "all three anchors must exist");
    assert.ok(shorterIdx > countIdx, "#preview-shorter must come after #preview-count in DOM order");
    assert.ok(barIdx > shorterIdx, "#preview-length-bar must come after #preview-shorter in DOM order");
  });

  test("#preview-shorter and #preview-length-bar start hidden", () => {
    const shorterTag = POPUP_HTML.match(/<p[^>]*id="preview-shorter"[^>]*>/);
    assert.ok(shorterTag, "#preview-shorter tag must exist");
    assert.match(shorterTag[0], /\bhidden\b/, "#preview-shorter must start hidden");

    const barTag = POPUP_HTML.match(/<div[^>]*id="preview-length-bar"[^>]*>/);
    assert.ok(barTag, "#preview-length-bar tag must exist");
    assert.match(barTag[0], /\bhidden\b/, "#preview-length-bar must start hidden");
  });

  test("the length track is decorative (aria-hidden) — the accessible name is carried by the adjacent #preview-shorter text", () => {
    const trackTag = POPUP_HTML.match(/<div[^>]*class="preview-length-track"[^>]*>/);
    assert.ok(trackTag, "the .preview-length-track element must exist");
    assert.match(trackTag[0], /role="img"/, "the track must carry role=\"img\"");
    assert.match(trackTag[0], /aria-hidden="true"/, "the track must be aria-hidden (mirrors web/index.html .length-bar-track)");
  });
});

describe("#1062 slice 1 — popup.css", () => {
  test("popup.css defines the bar rules using the popup's own diff-strip/diff-keep pair", () => {
    assert.match(POPUP_CSS, /\.preview-shorter\s*\{/, "popup.css must define .preview-shorter");
    assert.match(POPUP_CSS, /\.preview-length-track\s*\{/, "popup.css must define .preview-length-track");
    assert.match(POPUP_CSS, /\.preview-length-kept\s*\{/, "popup.css must define .preview-length-kept");
    assert.match(POPUP_CSS, /\.preview-length-removed\s*\{/, "popup.css must define .preview-length-removed");

    const keptBlock = POPUP_CSS.match(/\.preview-length-kept\s*\{[^}]*\}/);
    assert.ok(keptBlock, ".preview-length-kept rule must exist");
    assert.match(keptBlock[0], /var\(--diff-keep\)/, ".preview-length-kept must use var(--diff-keep) — popup.css has no --good");

    const removedBlock = POPUP_CSS.match(/\.preview-length-removed\s*\{[^}]*\}/);
    assert.ok(removedBlock, ".preview-length-removed rule must exist");
    assert.match(removedBlock[0], /var\(--diff-strip\)/, ".preview-length-removed must use var(--diff-strip) — popup.css has no --bad");
  });

  test("the track is a flex row, 8px tall, pill-radius, overflow hidden (mirrors web/index.html .length-bar-track)", () => {
    const trackBlock = POPUP_CSS.match(/\.preview-length-track\s*\{[^}]*\}/);
    assert.ok(trackBlock, ".preview-length-track rule must exist");
    assert.match(trackBlock[0], /display:\s*flex/, "track must be display: flex");
    assert.match(trackBlock[0], /height:\s*8px/, "track must be 8px tall");
    assert.match(trackBlock[0], /overflow:\s*hidden/, "track must clip overflow");
  });

  test("neither .preview-shorter nor .preview-length-bar sets `display` on the hidden-carrying node (would defeat the UA [hidden] rule)", () => {
    const shorterBlock = POPUP_CSS.match(/\.preview-shorter\s*\{[^}]*\}/);
    const barBlock = POPUP_CSS.match(/\.preview-length-bar\s*\{[^}]*\}/);
    assert.ok(shorterBlock, ".preview-shorter rule must exist");
    assert.ok(barBlock, ".preview-length-bar rule must exist");
    assert.ok(!/display\s*:/.test(shorterBlock[0]), ".preview-shorter must not set display (it carries the hidden attribute directly)");
    assert.ok(!/display\s*:/.test(barBlock[0]), ".preview-length-bar must not set display (it carries the hidden attribute directly)");
  });
});

describe("#1062 slice 1 — popup.js wiring", () => {
  test("popup.js imports computeLengthReduction and computeLengthBar from src/lib/length-reduction.js", () => {
    assert.match(
      POPUP_JS,
      /import\s*\{\s*computeLengthReduction\s*,\s*computeLengthBar\s*\}\s*from\s*["']\.\.\/lib\/length-reduction\.js["']/,
      "popup.js must import both pure helpers from ../lib/length-reduction.js",
    );
  });

  test("showUrlPreview computes the view-model and gates rendering on !isClean", () => {
    assert.match(POPUP_JS, /computeLengthReduction\(\s*url\s*,\s*result\.cleanUrl\s*\)/, "popup.js must call computeLengthReduction(url, result.cleanUrl)");
    assert.match(POPUP_JS, /computeLengthBar\(/, "popup.js must call computeLengthBar(...)");
    assert.match(POPUP_JS, /!\s*\w*[Ll]engthView\.isClean/, "popup.js must gate the bar/percent render on !isClean");
  });

  test("popup.js sets the bar segment widths and unhides both elements", () => {
    assert.match(POPUP_JS, /preview-length-kept["'][\s\S]{0,300}?\.style\.width\s*=/, "popup.js must set #preview-length-kept's width");
    assert.match(POPUP_JS, /preview-length-removed["'][\s\S]{0,300}?\.style\.width\s*=/, "popup.js must set #preview-length-removed's width");
    assert.match(POPUP_JS, /preview_shorter/, "popup.js must reference the preview_shorter i18n key");
    assert.match(POPUP_JS, /\{n\}/, "popup.js must replace the {n} placeholder in JS (t() has no interpolation)");
  });

  test("popup.js never uses innerHTML for the length-reduction slots", () => {
    const fnIdx = POPUP_JS.indexOf("async function showUrlPreview");
    assert.ok(fnIdx !== -1, "showUrlPreview must exist");
    const nextFnIdx = POPUP_JS.indexOf("\nfunction ", fnIdx + 10);
    const slice = POPUP_JS.slice(fnIdx, nextFnIdx === -1 ? fnIdx + 6000 : nextFnIdx);
    assert.ok(!/\binnerHTML\s*=/.test(slice), "showUrlPreview must not assign innerHTML anywhere, including the new length-reduction block");
  });

  test("_resetPreviewDom clears #preview-shorter, #preview-length-bar, and the inline bar widths", () => {
    const fnIdx = POPUP_JS.indexOf("function _resetPreviewDom");
    assert.ok(fnIdx !== -1, "_resetPreviewDom must exist");
    const slice = POPUP_JS.slice(fnIdx, fnIdx + 3000);
    assert.ok(slice.includes("preview-shorter"), "_resetPreviewDom must reset #preview-shorter");
    assert.ok(slice.includes("preview-length-bar"), "_resetPreviewDom must reset #preview-length-bar");
    assert.ok(slice.includes("preview-length-kept"), "_resetPreviewDom must clear #preview-length-kept's inline width");
    assert.ok(slice.includes("preview-length-removed"), "_resetPreviewDom must clear #preview-length-removed's inline width");
  });
});

describe("#1062 slice 1 — i18n", () => {
  test("preview_shorter exists with a {n} placeholder in every supported locale", () => {
    const entry = TRANSLATIONS.preview_shorter;
    assert.ok(entry, "TRANSLATIONS.preview_shorter must exist");
    for (const { code } of SUPPORTED_LANGS) {
      const value = entry[code];
      assert.ok(typeof value === "string" && value.length > 0, `preview_shorter is missing a non-empty "${code}" value`);
      assert.ok(value.includes("{n}"), `preview_shorter "${code}" must contain the {n} placeholder`);
    }
  });

  test("preview_count_clean carries the reworded positive, URL-cleaner-DNA copy in every locale", () => {
    const entry = TRANSLATIONS.preview_count_clean;
    assert.ok(entry, "TRANSLATIONS.preview_count_clean must exist");
    for (const { code } of SUPPORTED_LANGS) {
      const value = entry[code];
      assert.ok(typeof value === "string" && value.length > 0, `preview_count_clean is missing a non-empty "${code}" value`);
    }
    // en/es are pinned to the exact spec copy so a future edit can't drift
    // silently away from the agreed wording.
    assert.equal(entry.en, "This page is clean. MUGA cleans links automatically as you browse.");
    assert.equal(entry.es, "Esta página está limpia. MUGA limpia los enlaces automáticamente mientras navegas.");
  });

  test("preview_shorter and preview_count_clean never contain an em-dash or double-hyphen dash in any locale", () => {
    for (const key of ["preview_shorter", "preview_count_clean"]) {
      const entry = TRANSLATIONS[key];
      for (const { code } of SUPPORTED_LANGS) {
        const value = entry[code];
        assert.ok(!value.includes("—"), `${key} "${code}" must not contain an em-dash (—)`);
        assert.ok(!value.includes("--"), `${key} "${code}" must not contain "--"`);
      }
    }
  });
});
