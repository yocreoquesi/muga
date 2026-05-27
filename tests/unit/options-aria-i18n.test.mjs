/**
 * MUGA — Regression tests for the #707 options-page i18n + a11y cleanup.
 *
 * Two invariants pinned at the source level:
 *
 * 1. No hardcoded `aria-label="..."` attributes in `src/options/options.html`.
 *    Every aria-label must come from `data-i18n-aria-label="<key>"` so
 *    screen-reader users on every supported locale hear the label in their
 *    own language. Hardcoded English aria-labels are an a11y regression for
 *    ES/PT/DE/FR/IT/JA users.
 *
 * 2. Every `data-i18n-aria-label` key resolves to a real TRANSLATIONS entry
 *    in `src/lib/i18n.js`. A dangling key would result in the
 *    aria-label being set to the bare key name (or empty), defeating the
 *    purpose of the data-i18n-aria-label dance entirely.
 *
 * Also asserts the language `<select>` is fully data-driven from
 * `SUPPORTED_LANGS` and no longer hardcodes a subset of locales (item 9).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_HTML = readFileSync(
  join(__dirname, "../../src/options/options.html"),
  "utf8",
);
const OPTIONS_JS = readFileSync(
  join(__dirname, "../../src/options/options.js"),
  "utf8",
);

describe("#707 — options-page aria-labels are i18n-driven", () => {
  test("no hardcoded aria-label= attributes remain in options.html", () => {
    // Negative lookbehind avoids matching the `aria-label` substring inside
    // `data-i18n-aria-label="..."`. We only flag bare `aria-label="..."`.
    const hardcoded = OPTIONS_HTML.match(/(?<!data-i18n-)aria-label="[^"]*"/g) || [];
    assert.equal(
      hardcoded.length,
      0,
      `options.html still contains ${hardcoded.length} hardcoded aria-label attributes: ${hardcoded.join(", ")}.\n` +
        "Every aria-label must use data-i18n-aria-label=\"<key>\" so non-EN screen-reader users hear the translated label.",
    );
  });

  test("every data-i18n-aria-label key resolves to a TRANSLATIONS entry", () => {
    const keyRe = /data-i18n-aria-label="([^"]+)"/g;
    const keys = [];
    let m;
    while ((m = keyRe.exec(OPTIONS_HTML)) !== null) keys.push(m[1]);
    assert.ok(keys.length > 0, "expected at least one data-i18n-aria-label in options.html");
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
    while ((m = keyRe.exec(OPTIONS_HTML)) !== null) keys.add(m[1]);
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

  test("options.js no longer manually overrides aria-label for privacyProxyEnabled", () => {
    // The override at the privacyProxyEnabled init path was redundant once
    // data-i18n-aria-label="enable_privacy_proxy_cta" was added in HTML
    // (#707). Re-adding setAttribute("aria-label", ...) on that checkbox
    // would shadow applyTranslations on every lang change.
    assert.ok(
      !/setAttribute\(\s*["']aria-label["']\s*,\s*t\(\s*["']enable_privacy_proxy_cta["']/.test(
        OPTIONS_JS,
      ),
      "options.js must not manually setAttribute aria-label on #privacyProxyEnabled — let data-i18n-aria-label handle it",
    );
  });
});

describe("#707 — language selector is data-driven from SUPPORTED_LANGS", () => {
  test("options.html lang-select has no hardcoded <option> children", () => {
    const selectMatch = OPTIONS_HTML.match(
      /<select[^>]*id="lang-select"[^>]*>([\s\S]*?)<\/select>/,
    );
    assert.ok(selectMatch, "lang-select must exist in options.html");
    const inner = selectMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();
    assert.equal(
      inner,
      "",
      `lang-select must be empty in HTML (populated at runtime from SUPPORTED_LANGS); found:\n${inner}`,
    );
  });

  test("options.js populates lang-select from SUPPORTED_LANGS at init", () => {
    assert.ok(
      /SUPPORTED_LANGS\.map/.test(OPTIONS_JS) || /for\s*\([^)]*SUPPORTED_LANGS/.test(OPTIONS_JS),
      "options.js must iterate SUPPORTED_LANGS to populate the lang-select dropdown (otherwise the picker silently drops fr/it/ja)",
    );
  });
});

describe("#707 — i18n keys retired or added by this change", () => {
  test("whatsNewRemoteRules key is retired (#707 dead delete)", () => {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(TRANSLATIONS, "whatsNewRemoteRules"),
      "whatsNewRemoteRules was a Phase-4 placeholder never wired into the UI; retired in #707",
    );
  });

  test("forget_reported_params_label is added (#707 i18n key split)", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(TRANSLATIONS, "forget_reported_params_label"),
      "forget_reported_params_label must exist — split from forget_reported_params_btn so the row label and button label differ",
    );
  });

  test("privacy_proxy_section_title is added (#707 i18n key split)", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(TRANSLATIONS, "privacy_proxy_section_title"),
      "privacy_proxy_section_title must exist — split from privacy_proxy_enabled so the section h2 and the toggle label differ",
    );
  });
});
