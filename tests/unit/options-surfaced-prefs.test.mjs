/**
 * MUGA — #925/#936 guards for the newly-surfaced Advanced controls.
 *
 * #925 surfaced seven previously UI-less prefs as Advanced controls:
 *   - Privacy toggles:  canonicalExtractorEnabled, crossSiteFrequencyEnabled,
 *                       attributionLedgerEnabled
 *   - Display toggles:  paramBreakdown, showReportButton, domainStats
 *     (paramBreakdown and showReportButton were later retired — #1355/#1354 —
 *     see the dedicated retirement describe blocks below)
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

// ── Real DOM-nesting check (#1355 R3-003/R3-004) ────────────────────────────
//
// A previous version of the containment tests below only compared string
// offsets ("this id's index is greater than that id's index and less than
// this other one") — that proves an id appears somewhere in a stretch of
// TEXT, never that it is an actual DESCENDANT of a given container element.
// Two sibling <div>s at the same nesting depth, or an id placed AFTER a
// container's closing tag but still before some unrelated later marker,
// would satisfy the old check just as well as real nesting would.
//
// options.html is our own controlled, well-formed template — no <div> tags
// inside HTML comments (verified), every <div> explicitly closed — so a
// plain balanced-tag walk is sufficient here without pulling in a full HTML
// parser (none of jsdom/linkedom/happy-dom is a project devDependency, and
// adding one is out of scope for a test-only fix). Comments are stripped
// first anyway, defensively, so a future edit that mentions "<div" in a
// comment can't silently corrupt the depth count.

/** Strips HTML comments so they can never be mistaken for real tags. */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * True when `id="childId"` appears strictly inside the matching, balanced
 * closing tag of `<div id="containerId">` — real DOM nesting, not merely
 * "later in the text". Throws (fails loudly, not silently false) if the
 * container id or its balanced close can't be found, so a typo'd id or a
 * genuinely unbalanced template is a visible test error, not a false pass.
 *
 * @param {string} html
 * @param {string} containerId
 * @param {string} childId
 * @returns {boolean}
 */
function isNestedInsideDiv(html, containerId, childId) {
  const clean = stripHtmlComments(html);
  const markerIdx = clean.indexOf(`id="${containerId}"`);
  if (markerIdx === -1) throw new Error(`isNestedInsideDiv: container id="${containerId}" not found`);
  const openTagEnd = clean.indexOf(">", markerIdx);
  if (openTagEnd === -1) throw new Error(`isNestedInsideDiv: unterminated opening tag for id="${containerId}"`);

  const tagRe = /<div\b|<\/div>/g;
  tagRe.lastIndex = openTagEnd + 1;
  let depth = 1; // already inside the container's own <div>
  let closeIdx = -1;
  let m;
  while ((m = tagRe.exec(clean)) !== null) {
    if (m[0] === "</div>") {
      depth--;
      if (depth === 0) { closeIdx = m.index; break; }
    } else {
      depth++;
    }
  }
  if (closeIdx === -1) throw new Error(`isNestedInsideDiv: no balanced closing </div> found for id="${containerId}"`);

  const childIdx = clean.indexOf(`id="${childId}"`);
  if (childIdx === -1) return false;
  return childIdx > openTagEnd && childIdx < closeIdx;
}

// Each surfaced boolean pref → { id, prefKey }. #1407: every switch is
// aria-labelledby its visible row label (`${id}-label`), not a separate key.
// #1355: canonicalExtractorEnabled moved into the devToolsMode-gated
// Developer tools panel — see the dedicated describe block below — so it is
// no longer part of the dev-mode-gated-Advanced-card group tested here.
// paramBreakdown was retired entirely (#1355/#1354: the popup glance shows
// the breakdown unconditionally now) — see the retirement describe block
// below instead of listing it here.
const BOOLEAN_CONTROLS = [
  { id: "cross-site-frequency", prefKey: "crossSiteFrequencyEnabled" },
  { id: "attribution-ledger",   prefKey: "attributionLedgerEnabled" },
  { id: "domain-stats",         prefKey: "domainStats" },
];

// #1355 (ADR-0011 internal-with-a-default): canonicalExtractorEnabled's
// control moved into Developer tools; experimentalParamClassesEnabled's
// control moved there too (previously in the dev-mode-gated Advanced card,
// same as the ones above). Both stay real, user-settable, exported prefs —
// only their Settings location changed.
const DEV_TOOLS_CONTROLS = [
  { id: "canonical-extractor",      prefKey: "canonicalExtractorEnabled" },
  { id: "experimental-param-classes", prefKey: "experimentalParamClassesEnabled" },
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
  for (const { id, prefKey } of BOOLEAN_CONTROLS) {
    test(`#${id} checkbox exists, labelled by its visible row label`, () => {
      assert.ok(
        optionsHtml.includes(`id="${id}"`),
        `options.html must contain a checkbox with id="${id}"`
      );
      assert.ok(
        optionsHtml.includes(`id="${id}" aria-labelledby="${id}-label"`),
        `the #${id} switch must be aria-labelledby its visible row label`
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
  for (const { id, prefKey } of DEV_TOOLS_CONTROLS) {
    test(`#${id} checkbox exists, labelled by its visible row label`, () => {
      assert.ok(optionsHtml.includes(`id="${id}"`), `options.html must contain a checkbox with id="${id}"`);
      assert.ok(
        optionsHtml.includes(`id="${id}" aria-labelledby="${id}-label"`),
        `the #${id} switch must be aria-labelledby its visible row label`
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
  for (const { id } of DEV_TOOLS_CONTROLS) {
    test(`#${id} is a real DOM descendant of #dev-tools-panel`, () => {
      assert.ok(
        isNestedInsideDiv(optionsHtml, "dev-tools-panel", id),
        `#${id} must be an actual descendant of <div id="dev-tools-panel">, not merely later in the file`,
      );
    });

    test(`#${id} is NOT a descendant of #dev-tools-card`, () => {
      assert.ok(
        !isNestedInsideDiv(optionsHtml, "dev-tools-card", id),
        `#${id} must not remain a descendant of <div id="dev-tools-card">`,
      );
    });
  }
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
  for (const { id } of BOOLEAN_CONTROLS) {
    test(`#${id} is a real DOM descendant of #dev-tools-card`, () => {
      assert.ok(
        isNestedInsideDiv(optionsHtml, "dev-tools-card", id),
        `#${id} must be an actual descendant of <div id="dev-tools-card">, not merely later in the file`,
      );
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

  test("popup.js's per-page preview breakdown still renders unconditionally when there are removed params", () => {
    assert.ok(
      /if\s*\(\s*result\.removedTracking\?\.length\s*>\s*0\s*\)/.test(popupJs),
      "the per-page breakdown must render whenever there is something to show, no pref gate",
    );
  });

  // #1352: the per-history-entry breakdown moved to options.js along with
  // the rest of the "This session" ledger (showHistory, now
  // renderActivityLedgerPanel/_buildSessionHistoryRow) — popup.js no longer
  // has a history entry to gate at all.
  test("options.js's per-history-entry breakdown still renders unconditionally when there are removed params", () => {
    assert.ok(
      /if\s*\(\s*entry\.removedTracking\?\.length\s*>\s*0\s*\)/.test(optionsJs),
      "the per-history-entry breakdown must render whenever there is something to show, no pref gate",
    );
  });

  test("a legacy export carrying paramBreakdown imports cleanly (key ignored, no throw)", () => {
    const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [], paramBreakdown: true });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.toSave.paramBreakdown, undefined);
  });
});

// #1355/#1354 (ADR-0011 internal-with-a-default): showReportButton is
// retired entirely along with the popup's own report flow. Reporting now
// lives in Settings (#1353, section-report) — see
// tests/unit/report-button.test.mjs for the full retirement coverage
// (i18n keys, popup markup, popup.js). This block covers the Settings side.
describe("#1355/#1354 — showReportButton is retired", () => {
  test("PREF_DEFAULTS no longer has showReportButton", () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "showReportButton"));
  });

  test("options.html has no #show-report-button control", () => {
    assert.ok(!optionsHtml.includes('id="show-report-button"'));
  });

  test("options.js no longer binds #show-report-button", () => {
    assert.ok(!optionsJs.includes('"show-report-button"'));
  });

  test("showReportButton is not in SETTINGS_FIELDS/BOOLEAN_KEYS", () => {
    assert.ok(!BOOLEAN_KEYS.includes("showReportButton"));
  });

  test("a legacy export carrying showReportButton imports cleanly (key ignored, no throw)", () => {
    const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [], showReportButton: true });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.toSave.showReportButton, undefined);
  });
});

describe("#925/#936 — new i18n keys are complete across all locales", () => {
  const newKeys = [
    "section_general", "section_rules_lists", "section_privacy_controls",
    "section_display", "section_user_custom_rules", "user_custom_rules_hint",
    "row_canonical_extractor_label", "row_canonical_extractor_hint",
    "row_cross_site_frequency_label", "row_cross_site_frequency_hint",
    "row_attribution_ledger_label", "row_attribution_ledger_hint",
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
