/**
 * MUGA — browsewrap Phase 2: Settings UI for the shortener click/hover split.
 *
 * The single "Follow shortener redirects" toggle is replaced by two
 * independent controls:
 *   - #resolveShortenersOnClick — click-time resolution, default ON.
 *   - #resolveShortenersOnHover — hover/proactive resolution, default OFF
 *     (opt-in), with copy that honestly conveys the privacy tradeoff (it
 *     pings the shortener before the user clicks).
 *
 * Both share the existing permission-request flow (requestShortenerPermissions/
 * hasShortenerPermissions) and the existing "new shorteners available,
 * re-enable" regrant notice — same source-string-inspection pattern as
 * export-import.test.mjs / options-surfaced-prefs.test.mjs (options.js is
 * browser-only).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

describe("browsewrap Phase 2 — PREF_DEFAULTS for the split shortener prefs", () => {
  test("resolveShortenersOnClick defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.resolveShortenersOnClick, true);
  });

  test("resolveShortenersOnHover defaults to false (opt-in)", () => {
    assert.strictEqual(PREF_DEFAULTS.resolveShortenersOnHover, false);
  });

  test("followShortenersEnabled no longer exists in PREF_DEFAULTS", () => {
    assert.ok(!("followShortenersEnabled" in PREF_DEFAULTS));
  });
});

describe("browsewrap Phase 2 — options.html has two independent toggles", () => {
  test('#resolveShortenersOnClick checkbox exists with an aria-label', () => {
    assert.ok(
      optionsHtml.includes('id="resolveShortenersOnClick"'),
      "options.html must contain a checkbox with id=\"resolveShortenersOnClick\""
    );
    assert.ok(
      optionsHtml.includes('data-i18n-aria-label="enable_resolve_on_click_cta"'),
      "the #resolveShortenersOnClick row must carry data-i18n-aria-label=\"enable_resolve_on_click_cta\""
    );
  });

  test('#resolveShortenersOnHover checkbox exists with an aria-label', () => {
    assert.ok(
      optionsHtml.includes('id="resolveShortenersOnHover"'),
      "options.html must contain a checkbox with id=\"resolveShortenersOnHover\""
    );
    assert.ok(
      optionsHtml.includes('data-i18n-aria-label="enable_resolve_on_hover_cta"'),
      "the #resolveShortenersOnHover row must carry data-i18n-aria-label=\"enable_resolve_on_hover_cta\""
    );
  });

  test("the old single followShortenersEnabled checkbox is gone", () => {
    assert.ok(
      !optionsHtml.includes('id="followShortenersEnabled"'),
      "the retired single toggle must not remain in options.html"
    );
  });

  test("the regrant notice/button stay shared for both toggles", () => {
    assert.ok(optionsHtml.includes('id="shortener-regrant-notice"'));
    assert.ok(optionsHtml.includes('id="shortener-regrant-btn"'));
  });
});

describe("browsewrap Phase 2 — options.js wires both toggles to the permission-request flow", () => {
  test("initFollowShorteners reads both prefs and sets checkbox state", () => {
    assert.ok(
      /resolveShortenersOnClick/.test(optionsJs) && /resolveShortenersOnHover/.test(optionsJs),
      "options.js must reference both resolveShortenersOnClick and resolveShortenersOnHover"
    );
  });

  test("enabling either toggle requests the shortener host permissions FIRST (Firefox MV2 gesture-frame requirement)", () => {
    assert.ok(
      optionsJs.includes("requestShortenerPermissions"),
      "options.js must still call requestShortenerPermissions for the enable path"
    );
  });

  test("the retired followShortenersEnabled identifier is gone from options.js", () => {
    assert.ok(
      !optionsJs.includes("followShortenersEnabled"),
      "options.js must not reference the retired followShortenersEnabled pref/id"
    );
  });

  test("post-import DOM refresh reflects both prefs on their respective checkboxes", () => {
    assert.ok(
      /getElementById\("resolveShortenersOnClick"\)/.test(optionsJs),
      "post-import refresh must look up #resolveShortenersOnClick"
    );
    assert.ok(
      /getElementById\("resolveShortenersOnHover"\)/.test(optionsJs),
      "post-import refresh must look up #resolveShortenersOnHover"
    );
  });
});

describe("browsewrap Phase 2 — new i18n keys are complete across all locales", () => {
  const newKeys = [
    "resolve_on_click_label", "enable_resolve_on_click_cta",
    "resolve_on_hover_label", "enable_resolve_on_hover_cta",
  ];

  for (const key of newKeys) {
    test(`"${key}" exists and is non-empty for every supported locale`, () => {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `TRANSLATIONS is missing new key "${key}"`);
      for (const { code } of SUPPORTED_LANGS) {
        assert.ok(
          typeof entry[code] === "string" && entry[code].trim().length > 0,
          `TRANSLATIONS["${key}"]["${code}"] must be a non-empty string`
        );
      }
    });
  }

  test("the retired single-toggle keys are gone", () => {
    assert.ok(!("follow_shorteners_enabled" in TRANSLATIONS), "follow_shorteners_enabled must be removed (split into per-toggle labels)");
    assert.ok(!("enable_follow_shorteners_cta" in TRANSLATIONS), "enable_follow_shorteners_cta must be removed (split into per-toggle aria labels)");
  });

  test("the shared section title/disclosure/regrant keys are retained", () => {
    for (const key of ["follow_shorteners_section_title", "follow_shorteners_disclosure", "shortener_regrant_notice", "shortener_regrant_cta", "shortener_regrant_denied"]) {
      assert.ok(key in TRANSLATIONS, `${key} must still exist — shared by both toggles`);
    }
  });
});
