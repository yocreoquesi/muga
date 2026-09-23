/**
 * MUGA — Settings Activity home + domain-stats relocation (#1350)
 *
 * ADR-0011 Decision 3 classifies the domain-stats table as a record, not a
 * glance, and assigns it to Settings. Before this change `options.html` had
 * only the gating checkbox (`id="domain-stats"`) and `popup.html` had only
 * the panel (`id="domain-stats"` too) — no collision because they lived in
 * separate documents. Moving the panel into `options.html` would create a
 * real duplicate id in that single document unless the panel gets its own
 * id, which is exactly the defect class this test's id-uniqueness check
 * would have caught.
 *
 * These tests pin:
 *   1. No duplicate `id="..."` attributes anywhere in options.html (general
 *      guard — not just for domain-stats).
 *   2. options.html has a Settings home (#section-activity) hosting the
 *      domain-stats table under its own id, distinct from the checkbox.
 *   3. options.js wires the table from getDomainStats()/planDomainStatsView.
 *   4. popup.html/popup.js no longer render the panel at all.
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

/** Extracts every `id="..."` value from a raw HTML string, ignoring
 *  anything inside HTML comments (a comment mentioning an id="..." string
 *  for documentation purposes is not a real duplicate element). */
function extractIds(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(withoutComments)) !== null) ids.push(m[1]);
  return ids;
}

// ── 1. Id-uniqueness guard (the actual defect class) ──────────────────────────

describe("options.html — no duplicate DOM ids", () => {
  test("every id attribute in options.html is unique", () => {
    const ids = extractIds(optionsHtml);
    const seen = new Map();
    const dupes = [];
    for (const id of ids) {
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    for (const [id, count] of seen) {
      if (count > 1) dupes.push(`${id} (${count}x)`);
    }
    assert.deepStrictEqual(dupes, [], `duplicate ids found in options.html: ${dupes.join(", ")}`);
  });

  test("the gating checkbox and the Activity panel no longer share an id", () => {
    // Historically both would have been id="domain-stats" if the panel were
    // moved in naively (ADR-0011: "moving the panel into options.html will
    // force a rename").
    assert.match(optionsHtml, /id="domain-stats"/, "the gating checkbox must keep id=\"domain-stats\"");
    assert.match(optionsHtml, /id="domain-stats-panel"/, "the Activity panel must have its own, different id");
  });
});

// ── 2. Settings Activity home exists and hosts the table ──────────────────────

describe("options.html — #section-activity hosts the domain-stats table", () => {
  test("section#section-activity exists with a translated heading", () => {
    assert.match(optionsHtml, /<section id="section-activity" hidden>/, "options.html must contain #section-activity");
    assert.match(
      optionsHtml,
      /<section id="section-activity" hidden>\s*<h2[^>]*data-i18n="section_activity"/,
      "#section-activity must have an h2 with data-i18n=\"section_activity\""
    );
  });

  test("#section-activity starts hidden, so it never flashes empty before init decides (#1350 review R3-001)", () => {
    assert.match(optionsHtml, /<section id="section-activity" hidden>/);
  });

  test("the domain-stats-panel lives inside #section-activity and declares a list container", () => {
    const sectionMatch = optionsHtml.match(/<section id="section-activity" hidden>[\s\S]*?<\/section>/);
    assert.ok(sectionMatch, "#section-activity must be a well-formed <section>");
    assert.match(sectionMatch[0], /id="domain-stats-panel"/);
    assert.match(sectionMatch[0], /id="domain-stats-list"/);
  });

  test("#section-activity is NOT gated behind Advanced/dev-mode (TIER 1)", () => {
    // The Advanced card is everything between #section-dev and Developer tools.
    const advancedStart = optionsHtml.indexOf('<section id="section-dev">');
    const devToolsStart = optionsHtml.indexOf('<section id="section-dev-tools">');
    assert.ok(advancedStart !== -1 && devToolsStart !== -1, "Advanced/dev-tools markers must exist");
    const activityStart = optionsHtml.indexOf('<section id="section-activity" hidden>');
    assert.ok(activityStart !== -1, "#section-activity must exist");
    assert.ok(
      activityStart < advancedStart,
      "#section-activity must be positioned before the Advanced (dev-mode gated) card, i.e. always visible"
    );
  });
});

// ── 3. options.js wiring ───────────────────────────────────────────────────────

describe("options.js — renders the Activity domain-stats table", () => {
  test("imports getDomainStats from storage.js", () => {
    assert.match(
      optionsJs,
      /import\s*\{[^}]*\bgetDomainStats\b[^}]*\}\s*from\s*["']\.\.\/lib\/storage\.js["']/,
      "options.js must import getDomainStats from storage.js"
    );
  });

  test("imports planDomainStatsView from the extracted view module", () => {
    assert.match(
      optionsJs,
      /import\s*\{\s*planDomainStatsView\s*\}\s*from\s*["']\.\.\/lib\/domain-stats-view\.js["']/,
      "options.js must import planDomainStatsView from ../lib/domain-stats-view.js"
    );
  });

  test("declares a renderer for the Activity domain-stats table", () => {
    assert.match(
      optionsJs,
      /function\s+renderDomainStatsActivity\s*\(/,
      "options.js must declare renderDomainStatsActivity()"
    );
  });

  test("gates the table on prefs.domainStats", () => {
    const fnStart = optionsJs.indexOf("async function renderDomainStatsActivity(");
    assert.ok(fnStart !== -1, "renderDomainStatsActivity must exist");
    const fnEnd = optionsJs.indexOf("\n}", fnStart);
    const fnBody = optionsJs.slice(fnStart, fnEnd);
    assert.match(fnBody, /section\.hidden\s*=\s*true/, "must hide the section when domain stats is off");
  });
});

// ── 4. Popup no longer renders the panel ───────────────────────────────────────

describe("popup.html / popup.js — no longer render the domain-stats panel (#1350)", () => {
  test("popup.html no longer declares a #domain-stats element", () => {
    assert.doesNotMatch(popupHtml, /id="domain-stats"/, "popup.html must not contain id=\"domain-stats\" anymore");
  });

  test("popup.html no longer declares a #domain-stats-list element", () => {
    assert.doesNotMatch(popupHtml, /id="domain-stats-list"/, "popup.html must not contain id=\"domain-stats-list\" anymore");
  });

  test("popup.js no longer declares showDomainStats", () => {
    assert.doesNotMatch(popupJs, /function\s+showDomainStats/, "popup.js must not declare showDomainStats anymore");
  });

  test("popup.js no longer calls showDomainStats", () => {
    assert.doesNotMatch(popupJs, /showDomainStats\s*\(/, "popup.js must not call showDomainStats anymore");
  });
});
