/**
 * MUGA — Unified Activity ledger panel (#1352)
 *
 * The maintainer decided (issue #1352 comment, 2026-09-24): merge the
 * popup's two ledgers ("This session" / former showHistory and "Recent
 * activity" / former showRecentActivity) into ONE Activity panel in
 * Settings, with a scope control switching between the two, rather than
 * two separate panels. This mirrors the guard-test shape #1350/#1351 used
 * (tests/unit/settings-activity-domain-stats.test.mjs,
 * tests/unit/settings-activity-suspicious-params.test.mjs).
 *
 * These tests pin the Settings side:
 *   1. No duplicate DOM ids in options.html.
 *   2. #section-activity hosts a single activity-ledger-panel with a real
 *      fieldset/legend/radio scope control (not a synthetic ARIA widget).
 *   3. options.js wires both scopes from the pure view modules and
 *      participates in updateActivitySectionVisibility().
 *
 * The companion "popup no longer renders either ledger" guard lands in the
 * commit that actually removes them from popup.html/popup.js (see the
 * describe block appended there), so this file's assertions are true at
 * every commit tip that includes it.
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
const popupHtml = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");
const popupJs = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");

/** Extracts every `id="..."` value from raw HTML, ignoring HTML comments. */
function extractIds(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(withoutComments)) !== null) ids.push(m[1]);
  return ids;
}

describe("options.html — no duplicate DOM ids (still holds after #1352)", () => {
  test("every id attribute in options.html is unique", () => {
    const ids = extractIds(optionsHtml);
    const seen = new Map();
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
    const dupes = [...seen].filter(([, count]) => count > 1).map(([id, count]) => `${id} (${count}x)`);
    assert.deepStrictEqual(dupes, [], `duplicate ids found in options.html: ${dupes.join(", ")}`);
  });
});

describe("options.html — #section-activity hosts the unified activity-ledger-panel", () => {
  function activitySection() {
    const m = optionsHtml.match(/<section id="section-activity" hidden>[\s\S]*?<\/section>/);
    assert.ok(m, "#section-activity must be a well-formed <section>");
    return m[0];
  }

  test("activity-ledger-panel lives inside #section-activity", () => {
    assert.match(activitySection(), /id="activity-ledger-panel"/);
  });

  test("the scope control is a real fieldset/legend, not a synthetic ARIA widget", () => {
    const section = activitySection();
    assert.match(section, /<fieldset[^>]*class="activity-scope-fieldset"[^>]*>/);
    assert.match(section, /<legend[^>]*data-i18n="activity_ledger_label"/);
  });

  test("the scope control uses two real radio inputs sharing one name (keyboard-operable natively)", () => {
    const section = activitySection();
    const radios = [...section.matchAll(/<input type="radio" name="activity-scope"[^>]*>/g)];
    assert.strictEqual(radios.length, 2, "expected exactly 2 radio inputs in the scope control");
    assert.match(section, /id="activity-scope-session"[^>]*value="session"[^>]*checked/);
    assert.match(section, /id="activity-scope-recent"[^>]*value="recent"/);
  });

  test("both sub-panels exist with list + empty-state slots", () => {
    const section = activitySection();
    assert.match(section, /id="activity-session-panel"/);
    assert.match(section, /id="activity-session-list"/);
    assert.match(section, /id="activity-session-empty"/);
    assert.match(section, /id="activity-recent-panel"[^>]*hidden/);
    assert.match(section, /id="activity-recent-list"/);
    assert.match(section, /id="activity-recent-empty"/);
  });

  test("reuses the popup's original labels for the two scope options (no new strings for existing copy)", () => {
    const section = activitySection();
    assert.match(section, /data-i18n="history_label"/, "session scope option must reuse history_label (\"This session\")");
    assert.match(section, /data-i18n="ledger_section_title"/, "recent scope option must reuse ledger_section_title (\"Recent activity\")");
  });
});

describe("options.js — renders and wires the unified Activity ledger panel", () => {
  test("imports the pure view modules for both scopes", () => {
    assert.match(optionsJs, /import\s*\{\s*planSessionHistoryView\s*\}\s*from\s*["']\.\.\/lib\/session-history-view\.js["']/);
    assert.match(
      optionsJs,
      /import\s*\{\s*ACTIVITY_SCOPES,\s*DEFAULT_ACTIVITY_SCOPE,\s*isValidActivityScope,\s*planActivityScopeView\s*\}\s*from\s*["']\.\.\/lib\/activity-scope-view\.js["']/,
    );
    assert.match(optionsJs, /import\s*\{\s*presentLedger,\s*DEFAULT_LEDGER_CAPACITY,\s*EVENT_TYPES\s*\}\s*from\s*["']\.\.\/lib\/attribution-ledger\.js["']/);
    assert.match(optionsJs, /import\s*\{\s*renderEntries as renderLedgerEntries\s*\}\s*from\s*["']\.\.\/lib\/attribution-ledger-view\.js["']/);
  });

  test("declares renderActivityLedgerPanel and calls it during init", () => {
    assert.match(optionsJs, /async function\s+renderActivityLedgerPanel\s*\(/);
    assert.match(optionsJs, /await renderActivityLedgerPanel\(_currentLang\)/);
  });

  // R3-init-abort-on-render-throw
  test("the init() call site never lets renderActivityLedgerPanel's rejection escape uncaught", () => {
    assert.match(
      optionsJs,
      /await renderActivityLedgerPanel\(_currentLang\)\s*\.catch\(\s*\(err\)\s*=>\s*\{/,
      "init() must .catch() renderActivityLedgerPanel so a throw there cannot abort the rest of init()",
    );
  });

  test("declares a scope-application helper that reads planActivityScopeView", () => {
    assert.match(optionsJs, /function\s+_applyActivityScopeView\s*\(/);
    const start = optionsJs.indexOf("function _applyActivityScopeView(");
    const end = optionsJs.indexOf("\n}", start);
    const body = optionsJs.slice(start, end);
    assert.match(body, /planActivityScopeView\(_activityLedgerScope\)/);
    assert.match(body, /sessionPanel\.hidden\s*=\s*sessionPanelHidden/);
    assert.match(body, /recentPanel\.hidden\s*=\s*recentPanelHidden/);
  });

  test("wires both radio inputs to update the scope and re-apply the view", () => {
    assert.match(
      optionsJs,
      /getElementById\("activity-scope-session"\)\?\.addEventListener\("change",\s*\(\)\s*=>\s*\{[\s\S]*?ACTIVITY_SCOPES\.SESSION[\s\S]*?_applyActivityScopeView\(\);[\s\S]*?\}\);/,
    );
    assert.match(
      optionsJs,
      /getElementById\("activity-scope-recent"\)\?\.addEventListener\("change",\s*\(\)\s*=>\s*\{[\s\S]*?ACTIVITY_SCOPES\.RECENT[\s\S]*?_applyActivityScopeView\(\);[\s\S]*?\}\);/,
    );
  });

  test("participates in updateActivitySectionVisibility()'s panel list", () => {
    const start = optionsJs.indexOf("function updateActivitySectionVisibility(");
    assert.ok(start !== -1);
    const end = optionsJs.indexOf("\n}", start);
    const body = optionsJs.slice(start, end);
    assert.match(body, /activity-ledger-panel/);
  });

  test("renderActivityLedgerPanel reads session history via sessionStorage and the pure view model", () => {
    const start = optionsJs.indexOf("async function renderActivityLedgerPanel(");
    assert.ok(start !== -1);
    let depth = 0, i = optionsJs.indexOf("{", start);
    const bodyStart = i;
    for (; i < optionsJs.length; i++) {
      if (optionsJs[i] === "{") depth++;
      else if (optionsJs[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = optionsJs.slice(bodyStart, i + 1);
    assert.match(body, /sessionStorage\.get\(\{\s*history:\s*\[\]\s*\}\)/);
    assert.match(body, /planSessionHistoryView\(history\)/);
    assert.match(body, /chrome\.storage\.local\.get\(\{[\s\S]*?attributionLedger/);
    assert.match(body, /presentLedger\(safeLedger\)/);
    assert.match(body, /renderLedgerEntries\(/);
  });

  // R3-init-abort-on-render-throw
  test("shape-checks ledger events before presentLedger, and wraps both sub-panel renders so a throw degrades to the empty state", () => {
    const start = optionsJs.indexOf("async function renderActivityLedgerPanel(");
    assert.ok(start !== -1);
    let depth = 0, i = optionsJs.indexOf("{", start);
    const bodyStart = i;
    for (; i < optionsJs.length; i++) {
      if (optionsJs[i] === "{") depth++;
      else if (optionsJs[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = optionsJs.slice(bodyStart, i + 1);

    // Shape-check: only object entries with a string url and a recognized
    // EVENT_TYPES member reach presentLedger.
    assert.match(body, /ev\s*&&\s*typeof ev === "object"\s*&&\s*typeof ev\.url === "string"\s*&&\s*EVENT_TYPES\.includes\(ev\.type\)/);

    // Both sub-panel renders are wrapped so a throw can't escape this
    // function (only the two storage-read try/catches existed before).
    const tryCount = (body.match(/\btry\s*\{/g) || []).length;
    assert.ok(tryCount >= 4, `expected at least 4 try blocks (2 storage reads + 2 render/shape guards); found ${tryCount}`);
    assert.match(body, /session-history render failed, degrading to empty state/);
    assert.match(body, /recent-activity render failed, degrading to empty state/);
  });
});

// ── R3-keydown-hijacks-inner-controls ───────────────────────────────────────
// Full behavioral coverage lives in tests/e2e/options.spec.mjs
// ("keyboard Enter on an inner copy button activates the button, not the
// whole row"). This pins the structural guard so a future edit can't
// silently drop the e.target check.

describe("options.js — session-history row keydown does not hijack bubbled events from inner controls", () => {
  test("the row's keydown handler only acts when the event target IS the row itself", () => {
    const idx = optionsJs.indexOf('entryDiv.addEventListener("keydown"');
    assert.ok(idx !== -1, "entryDiv keydown handler must exist");
    const block = optionsJs.slice(idx, idx + 400);
    assert.match(
      block,
      /if\s*\(\s*e\.target\s*!==\s*entryDiv\s*\)\s*return\s*;/,
      "must bail out before handling Enter/Space when the keydown bubbled from a descendant (e.g. an inner copy button)",
    );
  });
});

// ── R3-radio-state-desync ───────────────────────────────────────────────────
// Full behavioral coverage lives in tests/e2e/options.spec.mjs (the same
// "scope radio switches the visible sub-panel" test also covers the
// bfcache-restore desync case).

describe("options.js / options.html — the scope radio's checked DOM state is the single source of truth", () => {
  test("options.html marks both scope radios autocomplete=off", () => {
    const section = optionsHtml.match(/<section id="section-activity" hidden>[\s\S]*?<\/section>/)[0];
    const radios = [...section.matchAll(/<input type="radio" name="activity-scope"[^>]*>/g)].map((m) => m[0]);
    assert.strictEqual(radios.length, 2);
    for (const radio of radios) {
      assert.match(radio, /autocomplete="off"/, `radio must declare autocomplete="off": ${radio}`);
    }
  });

  test("declares _readCheckedActivityScope and uses it to initialize scope before first render", () => {
    assert.match(optionsJs, /function\s+_readCheckedActivityScope\s*\(/);
    const fnIdx = optionsJs.indexOf("function _readCheckedActivityScope(");
    const fnBody = optionsJs.slice(fnIdx, optionsJs.indexOf("\n}", fnIdx));
    assert.match(fnBody, /document\.querySelector\(\s*['"]input\[name="activity-scope"\]:checked['"]\s*\)/);
    assert.match(fnBody, /isValidActivityScope\(/);

    const setIdx = optionsJs.indexOf("_activityLedgerScope = _readCheckedActivityScope();");
    const renderIdx = optionsJs.indexOf("await renderActivityLedgerPanel(_currentLang)");
    assert.ok(setIdx !== -1, "init() must set _activityLedgerScope from _readCheckedActivityScope()");
    assert.ok(setIdx < renderIdx, "the resync must happen before the panel first renders");
  });

  test("resyncs the scope from the checked radio on a bfcache restore (pageshow persisted)", () => {
    assert.match(
      optionsJs,
      /window\.addEventListener\(\s*["']pageshow["']\s*,\s*\(e\)\s*=>\s*\{[\s\S]{0,200}e\.persisted[\s\S]{0,200}_readCheckedActivityScope\(\)[\s\S]{0,200}_applyActivityScopeView\(\);/,
      "a pageshow(persisted:true) listener must re-read the checked radio and re-apply the scope view",
    );
  });
});

describe("i18n — new Activity ledger keys exist in all locales", () => {
  test("activity_ledger_label and activity_ledger_hint are non-empty in every supported locale", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    const { SUPPORTED_LANGS } = await import("../../src/lib/i18n.js");
    for (const key of ["activity_ledger_label", "activity_ledger_hint"]) {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `${key} must exist in TRANSLATIONS`);
      for (const { code } of SUPPORTED_LANGS) {
        assert.ok(
          typeof entry[code] === "string" && entry[code].length > 0,
          `${key}.${code} must be a non-empty string`,
        );
      }
    }
  });

  test("no em dash in the new keys' translations (house style)", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    for (const key of ["activity_ledger_label", "activity_ledger_hint"]) {
      for (const [lang, value] of Object.entries(TRANSLATIONS[key])) {
        assert.ok(!value.includes("—"), `${key}.${lang} must not contain an em dash`);
      }
    }
  });
});

// ── The issue's explicit ask: popup no longer renders either ledger ────────

describe("popup.html / popup.js — no longer render either ledger (#1352)", () => {
  test("popup.html no longer declares #history", () => {
    assert.doesNotMatch(popupHtml, /id="history"/, "popup.html must not contain id=\"history\" anymore");
  });

  test("popup.html no longer declares #history-list", () => {
    assert.doesNotMatch(popupHtml, /id="history-list"/, "popup.html must not contain id=\"history-list\" anymore");
  });

  test("popup.html no longer declares #recent-activity", () => {
    assert.doesNotMatch(popupHtml, /id="recent-activity"/, "popup.html must not contain id=\"recent-activity\" anymore");
  });

  test("popup.html no longer declares #recent-activity-list or #recent-activity-empty", () => {
    assert.doesNotMatch(popupHtml, /id="recent-activity-list"/);
    assert.doesNotMatch(popupHtml, /id="recent-activity-empty"/);
  });

  test("popup.js no longer declares showHistory", () => {
    assert.doesNotMatch(popupJs, /function\s+showHistory/, "popup.js must not declare showHistory anymore");
  });

  test("popup.js no longer calls showHistory", () => {
    assert.doesNotMatch(popupJs, /showHistory\s*\(/, "popup.js must not call showHistory anymore");
  });

  test("popup.js no longer declares showRecentActivity", () => {
    assert.doesNotMatch(popupJs, /function\s+showRecentActivity/, "popup.js must not declare showRecentActivity anymore");
  });

  test("popup.js no longer calls showRecentActivity", () => {
    assert.doesNotMatch(popupJs, /showRecentActivity\s*\(/, "popup.js must not call showRecentActivity anymore");
  });

  test("popup.js no longer imports the attribution-ledger presenter/view (moved to options.js)", () => {
    assert.doesNotMatch(popupJs, /from\s+"\.\.\/lib\/attribution-ledger\.js"/);
    assert.doesNotMatch(popupJs, /from\s+"\.\.\/lib\/attribution-ledger-view\.js"/);
  });

  test("the stat-urls-wrap tile is no longer clickable (its target, #history, is gone)", () => {
    assert.doesNotMatch(popupHtml, /class="stat stat-clickable"/);
    assert.doesNotMatch(popupJs, /statUrlsWrap\.setAttribute\(\s*["']aria-controls["']/);
  });
});

// ── i18n for the ledger now rendered in Settings (#1352 review R3-002) ──
// Ported from the deleted popup-recent-activity.test.mjs, widened to all
// seven locales since the panel is user-facing in every one of them.
describe("#1352 — ledger strings the Settings panel renders", async () => {
  // Some modules touch chrome at import time; a minimal stub is enough here.
  const { makeChromeMock } = await import("./helpers/chrome-stub.mjs");
  globalThis.chrome ??= makeChromeMock();
  const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
  const LOCALES = ["en", "es", "pt", "de", "fr", "it", "ja"];
  const REQUIRED_KEYS = [
    "ledger_section_title",
    "ledger_empty",
    "ledger_badge_cleaned",
    "ledger_badge_preserve_affiliate",
    "ledger_badge_honor_creator",
    "ledger_badge_blocked_opaque",
    "ledger_creator_credit_template",
    "ledger_network_template",
    "ledger_copy_btn_label",
    "ledger_copy_btn_copied",
  ];

  for (const key of REQUIRED_KEYS) {
    test(`${key} exists and is non-empty in all 7 locales`, () => {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `${key} must exist in TRANSLATIONS`);
      for (const lang of LOCALES) {
        assert.ok(typeof entry[lang] === "string" && entry[lang].length > 0, `${key}.${lang} non-empty`);
      }
    });
  }

  test("the templates keep their placeholders in every locale", () => {
    for (const lang of LOCALES) {
      assert.ok(TRANSLATIONS.ledger_creator_credit_template[lang].includes("{creator}"), `creator template (${lang})`);
      assert.ok(TRANSLATIONS.ledger_network_template[lang].includes("{network}"), `network template (${lang})`);
    }
  });
});
