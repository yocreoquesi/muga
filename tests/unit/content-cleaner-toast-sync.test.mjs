/**
 * MUGA — Drift guard: cleaner.js inline STRINGS table vs i18n.js (#819)
 *
 * Why this file exists: cleaner.js carries a self-contained copy of the
 * five toast keys (toast_title, toast_tag_msg, toast_allow, toast_block,
 * toast_dismiss) because content scripts cannot import from src/lib/ at
 * runtime. When a new locale is added to i18n.js, the inline table in
 * cleaner.js MUST be updated in sync — otherwise fr/it/ja users always
 * see English toasts.
 *
 * These tests fail red until both sources are in sync and the inline
 * locale set equals the i18n.js SUPPORTED_LANGS codes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ── Load i18n source of truth ────────────────────────────────────────────────

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS, SUPPORTED_LANGS: I18N_SUPPORTED_LANGS } = await import(
  "../../src/lib/i18n.js"
);

// The five toast keys that must exist in both sources
const TOAST_KEYS = [
  "toast_title",
  "toast_tag_msg",
  "toast_allow",
  "toast_block",
  "toast_dismiss",
];

// ── Parse the inline STRINGS table from cleaner.js ──────────────────────────
//
// We read the source as text and eval the object literal in a sandboxed way
// by extracting it with a regex. This avoids executing the full IIFE (which
// requires a browser environment). The table lives between
// "const STRINGS = {" and "};" and uses only plain string literals.

const cleanerSrc = readFileSync(
  resolve(root, "src/content/cleaner.js"),
  "utf8"
);

// Extract inline SUPPORTED_LANGS from cleaner.js (the object literal {en:1,...})
function parseInlineSupportedLangs(src) {
  const match = src.match(/const SUPPORTED_LANGS\s*=\s*\{([^}]+)\}/);
  assert.ok(match, "cleaner.js must declare const SUPPORTED_LANGS = { ... }");
  const keys = [...match[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  return new Set(keys);
}

// Extract inline STRINGS from cleaner.js — parse each locale block
function parseInlineStrings(src) {
  // Find the STRINGS object block
  const startIdx = src.indexOf("const STRINGS = {");
  assert.ok(startIdx >= 0, "cleaner.js must contain 'const STRINGS = {'");

  // Walk to find the matching closing brace at the top level of STRINGS
  let depth = 0;
  let objStart = src.indexOf("{", startIdx);
  let i = objStart;
  let objEnd = -1;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        objEnd = i + 1;
        break;
      }
    }
    i++;
  }
  assert.ok(objEnd > 0, "cleaner.js STRINGS object must be closed with }");

  const objText = src.slice(objStart, objEnd);

  // Extract locale blocks: find each top-level key "xx: {" inside STRINGS
  const result = {};
  // Match locale-level entries: two-letter code followed by ": {"
  const localeRe = /\b([a-z]{2})\s*:\s*\{/g;
  let m;
  while ((m = localeRe.exec(objText)) !== null) {
    const locale = m[1];
    // Find the opening brace of this locale's block
    const blockStart = objText.indexOf("{", m.index + m[0].length - 1);
    // Walk to find matching closing brace
    let d = 0;
    let j = blockStart;
    let blockEnd = -1;
    while (j < objText.length) {
      if (objText[j] === "{") d++;
      else if (objText[j] === "}") {
        d--;
        if (d === 0) {
          blockEnd = j + 1;
          break;
        }
      }
      j++;
    }
    if (blockEnd < 0) continue;
    const blockText = objText.slice(blockStart, blockEnd);

    // Extract key-value pairs: toast_xxx: "...",
    const kvRe = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let kv;
    result[locale] = {};
    while ((kv = kvRe.exec(blockText)) !== null) {
      result[locale][kv[1]] = kv[2];
    }
  }

  return result;
}

const inlineSupportedLangs = parseInlineSupportedLangs(cleanerSrc);
const inlineStrings = parseInlineStrings(cleanerSrc);

// The canonical locale set: all codes from i18n.js SUPPORTED_LANGS
const i18nLocaleCodes = new Set(I18N_SUPPORTED_LANGS.map((l) => l.code));

// ── Tests ────────────────────────────────────────────────────────────────────

test("cleaner.js inline SUPPORTED_LANGS matches i18n.js SUPPORTED_LANGS codes", () => {
  // Every locale in i18n.js must be in cleaner's SUPPORTED_LANGS
  for (const code of i18nLocaleCodes) {
    assert.ok(
      inlineSupportedLangs.has(code),
      `cleaner.js SUPPORTED_LANGS is missing locale "${code}" — sync it from i18n.js`
    );
  }
  // And vice versa: no extra locales in cleaner that don't exist in i18n.js
  for (const code of inlineSupportedLangs) {
    assert.ok(
      i18nLocaleCodes.has(code),
      `cleaner.js SUPPORTED_LANGS has unexpected locale "${code}" not in i18n.js`
    );
  }
});

test("cleaner.js STRINGS table has an entry for every i18n.js locale", () => {
  for (const code of i18nLocaleCodes) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(inlineStrings, code),
      `cleaner.js STRINGS is missing locale block "${code}" — add fr/it/ja entries`
    );
  }
});

for (const key of TOAST_KEYS) {
  test(`cleaner.js STRINGS[locale].${key} matches i18n.js for every locale`, () => {
    const i18nEntry = TRANSLATIONS[key];
    assert.ok(i18nEntry, `i18n.js must have key "${key}"`);

    for (const code of i18nLocaleCodes) {
      const inlineVal = inlineStrings[code]?.[key];
      const i18nVal = i18nEntry[code];

      assert.ok(
        typeof inlineVal === "string" && inlineVal.length > 0,
        `cleaner.js STRINGS["${code}"]["${key}"] is missing or empty`
      );
      assert.strictEqual(
        inlineVal,
        i18nVal,
        `cleaner.js STRINGS["${code}"]["${key}"] drifted from i18n.js:\n` +
          `  inline: "${inlineVal}"\n` +
          `  i18n:   "${i18nVal}"`
      );
    }
  });
}
