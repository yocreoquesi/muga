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

  test("options.js does not contain privacyProxyEnabled references (section removed in phase 5)", () => {
    // ADR-0004 phase 5: privacyProxyEnabled and the entire URL Unwrapper section
    // were removed. No reference to this old pref key should remain in options.js.
    assert.ok(
      !OPTIONS_JS.includes("privacyProxyEnabled"),
      "options.js must not contain privacyProxyEnabled (Privacy Proxy section decommissioned in phase 5)",
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

  test("privacy_proxy_section_title is removed (ADR-0004 phase 5: proxy section decommissioned)", () => {
    // The entire URL Unwrapper / Privacy Proxy section was removed in phase 5.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(TRANSLATIONS, "privacy_proxy_section_title"),
      "privacy_proxy_section_title must NOT exist after phase 5 proxy decommission",
    );
  });
});

// ── renderList delete-button aria-label is i18n (#742) ───────────────────────
//
// The per-item delete button in renderList previously hardcoded an English
// `Remove ${entry}` aria-label — the exact a11y regression #707 set out to
// kill, but the #707 guard only scanned options.html, never JS-set labels.
describe("renderList delete button aria-label is i18n (#742)", () => {
  test("renderList no longer hardcodes the English `Remove ${entry}` aria-label", () => {
    assert.ok(
      !/setAttribute\(\s*["']aria-label["']\s*,\s*`Remove\s/.test(OPTIONS_JS),
      "renderList must not hardcode `Remove ${entry}` — use t() so non-en locales are covered",
    );
  });

  test("renderList resolves the delete aria-label through t()", () => {
    // Both renderList and the creator-allowlist renderer use this translated
    // key; there must be at least two t(\"creator_allowlist_remove_btn\") calls.
    const matches = OPTIONS_JS.match(/setAttribute\(\s*["']aria-label["']\s*,\s*t\("creator_allowlist_remove_btn"/g) || [];
    assert.ok(
      matches.length >= 2,
      `renderList + creator-allowlist must both i18n the remove aria-label via t(); found ${matches.length}`,
    );
    // The reused key must exist for every supported locale.
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSLATIONS, "creator_allowlist_remove_btn"));
    for (const { code } of SUPPORTED_LANGS) {
      assert.ok(
        TRANSLATIONS.creator_allowlist_remove_btn[code],
        `creator_allowlist_remove_btn must have a ${code} translation`,
      );
    }
  });
});

// ── store-group chip aria-label is i18n (#757) ───────────────────────────────
//
// Same defect class as #707 / #742 (a JS-set hardcoded English aria-label),
// found on the store-group toggle chip. Unlike #742 it needed a NEW key with a
// {name} placeholder. This guard is the catch-all the earlier per-control
// guards lacked: it fails on ANY string-literal aria-label set from JS.
describe("store-group chip aria-label is i18n + no JS-set hardcodes remain (#757)", () => {
  test('no setAttribute("aria-label", <string-literal>) hardcodes remain in options.js', () => {
    // A literal argument opens with ", ', or a backtick. t(...) calls and bare
    // variables (e.g. a pre-translated `label`) are allowed.
    const re = /setAttribute\(\s*["']aria-label["']\s*,\s*(["'\x60])/g;
    const hits = [];
    let m;
    while ((m = re.exec(OPTIONS_JS)) !== null) {
      hits.push(OPTIONS_JS.slice(m.index, m.index + 70).split("\n")[0]);
    }
    assert.deepEqual(
      hits,
      [],
      "options.js sets an aria-label from a string literal — an a11y regression for " +
        "non-en locales. Use t(\"<key>\", _currentLang). Offending call(s):\n  " +
        hits.join("\n  "),
    );
  });

  test('the store-group chip resolves its aria-label through t("store_group_toggle")', () => {
    assert.ok(
      /setAttribute\(\s*["']aria-label["']\s*,\s*t\(\s*["']store_group_toggle["']\s*,\s*_currentLang\s*\)\.replace\(/.test(
        OPTIONS_JS,
      ),
      'the store-group chip must build its aria-label from t("store_group_toggle", _currentLang).replace("{name}", groupName)',
    );
  });

  test("store_group_toggle exists, covers all SUPPORTED_LANGS, and keeps the {name} placeholder", () => {
    const entry = TRANSLATIONS.store_group_toggle;
    assert.ok(entry, "TRANSLATIONS.store_group_toggle must exist");
    for (const { code } of SUPPORTED_LANGS) {
      assert.ok(
        typeof entry[code] === "string" && entry[code].length > 0,
        `store_group_toggle is missing a non-empty "${code}" value`,
      );
      assert.ok(
        entry[code].includes("{name}"),
        `store_group_toggle["${code}"] must keep the {name} placeholder for interpolation`,
      );
    }
  });
});
