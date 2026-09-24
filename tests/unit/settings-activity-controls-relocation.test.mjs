/**
 * MUGA — Recording switches + Reset stats relocated into Settings > Activity
 * (#1398), Recent-activity clear-on-disable + explicit Clear button (#1390),
 * and Activity panels re-render after their destructive Advanced buttons
 * write (#1392).
 *
 * #1398 (maintainer decision, 2026-09-24): "move the recording switches
 * (domain stats, cross-site frequency, recent activity) and Reset stats INTO
 * the Settings > Activity section, each next to the panel it controls,
 * together with a way to clear that panel's data (see #1390). Advanced keeps
 * no duplicates."
 *
 * #1390 (scoped by #1398's decision): turning off Recent activity must clear
 * the stored ledger and show a distinct empty state (not the generic
 * ledger_empty), and a Clear button must exist so clearing the panel never
 * requires flipping the switch.
 *
 * #1392 (triage, reduced scope, 2026-09-24): "Reset stats" and "Forget
 * reported params" write to storage and toast, but never re-rendered the
 * Activity panel that reads the data they just cleared.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

function activitySection() {
  const m = optionsHtml.match(/<section id="section-activity" hidden>[\s\S]*?<\/section>/);
  assert.ok(m, "#section-activity must be a well-formed <section>");
  return m[0];
}

function advancedCard() {
  const start = optionsHtml.indexOf('id="dev-tools-card"');
  const end = optionsHtml.indexOf('data-i18n="section_data"');
  assert.ok(start !== -1 && end !== -1, "the dev-mode-gated Advanced card must exist");
  return optionsHtml.slice(start, end);
}

// ── 1. #1398: switches + Reset stats live in Activity, not Advanced ───────

describe("#1398 — recording switches and Reset stats live in Settings > Activity", () => {
  test("#domain-stats, #cross-site-frequency, #attribution-ledger each appear exactly once in options.html", () => {
    for (const id of ["domain-stats", "cross-site-frequency", "attribution-ledger"]) {
      const count = (optionsHtml.match(new RegExp(`id="${id}"`, "g")) || []).length;
      assert.equal(count, 1, `#${id} must appear exactly once (no duplicate left in Advanced)`);
    }
  });

  test("#reset-stats-btn appears exactly once, inside #section-activity", () => {
    const count = (optionsHtml.match(/id="reset-stats-btn"/g) || []).length;
    assert.equal(count, 1, "#reset-stats-btn must appear exactly once (no duplicate left in Advanced)");
    assert.match(activitySection(), /id="reset-stats-btn"/);
  });

  test("the three switches live inside #section-activity", () => {
    const section = activitySection();
    for (const id of ["domain-stats", "cross-site-frequency", "attribution-ledger"]) {
      assert.match(section, new RegExp(`id="${id}"`), `#${id} must live inside #section-activity`);
    }
  });

  test("the Advanced card no longer contains the three switches or Reset stats", () => {
    const advanced = advancedCard();
    for (const id of ["domain-stats", "cross-site-frequency", "attribution-ledger", "reset-stats-btn"]) {
      assert.doesNotMatch(advanced, new RegExp(`id="${id}"`), `#${id} must not remain in the Advanced card`);
    }
  });

  test("Advanced still has \"Forget reported params\" (not part of #1398's move)", () => {
    assert.match(advancedCard(), /id="forget-reported-params-btn"/);
  });

  test("the empty Advanced > Privacy card and its heading are removed", () => {
    assert.doesNotMatch(optionsHtml, /data-i18n="section_privacy_controls"/);
  });

  test("every moved switch is aria-labelledby its visible row label (#1407 pattern)", () => {
    for (const id of ["domain-stats", "cross-site-frequency", "attribution-ledger"]) {
      assert.match(
        optionsHtml,
        new RegExp(`id="${id}" aria-labelledby="${id}-label"`),
        `#${id} must be aria-labelledby="${id}-label"`,
      );
      assert.match(
        optionsHtml,
        new RegExp(`<label class="row-label" for="${id}">`),
        `#${id}'s row text must be a <label class="row-label" for="${id}">`,
      );
    }
  });
});

// ── 2. #1390: Clear button + toggle-off clears the ledger ─────────────────

describe("#1390 — Recent activity: Clear button and clear-on-disable", () => {
  test("options.html declares a Clear button positioned after activity-recent-panel opens", () => {
    const section = activitySection();
    const panelIdx = section.indexOf('id="activity-recent-panel"');
    const clearBtnIdx = section.indexOf('id="activity-ledger-clear-btn"');
    const listIdx = section.indexOf('id="activity-recent-list"');
    assert.ok(panelIdx !== -1 && clearBtnIdx !== -1 && listIdx !== -1, "all three anchors must exist");
    assert.ok(panelIdx < clearBtnIdx, "the Clear button must be inside activity-recent-panel");
    assert.ok(clearBtnIdx < listIdx, "the Clear button must sit next to the list it clears, not after it in an unrelated place");
  });

  test("options.js wires the Clear button to confirm, clear attributionLedger, then re-render", () => {
    const idx = optionsJs.indexOf('getElementById("activity-ledger-clear-btn")');
    assert.ok(idx !== -1, "activity-ledger-clear-btn must be wired");
    const block = optionsJs.slice(idx, idx + 700);
    const confirmAt = block.indexOf("showConfirm(");
    const clearAt = block.indexOf("chrome.storage.local.set({ attributionLedger:");
    const renderAt = block.indexOf("renderActivityLedgerPanel(_currentLang, prefs.attributionLedgerEnabled)");
    assert.ok(confirmAt > -1, "Clear button must confirm before wiping data");
    assert.ok(clearAt > confirmAt, "Clear button must clear attributionLedger after confirming");
    assert.ok(renderAt > clearAt, "Clear button must re-render the panel after clearing");
  });

  test("options.js clears attributionLedger and re-renders when the switch flips off", () => {
    const idx = optionsJs.indexOf('getElementById("attribution-ledger")?.addEventListener("change"');
    assert.ok(idx !== -1, "the attribution-ledger toggle handler must exist");
    const block = optionsJs.slice(idx, idx + 700);
    assert.match(block, /chrome\.storage\.local\.set\(\{\s*attributionLedger:/, "must clear the attributionLedger storage key when disabled");
    // b5-3 audit fix: the handler passes its own `enabled` (the checkbox's
    // own just-changed `checked` value) into the render call, rather than
    // letting the render re-read chrome.storage.sync — see the toggle-race
    // test below and the fix note on renderActivityLedgerPanel's definition.
    assert.match(block, /renderActivityLedgerPanel\(_currentLang,\s*enabled\)/, "must re-render the panel after the toggle changes, passing the known in-memory enabled state");
  });

  test("renderActivityLedgerPanel shows a distinct disabled empty state, not ledger_empty, when attributionLedgerEnabled is false", () => {
    const start = optionsJs.indexOf("async function renderActivityLedgerPanel(");
    assert.ok(start !== -1);
    let depth = 0, i = optionsJs.indexOf("{", start);
    const bodyStart = i;
    for (; i < optionsJs.length; i++) {
      if (optionsJs[i] === "{") depth++;
      else if (optionsJs[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = optionsJs.slice(bodyStart, i + 1);
    assert.match(body, /attributionLedgerEnabled/, "must read attributionLedgerEnabled from prefs");
    assert.match(
      body,
      /if\s*\(\s*!attributionLedgerEnabled\s*\)\s*\{[\s\S]*?ledger_disabled_empty/,
      "the disabled branch must render ledger_disabled_empty, not ledger_empty",
    );
  });

  test("b5-3 audit fix: renderActivityLedgerPanel accepts the known enabled state instead of always re-reading storage", () => {
    // Superseded invariant: this test used to pin that init() called
    // renderActivityLedgerPanel(_currentLang) with NO extra argument, on the
    // theory that the enabled/disabled gating must always be read INSIDE the
    // function via getPrefs(). That was the actual bug: the attribution-ledger
    // toggle handler writes the pref via bindToggle()'s async setPrefs() call
    // and re-renders in the same tick, so a getPrefs() read inside the render
    // could resolve before that write lands and see the stale (pre-toggle)
    // value, showing "recording is on" copy for a moment right after the user
    // turned it off. The fix widens the signature so every call site that
    // already knows the current value (the toggle handler has the checkbox's
    // own `checked`; init and the Clear button have the freshly-loaded
    // `prefs` object) passes it directly, and getPrefs() is only a fallback
    // for a hypothetical caller with no better source.
    assert.match(
      optionsJs,
      /async function\s+renderActivityLedgerPanel\s*\(\s*lang,\s*attributionLedgerEnabledOverride\s*\)/,
      "renderActivityLedgerPanel must accept an explicit override parameter",
    );
    assert.match(optionsJs, /await renderActivityLedgerPanel\(_currentLang,\s*prefs\.attributionLedgerEnabled\)\s*\.catch\(\s*\(err\)\s*=>\s*\{/);
  });
});

// ── 3. #1392: destructive Advanced buttons re-render Activity panels ──────

describe("#1392 — Reset stats / Forget reported params re-render their Activity panel", () => {
  test("reset-stats-btn's handler calls renderDomainStatsActivity after writing", () => {
    const at = optionsJs.indexOf('getElementById("reset-stats-btn")');
    assert.ok(at > -1);
    const handler = optionsJs.slice(at, at + 1200);
    const writeAt = handler.indexOf("chrome.storage.local.set");
    const toastAt = handler.indexOf("showToast(");
    const renderAt = handler.indexOf("renderDomainStatsActivity(");
    assert.ok(writeAt > -1 && toastAt > writeAt, "must toast after writing");
    assert.ok(renderAt > toastAt, "must call renderDomainStatsActivity after the toast");
  });

  test("forget-reported-params-btn's handler calls renderSuspiciousParamsActivity after writing", () => {
    const at = optionsJs.indexOf('getElementById("forget-reported-params-btn")');
    assert.ok(at > -1);
    const handler = optionsJs.slice(at, at + 1200);
    const writeAt = handler.indexOf("chrome.storage.local.set");
    const toastAt = handler.indexOf("showToast(");
    const renderAt = handler.indexOf("renderSuspiciousParamsActivity(");
    assert.ok(writeAt > -1 && toastAt > writeAt, "must toast after writing");
    assert.ok(renderAt > toastAt, "must call renderSuspiciousParamsActivity after the toast");
  });

  test("both destructive buttons still confirm before writing (#1260 unchanged)", () => {
    for (const id of ["reset-stats-btn", "forget-reported-params-btn"]) {
      const at = optionsJs.indexOf(id);
      const handler = optionsJs.slice(at, at + 900);
      const confirmAt = handler.indexOf("showConfirm(");
      const writeAt = handler.indexOf("chrome.storage.local.set");
      assert.ok(confirmAt > -1 && writeAt > confirmAt, `${id} must still confirm before writing`);
    }
  });
});

// ── 4. i18n: new keys exist, non-empty, no em dash, in all 7 locales ──────

describe("i18n — new #1390 keys exist in all locales", () => {
  const NEW_KEYS = [
    "ledger_disabled_empty",
    "activity_ledger_clear_label",
    "activity_ledger_clear_hint",
    "activity_ledger_clear_btn",
    "activity_ledger_clear_confirm",
    "activity_ledger_clear_done",
  ];

  test("all six keys exist and are non-empty in every supported locale, with no em dash", async () => {
    const { TRANSLATIONS, SUPPORTED_LANGS } = await import("../../src/lib/i18n.js");
    for (const key of NEW_KEYS) {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `${key} must exist in TRANSLATIONS`);
      for (const { code } of SUPPORTED_LANGS) {
        assert.ok(typeof entry[code] === "string" && entry[code].length > 0, `${key}.${code} must be a non-empty string`);
        assert.ok(!entry[code].includes("—"), `${key}.${code} must not contain an em dash`);
      }
    }
  });

  test("de keys address the user as du (no Sie/Ihr/Ihnen)", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    for (const key of NEW_KEYS) {
      const de = TRANSLATIONS[key].de;
      assert.doesNotMatch(de, /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/, `${key}.de must use du, not Sie/Ihr: ${de}`);
    }
  });
});
