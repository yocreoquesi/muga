/**
 * Popup wiring for the "preserved creator referral" UI signal (#327).
 *
 * The wedge of MUGA — leaving third-party creator affiliate tags untouched —
 * is invisible without a UI cue. These tests assert the popup exposes the
 * surface, the i18n keys exist, and the reset helper clears the signal so
 * stale state never leaks across re-renders.
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

// ── i18n keys ────────────────────────────────────────────────────────────────

test("preview_preserved_creator: i18n key exists with en + es non-empty", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, "preview_preserved_creator"),
    "TRANSLATIONS must have preview_preserved_creator"
  );
  const k = TRANSLATIONS.preview_preserved_creator;
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("preview_preserved_creator_hint: i18n key explains the why", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, "preview_preserved_creator_hint"),
    "TRANSLATIONS must have preview_preserved_creator_hint"
  );
  const hint = TRANSLATIONS.preview_preserved_creator_hint;
  assert.ok(typeof hint.en === "string" && hint.en.length > 20, "hint must be a sentence, not a label");
  // The hint must mention 'creator' (or its localized equivalent) so future
  // refactors that drop the message do not silently strip the brand wedge.
  assert.match(
    hint.en.toLowerCase(),
    /creator|recommend/,
    "hint must reference the creator/recommendation concept"
  );
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html exposes #preview-preserved inside #preview, with the tag slot", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");

  assert.match(html, /id="preview-preserved"/, "popup.html must contain #preview-preserved");
  assert.match(html, /id="preview-preserved-tag"/, "popup.html must contain the tag slot");
  assert.match(
    html,
    /id="preview-preserved"[\s\S]*?data-i18n="preview_preserved_creator"/,
    "the preserved block must declare its i18n key"
  );

  const previewOpenIdx = html.indexOf('id="preview"');
  const preservedIdx = html.indexOf('id="preview-preserved"');
  const previewCloseIdx = html.indexOf("</section>", previewOpenIdx);
  assert.ok(
    preservedIdx > previewOpenIdx && preservedIdx < previewCloseIdx,
    "#preview-preserved must live inside the #preview section"
  );
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test("popup.js renders preservedAffiliate from the cleaner result", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  // Must read result.preservedAffiliate (not detectedAffiliate, not anything else)
  assert.ok(
    /result\.preservedAffiliate/.test(popupSrc),
    "popup.js must consume result.preservedAffiliate"
  );

  // Must populate the tag slot with both param and value (compact `param=value`)
  assert.ok(
    /preview-preserved-tag[\s\S]{0,400}preservedAffiliate\.param/.test(popupSrc) ||
      /preservedAffiliate\.param[\s\S]{0,400}preview-preserved-tag/.test(popupSrc),
    "popup.js must inject the preserved param into #preview-preserved-tag"
  );
});

test("_resetPreviewDom clears #preview-preserved so stale state never leaks", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  const fnIdx = popupSrc.indexOf("function _resetPreviewDom");
  assert.ok(fnIdx !== -1, "popup.js must define _resetPreviewDom");

  const slice = popupSrc.slice(fnIdx, fnIdx + 2500);
  assert.ok(
    slice.includes("preview-preserved"),
    "_resetPreviewDom must reset the preserved-creator block"
  );
  assert.ok(
    /preview-preserved-tag/.test(slice),
    "_resetPreviewDom must clear the tag slot textContent"
  );
});
