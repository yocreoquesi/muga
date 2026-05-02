/**
 * MUGA — PREF_DEFAULTS + docs surface for attributionLedgerEnabled (#460, A2).
 *
 * The Attribution Ledger persists the last N navigations to
 * chrome.storage.local. Because the data is privacy-sensitive (it carries
 * URLs the user visited), users get an explicit pref to disable
 * persistence: `attributionLedgerEnabled` (default true). The
 * service-worker writer is gated on this flag — when off, the ledger
 * never touches local storage and the popup section silently empties.
 *
 * These tests pin both the code surface (PREF_DEFAULTS in storage.js)
 * AND the documentation surface (docs/data_architect.md) so the schema
 * stays a single source of truth.
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

test("PREF_DEFAULTS includes attributionLedgerEnabled: true", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "attributionLedgerEnabled"),
    "PREF_DEFAULTS must include attributionLedgerEnabled",
  );
  assert.equal(
    PREF_DEFAULTS.attributionLedgerEnabled,
    true,
    "default must be true so users get the recent-activity feedback unless they opt out",
  );
});

test("docs/data_architect.md documents attributionLedgerEnabled (sync prefs row)", () => {
  const md = readFileSync(resolve(root, "docs/data_architect.md"), "utf8");
  // The row must live in the chrome.storage.sync section (where prefs are
  // documented) and reference the key by name.
  assert.match(
    md,
    /\|\s*`attributionLedgerEnabled`\s*\|/,
    "docs/data_architect.md must contain a sync-prefs row for attributionLedgerEnabled",
  );
});

test("docs/data_architect.md documents attributionLedger (chrome.storage.local row)", () => {
  const md = readFileSync(resolve(root, "docs/data_architect.md"), "utf8");
  assert.match(
    md,
    /\|\s*`attributionLedger`\s*\|/,
    "docs/data_architect.md must contain a local-storage row for attributionLedger",
  );
});
