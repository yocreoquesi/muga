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
      /import\s*\{\s*ACTIVITY_SCOPES,\s*DEFAULT_ACTIVITY_SCOPE,\s*planActivityScopeView\s*\}\s*from\s*["']\.\.\/lib\/activity-scope-view\.js["']/,
    );
    assert.match(optionsJs, /import\s*\{\s*presentLedger,\s*DEFAULT_LEDGER_CAPACITY\s*\}\s*from\s*["']\.\.\/lib\/attribution-ledger\.js["']/);
    assert.match(optionsJs, /import\s*\{\s*renderEntries as renderLedgerEntries\s*\}\s*from\s*["']\.\.\/lib\/attribution-ledger-view\.js["']/);
  });

  test("declares renderActivityLedgerPanel and calls it during init", () => {
    assert.match(optionsJs, /async function\s+renderActivityLedgerPanel\s*\(/);
    assert.match(optionsJs, /await renderActivityLedgerPanel\(_currentLang\);/);
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
    assert.match(body, /presentLedger\(ledger\)/);
    assert.match(body, /renderLedgerEntries\(/);
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
