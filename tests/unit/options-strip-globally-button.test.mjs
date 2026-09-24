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
 * Sliced delivery note (#1351 stacked-PR re-slice): this is slice B. The
 * popup still has its own "Strip locally" button at this point (slice C
 * retires it), so the popup-side `strip_locally_*` i18n keys are still
 * live here too — a temporary, deliberate duplication. The orphan-removal
 * guard for those keys is added in slice C, once they are actually
 * unreferenced.
 *
 * These structural tests pin:
 *   - the i18n keys exist (en + es non-empty)
 *   - options.js contains the marker class for the button so future
 *     refactors keep it discoverable
 *   - options.js writes userCustomRules through the shared, race-safe
 *     withSyncMutation + addUserCustomRule path
 *   - options.js surfaces the cap error instead of failing silently
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
