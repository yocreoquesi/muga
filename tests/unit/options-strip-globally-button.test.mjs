/**
 * MUGA — Settings "Strip everywhere" button per Activity suspicious-params
 * row (#1351, relocated from the popup's "Strip locally" button, #536).
 *
 * The button promotes a flagged param into prefs.userCustomRules
 * (chrome.storage.sync). The cleaner consults that array on every
 * subsequent navigation, so the user gets immediate, persistent strip
 * behaviour without waiting for a release.
 *
 * 2026-09-24 maintainer decision on #1351: this action writes a GLOBAL
 * rule (every host), so it moved out of the popup's two-second surface
 * into Settings, next to the "Your locally-stripped params" receipt list.
 * The button is renamed "Strip everywhere" (was "Strip locally" in the
 * popup) — the old label undersold the fact that the rule applies on every
 * site, which is exactly the scope clarity #1351 asks for.
 *
 * These structural tests pin:
 *   - the i18n keys exist (en + es non-empty)
 *   - options.js contains the marker class for the button so future
 *     refactors keep it discoverable
 *   - options.js writes userCustomRules through the shared, race-safe
 *     withSyncMutation + addUserCustomRule path
 *   - options.js surfaces the cap error instead of failing silently
 *   - the retired popup-side keys/classes are gone (no orphans)
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

test("strip_globally_btn: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.strip_globally_btn;
  assert.ok(k, "strip_globally_btn must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("strip_globally_btn_done: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.strip_globally_btn_done;
  assert.ok(k, "strip_globally_btn_done must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("suspicious_params_settings_hint: i18n key exists with en + es non-empty (scope clarity, #1351)", () => {
  const k = TRANSLATIONS.suspicious_params_settings_hint;
  assert.ok(k, "suspicious_params_settings_hint must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("suspicious_params_settings_empty: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.suspicious_params_settings_empty;
  assert.ok(k, "suspicious_params_settings_empty must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("the retired strip_locally_* keys no longer exist (superseded by strip_globally_*, #1351)", () => {
  for (const key of ["strip_locally_btn", "strip_locally_btn_done", "strip_locally_active_count", "strip_locally_manage"]) {
    assert.ok(!TRANSLATIONS[key], `${key} must be removed — it is unreferenced since the action moved to Settings`);
  }
});

// ── JS surface ───────────────────────────────────────────────────────────────

test("options.js declares a 'strip-globally-btn' class for the per-row button", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.ok(
    /strip-globally-btn/.test(optionsSrc),
    "options.js must reference the strip-globally-btn class so the button is discoverable",
  );
});

test("options.js writes userCustomRules via the shared withSyncMutation path (not a raw chrome.storage.sync call)", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.ok(
    /withSyncMutation\(withListLock,\s*"userCustomRules"/.test(optionsSrc),
    "options.js must persist userCustomRules through withSyncMutation, sharing the lock addEntry/removeEntry use",
  );
});

test("options.js routes the Strip-everywhere add through the capped addUserCustomRule helper", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.ok(
    /import\s*\{\s*addUserCustomRule\s*\}\s*from\s*"\.\.\/lib\/user-custom-rules\.js"/.test(optionsSrc),
    "options.js must import the shared, cap-enforcing addUserCustomRule helper",
  );
  assert.ok(
    /addUserCustomRule\(\s*list\s*,\s*paramName\s*\)/.test(optionsSrc),
    "the Strip-everywhere click-handler must call addUserCustomRule(list, paramName) instead of pushing directly",
  );
});

test("options.js surfaces the cap error to the user instead of failing silently", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.ok(
    /error\s*===\s*"max"/.test(optionsSrc),
    "options.js must branch on the 'max' error from addUserCustomRule",
  );
});

// ── #1351 R3-strip-silent-noop ──────────────────────────────────────────────
//
// Review findings: the click-handler returned silently on duplicate/aborted/
// non-max outcomes, never disabled the button while the write was in
// flight, and the button's initial state came from a render-time isPromoted
// snapshot that can be stale by click time.

test("strip_globally_error: i18n key exists with en + es non-empty (visible failure feedback, #1351 R3)", () => {
  const k = TRANSLATIONS.strip_globally_error;
  assert.ok(k, "strip_globally_error must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

function getStripHandlerBody() {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  const fnStart = optionsSrc.indexOf("function buildStripGloballyButton(");
  assert.ok(fnStart !== -1, "buildStripGloballyButton must exist");
  const clickStart = optionsSrc.indexOf('btn.addEventListener("click"', fnStart);
  assert.ok(clickStart !== -1, "the button must have a click handler");
  // Bracket-depth scan from the handler's opening brace to its matching close.
  let depth = 0;
  let i = optionsSrc.indexOf("{", clickStart);
  const bodyStart = i;
  for (; i < optionsSrc.length; i++) {
    if (optionsSrc[i] === "{") depth++;
    else if (optionsSrc[i] === "}") { depth--; if (depth === 0) break; }
  }
  return optionsSrc.slice(bodyStart, i + 1);
}

test("disables the button before attempting the write, so a double-click can't fire twice", () => {
  const body = getStripHandlerBody();
  const disableIdx = body.indexOf("btn.disabled = true");
  const mutationIdx = body.indexOf("withSyncMutation(");
  assert.ok(disableIdx !== -1, "must set btn.disabled = true somewhere");
  assert.ok(mutationIdx !== -1, "must call withSyncMutation");
  assert.ok(disableIdx < mutationIdx, "btn.disabled = true must happen BEFORE the write starts");
});

test("handles a 'duplicate' outcome by flipping to the done state instead of a silent no-op", () => {
  const body = getStripHandlerBody();
  assert.match(body, /error\s*===\s*"duplicate"/, "must explicitly branch on the 'duplicate' error");
  const dupIdx = body.indexOf('error === "duplicate"');
  const afterDup = body.slice(dupIdx, dupIdx + 400);
  assert.match(afterDup, /t\("strip_globally_btn_done",\s*_currentLang\)/, "the duplicate branch must render the done-state copy, not stay silent");
});

test("re-enables the button and shows strip_globally_error on a genuine failure (neither duplicate nor max)", () => {
  const body = getStripHandlerBody();
  assert.match(body, /t\("strip_globally_error",\s*_currentLang\)/, "a genuine failure must surface strip_globally_error");
  const errorIdx = body.indexOf('t("strip_globally_error"');
  assert.ok(errorIdx !== -1);
  const around = body.slice(Math.max(0, errorIdx - 200), errorIdx + 200);
  assert.match(around, /btn\.disabled\s*=\s*false/, "a failure must re-enable the button so the user can retry");
});

test("wraps the write in try/catch so an unexpected throw still re-enables the button and reports failure", () => {
  const body = getStripHandlerBody();
  assert.match(body, /catch\s*\(err\)\s*\{/, "the click handler must catch unexpected errors");
  const catchIdx = body.search(/catch\s*\(err\)\s*\{/);
  const catchBody = body.slice(catchIdx, catchIdx + 300);
  assert.match(catchBody, /strip_globally_error/);
  assert.match(catchBody, /btn\.disabled\s*=\s*false/);
});

test("options.js keeps the ungated receipt list (#user-custom-rules-items) in sync after a successful strip", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  const start = optionsSrc.indexOf("function buildStripGloballyButton(");
  assert.ok(start !== -1);
  const end = optionsSrc.indexOf("\nfunction ", start + 1);
  const body = optionsSrc.slice(start, end === -1 ? undefined : end);
  assert.match(body, /renderList\("user-custom-rules-items",\s*next,\s*"userCustomRules"\)/);
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("options.html exposes the suspicious-params Activity panel host (regression guard)", () => {
  const html = readFileSync(resolve(root, "src/options/options.html"), "utf8");
  assert.match(html, /id="suspicious-params-settings-list"/);
});
