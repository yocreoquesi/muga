/**
 * MUGA — PREF_DEFAULTS + docs surface for showBadge (#910).
 *
 * Re-introduces a per-tab toolbar badge (running count of tracking params
 * stripped in the tab) gated behind `showBadge` (default true). See
 * src/lib/toolbar-presenter.js for the badge logic and
 * src/background/service-worker.js:updateTabBadge for the persistent
 * per-tab running total (chrome.storage.session key `tab_badge_{tabId}`).
 *
 * These tests pin both the code surface (PREF_DEFAULTS in prefs.js) AND
 * the documentation surface (docs/data_architect.md) so the schema stays
 * a single source of truth (docs-prefs-table.test.mjs also enforces 1:1
 * key coverage for the sync-prefs table generically).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");

test("PREF_DEFAULTS includes showBadge: true", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "showBadge"),
    "PREF_DEFAULTS must include showBadge",
  );
  assert.equal(
    PREF_DEFAULTS.showBadge,
    true,
    "showBadge must default to true so users see the toolbar badge unless they opt out",
  );
});

test("docs/data_architect.md documents showBadge (sync prefs row)", () => {
  const md = readFileSync(resolve(root, "docs/data_architect.md"), "utf8");
  assert.match(
    md,
    /\|\s*`showBadge`\s*\|/,
    "docs/data_architect.md must contain a sync-prefs row for showBadge",
  );
});

test("docs/data_architect.md documents tab_badge_{tabId} (chrome.storage.session row)", () => {
  const md = readFileSync(resolve(root, "docs/data_architect.md"), "utf8");
  assert.match(
    md,
    /\|\s*`tab_badge_\{tabId\}`\s*\|/,
    "docs/data_architect.md must contain a session-storage row for tab_badge_{tabId}",
  );
});
