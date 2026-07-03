/**
 * MUGA — options UI wiring for showBadge (#910).
 *
 * Pins the source surface for the toolbar-badge toggle the same way
 * options-surfaced-prefs.test.mjs pins the #925 controls: the HTML row +
 * aria-label, the bindToggle wiring, and the export/import round-trip.
 * Source-string-inspection pattern (options.js is browser-only, no DOM
 * available under node:test).
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

describe("#910 — showBadge defaults to true", () => {
  test("PREF_DEFAULTS.showBadge is true", () => {
    assert.strictEqual(PREF_DEFAULTS.showBadge, true);
  });
});

describe("#910 — the toggle has an HTML row and a bindToggle wiring", () => {
  test('#show-badge checkbox exists with data-i18n-aria-label="aria_show_badge"', () => {
    assert.ok(optionsHtml.includes('id="show-badge"'), 'options.html must contain a checkbox with id="show-badge"');
    assert.ok(
      optionsHtml.includes('data-i18n-aria-label="aria_show_badge"'),
      'the #show-badge row must carry data-i18n-aria-label="aria_show_badge"'
    );
  });

  test('options.js binds #show-badge to "showBadge"', () => {
    assert.ok(
      optionsJs.includes('bindToggle("show-badge", "showBadge", prefs)'),
      'options.js must call bindToggle("show-badge", "showBadge", prefs)'
    );
  });

  test("#show-badge lives inside the dev-mode-gated Advanced card (Display group)", () => {
    const cardIdx = optionsHtml.indexOf('id="dev-tools-card"');
    const verIdx = optionsHtml.indexOf("version-info");
    const idx = optionsHtml.indexOf('id="show-badge"');
    assert.ok(idx > cardIdx && idx < verIdx, "#show-badge must be inside the gated Advanced card");
  });
});

describe("#910 — export/import round-trips showBadge", () => {
  test("export payload includes showBadge", () => {
    assert.ok(optionsJs.includes("showBadge: prefs.showBadge"), "export payload must include showBadge");
  });

  test("import BOOL_KEYS includes showBadge", () => {
    const boolKeysMatch = optionsJs.match(/const BOOL_KEYS = \[([^\]]*)\]/);
    assert.ok(boolKeysMatch, "import handler must define BOOL_KEYS");
    assert.ok(boolKeysMatch[1].includes('"showBadge"'), "BOOL_KEYS must include showBadge so import applies it");
  });

  test("import handler refreshes the #show-badge checkbox after import", () => {
    assert.ok(
      optionsJs.includes('document.getElementById("show-badge").checked = newPrefs.showBadge'),
      "the post-import UI refresh must update #show-badge"
    );
  });
});

describe("#910 — new i18n keys are complete across all locales", () => {
  const newKeys = ["row_show_badge_label", "row_show_badge_hint", "aria_show_badge"];

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

  test("es translations differ from en (peninsular Spanish, not a copy)", () => {
    for (const key of newKeys) {
      assert.notEqual(TRANSLATIONS[key].es, TRANSLATIONS[key].en, `"${key}" es must not equal en`);
    }
  });
});
