/**
 * MUGA — PREF_DEFAULTS + docs surface for userCustomRules (#536).
 *
 * The "Strip locally" button in the popup's Suspicious Params section
 * promotes a flagged param into a per-user array of param names that the
 * cleaner consults globally. The list lives in chrome.storage.sync so it
 * follows the user across devices (it is small — empty by default and
 * generally a handful of entries even for power users).
 *
 * These tests pin both the code surface (PREF_DEFAULTS in storage.js)
 * AND the documentation surface (docs/data_architect.md) so the schema
 * stays a single source of truth (parity test docs-prefs-table also
 * enforces 1:1 key coverage).
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

test("PREF_DEFAULTS includes userCustomRules: []", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "userCustomRules"),
    "PREF_DEFAULTS must include userCustomRules",
  );
  assert.ok(
    Array.isArray(PREF_DEFAULTS.userCustomRules),
    "userCustomRules default must be an array",
  );
  assert.equal(
    PREF_DEFAULTS.userCustomRules.length,
    0,
    "userCustomRules default must be empty — users opt in by clicking 'Strip locally'",
  );
});

test("docs/data_architect.md documents userCustomRules (sync prefs row)", () => {
  const md = readFileSync(resolve(root, "docs/data_architect.md"), "utf8");
  assert.match(
    md,
    /\|\s*`userCustomRules`\s*\|/,
    "docs/data_architect.md must contain a sync-prefs row for userCustomRules",
  );
});
