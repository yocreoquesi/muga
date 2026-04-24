#!/usr/bin/env node
/**
 * MUGA — sign-rules.mjs
 *
 * CLI tool to sign tools/rules-source/params.json and emit
 * docs/rules/v1/params.json with an Ed25519 signature.
 *
 * Usage:
 *   MUGA_SIGNING_KEY_PATH=/path/to/key.pem node tools/sign-rules.mjs
 *
 * Environment variables:
 *   MUGA_SIGNING_KEY_PATH  (required) Path to the Ed25519 private key PEM file.
 *                          Do NOT pass key material via CLI args — shell history leakage.
 *   MUGA_SOURCE_FILE       (optional) Override source file path (for testing).
 *   MUGA_OUTPUT_FILE       (optional) Override output file path (for testing).
 *
 * Exit codes:
 *   0 — success
 *   1 — validation error in source (schema, format, denylist, malformed JSON)
 *   2 — signing setup error (missing MUGA_SIGNING_KEY_PATH, unreadable key, bad PEM)
 *   3 — I/O error (cannot read source file, cannot write output file)
 *
 * Security rules:
 *   - Private key path is ONLY accepted via MUGA_SIGNING_KEY_PATH env var.
 *   - Key material never logged, never on stdout.
 *   - No npm dependencies — uses node:crypto and node:fs only.
 */

import { sign as cryptoSign, createPrivateKey, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── Path resolution ──────────────────────────────────────────────────────────

const DEFAULT_SOURCE = new URL("../tools/rules-source/params.json", import.meta.url).pathname;
const DEFAULT_OUTPUT = new URL("../docs/rules/v1/params.json", import.meta.url).pathname;

// On Windows, URL.pathname starts with /C:/ — normalize that
function normalizePath(p) {
  if (process.platform === "win32" && p.startsWith("/")) {
    return p.slice(1);
  }
  return p;
}

const SOURCE_FILE = process.env.MUGA_SOURCE_FILE || normalizePath(DEFAULT_SOURCE);
const OUTPUT_FILE = process.env.MUGA_OUTPUT_FILE || normalizePath(DEFAULT_OUTPUT);

// ── Denylist (mirrors src/lib/remote-rules.js REMOTE_PARAM_DENYLIST + AFFILIATE_PARAM_GUARD) ──
// Duplicated here to avoid importing a browser-targeted ES module; kept in sync manually.

const REMOTE_PARAM_DENYLIST = new Set([
  "q", "query", "search", "s", "keyword", "keywords",
  "id", "uid", "user", "userid", "session", "sid", "token", "access_token",
  "api_key", "apikey", "key", "hash", "code", "auth", "signature",
  "page", "p", "pg", "offset", "limit", "size", "per_page",
  "sort", "order", "orderby", "dir", "direction",
  "filter", "type", "category", "cat", "tag", "tab", "view", "mode", "format",
  "output", "action", "op", "method",
  "lang", "locale", "hl", "tz", "timezone", "region", "country",
  "from", "to", "date", "year", "month", "day", "time", "t",
  "state", "redirect", "redirect_uri", "return", "return_to", "return_url",
  "url", "next", "continue", "callback", "error", "error_description",
  "v", "w", "h", "width", "height", "color", "theme",
]);

const AFFILIATE_PARAM_GUARD = new Set([
  "tag", "ascsubtag", "associatetag", "linkcode", "creativeasin",
  "campid", "mkevt", "mkcid", "mkrid", "toolid", "customid",
  "aid", "subid", "sid", "affiliate_id",
  "awc", "irclickid", "irgwc", "clickid", "click_id",
  "hmkeyword",
  "afsrc", "af_id",
  "partner", "partnerid", "affid", "aff_id", "refcode",
]);

const PARAM_FORMAT_RE = /^[a-zA-Z0-9_.\-]+$/;
const MAX_PARAM_LEN = 64;

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates the unsigned source shape.
 * Source must have version (integer), published (string), params (string[]).
 * Source must NOT have a 'sig' field — it is unsigned input.
 *
 * @param {unknown} obj
 * @returns {{ ok: boolean, error?: string }}
 */
function validateSource(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "Source must be a JSON object" };
  }

  if (Object.prototype.hasOwnProperty.call(obj, "sig")) {
    return {
      ok: false,
      error: "Source file must NOT contain a 'sig' field — use the unsigned source",
    };
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

  // Validate each param
  for (const param of obj.params) {
    if (param.length < 1 || param.length > MAX_PARAM_LEN) {
      return {
        ok: false,
        error: `Param "${param}" violates length constraint [1, ${MAX_PARAM_LEN}]`,
      };
    }
    if (!PARAM_FORMAT_RE.test(param)) {
      return {
        ok: false,
        error: `Param "${param}" contains invalid characters. Allowed: [a-zA-Z0-9_.\\-]`,
      };
    }
    const lower = param.toLowerCase();
    if (REMOTE_PARAM_DENYLIST.has(lower)) {
      return {
        ok: false,
        error: `Param "${param}" is in REMOTE_PARAM_DENYLIST and must not be published`,
      };
    }
    if (AFFILIATE_PARAM_GUARD.has(lower)) {
      return {
        ok: false,
        error: `Param "${param}" is in AFFILIATE_PARAM_GUARD and must not be published`,
      };
    }
  }

  return { ok: true };
}

// ── Canonical message ─────────────────────────────────────────────────────────

/**
 * Derives the canonical signed message per REQ-VERIFY-3.
 * Format: `${version}|${published}|${params.join(",")}`
 *
 * @param {number}   version
 * @param {string}   published
 * @param {string[]} params
 * @returns {string}
 */
function canonicalMessage(version, published, params) {
  return `${version}|${published}|${params.join(",")}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load the private key from env var (exit 2 if missing or unreadable)
  const keyPath = process.env.MUGA_SIGNING_KEY_PATH;
  if (!keyPath) {
    console.error("[sign-rules] ERROR: MUGA_SIGNING_KEY_PATH env var is not set.");
    console.error("  Set it to the path of the Ed25519 private key PEM file.");
    process.exit(2);
  }

  let privateKey;
  try {
    const keyPem = readFileSync(keyPath, "utf8");
    privateKey = createPrivateKey({ key: keyPem, format: "pem" });
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot read private key from "${keyPath}": ${err.message}`);
    process.exit(2);
  }

  // 2. Read the source file (exit 3 on I/O error)
  let rawSource;
  try {
    rawSource = readFileSync(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot read source file "${SOURCE_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 3. Parse and validate the source (exit 1 on validation error)
  let source;
  try {
    source = JSON.parse(rawSource);
  } catch (err) {
    console.error(`[sign-rules] ERROR: Source file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const validation = validateSource(source);
  if (!validation.ok) {
    console.error(`[sign-rules] ERROR: Source validation failed: ${validation.error}`);
    process.exit(1);
  }

  // 4. Sign the canonical message
  const canonical = canonicalMessage(source.version, source.published, source.params);
  const msgBuf = Buffer.from(canonical, "utf8");

  let sigBuf;
  try {
    sigBuf = cryptoSign(null, msgBuf, privateKey);
  } catch (err) {
    console.error(`[sign-rules] ERROR: Signing failed: ${err.message}`);
    process.exit(2);
  }

  // Encode as base64url (URL-safe, no padding) per design §2
  const sigBase64url = sigBuf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // 5. Write the signed output (exit 3 on I/O error)
  const output = {
    version: source.version,
    published: source.published,
    params: source.params,
    sig: sigBase64url,
  };

  try {
    mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot write output to "${OUTPUT_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 6. Emit a one-line summary (stdout only, no key material)
  const sha256 = createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex");

  console.log(JSON.stringify({
    input: SOURCE_FILE,
    output: OUTPUT_FILE,
    version: source.version,
    paramCount: source.params.length,
    sha256,
  }));

  process.exit(0);
}

main().catch(err => {
  console.error("[sign-rules] Unexpected error:", err.message);
  process.exit(3);
});
