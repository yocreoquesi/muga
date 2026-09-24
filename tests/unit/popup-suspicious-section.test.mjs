/**
 * MUGA — Popup wiring for the "Suspicious params" section (#446, B16).
 *
 * #1351 (2026-09-24 maintainer decision, ADR-0011 Decision 1/3) narrowed
 * this section to the ENTROPY heuristic flags ONLY (B15, #436) — values on
 * the CURRENT page's URL that look like opaque tracking IDs by shape alone.
 * The cross-site FREQUENCY subgroup (B16, #446) and every action that
 * writes `prefs.userCustomRules` moved to Settings' Activity section (see
 * tests/unit/settings-activity-suspicious-params.test.mjs); the popup keeps
 * the entropy subgroup specifically because it depends on the CURRENT tab's
 * URL, something Settings — opened in its own tab — has no way to reproduce.
 *
 * READ-ONLY: no button here promotes a param to a permanent strip rule or
 * opens a report. This just surfaces the signal.
 *
 * These tests pin down:
 *   - the i18n keys exist with EN + ES values
 *   - the popup HTML exposes the section, hidden-by-default
 *   - the popup JS renders it read-only, entropy-only
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

test("entropy_score_label: i18n key exists with en + es and {score} placeholder", () => {
  const k = TRANSLATIONS.entropy_score_label;
  assert.ok(k, "entropy_score_label must exist");
  for (const lang of ["en", "es"]) {
    assert.ok(typeof k[lang] === "string" && k[lang].includes("{score}"), `${lang} must carry {score}`);
  }
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

test("popup.html no longer hosts a strip-locally counter (retired with the moved action, #1351)", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.doesNotMatch(html, /id="strip-locally-count"/);
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test("popup.js imports the entropy heuristic", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /from\s+"\.\.\/lib\/entropy-heuristic\.js"/.test(popupSrc),
    "popup.js must import from entropy-heuristic.js (B15)"
  );
});

test("popup.js no longer imports the cross-site-frequency module (#1351: moved to options.js)", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    !/from\s+"\.\.\/lib\/cross-site-frequency\.js"/.test(popupSrc),
    "popup.js must not import cross-site-frequency.js anymore"
  );
});

test("popup.js declares a renderer for the suspicious-params section, entropy-only signature", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /async function\s+showSuspiciousParams\s*\(lang\)/.test(popupSrc),
    "popup.js must declare showSuspiciousParams(lang) — no prefs param needed once read-only"
  );
});

test("popup.js's suspicious-params section renders no strip/report action (#1351)", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  const start = popupSrc.indexOf("async function showSuspiciousParams(lang)");
  assert.ok(start !== -1);
  const end = popupSrc.indexOf("\n}", start);
  const body = popupSrc.slice(start, end);
  assert.doesNotMatch(body, /userCustomRules/);
  assert.doesNotMatch(body, /strip-locally-btn|strip-globally-btn/);
  assert.doesNotMatch(body, /report-upstream-btn/);
});
