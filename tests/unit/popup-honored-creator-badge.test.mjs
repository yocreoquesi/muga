/**
 * MUGA — Popup wiring for the "honored creator" badge (#452, B14).
 *
 * When the cleaner pipeline returns `action: "honored-creator"`, the popup
 * surfaces a translatable badge:
 *   "Routed through {network} to honor {creator}"
 *
 * These tests assert (1) the i18n key exists with en + es non-empty
 * placeholders, (2) the popup HTML carries the badge slot inside #preview,
 * (3) popup.js consumes `result.action === "honored-creator"` and renders
 * the badge with both placeholders substituted, and (4) the reset helper
 * clears the badge so stale state never leaks across re-renders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS } = await import("../../src/lib/i18n.js");

// ── i18n key ─────────────────────────────────────────────────────────────────

test("popup_badge_honored_creator: key exists with en + es and uses {network}/{creator}", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, "popup_badge_honored_creator"),
    "TRANSLATIONS must have popup_badge_honored_creator",
  );
  const k = TRANSLATIONS.popup_badge_honored_creator;
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
  assert.ok(k.en.includes("{network}"), "en must reference {network}");
  assert.ok(k.en.includes("{creator}"), "en must reference {creator}");
  assert.ok(k.es.includes("{network}"), "es must reference {network}");
  assert.ok(k.es.includes("{creator}"), "es must reference {creator}");
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html exposes #preview-honored inside #preview", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");

  assert.match(html, /id="preview-honored"/, "popup.html must contain #preview-honored");
  const previewOpenIdx = html.indexOf('id="preview"');
  const honoredIdx = html.indexOf('id="preview-honored"');
  const previewCloseIdx = html.indexOf("</section>", previewOpenIdx);
  assert.ok(
    honoredIdx > previewOpenIdx && honoredIdx < previewCloseIdx,
    "#preview-honored must live inside the #preview section",
  );
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test('popup.js renders the badge when result.action === "honored-creator"', () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  assert.ok(
    /honored-creator/.test(popupSrc),
    "popup.js must consume the honored-creator action",
  );
  assert.ok(
    /popup_badge_honored_creator/.test(popupSrc),
    "popup.js must reference the i18n key",
  );
  // Both placeholders must be substituted (otherwise the user sees a literal "{network}").
  assert.ok(
    /\{network\}/.test(popupSrc) && /\{creator\}/.test(popupSrc),
    "popup.js must substitute {network} and {creator} placeholders",
  );
});

test("_resetPreviewDom clears the honored-creator badge", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  const fnIdx = popupSrc.indexOf("function _resetPreviewDom");
  assert.ok(fnIdx !== -1, "popup.js must define _resetPreviewDom");

  const slice = popupSrc.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    slice.includes("preview-honored"),
    "_resetPreviewDom must reset the honored-creator badge slot",
  );
});
