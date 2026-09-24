/**
 * MUGA — popup section order (audit 2026-09-24 reorder)
 *
 * Maintainer decision: the popup should lead with the most important content.
 * "This page" (#preview — what MUGA is doing on the current tab right now)
 * moves ahead of the lifetime stats and the suspicious-params list, which are
 * both about other page loads, not this one. The migration banner stays
 * right after the header/toggle since it is a transient one-time notice, not
 * recurring content that should compete with "This page" for top billing.
 * The rate/report/support block (growth-bar) and the footer stay last.
 *
 * Final order: header/toggle -> migration-banner -> #preview -> stats ->
 * suspicious-params -> growth-bar -> footer.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");

/** Index of an element by its id attribute, or -1 if absent. */
function idIndex(id) {
  return html.indexOf(`id="${id}"`);
}

describe("popup.html section order", () => {
  test("#preview precedes the stats section", () => {
    const previewIdx = idIndex("preview");
    const statsIdx = html.indexOf('class="stats"');
    assert.ok(previewIdx !== -1, "#preview must exist");
    assert.ok(statsIdx !== -1, ".stats section must exist");
    assert.ok(previewIdx < statsIdx, "#preview must come before the stats section in the DOM");
  });

  test("full section order: header -> migration-banner -> preview -> stats -> suspicious-params -> growth-bar -> footer", () => {
    const headerIdx = html.indexOf("<header>");
    const migrationIdx = idIndex("migration-banner");
    const previewIdx = idIndex("preview");
    const statsIdx = html.indexOf('class="stats"');
    const suspiciousIdx = idIndex("suspicious-params");
    const growthIdx = idIndex("growth-bar");
    const footerIdx = html.indexOf("<footer>");

    for (const [label, idx] of [
      ["<header>", headerIdx], ["#migration-banner", migrationIdx], ["#preview", previewIdx],
      [".stats", statsIdx], ["#suspicious-params", suspiciousIdx], ["#growth-bar", growthIdx],
      ["<footer>", footerIdx],
    ]) {
      assert.ok(idx !== -1, `${label} must exist in popup.html`);
    }

    assert.ok(headerIdx < migrationIdx, "<header> must come before #migration-banner");
    assert.ok(migrationIdx < previewIdx, "#migration-banner must come before #preview (transient notice, not competing with top content)");
    assert.ok(previewIdx < statsIdx, "#preview must come before .stats");
    assert.ok(statsIdx < suspiciousIdx, ".stats must come before #suspicious-params");
    assert.ok(suspiciousIdx < growthIdx, "#suspicious-params must come before #growth-bar");
    assert.ok(growthIdx < footerIdx, "#growth-bar must come before <footer> (rate/report/support stays last)");
  });

  test("the stats-empty zero-state stays adjacent to the stats section it describes", () => {
    const statsIdx = html.indexOf('class="stats"');
    const statsEmptyIdx = idIndex("stats-empty");
    const suspiciousIdx = idIndex("suspicious-params");
    assert.ok(statsIdx < statsEmptyIdx && statsEmptyIdx < suspiciousIdx, "#stats-empty must sit between .stats and #suspicious-params");
  });
});
