/**
 * MUGA: structural guard for the popup length-reduction insight wiring (#1062).
 *
 * popup.js and popup.html cannot be imported under node:test (browser-only DOM),
 * so this readFileSync guard verifies the renderer stays wired to the pure
 * length-reduction module and that every DOM slot popup.js drives actually
 * exists in popup.html (a missing id would silently no-op the feature).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const popupJs = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");
const popupHtml = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");

const SLOT_IDS = ["preview-shorter", "preview-length-bar", "preview-length-kept", "preview-length-removed", "preview-unwrap"];

test("popup.js imports the pure length-reduction module", () => {
  assert.match(popupJs, /from "\.\.\/lib\/length-reduction\.js"/);
  assert.match(popupJs, /computeLengthReduction/);
  assert.match(popupJs, /computeLengthBar/);
});

test("popup.html declares every length-bar slot popup.js drives", () => {
  for (const id of SLOT_IDS) {
    assert.ok(popupHtml.includes(`id="${id}"`), `popup.html is missing #${id}`);
  }
});

test("popup.js references every length-bar slot it resets and renders", () => {
  for (const id of SLOT_IDS) {
    assert.ok(popupJs.includes(id), `popup.js never references #${id}`);
  }
});

test("popup.js renders the length line via the interpolated preview_shorter key", () => {
  assert.match(popupJs, /preview_shorter/);
  assert.match(popupJs, /\{n\}/);
});
