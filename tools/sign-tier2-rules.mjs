#!/usr/bin/env node
/**
 * MUGA — sign-tier2-rules.mjs (#1027 Slice 2, PR B3)
 *
 * CLI tool to sign tools/rules-source/tier2.json and emit
 * docs/rules/v1/tier2.json with an Ed25519 signature.
 *
 * REVISED ADR-6 (product-owner decision — shared key): this tool signs with
 * the SAME `MUGA_SIGNING_KEY_PATH` / `MUGA_SIGNING_KEY` used by
 * `tools/sign-rules.mjs` for params.json. There is NO separate Tier2-scoped
 * signing secret and NO `remote-tier2-keys.js`. The runtime already verifies
 * Tier2 signatures against the existing `TRUSTED_PUBLIC_KEYS` (see
 * src/lib/remote-tier2-rules.js).
 *
 * Domain separation across the two payload types sharing one key comes
 * entirely from `canonicalTier2Message`'s leading `tier2|` tag — which is why
 * this tool IMPORTS that function from src/lib/remote-tier2-rules.js instead
 * of reimplementing it (unlike tools/sign-rules.mjs's `canonicalMessage`,
 * which is a local reimplementation for params). The signed bytes here MUST
 * be byte-identical to what `runTier2RulesFetch` verifies at fetch time —
 * importing the shared function is what guarantees that, structurally.
 *
 * Usage:
 *   MUGA_SIGNING_KEY_PATH=/path/to/key.pem node tools/sign-tier2-rules.mjs
 *
 * Environment variables:
 *   MUGA_SIGNING_KEY_PATH    (required) Path to the Ed25519 private key PEM
 *                            file — the SAME key file used for params.json.
 *                            Do NOT pass key material via CLI args.
 *   MUGA_TIER2_SOURCE_FILE   (optional) Override source file path (tests).
 *   MUGA_TIER2_OUTPUT_FILE   (optional) Override output file path (tests).
 *
 * Exit codes:
 *   0 — success
 *   1 — validation error in source (schema, token-scan, selector-syntax, rules)
 *   2 — signing setup error (missing MUGA_SIGNING_KEY_PATH, unreadable key, bad PEM)
 *   3 — I/O error (cannot read source file, cannot write output file)
 *
 * Security rules (identical to tools/sign-rules.mjs):
 *   - Private key path is ONLY accepted via MUGA_SIGNING_KEY_PATH env var.
 *   - Key material never logged, never on stdout.
 *   - No npm dependencies — uses node:crypto and node:fs only.
 *
 * This module is entry-guarded (see bottom of file): importing it for unit
 * tests (e.g. the canonicalTier2Message import-equality test) performs ZERO
 * I/O and never calls main().
 */

import { sign as cryptoSign, createPrivateKey, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Reused verbatim (REVISED ADR-6) — the exact function the runtime verifier
// builds its message with. Re-exported below for the import-equality test.
import { canonicalTier2Message } from "../src/lib/remote-tier2-rules.js";
import { validateTier2SourceContent } from "./validate-tier2-source.mjs";

export { canonicalTier2Message };

// ── Path resolution ──────────────────────────────────────────────────────────

const DEFAULT_SOURCE = new URL("../tools/rules-source/tier2.json", import.meta.url).pathname;
const DEFAULT_OUTPUT = new URL("../docs/rules/v1/tier2.json", import.meta.url).pathname;

// On Windows, URL.pathname starts with /C:/ — normalize that
function normalizePath(p) {
  if (process.platform === "win32" && p.startsWith("/")) {
    return p.slice(1);
  }
  return p;
}

const SOURCE_FILE = process.env.MUGA_TIER2_SOURCE_FILE || normalizePath(DEFAULT_SOURCE);
const OUTPUT_FILE = process.env.MUGA_TIER2_OUTPUT_FILE || normalizePath(DEFAULT_OUTPUT);

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // 1. Load the private key from env var (exit 2 if missing or unreadable)
  const keyPath = process.env.MUGA_SIGNING_KEY_PATH;
  if (!keyPath) {
    console.error("[sign-tier2-rules] ERROR: MUGA_SIGNING_KEY_PATH env var is not set.");
    console.error("  Set it to the path of the SAME Ed25519 private key PEM file used for params.json.");
    process.exit(2);
  }

  let privateKey;
  try {
    const keyPem = readFileSync(keyPath, "utf8");
    privateKey = createPrivateKey({ key: keyPem, format: "pem" });
  } catch (err) {
    console.error(`[sign-tier2-rules] ERROR: Cannot read private key from "${keyPath}": ${err.message}`);
    process.exit(2);
  }

  // 2. Read the source file (exit 3 on I/O error)
  let rawSource;
  try {
    rawSource = readFileSync(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`[sign-tier2-rules] ERROR: Cannot read source file "${SOURCE_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 3. Parse and validate the source (exit 1 on validation error). Reuses the
  // SAME pure validator the PR-gate CI job runs (validate-tier2-source.mjs),
  // so a payload that passed PR review can never fail signing for a
  // different reason than what the reviewer already saw.
  let source;
  try {
    source = JSON.parse(rawSource);
  } catch (err) {
    console.error(`[sign-tier2-rules] ERROR: Source file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const validation = validateTier2SourceContent(source, rawSource);
  if (!validation.ok) {
    console.error(`[sign-tier2-rules] ERROR: Source validation failed [${validation.code}]: ${validation.detail}`);
    process.exit(1);
  }

  // 4. Sign the canonical message — imported, not reimplemented (see docblock).
  const canonical = canonicalTier2Message(source.version, source.published, source.rules);
  const msgBuf = Buffer.from(canonical, "utf8");

  let sigBuf;
  try {
    sigBuf = cryptoSign(null, msgBuf, privateKey);
  } catch (err) {
    console.error(`[sign-tier2-rules] ERROR: Signing failed: ${err.message}`);
    process.exit(2);
  }

  // Encode as base64url (URL-safe, no padding) — same encoding as sign-rules.mjs.
  const sigBase64url = sigBuf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // 5. Write the signed output (exit 3 on I/O error)
  const output = {
    schemaVersion: source.schemaVersion,
    version: source.version,
    published: source.published,
    rules: source.rules,
    sig: sigBase64url,
  };

  try {
    mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[sign-tier2-rules] ERROR: Cannot write output to "${OUTPUT_FILE}": ${err.message}`);
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
    ruleCount: source.rules.length,
    sha256,
  }));

  process.exit(0);
}

// Only run the filesystem/signing main() when invoked directly — importing
// this module (e.g. for the canonicalTier2Message import-equality test)
// performs zero I/O and never signs anything.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
