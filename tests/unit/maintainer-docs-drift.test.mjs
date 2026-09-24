/**
 * MUGA — regression guard: maintainer and contributor docs describe the
 * popup after ADR-0011 and the product after ADR-0006 (#1438, #1440).
 *
 *   - ADR-0011's status no longer says its panel moves are unstarted.
 *   - CONTRIBUTING/CONTEXT/data_architect do not send readers to popup
 *     controls that moved to Settings, and do not describe affiliate
 *     injection, which ADR-0006 removed.
 *   - The catalogue for the removed cookie-consent subsystem is gone.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("#1438 ADR-0011 status reflects shipped moves", () => {
  const adr = read("docs/adr/0011-popup-glance-and-act.md");
  const status = adr.split("\n").find((l) => l.startsWith("**Status**"));
  test("status line does not call the moves unstarted", () => {
    assert.ok(status, "ADR-0011 has a status line");
    assert.ok(!/unstarted/i.test(status), status);
  });
  for (const n of [1350, 1351, 1352, 1353, 1355]) {
    test(`status line cites #${n}`, () => assert.ok(status.includes(`#${n}`), status));
  }
});

describe("#1438 contributor docs match the current popup", () => {
  test("the popup has no Report broken site button", () => {
    assert.ok(!read("src/popup/popup.html").includes("report-broken"), "source of truth moved");
    assert.ok(!/popup's "Report broken site" button/.test(read("CONTRIBUTING.md")));
  });
  test("CONTEXT.md does not list recent activity or stats in the popup", () => {
    assert.ok(!/popup\.js\s+— badge, recent activity/.test(read("CONTEXT.md")));
  });
  test("no doc describes path-based affiliate injection", () => {
    assert.ok(!/affiliate injection rules/i.test(read("CONTEXT.md")));
    assert.ok(!/Affiliate injection logic/.test(read("docs/ops/staged-release.md")));
  });
  test("data_architect.md does not describe popup ledger or Strip locally", () => {
    const doc = read("docs/data_architect.md");
    assert.ok(!/popup's "Recent activity"/.test(doc));
    assert.ok(!/popup "Recent activity"/.test(doc));
    assert.ok(!/"Strip locally"/.test(doc));
    assert.ok(!/redirect:"manual"/.test(doc));
  });
});

describe("#1440 removed cookie-consent catalogue is gone", () => {
  test("docs/COOKIE-CMP-TEST-SITES.md does not exist", () => {
    assert.equal(existsSync(join(ROOT, "docs/COOKIE-CMP-TEST-SITES.md")), false);
  });
});
