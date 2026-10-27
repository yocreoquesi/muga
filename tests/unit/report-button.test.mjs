/**
 * Tests for the retirement of the popup report button + showReportButton
 * pref (#1355, #1354; ADR-0011 internal-with-a-default).
 *
 * Reporting a problem now lives in Settings (#1353, section-report), which
 * every user can reach. The popup's own report flow — a display sub-toggle
 * for one button, hidden behind a pref most users never set — is retired
 * entirely: no #report-broken link, no #report-include-url-row, no
 * showReportButton pref, no report_dirty_url i18n key.
 *
 * #1507 brings a report back to the popup as a one-click LINK-OUT, not a
 * flow: #report-page-btn opens the broken-site.yml issue form prefilled for
 * the tab, and the consent step is the form's required privacy checkbox on
 * GitHub. Settings' report uses the same builder, so the "Include the full
 * URL" opt-in rows and their i18n keys are retired too. The link itself is
 * tested through its public builder in broken-site-report.test.mjs.
 *
 * Formerly (superseded by this file, kept as history):
 *   T2-1: Flag `showReportButton` exists in PREF_DEFAULTS and defaults to true
 *   T2-4: popup.js source does NOT gate #report-broken visibility on prefs.devMode
 *   T2-5: TRANSLATIONS has `report_dirty_url` key with both `en` and `es`
 */

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ── Import source modules ────────────────────────────────────────────────────

// storage.js uses chrome.* APIs at module level (the shim IIFE and the
// onSuspend listener). Provide a minimal stub so the module can be imported
// in a Node.js test environment without crashing.
import { makeChromeMock } from "./helpers/chrome-stub.mjs";
// Promise shape, session explicitly absent (undefined) — matches original behaviour
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
const { planImport } = await import("../../src/lib/settings-schema.js");

const popupJs = readFileSync(join(root, "src/popup/popup.js"), "utf8");
const popupHtml = readFileSync(join(root, "src/popup/popup.html"), "utf8");

// ── PREF_DEFAULTS ─────────────────────────────────────────────────────────────

test("showReportButton is retired: not in PREF_DEFAULTS", () => {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "showReportButton"),
    "PREF_DEFAULTS must not have a showReportButton key"
  );
});

// ── popup markup + source ────────────────────────────────────────────────────

test("popup.html has no #report-broken link", () => {
  assert.ok(!popupHtml.includes('id="report-broken"'));
});

test("popup.html has no #report-include-url-row", () => {
  assert.ok(!popupHtml.includes('id="report-include-url-row"'));
});

test("popup.js no longer references prefs.showReportButton", () => {
  assert.ok(!popupJs.includes("prefs.showReportButton"));
});

test("popup.js no longer references the retired report-broken DOM id", () => {
  assert.ok(!popupJs.includes('"report-broken"'));
});

// ── i18n ─────────────────────────────────────────────────────────────────────

test("report_dirty_url i18n key is retired (it named only the removed popup link)", () => {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_dirty_url"),
    "TRANSLATIONS must not have report_dirty_url — it was only used by the retired popup report link"
  );
});

test("#1507: report_include_full_url_label/hint are retired with the opt-in checkbox", () => {
  assert.ok(!Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_include_full_url_label"));
  assert.ok(!Object.prototype.hasOwnProperty.call(TRANSLATIONS, "report_include_full_url_hint"));
});

test("#1507: popup_report_page is translated in every locale", () => {
  const entry = TRANSLATIONS.popup_report_page;
  assert.ok(entry, "popup_report_page must exist");
  for (const [lang, text] of Object.entries(entry)) {
    assert.ok(typeof text === "string" && text.length > 0, `${lang} is empty`);
    assert.ok(!text.includes("—"), `${lang} must not use an em-dash`);
  }
  assert.equal(entry.en, "Report this page");
  assert.equal(entry.es, "Reportar esta página");
});

// ── #1507: popup link-out wiring ─────────────────────────────────────────────

describe("#1507 — the popup's one-click Report this page", () => {
  const optionsJs = readFileSync(join(root, "src/options/options.js"), "utf8");

  it("popup.html carries a translated, initially hidden #report-page-btn button", () => {
    assert.match(popupHtml, /<button type="button" class="report-page-btn" id="report-page-btn" hidden data-i18n="popup_report_page">/);
  });

  it("popup.js and Settings both open the shared buildPageReportLink link", () => {
    assert.ok(popupJs.includes("buildPageReportLink({"));
    assert.ok(optionsJs.includes("buildPageReportLink({"));
  });

  it("Settings no longer hand-builds an issues/new?title&body link", () => {
    assert.doesNotMatch(optionsJs, /issues\/new\?title=/);
  });
});

// ── import tolerance ─────────────────────────────────────────────────────────

test("a legacy export carrying showReportButton imports cleanly (key ignored, no throw)", () => {
  const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [], showReportButton: true });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.toSave.showReportButton, undefined);
});

// #1355 review R3-report-reachability: the popup copy now sends users to
// Settings to report a problem, so that surface must be reachable by every
// user, never hidden behind Advanced (dev-tools-card) or Developer tools
// (section-dev-tools / dev-tools-panel).
describe("#1355 — the Settings report section is reachable without any dev gate", () => {
  const optionsHtml = readFileSync(new URL("../../src/options/options.html", import.meta.url), "utf8");
  const open = optionsHtml.indexOf('<section id="section-report"');
  const close = optionsHtml.indexOf("</section>", open);

  it("exists as its own section with no hidden attribute or dev-tools class", () => {
    assert.ok(open !== -1, "section-report must exist");
    const openTag = optionsHtml.slice(open, optionsHtml.indexOf(">", open) + 1);
    assert.doesNotMatch(openTag, /\bhidden\b/);
    assert.doesNotMatch(openTag, /dev-tools/);
  });

  it("sits outside every dev-gated container", () => {
    for (const gated of ['id="section-dev-tools"', 'id="dev-tools-card"', 'id="dev-tools-panel"']) {
      const at = optionsHtml.indexOf(gated);
      assert.ok(at !== -1, `${gated} must exist for this check to mean anything`);
      assert.ok(at > close || at < open, `section-report must not contain ${gated}`);
    }
    const devSection = optionsHtml.indexOf('<section id="section-dev-tools"');
    const devSectionEnd = optionsHtml.indexOf("</section>", devSection);
    assert.ok(open < devSection || open > devSectionEnd, "section-report must not be inside section-dev-tools");
    const card = optionsHtml.indexOf('id="dev-tools-card"');
    const cardSectionEnd = optionsHtml.indexOf("</section>", card);
    assert.ok(open < card || open > cardSectionEnd, "section-report must not be inside the Advanced dev-tools-card");
  });

  it("carries the URL input and the report button a user needs", () => {
    const body = optionsHtml.slice(open, close);
    assert.match(body, /id="report-url-input"/);
    assert.match(body, /id="report-url-report-btn"/);
  });
});
