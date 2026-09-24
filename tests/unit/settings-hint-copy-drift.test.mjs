/**
 * MUGA — Settings hints must name controls and sections that exist (#1389, #1395, #1396, #1429).
 *
 * A hint that says "add the site to X" or "use the Y button" only helps if X
 * and Y are on the page under that exact name. These tests read each
 * locale's real strings and check that every hint which cites another
 * control quotes that control's CURRENT label from the same locale, so a
 * future label rename fails here instead of silently stranding the hint.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const LANGS = SUPPORTED_LANGS.map(({ code }) => code);
const s = (key, lang) => {
  const value = TRANSLATIONS[key]?.[lang];
  assert.equal(typeof value, "string", `TRANSLATIONS["${key}"]["${lang}"] must exist`);
  return value;
};
/** A list heading is "<name>: <rule>"; hints cite the name part. */
const headingName = (key, lang) => s(key, lang).split(/\s*:\s/)[0].trim();

describe("#1389: Activity hints point to Settings > Activity, not the popup", () => {
  // The word each locale uses for the popup in these hints before #1389.
  const POPUP_WORD = {
    en: "popup", es: "ventana emergente", pt: "pop-up", de: "Popup",
    fr: "fenêtre contextuelle", it: "popup", ja: "ポップアップ",
  };
  const ACTIVITY_HINTS = [
    "user_custom_rules_hint",
    "row_cross_site_frequency_hint",
    "row_attribution_ledger_hint",
    "row_domain_stats_hint",
  ];

  for (const lang of LANGS) {
    test(`${lang}: the four hints cite the Activity section and never the popup`, () => {
      const activity = s("section_activity", lang);
      for (const key of ACTIVITY_HINTS) {
        const hint = s(key, lang);
        assert.ok(hint.includes(activity), `${key}.${lang} must name the "${activity}" section: ${hint}`);
        assert.ok(
          !hint.toLowerCase().includes(POPUP_WORD[lang].toLowerCase()),
          `${key}.${lang} still says the data shows in the popup: ${hint}`,
        );
      }
    });

    test(`${lang}: the custom-rules hint quotes the real "strip everywhere" button`, () => {
      const btn = s("strip_globally_btn", lang);
      const hint = s("user_custom_rules_hint", lang);
      assert.ok(hint.includes(btn), `user_custom_rules_hint.${lang} must quote "${btn}": ${hint}`);
    });
  }

  test("de addresses the user as du everywhere (no Sie/Ihr/Ihnen)", () => {
    const de = readFileSync(resolve(root, "src/lib/locales/de.mjs"), "utf8");
    const offenders = de.split("\n").filter((line) =>
      /\b(Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/.test(line) ||
      // "Sie" mid-sentence is the formal you; capitalised after a full stop it is "they".
      /[a-zäöüß,] Sie\b/.test(line));
    assert.deepEqual(offenders, []);
  });
});

describe("#1395: the Developer tools hint does not deny that the panel changes cleaning", () => {
  // The panel holds #canonical-extractor and #experimental-param-classes
  // (#1355), both of which change cleaning output.
  const html = readFileSync(resolve(root, "src/options/options.html"), "utf8");
  const panel = html.slice(html.indexOf('id="dev-tools-panel"'));

  test("the panel really does hold the two cleaning toggles", () => {
    assert.ok(panel.includes('id="canonical-extractor"'));
    assert.ok(panel.includes('id="experimental-param-classes"'));
  });

  const RETIRED = [
    "None of these change how URLs are cleaned.",
    "Ninguna cambia cómo se limpian las URLs.",
    "Nenhuma delas muda como as URLs são limpas.",
    "Keines davon ändert, wie URLs bereinigt werden.",
    "Aucun ne change la façon dont les URL sont nettoyées.",
    "Nessuno di questi cambia il modo in cui gli URL vengono puliti.",
    "これらは URL のクリーンアップ方法を変えません。",
  ];

  for (const lang of LANGS) {
    test(`${lang}: dev_tools_disclosure_hint drops the "nothing changes cleaning" claim`, () => {
      const hint = s("dev_tools_disclosure_hint", lang);
      for (const old of RETIRED) assert.ok(!hint.includes(old), `${lang}: ${hint}`);
    });
  }

  test("en: the hint says some of these options do change cleaning", () => {
    assert.match(s("dev_tools_disclosure_hint", "en"), /clean/i);
  });
});

describe("#1396/#1429: hints quote section and control names verbatim", () => {
  for (const lang of LANGS) {
    test(`${lang}: hints that send users to the protected list use its heading`, () => {
      const protectedName = headingName("section_whitelist", lang);
      for (const key of [
        "row_suppress_referer_hint",
        "row_block_beacons_hint",
        "notice_blocklist_referer_beacon_text",
        "wl_hint",
        "bl_hint",
      ]) {
        const hint = s(key, lang);
        assert.ok(hint.includes(protectedName), `${key}.${lang} must cite "${protectedName}": ${hint}`);
      }
    });

    test(`${lang}: hints that mean the blocked list use its heading`, () => {
      const blockedName = headingName("section_blacklist", lang);
      for (const key of ["notice_blocklist_referer_beacon_text", "wl_hint", "bl_hint"]) {
        const hint = s(key, lang);
        assert.ok(hint.includes(blockedName), `${key}.${lang} must cite "${blockedName}": ${hint}`);
      }
    });

    test(`${lang}: the beacon hint quotes the real click-beacon option label`, () => {
      const pings = s("row_pings_label", lang);
      const hint = s("row_block_beacons_hint", lang);
      assert.ok(hint.includes(pings), `row_block_beacons_hint.${lang} must quote "${pings}": ${hint}`);
    });

    test(`${lang}: the onboarding blurb names the Settings page by its title`, () => {
      const title = s("opts_title", lang);
      const desc = s("ob_aggressive_privacy_desc", lang);
      assert.ok(desc.includes(title), `ob_aggressive_privacy_desc.${lang} must say "${title}": ${desc}`);
    });
  }

  test("en: no hint names an Allowlist or Blocklist heading that is not on the page", () => {
    for (const key of ["bl_hint", "wl_hint", "notice_blocklist_referer_beacon_text"]) {
      assert.doesNotMatch(s(key, "en"), /allowlist|blocklist/i, key);
    }
  });
});
