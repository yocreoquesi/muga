#!/usr/bin/env node
/**
 * MUGA — validate-rules-source.mjs
 *
 * Validates tools/rules-source/params.json against the same denylist /
 * format / length / schema rules the extension enforces at runtime.
 * Intended to run in CI on PRs that touch tools/rules-source/**.
 *
 * Usage:
 *   node tools/validate-rules-source.mjs
 *
 * Environment variables:
 *   MUGA_SOURCE_FILE  (optional) Override source file path (used in tests).
 *
 * Exit codes:
 *   0 — source is valid
 *   1 — validation failure (schema, format, denylist, etc.)
 *   3 — I/O error (cannot read source file)
 *
 * Note: Signature verification is intentionally NOT performed here.
 * This validator runs BEFORE signing — it checks the unsigned source.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Import pure validation functions from src/lib/remote-rules.js.
// These functions have zero I/O and no browser API dependencies.
import {
  validatePayloadShape,
  validateParams,
  ERR,
} from "../src/lib/remote-rules.js";

// ── Path resolution ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = join(__dirname, "rules-source", "params.json");

function normalizePath(p) {
  // On Windows, file:// URL.pathname starts with /C:/ — normalize
  if (process.platform === "win32" && p.startsWith("/")) {
    return p.slice(1);
  }
  return p;
}

const SOURCE_FILE = process.env.MUGA_SOURCE_FILE
  ? normalizePath(process.env.MUGA_SOURCE_FILE)
  : DEFAULT_SOURCE;

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // 1. Read source file
  let rawSource;
  try {
    rawSource = readFileSync(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`[validate-rules] ERROR: Cannot read source file "${SOURCE_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 2. Parse JSON
  let source;
  try {
    source = JSON.parse(rawSource);
  } catch (err) {
    console.error(`[validate-rules] ERROR: Source file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  // 3. Validate shape (version, published, params, no sig field for source)
  // Source files don't have 'sig', so we add a dummy to satisfy validatePayloadShape
  // which requires all four fields. Instead we use our own shape check for source.
  const shapeResult = validateSourceShape(source);
  if (!shapeResult.ok) {
    console.error(`[validate-rules] ERROR: Schema validation failed: ${shapeResult.error}`);
    process.exit(1);
  }

  // 4. Validate params (format, length, denylist, affiliate guard)
  // Pass stored = { version: 0 } and nowMs = Date.now() for freshness check.
  // Skip version monotonicity and freshness here (source may be dated during dev).
  const paramsResult = validateParamsForSource(source.params);
  if (!paramsResult.ok) {
    console.error(
      `[validate-rules] ERROR: Param validation failed [${paramsResult.code}]: ${paramsResult.detail}`
    );
    process.exit(1);
  }

  console.log(
    `[validate-rules] OK: ${source.params.length} param(s) validated successfully (version ${source.version})`
  );
  process.exit(0);
}

/**
 * Validates the shape of an unsigned source file.
 * Similar to validatePayloadShape but does NOT require 'sig'.
 *
 * @param {unknown} obj
 * @returns {{ ok: boolean, error?: string }}
 */
function validateSourceShape(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "Source must be a JSON object" };
  }

  if (
    !Object.prototype.hasOwnProperty.call(obj, "version") ||
    typeof obj.version !== "number" ||
    !Number.isInteger(obj.version)
  ) {
    return { ok: false, error: "Missing or invalid 'version' field (must be an integer)" };
  }

  if (
    !Object.prototype.hasOwnProperty.call(obj, "published") ||
    typeof obj.published !== "string"
  ) {
    return { ok: false, error: "Missing or invalid 'published' field (must be an ISO-8601 string)" };
  }

  if (
    !Object.prototype.hasOwnProperty.call(obj, "params") ||
    !Array.isArray(obj.params) ||
    !obj.params.every(p => typeof p === "string")
  ) {
    return { ok: false, error: "Missing or invalid 'params' field (must be an array of strings)" };
  }

  return { ok: true };
}

// Error code → human-readable detail map
const ERR_DETAILS = {
  [ERR.INVALID_FORMAT]:      "A param failed the format regex or length check [1, 64 chars, [a-zA-Z0-9_.\\-]]",
  [ERR.DENYLIST_HIT]:        "A param is in REMOTE_PARAM_DENYLIST or AFFILIATE_PARAM_GUARD",
  [ERR.OVER_CAP]:            "More than 500 params after filtering",
  [ERR.VERSION_REGRESSION]:  "Version is not strictly increasing",
  [ERR.STALE_PAYLOAD]:       "Published date is more than 180 days old",
};

/**
 * Validates params against format, length, denylist, and cap rules.
 * Skips version monotonicity and freshness (those are signing-time concerns).
 *
 * @param {string[]} params
 * @returns {{ ok: boolean, code?: string, detail?: string }}
 */
function validateParamsForSource(params) {
  // Call validateParams with:
  //   stored = { version: 0 }   → always passes version check (version: 1 > 0)
  //   nowMs = Date.now()
  //   opts = { newVersion: 999999999, newPublished: new Date().toISOString() }
  //   This makes version/freshness checks trivially pass so we focus on format/denylist.
  const result = validateParams(
    params,
    { version: 0 },
    Date.now(),
    {
      newVersion: 999_999_999,
      newPublished: new Date().toISOString(),
    }
  );

  if (!result.ok) {
    const detail = ERR_DETAILS[result.code] || result.code;
    return { ok: false, code: result.code, detail };
  }

  return { ok: true };
}

main();
