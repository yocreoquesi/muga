/**
 * MUGA — every Settings switch is named by the text next to it (#1407, #1403, #1414).
 *
 * #1271 rewrote the visible labels but not the separate aria-label keys, so
 * 12 switches announced a different name from the one on screen (WCAG 2.5.3
 * Label in Name: a voice user saying "click Skip AMP detours" got nothing).
 * The fix removes the second copy altogether: each switch is
 * aria-labelledby its visible <strong>, so the two can no longer drift, and
 * the row text is a <label for> so clicking it flips the switch, like any
 * native checkbox label. The three rows built differently (#1414: remote
 * rules and the two shortener switches) now use the same markup.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, "../../src/options/options.html"), "utf8");

// Every switch in the static markup: <label class="toggle"> ... <input type="checkbox" ...>
const toggleInputs = [...html.matchAll(/<label class="toggle">\s*(<input type="checkbox"[^>]*>)/g)].map((m) => m[1]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

describe("Settings switches are labelled by their visible text", () => {
  test("the page has the expected number of switches", () => {
    assert.ok(toggleInputs.length >= 22, `found ${toggleInputs.length}`);
  });

  for (const input of toggleInputs) {
    const id = attr(input, "id");
    test(`#${id} is aria-labelledby its visible row label`, () => {
      assert.equal(attr(input, "data-i18n-aria-label"), undefined, `#${id} still carries a separate aria-label key`);
      const labelledBy = attr(input, "aria-labelledby");
      assert.ok(labelledBy, `#${id} must be aria-labelledby its visible label`);
      const target = html.match(new RegExp(`<strong id="${labelledBy}" data-i18n="([^"]+)"`));
      assert.ok(target, `#${labelledBy} must be a translated <strong> row label`);
      assert.ok(TRANSLATIONS[target[1]], `row label key ${target[1]} must exist`);
    });

    test(`#${id}: clicking the row text flips the switch`, () => {
      assert.ok(
        html.includes(`<label class="row-label" for="${id}">`),
        `#${id}'s row text must be a <label class="row-label" for="${id}">`,
      );
    });
  }

  test("#1414: remote rules and shortener rows use the standard row markup", () => {
    for (const id of ["remote-rules-toggle", "resolveShortenersOnClick", "resolveShortenersOnHover"]) {
      assert.ok(html.includes(`<label class="row-label" for="${id}">`), id);
    }
    assert.doesNotMatch(html, /<\/label>\s*<span data-i18n="(optionsRemoteRulesToggle|resolve_on_click_label|resolve_on_hover_label)">/);
  });

  test("the retired per-switch aria keys are gone from every locale", () => {
    const RETIRED = [
      "aria_notify", "aria_strip_affiliates", "aria_context_menu", "aria_remote_rules_toggle",
      "aria_dev_mode", "aria_active_defense_enabled", "aria_unwrap_redirects", "aria_hover_preview",
      "aria_block_pings", "aria_amp_redirect", "aria_honor_creator", "aria_cross_site_frequency",
      "aria_attribution_ledger", "aria_suppress_referer", "aria_block_beacons", "aria_domain_stats",
      "aria_show_badge", "enable_resolve_on_click_cta", "enable_resolve_on_hover_cta",
      "aria_dev_tools_mode", "aria_canonical_extractor", "aria_experimental_params",
    ];
    assert.deepEqual(RETIRED.filter((k) => k in TRANSLATIONS), []);
  });
});

describe("#1403: German names Honor Creator Mode as honouring creators", () => {
  test("the visible label no longer reads 'respect creator mode'", () => {
    assert.doesNotMatch(TRANSLATIONS.honor_creator_mode_label.de, /respektieren/);
  });

  test("the allowlist hint in every locale cites the mode by its visible label", () => {
    for (const { code } of SUPPORTED_LANGS) {
      const label = TRANSLATIONS.honor_creator_mode_label[code];
      const hint = TRANSLATIONS.creator_allowlist_hint[code];
      assert.ok(hint.includes(label), `creator_allowlist_hint.${code} must cite "${label}": ${hint}`);
    }
  });
});
