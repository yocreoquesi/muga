/**
 * MUGA — i18n completeness floor (#359)
 *
 * Enforces the maintenance floor for officially maintained languages:
 * for every key in TRANSLATIONS, both `en` and `es` must be present,
 * non-empty, and not identical to each other (unless explicitly exempted).
 *
 * PT and DE are intentionally not asserted here — they are community-
 * maintained best-effort translations per #351 (the runtime fallback
 * chain at i18n.js:281 lands them on EN cleanly when an entry is missing).
 *
 * If you add a key to TRANSLATIONS, this test fails until you give it
 * BOTH an `en` and `es` value. PT and DE are optional.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

// Keys whose EN and ES values are legitimately identical. Add to this list
// only when the duplication is intentional (universal symbols, brand strings,
// placeholder URLs, single-word loanwords that read the same in both
// languages). Do NOT add a key to silence a real translation gap.
const EN_ES_IDENTICAL_EXCEPTIONS = new Set([
  "confirm_ok",                  // "OK" is universal
  "dev_url_tester_placeholder",  // example URL, not user-facing copy
  "dev_url_error",               // "Error:" reads identically in EN/ES
  "tooltip_default",             // "MUGA" — brand name, universal across locales
]);

describe("i18n completeness — every key has en + es", () => {
  for (const [key, entry] of Object.entries(TRANSLATIONS)) {
    test(`"${key}" has a non-empty "en" value`, () => {
      assert.ok(
        typeof entry.en === "string" && entry.en.trim().length > 0,
        `Key "${key}" is missing or empty in en. Add an English translation.`
      );
    });

    test(`"${key}" has a non-empty "es" value`, () => {
      assert.ok(
        typeof entry.es === "string" && entry.es.trim().length > 0,
        `Key "${key}" is missing or empty in es. Add a Spanish translation.`
      );
    });
  }
});

describe("i18n completeness — en and es differ for every key (with exceptions)", () => {
  for (const [key, entry] of Object.entries(TRANSLATIONS)) {
    if (EN_ES_IDENTICAL_EXCEPTIONS.has(key)) continue;
    test(`"${key}" has distinct en and es values`, () => {
      assert.notEqual(
        entry.es,
        entry.en,
        `Key "${key}" has identical en and es values — looks like a missed translation. ` +
          `If the duplication is intentional (universal symbol, brand string, etc.), ` +
          `add the key to EN_ES_IDENTICAL_EXCEPTIONS in this file.`
      );
    });
  }
});
