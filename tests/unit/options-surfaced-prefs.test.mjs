/**
 * MUGA — #925/#936 guards for the newly-surfaced Advanced controls.
 *
 * #925 surfaced seven previously UI-less prefs as Advanced controls:
 *   - Privacy toggles:  canonicalExtractorEnabled, crossSiteFrequencyEnabled,
 *                       attributionLedgerEnabled
 *   - Display toggles:  paramBreakdown, showReportButton, domainStats
 *   - userCustomRules:  view + remove editor (entries come from the popup's
 *                       "Strip locally" button)
 *
 * These tests pin the source surface (bindToggle wiring, the HTML rows with
 * unique ids + data-i18n-aria-label keys, and the export/import round-trip)
 * so the controls cannot silently regress. They follow the same
 * source-string-inspection pattern as export-import.test.mjs (the options
 * code is browser-only).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";
import { BOOLEAN_KEYS, buildExportPayload, planImport } from "../../src/lib/settings-schema.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

// Each surfaced boolean pref → { id, prefKey, ariaKey }
// #1355: canonicalExtractorEnabled moved into the devToolsMode-gated
// Developer tools panel — see the dedicated describe block below — so it is
// no longer part of the dev-mode-gated-Advanced-card group tested here.
// paramBreakdown was retired entirely (#1355/#1354: the popup glance shows
// the breakdown unconditionally now) — see the retirement describe block
// below instead of listing it here.
const BOOLEAN_CONTROLS = [
  { id: "cross-site-frequency", prefKey: "crossSiteFrequencyEnabled", ariaKey: "aria_cross_site_frequency" },
  { id: "attribution-ledger",   prefKey: "attributionLedgerEnabled",  ariaKey: "aria_attribution_ledger" },
  { id: "show-report-button",   prefKey: "showReportButton",          ariaKey: "aria_show_report_button" },
  { id: "domain-stats",         prefKey: "domainStats",               ariaKey: "aria_domain_stats" },
];

// #1355 (ADR-0011 internal-with-a-default): canonicalExtractorEnabled's
// control moved into Developer tools; experimentalParamClassesEnabled's
// control moved there too (previously in the dev-mode-gated Advanced card,
// same as the ones above). Both stay real, user-settable, exported prefs —
// only their Settings location changed.
const DEV_TOOLS_CONTROLS = [
  { id: "canonical-extractor",      prefKey: "canonicalExtractorEnabled",       ariaKey: "aria_canonical_extractor" },
  { id: "experimental-param-classes", prefKey: "experimentalParamClassesEnabled", ariaKey: "aria_experimental_params" },
];

describe("#925 — the remaining surfaced boolean prefs are all ON by default", () => {
  for (const { prefKey } of BOOLEAN_CONTROLS) {
    test(`PREF_DEFAULTS.${prefKey} is true`, () => {
      assert.strictEqual(
        PREF_DEFAULTS[prefKey], true,
        `${prefKey} must default to true so the surfaced toggle matches existing behaviour`
      );
    });
  }
});

describe("#925 — each surfaced toggle has an HTML row and a bindToggle wiring", () => {
  for (const { id, prefKey, ariaKey } of BOOLEAN_CONTROLS) {
    test(`#${id} checkbox exists with data-i18n-aria-label="${ariaKey}"`, () => {
      assert.ok(
        optionsHtml.includes(`id="${id}"`),
        `options.html must contain a checkbox with id="${id}"`
      );
      assert.ok(
        optionsHtml.includes(`data-i18n-aria-label="${ariaKey}"`),
        `the #${id} row must carry data-i18n-aria-label="${ariaKey}"`
      );
    });

    test(`options.js binds #${id} to "${prefKey}"`, () => {
      assert.ok(
        optionsJs.includes(`bindToggle("${id}", "${prefKey}", prefs)`),
        `options.js must call bindToggle("${id}", "${prefKey}", prefs)`
      );
    });
  }
});

describe("#1355 — canonical-extractor / experimental-param-classes have an HTML row and bindToggle wiring", () => {
  for (const { id, prefKey, ariaKey } of DEV_TOOLS_CONTROLS) {
    test(`#${id} checkbox exists with data-i18n-aria-label="${ariaKey}"`, () => {
      assert.ok(optionsHtml.includes(`id="${id}"`), `options.html must contain a checkbox with id="${id}"`);
      assert.ok(
        optionsHtml.includes(`data-i18n-aria-label="${ariaKey}"`),
        `the #${id} row must carry data-i18n-aria-label="${ariaKey}"`
      );
    });

    test(`options.js binds #${id} to "${prefKey}"`, () => {
      assert.ok(
        optionsJs.includes(`bindToggle("${id}", "${prefKey}", prefs)`),
        `options.js must call bindToggle("${id}", "${prefKey}", prefs)`
      );
    });
  }
});

// #1355: these two controls moved OUT of the dev-mode-gated Advanced card
// and INTO the devToolsMode-gated Developer tools panel (#dev-tools-panel).
// Moved, not retired: both stay real, default-preserving, exported prefs.
describe("#1355 — canonical-extractor / experimental-param-classes live inside #dev-tools-panel, not #dev-tools-card", () => {
  const cardIdx = optionsHtml.indexOf('id="dev-tools-card"');
  const panelIdx = optionsHtml.indexOf('id="dev-tools-panel"');
  const verIdx = optionsHtml.indexOf("version-info");

  for (const { id } of DEV_TOOLS_CONTROLS) {
    test(`#${id} appears inside #dev-tools-panel, after #dev-tools-card`, () => {
      const idx = optionsHtml.indexOf(`id="${id}"`);
      assert.ok(idx > panelIdx && idx < verIdx, `#${id} must be inside #dev-tools-panel`);
      assert.ok(idx > cardIdx, `#${id} must come after #dev-tools-card opens (sanity: document order)`);
    });
  }

  test("neither control remains inside #dev-tools-card", () => {
    const cardBlock = optionsHtml.slice(cardIdx, panelIdx);
    for (const { id } of DEV_TOOLS_CONTROLS) {
      assert.ok(!cardBlock.includes(`id="${id}"`), `#${id} must not remain inside #dev-tools-card`);
    }
  });
});

describe("#1355 — canonicalExtractorEnabled / experimentalParamClassesEnabled defaults are unchanged by the move", () => {
  test("canonicalExtractorEnabled still defaults to true", () => {
    assert.strictEqual(PREF_DEFAULTS.canonicalExtractorEnabled, true);
  });
  test("experimentalParamClassesEnabled still defaults to false (unpromoted experimental flag)", () => {
    assert.strictEqual(PREF_DEFAULTS.experimentalParamClassesEnabled, false);
  });
});

describe("#925 — surfaced controls live inside the dev-mode-gated Advanced card", () => {
  const cardIdx = optionsHtml.indexOf('id="dev-tools-card"');
  const verIdx = optionsHtml.indexOf("version-info");

  for (const { id } of BOOLEAN_CONTROLS) {
    test(`#${id} appears inside #dev-tools-card`, () => {
      const idx = optionsHtml.indexOf(`id="${id}"`);
      assert.ok(idx > cardIdx && idx < verIdx, `#${id} must be inside the gated Advanced card`);
    });
  }
});

describe("#925 — userCustomRules view/remove editor", () => {
  test("options.html contains the #user-custom-rules-items list container", () => {
    assert.ok(
      optionsHtml.includes('id="user-custom-rules-items"'),
      "options.html must contain the userCustomRules list container"
    );
  });

  test("options.js renders userCustomRules through the shared renderList path", () => {
    assert.ok(
      /renderList\("user-custom-rules-items", *prefs\.userCustomRules/.test(optionsJs),
      "init() must render userCustomRules via renderList"
    );
  });

  test("removeEntry containerMap maps userCustomRules to its container", () => {
    assert.ok(
      optionsJs.includes('userCustomRules: "user-custom-rules-items"'),
      "removeEntry containerMap must include the userCustomRules → user-custom-rules-items mapping"
    );
  });
});

describe("#925 — export/import round-trips the newly-surfaced prefs", () => {
  // #973 follow-up: export/import logic moved to the pure src/lib/settings-schema.js
  // (buildExportPayload/planImport/BOOLEAN_KEYS), single source of truth for options.js.
  test("export payload includes the three privacy booleans", () => {
    const prefs = { canonicalExtractorEnabled: true, crossSiteFrequencyEnabled: true, attributionLedgerEnabled: true };
    const payload = buildExportPayload(prefs, { devMode: false, appVersion: "1.0.0" });
    for (const key of ["canonicalExtractorEnabled", "crossSiteFrequencyEnabled", "attributionLedgerEnabled"]) {
      assert.strictEqual(payload[key], true, `export payload must include ${key}`);
    }
  });

  test("BOOLEAN_KEYS includes the three privacy booleans", () => {
    for (const key of ["canonicalExtractorEnabled", "crossSiteFrequencyEnabled", "attributionLedgerEnabled"]) {
      assert.ok(BOOLEAN_KEYS.includes(key), `BOOLEAN_KEYS must include ${key} so import applies it`);
    }
  });

  test("userCustomRules is exported and validated on import", () => {
    const payload = buildExportPayload({ userCustomRules: ["ref_code"] }, { devMode: false, appVersion: "1.0.0" });
    assert.deepStrictEqual(payload.userCustomRules, ["ref_code"], "export payload must include userCustomRules");

    const plan = planImport({
      muga: true, blacklist: [], whitelist: [], customParams: [],
      userCustomRules: ["ref_code", "q", "bad entry"],
    });
    assert.deepStrictEqual(plan.toSave.userCustomRules, ["ref_code"], "import must validate userCustomRules entries with isValidCustomParam");
  });
});

// #1355/#1354 (ADR-0011 internal-with-a-default): paramBreakdown is retired
// entirely. It was a display sub-toggle whose label said "in the popup"
// (#1354); under ADR-0011 the removed-parameter breakdown IS the popup
// glance, so it now always renders when there is something to show, with no
// toggle. A settings export made before this change may still carry the
// key — it must import cleanly, ignored, never thrown on.
describe("#1355/#1354 — paramBreakdown is retired", () => {
  const popupJs = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");

  test("PREF_DEFAULTS no longer has paramBreakdown", () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "paramBreakdown"));
  });

  test("options.html has no #param-breakdown control", () => {
    assert.ok(!optionsHtml.includes('id="param-breakdown"'));
  });

  test("options.js no longer binds #param-breakdown", () => {
    assert.ok(!optionsJs.includes('"param-breakdown"'));
  });

  test("popup.js no longer gates the breakdown on prefs.paramBreakdown", () => {
    assert.ok(!popupJs.includes("prefs.paramBreakdown"));
  });

  test("popup.js still renders the breakdown unconditionally when there are removed params", () => {
    assert.ok(
      /if\s*\(\s*result\.removedTracking\?\.length\s*>\s*0\s*\)/.test(popupJs),
      "the per-page breakdown must render whenever there is something to show, no pref gate",
    );
    assert.ok(
      /if\s*\(\s*entry\.removedTracking\?\.length\s*>\s*0\s*\)/.test(popupJs),
      "the per-history-entry breakdown must render whenever there is something to show, no pref gate",
    );
  });

  test("a legacy export carrying paramBreakdown imports cleanly (key ignored, no throw)", () => {
    const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [], paramBreakdown: true });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.toSave.paramBreakdown, undefined);
  });
});

describe("#925/#936 — new i18n keys are complete across all locales", () => {
  const newKeys = [
    "section_general", "section_rules_lists", "section_privacy_controls",
    "section_display", "section_user_custom_rules", "user_custom_rules_hint",
    ...BOOLEAN_CONTROLS.flatMap(({ ariaKey }) => ariaKey),
    "row_canonical_extractor_label", "row_canonical_extractor_hint",
    "row_cross_site_frequency_label", "row_cross_site_frequency_hint",
    "row_attribution_ledger_label", "row_attribution_ledger_hint",
    "row_show_report_button_label", "row_show_report_button_hint",
    "row_domain_stats_label", "row_domain_stats_hint",
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

  test("the retired single-item section headings are gone", () => {
    assert.ok(!("section_features" in TRANSLATIONS), "section_features must be removed (merged into General)");
    assert.ok(!("section_language" in TRANSLATIONS), "section_language must be removed (merged into General)");
  });
});
