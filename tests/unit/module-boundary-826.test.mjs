/**
 * MUGA — Module-boundary guard for #826 affiliates split
 *
 * Asserts the acyclicity and re-export completeness of the three-module
 * split introduced in #826 PR1:
 *
 *   affiliates-data.js   — static tracking-param dataset (domain a)
 *   redirect-networks.js — redirect-network table + lookup helpers (domain c)
 *   affiliates.js        — affiliate-program registry + re-export hub (domain b)
 *
 * Guards:
 *   (1) affiliates-data.js must NOT import from affiliates.js (acyclicity)
 *   (2) redirect-networks.js must NOT import from affiliates.js (acyclicity)
 *   (3) affiliates.js re-export surface covers the full pre-split public API
 *       (snapshot comparison — all names that the old monolith exported must
 *       still be resolvable from affiliates.js)
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

// ── Pinned pre-split public API surface ───────────────────────────────────
// These are all named exports the monolithic affiliates.js exposed before the
// #826 split. affiliates.js must continue to export each of them (either
// directly or via re-export) so all existing importers work unchanged.
const EXPECTED_EXPORTS = new Set([
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
    const missing = [...EXPECTED_EXPORTS].filter((name) => !actual.has(name));
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
