/**
 * MUGA — row_context_menu_hint shortcut-clause gating (#991)
 *
 * Firefox Android has no chrome.commands, so the Alt+Shift+C keyboard
 * shortcut does not exist there. row_context_menu_hint used to unconditionally
 * claim the shortcut works, which is false on that platform. The fix splits
 * the string into a base hint (row_context_menu_hint) plus an optional
 * clause (row_context_menu_hint_shortcut) that buildContextMenuHint() only
 * appends when the caller reports the shortcut capability is present.
 *
 * buildContextMenuHint() is a pure function (no DOM/chrome dependency) so it
 * is unit-tested directly, per the project's established pattern of
 * extracting testable UI-branching logic out of the browser-only
 * options.js/popup.js scripts (see planChangelogView in
 * remote-rules-changelog-view.js for precedent).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildContextMenuHint, TRANSLATIONS, t } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../src/options/options.js"),
  "utf8"
);
const OPTIONS_HTML = readFileSync(
  join(__dirname, "../../src/options/options.html"),
  "utf8"
);

describe("buildContextMenuHint(lang, hasShortcut)", () => {
  test("omits the shortcut clause when hasShortcut is false (Firefox Android)", () => {
    const hint = buildContextMenuHint("en", false);
    assert.ok(!hint.includes("Alt+Shift+C"), "hint must not claim a keyboard shortcut when unavailable");
    assert.equal(hint, t("row_context_menu_hint", "en"));
  });

  test("appends the shortcut clause when hasShortcut is true (desktop)", () => {
    const hint = buildContextMenuHint("en", true);
    assert.ok(hint.includes("Alt+Shift+C"), "hint must mention the shortcut when available");
    assert.ok(hint.startsWith(t("row_context_menu_hint", "en")), "base hint must come first");
    assert.ok(hint.includes(t("row_context_menu_hint_shortcut", "en")), "must include the shortcut clause text");
  });

  test("es (peninsular) hint omits the shortcut clause when unavailable", () => {
    const hint = buildContextMenuHint("es", false);
    assert.ok(!hint.includes("Alt+Shift+C"));
    assert.equal(hint, t("row_context_menu_hint", "es"));
  });

  test("es (peninsular) hint includes the shortcut clause when available", () => {
    const hint = buildContextMenuHint("es", true);
    assert.ok(hint.includes("Alt+Shift+C"));
  });

  test("falls back gracefully for an unsupported language (uses en fallback via t())", () => {
    const hint = buildContextMenuHint("xx", false);
    assert.equal(hint, t("row_context_menu_hint", "xx"));
  });
});

describe("row_context_menu_hint / row_context_menu_hint_shortcut — all 7 locales present", () => {
  const locales = ["en", "es", "pt", "de", "fr", "it", "ja"];

  test("row_context_menu_hint has no locale unconditionally embedding the shortcut in the base key", () => {
    // The base key itself must never contain the shortcut string — only the
    // dedicated *_shortcut key may, since it's the piece conditioned on hasCommands().
    for (const locale of locales) {
      const base = TRANSLATIONS.row_context_menu_hint[locale];
      if (!base) continue; // community locale pending translation is allowed to be null
      assert.ok(
        !/Alt\+(Shift|Maj|Maiusc)\+C/i.test(base) && !base.includes("Alt+Shift+C"),
        `row_context_menu_hint[${locale}] must not embed the shortcut clause: "${base}"`
      );
    }
  });

  test("row_context_menu_hint_shortcut exists for all 7 locales", () => {
    for (const locale of locales) {
      assert.ok(
        TRANSLATIONS.row_context_menu_hint_shortcut[locale],
        `row_context_menu_hint_shortcut is missing a translation for "${locale}"`
      );
    }
  });

  test("no locale string contains an em dash or a bare double-hyphen", () => {
    for (const key of ["row_context_menu_hint", "row_context_menu_hint_shortcut"]) {
      for (const locale of locales) {
        const value = TRANSLATIONS[key][locale];
        if (!value) continue;
        assert.ok(!value.includes("—"), `${key}[${locale}] must not contain an em dash: "${value}"`);
        assert.ok(!value.includes("--"), `${key}[${locale}] must not contain "--": "${value}"`);
      }
    }
  });
});

describe("options.js wires the shortcut clause conditionally via hasCommands()", () => {
  test("options.js imports hasCommands from browser-detect.js", () => {
    assert.ok(
      /import\s*\{[^}]*hasCommands[^}]*\}\s*from\s*"\.\.\/lib\/browser-detect\.js"/.test(OPTIONS_SOURCE),
      "options.js must import hasCommands from lib/browser-detect.js"
    );
  });

  test("options.js imports buildContextMenuHint from i18n.js", () => {
    assert.ok(
      /import\s*\{[^}]*buildContextMenuHint[^}]*\}\s*from\s*"\.\.\/lib\/i18n\.js"/.test(OPTIONS_SOURCE),
      "options.js must import buildContextMenuHint from lib/i18n.js"
    );
  });

  test("options.js calls buildContextMenuHint(lang, hasCommands()) to render the hint", () => {
    assert.ok(
      /buildContextMenuHint\(\s*[\w.]+\s*,\s*hasCommands\(\)\s*\)/.test(OPTIONS_SOURCE),
      "options.js must call buildContextMenuHint(lang, hasCommands())"
    );
  });

  test("the render call runs after every applyTranslations(...) call site (no stale hint left behind)", () => {
    const applyCalls = [...OPTIONS_SOURCE.matchAll(/applyTranslations\(_currentLang\)/g)];
    assert.ok(applyCalls.length >= 1, "expected at least one applyTranslations(_currentLang) call");
    for (const match of applyCalls) {
      const after = OPTIONS_SOURCE.slice(match.index, match.index + 300);
      assert.ok(
        /buildContextMenuHint|renderContextMenuHint/.test(after),
        "each applyTranslations(_currentLang) call site must be followed by a re-render of the context-menu hint"
      );
    }
  });
});

describe("options.html — context-menu hint element is addressable and has a shortcut-free English fallback", () => {
  test("the hint <small> element has an id the JS can target", () => {
    assert.ok(
      /<small[^>]*id="row-context-menu-hint"[^>]*data-i18n="row_context_menu_hint"/.test(OPTIONS_HTML),
      "the row_context_menu_hint <small> element must carry id=\"row-context-menu-hint\""
    );
  });

  test("the static English fallback text in options.html does not unconditionally claim the shortcut", () => {
    const idx = OPTIONS_HTML.indexOf('data-i18n="row_context_menu_hint"');
    assert.ok(idx !== -1, "row_context_menu_hint element must exist in options.html");
    const tagEnd = OPTIONS_HTML.indexOf("</small>", idx);
    const fallbackText = OPTIONS_HTML.slice(idx, tagEnd);
    assert.ok(
      !fallbackText.includes("Alt+Shift+C"),
      "the hardcoded English fallback must not unconditionally claim the Alt+Shift+C shortcut"
    );
  });
});
