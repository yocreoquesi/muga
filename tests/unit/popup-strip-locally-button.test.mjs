/**
 * MUGA — Popup "Strip locally" button per Suspicious-params row (#536).
 *
 * The button promotes a flagged param into prefs.userCustomRules
 * (chrome.storage.sync). The cleaner consults that array on every
 * subsequent navigation, so the user gets immediate, persistent strip
 * behaviour without waiting for a release.
 *
 * These structural tests pin:
 *   - the i18n keys exist (en + es non-empty)
 *   - the popup JS contains the marker class for the button so future
 *     refactors keep it discoverable
 *   - the popup JS references chrome.storage.sync.{get,set} for
 *     userCustomRules in the click-handler path
 *   - the renderer references the userCustomRules pref by name
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

test("strip_locally_btn: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.strip_locally_btn;
  assert.ok(k, "strip_locally_btn must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("strip_locally_btn_done: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.strip_locally_btn_done;
  assert.ok(k, "strip_locally_btn_done must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("strip_locally_active_count: i18n key exists with en + es and {n} placeholder", () => {
  const k = TRANSLATIONS.strip_locally_active_count;
  assert.ok(k, "strip_locally_active_count must exist");
  assert.ok(typeof k.en === "string" && k.en.includes("{n}"), "en must carry {n}");
  assert.ok(typeof k.es === "string" && k.es.includes("{n}"), "es must carry {n}");
});

// ── JS surface ───────────────────────────────────────────────────────────────

test("popup.js declares a 'strip-locally-btn' class for the per-row button", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /strip-locally-btn/.test(popupSrc),
    "popup.js must reference the strip-locally-btn class so the button is discoverable",
  );
});

test("popup.js click-handler reads + writes userCustomRules via chrome.storage.sync", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  // Both a read and a write of userCustomRules must appear; the read
  // can be via getPrefs() / chrome.storage.sync.get, the write must be
  // chrome.storage.sync.set (or setPrefs) so the rule survives reloads.
  assert.ok(
    /userCustomRules/.test(popupSrc),
    "popup.js must reference the userCustomRules pref by name",
  );
  assert.ok(
    /chrome\.storage\.sync\.set\(\s*\{\s*userCustomRules/.test(popupSrc) ||
      /setPrefs\(\s*\{\s*userCustomRules/.test(popupSrc),
    "popup.js must persist userCustomRules to chrome.storage.sync (set or setPrefs)",
  );
});

test("popup.js renders the active custom-rules counter via the i18n template", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /strip_locally_active_count/.test(popupSrc),
    "popup.js must reference the strip_locally_active_count i18n key for the counter",
  );
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html still exposes the suspicious-params section host (regression guard)", () => {
  // The Strip locally button lives INSIDE rows that the JS injects, so
  // there is no direct HTML token to assert beyond the existing host
  // section. This test exists so a future refactor that drops the
  // section also fails this slice's surface check, not just B16's.
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="suspicious-params-list"/);
});
