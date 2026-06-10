/**
 * MUGA — Structural validation for per-locale data modules (#834)
 *
 * Ensures every locale module under src/lib/locales/ exports exactly the
 * same key set as en.mjs (the canonical key set), and that no locale
 * silently diverges from the assembled TRANSLATIONS map.
 *
 * What is tested:
 *  1. Every locale file exports the same keys as en.mjs — no additions, no
 *     omissions.
 *  2. TRANSLATIONS (assembled by i18n.js) contains every key from en.mjs,
 *     and every locale slot matches the raw locale module value.
 *  3. All officially-maintained locales (en, es) have non-null values for
 *     every key. Community locales (pt, de, fr, it, ja) may have null for
 *     keys pending translation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "../../src/lib/locales");

// Load all locale modules — use pathToFileURL for Windows compatibility
const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".mjs"));
const localeModules = {};
for (const file of localeFiles) {
  const code = file.replace(/\.mjs$/, "");
  const mod = await import(pathToFileURL(resolve(localesDir, file)).href);
  localeModules[code] = mod.default;
}

// Load the assembled TRANSLATIONS and SUPPORTED_LANGS from i18n.js
const { TRANSLATIONS, SUPPORTED_LANGS } = await import("../../src/lib/i18n.js");

const enKeys = Object.keys(localeModules["en"]);
const supportedCodes = SUPPORTED_LANGS.map((l) => l.code);
const officialLocales = new Set(["en", "es"]);

describe("locale module files", () => {
  test("locales directory contains one file per supported language", () => {
    for (const code of supportedCodes) {
      assert.ok(
        localeModules[code] !== undefined,
        `Missing locale file: src/lib/locales/${code}.mjs`
      );
    }
    // No extra files beyond supported langs
    for (const code of Object.keys(localeModules)) {
      assert.ok(
        supportedCodes.includes(code),
        `Unexpected locale file: src/lib/locales/${code}.mjs — add it to SUPPORTED_LANGS or remove it`
      );
    }
  });

  for (const code of supportedCodes) {
    describe(`${code}.mjs key set`, () => {
      test(`${code}.mjs has exactly the same keys as en.mjs`, () => {
        if (!localeModules[code]) return; // caught by previous test
        const keys = Object.keys(localeModules[code]);
        assert.deepStrictEqual(
          keys,
          enKeys,
          `${code}.mjs key set diverges from en.mjs. ` +
            `Missing: [${enKeys.filter((k) => !keys.includes(k)).join(", ")}]. ` +
            `Extra: [${keys.filter((k) => !enKeys.includes(k)).join(", ")}].`
        );
      });

      if (officialLocales.has(code)) {
        test(`${code}.mjs has non-null value for every key (official locale)`, () => {
          for (const key of enKeys) {
            const val = localeModules[code][key];
            assert.ok(
              typeof val === "string" && val.trim().length > 0,
              `${code}.mjs["${key}"] is missing or empty — official locales must have all keys translated`
            );
          }
        });
      }
    });
  }
});

describe("TRANSLATIONS assembly (i18n.js)", () => {
  test("TRANSLATIONS contains every key from en.mjs", () => {
    for (const key of enKeys) {
      assert.ok(
        key in TRANSLATIONS,
        `TRANSLATIONS is missing key "${key}" — check i18n.js assembly logic`
      );
    }
    assert.strictEqual(
      Object.keys(TRANSLATIONS).length,
      enKeys.length,
      "TRANSLATIONS key count must equal en.mjs key count"
    );
  });

  test("every TRANSLATIONS entry has a slot for every supported locale", () => {
    for (const key of enKeys) {
      for (const code of supportedCodes) {
        assert.ok(
          code in TRANSLATIONS[key],
          `TRANSLATIONS["${key}"] is missing locale slot "${code}"`
        );
      }
    }
  });

  test("TRANSLATIONS values match raw locale module values", () => {
    for (const key of enKeys) {
      for (const code of supportedCodes) {
        const raw = localeModules[code]?.[key] ?? null;
        const assembled = TRANSLATIONS[key]?.[code] ?? null;
        assert.strictEqual(
          assembled,
          raw,
          `TRANSLATIONS["${key}"]["${code}"] (${JSON.stringify(assembled)}) ` +
            `does not match ${code}.mjs["${key}"] (${JSON.stringify(raw)})`
        );
      }
    }
  });
});
