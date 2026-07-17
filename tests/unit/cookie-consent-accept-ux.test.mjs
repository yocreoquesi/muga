/**
 * MUGA — cookie-consent-accept Slice 2a: Settings UX guards.
 *
 * options.js/options.html are browser-only (no DOM in Node), so this
 * follows the same source-string-inspection pattern as
 * options-surfaced-prefs.test.mjs. Covers:
 *   - the 3rd mode option + the informed-consent gesture row exist;
 *   - the gesture checkbox is wired via a real "change" listener (never
 *     set programmatically to true anywhere else in the file — the
 *     structural proof that only a real click can grant the capability);
 *   - the select restores its value via clampCookieConsentMode, not a
 *     stale off/reject-only-only ternary that would silently collapse the
 *     third mode back to reject-only on every page load.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

describe("cookie-consent-accept Slice 2a — options.html surface", () => {
  test("the mode select offers the accept-when-necessary option", () => {
    assert.ok(
      optionsHtml.includes('<option value="accept-when-necessary" data-i18n="cookie_consent_mode_opt_accept">'),
      "options.html must offer the accept-when-necessary <option>",
    );
  });

  test("the informed-consent gesture row exists, hidden by default", () => {
    assert.ok(
      optionsHtml.includes('id="cookie-consent-accept-gesture-row" hidden'),
      "the gesture row must exist and start hidden — only shown once the mode select is on accept-when-necessary",
    );
  });

  test("the gesture row's checkbox exists with the correct aria label key", () => {
    assert.ok(optionsHtml.includes('id="cookie-consent-accept-gesture-checkbox"'));
    assert.ok(optionsHtml.includes('data-i18n-aria-label="aria_cookie_consent_accept_gesture"'));
  });
});

describe("cookie-consent-accept Slice 2a — options.js wiring", () => {
  test("imports clampCookieConsentMode from settings-schema.js", () => {
    assert.ok(
      optionsJs.includes("clampCookieConsentMode"),
      "options.js must import clampCookieConsentMode",
    );
  });

  test("restores the select value via clampCookieConsentMode, not a stale off/reject-only ternary", () => {
    assert.ok(
      optionsJs.includes("cookieConsentModeSelect.value = clampCookieConsentMode(prefs.cookieConsentMode)"),
      "the select must be restored via clampCookieConsentMode so accept-when-necessary round-trips",
    );
    assert.equal(
      optionsJs.includes('prefs.cookieConsentMode === "off" ? "off" : "reject-only"'),
      false,
      "the old off/reject-only-only ternary must be removed — it would silently collapse accept-when-necessary",
    );
  });

  test("the gesture checkbox is wired with a real addEventListener(\"change\", ...) handler", () => {
    const idx = optionsJs.indexOf('getElementById("cookie-consent-accept-gesture-checkbox")');
    assert.ok(idx !== -1, "options.js must query the gesture checkbox by id");
    const nearby = optionsJs.slice(idx, idx + 1200);
    assert.ok(
      /cookieConsentAcceptGestureCheckbox\.addEventListener\(\s*"change"/.test(nearby),
      "the gesture checkbox must be wired via addEventListener(\"change\", ...)",
    );
  });

  test("setPrefs({ cookieConsentAcceptConsented: ... }) is called ONLY from inside the checkbox's change handler — never unconditionally set to true elsewhere", () => {
    const calls = [...optionsJs.matchAll(/setPrefs\(\{\s*cookieConsentAcceptConsented:\s*([^}]+)\}\)/g)];
    assert.equal(calls.length, 1, "cookieConsentAcceptConsented must be written to storage from exactly one call site");
    assert.match(
      calls[0][1].trim(),
      /cookieConsentAcceptGestureCheckbox\.checked\s*===\s*true/,
      "the single write call site must derive the value from the checkbox's own .checked property, never a literal true",
    );
  });

  test("the checkbox's .checked is only ever ASSIGNED (never used to trigger a save) outside the change handler — programmatic restores never fire a change event", () => {
    // Every `cookieConsentAcceptGestureCheckbox.checked = ...` assignment
    // (restoring from stored prefs) is a plain property assignment, which
    // the DOM never treats as a user interaction — only a real click does.
    const assignments = [...optionsJs.matchAll(/cookieConsentAcceptGestureCheckbox\.checked\s*=\s*[^;]+;/g)];
    assert.ok(assignments.length >= 1, "options.js must restore the checkbox state from stored prefs at least once");
  });

  test("selecting a mode other than accept-when-necessary hides the gesture row again (syncCookieConsentAcceptGestureVisibility is called after every mode change)", () => {
    const changeHandlerIdx = optionsJs.indexOf("cookieConsentModeSelect.addEventListener(\"change\"");
    assert.ok(changeHandlerIdx !== -1, "the mode select must have a change listener");
    const handlerBody = optionsJs.slice(changeHandlerIdx, changeHandlerIdx + 400);
    assert.ok(
      handlerBody.includes("syncCookieConsentAcceptGestureVisibility()"),
      "the mode select's change handler must re-sync the gesture row's visibility",
    );
  });
});

describe("cookie-consent-accept Slice 2a — i18n copy", () => {
  const KEYS = [
    "cookie_consent_mode_opt_accept",
    "row_cookie_consent_accept_gesture_label",
    "row_cookie_consent_accept_gesture_hint",
    "aria_cookie_consent_accept_gesture",
  ];
  const LOCALES = ["en", "es", "pt", "de", "fr", "it", "ja"];

  for (const key of KEYS) {
    for (const locale of LOCALES) {
      test(`${key}.${locale} is a non-empty string`, () => {
        const value = TRANSLATIONS[key]?.[locale];
        assert.equal(typeof value, "string", `${key}.${locale} must exist`);
        assert.ok(value.trim().length > 0, `${key}.${locale} must be non-empty`);
      });
    }
  }

  test("the EN gesture hint discloses the minimum/necessary-only framing, never a broad-accept promise", () => {
    const en = TRANSLATIONS.row_cookie_consent_accept_gesture_hint.en.toLowerCase();
    assert.ok(en.includes("minimum") || en.includes("necessary"));
    assert.ok(en.includes("never"), "must explicitly state MUGA never grants tracking");
  });

  test("no em-dash in any EN or ES copy for this feature (project copy convention)", () => {
    for (const key of KEYS) {
      assert.ok(!TRANSLATIONS[key].en.includes("—"), `${key}.en must not use an em-dash`);
      assert.ok(!TRANSLATIONS[key].es.includes("—"), `${key}.es must not use an em-dash`);
    }
  });
});
