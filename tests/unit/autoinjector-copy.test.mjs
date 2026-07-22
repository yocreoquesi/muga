/**
 * MUGA — i18n + copy guard for the auto-inject notice (affiliate-autoinject-notice).
 *
 * Two invariants:
 *  1. Parity: every new key exists in ALL 7 locales with non-empty text
 *     (this feature has no "community locale may be null" carve-out — it
 *     ships translated everywhere at once).
 *  2. Neutral/factual tone: none of the new strings may contain an
 *     adversarial token (the copy names the MECHANIC, never a motive —
 *     ADR-e, design.md). Checked in every locale, not just en/es.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS, SUPPORTED_LANGS } = await import("../../src/lib/i18n.js");

const NEW_KEYS = [
  "autoinject_toast_title",
  "autoinject_toast_msg",
  "autoinject_keep",
  "autoinject_remove",
  "autoinject_badge",
];

const FORBIDDEN_TOKENS = [
  "steal", "stole", "stolen",
  "skim", "skimming",
  "parasite", "parasitic",
  "recover what",
  "rob", "robbing",
  "cheat",
  "thief", "thieves",
];

const supportedCodes = SUPPORTED_LANGS.map((l) => l.code);

// Word-boundary matcher: a substring check (`lower.includes("rob")`) would
// false-trip on innocuous words that merely CONTAIN a token (es "problema"
// contains "rob", "cheat" would trip on a hypothetical "cheatsheet"-free but
// still substring-y edit). Match whole words only so a future locale edit is
// judged on real adversarial wording, not accidental substrings.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsForbiddenToken = (text, token) =>
  new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(text);

describe("autoinject i18n keys — parity across ALL locales", () => {
  for (const key of NEW_KEYS) {
    test(`TRANSLATIONS has key "${key}"`, () => {
      assert.ok(Object.prototype.hasOwnProperty.call(TRANSLATIONS, key), `missing key "${key}"`);
    });

    for (const code of supportedCodes) {
      test(`"${key}" is non-empty in locale "${code}"`, () => {
        const val = TRANSLATIONS[key]?.[code];
        assert.ok(typeof val === "string" && val.trim().length > 0, `${key}.${code} must be a non-empty string`);
      });
    }
  }

  test("autoinject_toast_msg references {platform} and {tag} placeholders in every locale", () => {
    for (const code of supportedCodes) {
      const val = TRANSLATIONS.autoinject_toast_msg[code];
      assert.ok(val.includes("{platform}"), `autoinject_toast_msg.${code} must include {platform}`);
      assert.ok(val.includes("{tag}"), `autoinject_toast_msg.${code} must include {tag}`);
    }
  });

  test("autoinject_badge references {platform} in every locale", () => {
    for (const code of supportedCodes) {
      const val = TRANSLATIONS.autoinject_badge[code];
      assert.ok(val.includes("{platform}"), `autoinject_badge.${code} must include {platform}`);
    }
  });
});

describe("autoinject copy guard — neutral/factual, zero adversarial tokens", () => {
  for (const key of NEW_KEYS) {
    for (const code of supportedCodes) {
      test(`"${key}" in "${code}" contains no forbidden adversarial token`, () => {
        const val = TRANSLATIONS[key]?.[code] ?? "";
        for (const token of FORBIDDEN_TOKENS) {
          assert.ok(!containsForbiddenToken(val, token), `"${key}".${code} contains forbidden token "${token}": "${val}"`);
        }
      });
    }
  }

  test("no new autoinject copy uses an em-dash (repo convention: no em-dashes in UI text)", () => {
    for (const key of NEW_KEYS) {
      for (const code of supportedCodes) {
        const val = TRANSLATIONS[key]?.[code] ?? "";
        assert.ok(!val.includes("—"), `"${key}".${code} contains an em-dash: "${val}"`);
      }
    }
  });
});
