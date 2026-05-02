/**
 * MUGA — Popup wiring for the "Suspicious params" section (#446, B16).
 *
 * The section surfaces TWO classes of suspicious URL params to the user
 * in a single, scannable block:
 *
 *   1. Entropy heuristic flags (B15, #436) — values that look like opaque
 *      tracking IDs by their shape alone.
 *   2. Cross-site frequency flags (B16, #446) — params that have been
 *      observed against 3+ first-party domains AND 3+ distinct values
 *      (local-only correlation tracker).
 *
 * Both classes are INFORMATIONAL — they do NOT trigger auto-stripping,
 * because auto-stripping unknown params is exactly what breaks creator
 * referrals (#160).
 *
 * These tests pin down:
 *   - the i18n keys exist with EN + ES values
 *   - the popup HTML exposes the section, hidden-by-default
 *   - the popup JS imports the cross-site-frequency module and wires it
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

test("suspicious_params_label: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.suspicious_params_label;
  assert.ok(k, "suspicious_params_label must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("suspicious_params_entropy_group: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.suspicious_params_entropy_group;
  assert.ok(k, "suspicious_params_entropy_group must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("suspicious_params_frequency_group: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.suspicious_params_frequency_group;
  assert.ok(k, "suspicious_params_frequency_group must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html exposes #suspicious-params section, hidden by default", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="suspicious-params"/, "popup.html must contain #suspicious-params");
  assert.match(
    html,
    /id="suspicious-params"[^>]*hidden/,
    "#suspicious-params must start hidden so empty installs don't show a chrome-less header"
  );
});

test("popup.html declares a list container inside the suspicious-params section", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(
    html,
    /id="suspicious-params-list"/,
    "popup.html must contain #suspicious-params-list (the row container)"
  );
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test("popup.js imports the cross-site-frequency module and the entropy heuristic", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /from\s+"\.\.\/lib\/cross-site-frequency\.js"/.test(popupSrc),
    "popup.js must import from cross-site-frequency.js"
  );
  assert.ok(
    /from\s+"\.\.\/lib\/entropy-heuristic\.js"/.test(popupSrc),
    "popup.js must import from entropy-heuristic.js (B15 surfaced via B16)"
  );
});

test("popup.js declares a renderer for the suspicious-params section", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /function\s+showSuspiciousParams|function\s+_renderSuspiciousParams/.test(popupSrc),
    "popup.js must declare a showSuspiciousParams or _renderSuspiciousParams helper"
  );
});

test("popup.js gates the section on the crossSiteFrequencyEnabled pref for the freq subgroup", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  // The pref toggle must be referenced by name somewhere in popup.js so a
  // user who disables the local frequency tracker sees the entropy-only
  // view. Accepts either a guard or a destructure.
  assert.ok(
    /crossSiteFrequencyEnabled/.test(popupSrc),
    "popup.js must reference crossSiteFrequencyEnabled to gate the frequency subgroup"
  );
});
