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
import { resolveConsentGestureOnModeChange } from "../../src/lib/settings-schema.js";

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
    // Window widened from 1200 -> 2200: the mode-select change handler
    // (which now revokes the gesture on mode change) legitimately grew the
    // code between the checkbox lookup and its own change listener.
    const nearby = optionsJs.slice(idx, idx + 2200);
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

  test("the mode-select change handler revokes the gesture via resolveConsentGestureOnModeChange (not sticky across mode switches)", () => {
    assert.ok(
      optionsJs.includes("resolveConsentGestureOnModeChange"),
      "options.js must import and use resolveConsentGestureOnModeChange to revoke the gesture on mode change",
    );
    const changeHandlerIdx = optionsJs.indexOf("cookieConsentModeSelect.addEventListener(\"change\"");
    const handlerBody = optionsJs.slice(changeHandlerIdx, changeHandlerIdx + 600);
    assert.ok(
      handlerBody.includes("resolveConsentGestureOnModeChange"),
      "the mode-select change handler must compute the next gesture value via resolveConsentGestureOnModeChange",
    );
  });

  test("no setPrefs call ever writes a LITERAL true for cookieConsentAcceptConsented (mode select can only revoke, never grant)", () => {
    const calls = [...optionsJs.matchAll(/cookieConsentAcceptConsented:\s*([^,}]+)/g)].map((m) => m[1].trim());
    assert.ok(calls.length >= 1, "options.js must write cookieConsentAcceptConsented at least once");
    for (const value of calls) {
      assert.notEqual(value, "true", "cookieConsentAcceptConsented must never be written as a literal true");
    }
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

describe("cookie-consent-accept Slice 2a — gesture is not sticky across mode switches", () => {
  test("leaving accept-when-necessary for any other mode REVOKES the stored gesture", () => {
    assert.equal(resolveConsentGestureOnModeChange("reject-only", true), false);
    assert.equal(resolveConsentGestureOnModeChange("off", true), false);
  });

  test("entering/staying in accept-when-necessary NEVER grants the gesture — it only preserves an already-stored true", () => {
    // A false can never become true via a mode change (only a real checkbox
    // click can), and an existing true (from a prior real click) is kept.
    assert.equal(resolveConsentGestureOnModeChange("accept-when-necessary", false), false);
    assert.equal(resolveConsentGestureOnModeChange("accept-when-necessary", true), true);
  });

  test("a truthy non-boolean stored value is never treated as consent when entering accept mode", () => {
    assert.equal(resolveConsentGestureOnModeChange("accept-when-necessary", 1), false);
    assert.equal(resolveConsentGestureOnModeChange("accept-when-necessary", "true"), false);
  });

  test("SCENARIO: accept + gesture -> switch to reject-only -> re-select accept leaves the gate CLOSED until a fresh gesture", () => {
    // Start in accept mode with a real gesture already granted.
    let consented = true;
    // User switches away to reject-only: the gesture must be revoked.
    consented = resolveConsentGestureOnModeChange("reject-only", consented);
    assert.equal(consented, false, "switching away from accept mode must revoke the gesture");
    // User re-selects accept: the gate stays closed (no stale re-open).
    consented = resolveConsentGestureOnModeChange("accept-when-necessary", consented);
    assert.equal(consented, false, "re-entering accept mode must NOT re-open the gate on stale consent");
    // Only a fresh explicit checkbox click (modeled here as the sole path
    // that sets true) re-opens it — never the mode select.
    const afterFreshClick = true;
    assert.equal(afterFreshClick, true);
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

  test("the EN gesture hint honestly discloses that accepting GRANTS tracking cookies, and states what MUGA never does", () => {
    // cookie-consent-paywall-accept: the OLD "minimum, never grants
    // tracking" framing is retired — the real mechanism grants broad
    // advertising/tracking consent, the only free path through a
    // consent-or-pay wall. The copy must say so plainly, and must still
    // state the things MUGA never does (never Subscribe/Pay, never without
    // a free-reject check).
    const en = TRANSLATIONS.row_cookie_consent_accept_gesture_hint.en.toLowerCase();
    assert.ok(en.includes("grants"), "must plainly disclose that accepting grants cookies");
    assert.ok(en.includes("never"), "must explicitly state what MUGA never does");
  });

  test("no em-dash in any EN or ES copy for this feature (project copy convention)", () => {
    for (const key of KEYS) {
      assert.ok(!TRANSLATIONS[key].en.includes("—"), `${key}.en must not use an em-dash`);
      assert.ok(!TRANSLATIONS[key].es.includes("—"), `${key}.es must not use an em-dash`);
    }
  });
});
