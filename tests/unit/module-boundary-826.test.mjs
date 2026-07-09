/**
 * MUGA — Module-boundary guards for the #826 architecture split
 *
 * Asserts the acyclicity and re-export completeness of BOTH three-module
 * splits introduced in #826:
 *
 * PR1 — affiliates split:
 *   affiliates-data.js   — static tracking-param dataset (domain a)
 *   redirect-networks.js — redirect-network table + lookup helpers (domain c)
 *   affiliates.js        — affiliate-program registry + re-export hub (domain b)
 *
 * PR2 — storage split:
 *   prefs.js              — PREF_DEFAULTS + getPrefs/setPrefs (sync domain)
 *   storage-migrations.js — one-time migration helpers (migrateStatsToLocal,
 *                           migrateLegacyProxyPref)
 *   storage.js            — stats, session, domain-rules, remote-params,
 *                           shortener counters + re-export hub (pre-split API)
 *
 * Guards (per split):
 *   (1) extracted data/leaf modules must NOT import from their hub (acyclicity)
 *   (2) the hub's re-export surface covers the full pre-split public API
 *       (snapshot comparison — all names the old monolith exported must
 *       still be resolvable from the hub)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function readLib(name) {
  return readFileSync(join(ROOT, "src", "lib", name), "utf8");
}

// ════════════════════════════════════════════════════════════════════════════
// PR1 — affiliates split
// ════════════════════════════════════════════════════════════════════════════

// ── Pinned pre-split public API surface (affiliates.js) ───────────────────
// These are all named exports the monolithic affiliates.js exposed before the
// #826 split. affiliates.js must continue to export each of them (either
// directly or via re-export) so all existing importers work unchanged.
const AFFILIATES_EXPECTED_EXPORTS = new Set([
  "TRACKING_PARAMS",
  "TRACKING_PREFIXES",
  "TRACKING_PARAM_CATEGORIES",
  "AFFILIATE_PATTERNS",
  "getPatternsForHost",
  "getAffiliateParamSetForHost",
  "getSupportedStores",
  "getAffiliateDomains",
  "REDIRECT_NETWORK_PATTERNS",
  "getRedirectNetworkPatterns",
  "getRedirectNetworkForRedirectHost",
  "getLandingParamsForReferrer",
]);

// ── Guard (1): affiliates-data.js must not import from affiliates.js ──────

describe("module-boundary — affiliates-data.js (#826)", () => {
  const src = readLib("affiliates-data.js");

  test("affiliates-data.js does not import from affiliates.js (acyclicity guard)", () => {
    // Match any import/export that references affiliates.js (but not affiliates-data.js)
    const re = /from\s+["']\.\/affiliates\.js["']/g;
    assert.ok(
      !re.test(src),
      "affiliates-data.js must not import from affiliates.js — this would create a circular dependency"
    );
  });

  test("affiliates-data.js exports TRACKING_PARAMS", () => {
    assert.ok(
      src.includes("export const TRACKING_PARAMS"),
      "affiliates-data.js must export TRACKING_PARAMS"
    );
  });

  test("affiliates-data.js exports TRACKING_PREFIXES", () => {
    assert.ok(
      src.includes("export const TRACKING_PREFIXES"),
      "affiliates-data.js must export TRACKING_PREFIXES"
    );
  });

  test("affiliates-data.js exports TRACKING_PARAM_CATEGORIES", () => {
    assert.ok(
      src.includes("export const TRACKING_PARAM_CATEGORIES"),
      "affiliates-data.js must export TRACKING_PARAM_CATEGORIES"
    );
  });
});

// ── Guard (2): redirect-networks.js must not import from affiliates.js ────

describe("module-boundary — redirect-networks.js (#826)", () => {
  const src = readLib("redirect-networks.js");

  test("redirect-networks.js does not import from affiliates.js (acyclicity guard)", () => {
    const re = /from\s+["']\.\/affiliates\.js["']/g;
    assert.ok(
      !re.test(src),
      "redirect-networks.js must not import from affiliates.js — this would create a circular dependency"
    );
  });

  test("redirect-networks.js exports REDIRECT_NETWORK_PATTERNS", () => {
    assert.ok(
      src.includes("export const REDIRECT_NETWORK_PATTERNS"),
      "redirect-networks.js must export REDIRECT_NETWORK_PATTERNS"
    );
  });

  test("redirect-networks.js exports getRedirectNetworkPatterns", () => {
    assert.ok(
      src.includes("export function getRedirectNetworkPatterns"),
      "redirect-networks.js must export getRedirectNetworkPatterns"
    );
  });

  test("redirect-networks.js exports getRedirectNetworkForRedirectHost", () => {
    assert.ok(
      src.includes("export function getRedirectNetworkForRedirectHost"),
      "redirect-networks.js must export getRedirectNetworkForRedirectHost"
    );
  });

  test("redirect-networks.js exports getLandingParamsForReferrer", () => {
    assert.ok(
      src.includes("export function getLandingParamsForReferrer"),
      "redirect-networks.js must export getLandingParamsForReferrer"
    );
  });
});

// ── Guard (3): affiliates.js re-export surface covers the full pre-split API

describe("module-boundary — affiliates.js re-export surface (#826)", () => {
  test("affiliates.js re-exports the complete pre-split public API", async () => {
    // Dynamic import resolves re-exports transparently.
    const mod = await import(
      new URL("../../src/lib/affiliates.js", import.meta.url).href
    );
    const actual = new Set(Object.keys(mod));
    const missing = [...AFFILIATES_EXPECTED_EXPORTS].filter((name) => !actual.has(name));
    assert.deepEqual(
      missing,
      [],
      `affiliates.js is missing expected exports after #826 split: ${missing.join(", ")}. ` +
      "Add explicit re-exports to restore backward compatibility."
    );
  });

  test("affiliates.js re-exports from affiliates-data.js (source-level check)", () => {
    const src = readLib("affiliates.js");
    assert.ok(
      src.includes('from "./affiliates-data.js"'),
      "affiliates.js must re-export from affiliates-data.js"
    );
  });

  test("affiliates.js re-exports from redirect-networks.js (source-level check)", () => {
    const src = readLib("affiliates.js");
    assert.ok(
      src.includes('from "./redirect-networks.js"'),
      "affiliates.js must re-export from redirect-networks.js"
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PR2 — storage split
// ════════════════════════════════════════════════════════════════════════════

// ── Pinned pre-split public API surface (storage.js) ──────────────────────
// These are all named exports the monolithic storage.js exposed before the
// #826 split. storage.js must continue to export each of them (either
// directly or via re-export) so all 11 importers work unchanged.
const STORAGE_EXPECTED_EXPORTS = new Set([
  "PREF_DEFAULTS",
  "getPrefs",
  "setPrefs",
  "getStats",
  "setStats",
  "getDevMode",
  "setDevMode",
  "incrementStat",
  "DOMAIN_STATS_MAX",
  "incrementDomainStat",
  "getDomainStats",
  "sessionStorage",
  "cacheDomainRules",
  "getCachedDomainRules",
  "getRemoteParams",
  "setRemoteParams",
  "getShortenerStats",
  "flushShortenerStats",
  "incrementShortenerStat",
  "migrateStatsToLocal",
  "migrateLegacyProxyPref",
  "migratePerSiteDisableToAllowlist",
]);

// ── Guard (1): prefs.js must not import from storage.js ───────────────────

describe("module-boundary — prefs.js (#826 PR2)", () => {
  const src = readLib("prefs.js");

  test("prefs.js does not import from storage.js (acyclicity guard)", () => {
    const re = /from\s+["']\.\/storage\.js["']/g;
    assert.ok(
      !re.test(src),
      "prefs.js must not import from storage.js — this would create a circular dependency"
    );
  });

  test("prefs.js exports PREF_DEFAULTS", () => {
    assert.ok(
      src.includes("export const PREF_DEFAULTS"),
      "prefs.js must export PREF_DEFAULTS"
    );
  });

  test("prefs.js exports getPrefs", () => {
    assert.ok(
      src.includes("export async function getPrefs"),
      "prefs.js must export getPrefs"
    );
  });

  test("prefs.js exports setPrefs", () => {
    assert.ok(
      src.includes("export async function setPrefs"),
      "prefs.js must export setPrefs"
    );
  });
});

// ── Guard (2): storage-migrations.js must not import from storage.js ──────

describe("module-boundary — storage-migrations.js (#826 PR2)", () => {
  const src = readLib("storage-migrations.js");

  test("storage-migrations.js does not import from storage.js (acyclicity guard)", () => {
    const re = /from\s+["']\.\/storage\.js["']/g;
    assert.ok(
      !re.test(src),
      "storage-migrations.js must not import from storage.js — this would create a circular dependency"
    );
  });

  test("storage-migrations.js exports migrateStatsToLocal", () => {
    assert.ok(
      src.includes("export async function migrateStatsToLocal"),
      "storage-migrations.js must export migrateStatsToLocal"
    );
  });

  test("storage-migrations.js exports migrateLegacyProxyPref", () => {
    assert.ok(
      src.includes("export async function migrateLegacyProxyPref"),
      "storage-migrations.js must export migrateLegacyProxyPref"
    );
  });

  test("storage-migrations.js exports migratePerSiteDisableToAllowlist", () => {
    assert.ok(
      src.includes("export async function migratePerSiteDisableToAllowlist"),
      "storage-migrations.js must export migratePerSiteDisableToAllowlist"
    );
  });
});

// ── Guard (3): storage.js re-export surface covers the full pre-split API ─

describe("module-boundary — storage.js re-export surface (#826 PR2)", () => {
  test("storage.js re-exports the complete pre-split public API", async () => {
    // Dynamic import resolves re-exports transparently.
    const mod = await import(
      new URL("../../src/lib/storage.js", import.meta.url).href
    );
    const actual = new Set(Object.keys(mod));
    const missing = [...STORAGE_EXPECTED_EXPORTS].filter((name) => !actual.has(name));
    assert.deepEqual(
      missing,
      [],
      `storage.js is missing expected exports after #826 PR2 split: ${missing.join(", ")}. ` +
      "Add explicit re-exports to restore backward compatibility."
    );
  });

  test("storage.js re-exports from prefs.js (source-level check)", () => {
    const src = readLib("storage.js");
    assert.ok(
      src.includes('from "./prefs.js"'),
      "storage.js must re-export from prefs.js"
    );
  });

  test("storage.js re-exports from storage-migrations.js (source-level check)", () => {
    const src = readLib("storage.js");
    assert.ok(
      src.includes('from "./storage-migrations.js"'),
      "storage.js must re-export from storage-migrations.js"
    );
  });
});
