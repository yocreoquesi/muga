/**
 * MUGA — Regression tests for the #930 onboarding consent-gate checkbox
 * aria-label i18n cleanup.
 *
 * Mirrors the #707 options-page guard (tests/unit/options-aria-i18n.test.mjs):
 *
 * 1. No hardcoded `aria-label="..."` attributes remain in
 *    `src/onboarding/onboarding.html`. Every aria-label must come from
 *    `data-i18n-aria-label="<key>"` so screen-reader users on every
 *    supported locale hear the label in their own language.
 *
 * 2. Every `data-i18n-aria-label` key resolves to a real TRANSLATIONS entry
 *    in `src/lib/i18n.js` and covers all SUPPORTED_LANGS.
 *
 * 3. The consent-gate checkboxes (#affiliate-check, #tos-check) specifically
 *    carry `data-i18n-aria-label`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ONBOARDING_HTML = readFileSync(
  join(__dirname, "../../src/onboarding/onboarding.html"),
  "utf8",
);

describe("#930 — onboarding consent-gate checkbox aria-labels are i18n-driven", () => {
  test("no hardcoded aria-label= attributes remain in onboarding.html", () => {
    // Negative lookbehind avoids matching the `aria-label` substring inside
    // `data-i18n-aria-label="..."`. We only flag bare `aria-label="..."`.
    const hardcoded = ONBOARDING_HTML.match(/(?<!data-i18n-)aria-label="[^"]*"/g) || [];
    assert.equal(
      hardcoded.length,
      0,
      `onboarding.html still contains ${hardcoded.length} hardcoded aria-label attributes: ${hardcoded.join(", ")}.\n` +
        "Every aria-label must use data-i18n-aria-label=\"<key>\" so non-EN screen-reader users hear the translated label.",
    );
  });

  test("every data-i18n-aria-label key resolves to a TRANSLATIONS entry", () => {
    const keyRe = /data-i18n-aria-label="([^"]+)"/g;
    const keys = [];
    let m;
    while ((m = keyRe.exec(ONBOARDING_HTML)) !== null) keys.push(m[1]);
    assert.ok(keys.length > 0, "expected at least one data-i18n-aria-label in onboarding.html");
    for (const key of keys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(TRANSLATIONS, key),
        `data-i18n-aria-label="${key}" but TRANSLATIONS["${key}"] is missing in src/lib/i18n.js`,
      );
    }
  });

  test("every data-i18n-aria-label entry covers all SUPPORTED_LANGS", () => {
    const keyRe = /data-i18n-aria-label="([^"]+)"/g;
    const keys = new Set();
    let m;
    while ((m = keyRe.exec(ONBOARDING_HTML)) !== null) keys.add(m[1]);
    for (const key of keys) {
      const entry = TRANSLATIONS[key];
      for (const { code } of SUPPORTED_LANGS) {
        assert.ok(
          typeof entry?.[code] === "string" && entry[code].length > 0,
          `TRANSLATIONS["${key}"] is missing a non-empty "${code}" value — screen-reader users in ${code} would hear a blank label`,
        );
      }
    }
  });

  const checkboxes = [
    { id: "affiliate-check", key: "aria_onboarding_affiliate_check" },
    { id: "tos-check", key: "aria_onboarding_tos_check" },
  ];

  for (const { id, key } of checkboxes) {
    test(`#${id} carries data-i18n-aria-label="${key}" and no literal aria-label`, () => {
      const inputRe = new RegExp(`<input[^>]*id="${id}"[^>]*>`);
      const m = ONBOARDING_HTML.match(inputRe);
      assert.ok(m, `#${id} checkbox must exist in onboarding.html`);
      const tag = m[0];
      assert.ok(
        tag.includes(`data-i18n-aria-label="${key}"`),
        `#${id} must carry data-i18n-aria-label="${key}"`,
      );
      assert.ok(
        !/(?<!data-i18n-)aria-label="/.test(tag),
        `#${id} must not carry a literal hardcoded aria-label`,
      );
    });
  }
});
