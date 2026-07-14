#!/usr/bin/env node
/**
 * MUGA — sign-wrappers.mjs
 *
 * CLI tool to (re-)sign src/rules/wrappers.json and emit
 * src/rules/wrappers.json.sig — an Ed25519 signature over the RAW BYTES of
 * wrappers.json under the worker key.
 *
 * This is a DIFFERENT key and a DIFFERENT artifact from tools/sign-rules.mjs:
 *   - sign-rules.mjs signs a canonical `version|published|params` message for
 *     the remote params.json artifact, under MUGA_SIGNING_KEY_PATH, verified
 *     against src/lib/remote-rules-keys.js's TRUSTED_PUBLIC_KEYS (the single
 *     source of truth for that key — #1102).
 *   - sign-wrappers.mjs signs the raw file bytes of wrappers.json under
 *     MUGA_WORKER_SIGNING_KEY_PATH, verified by worker-pubkey.txt.
 * The two are not interchangeable.
 *
 * Usage:
 *   MUGA_WORKER_SIGNING_KEY_PATH=/path/to/worker-key.pem node tools/sign-wrappers.mjs
 *
 * Environment variables:
 *   MUGA_WORKER_SIGNING_KEY_PATH  (required) Path to the Ed25519 worker
 *                          private key PEM file. Do NOT pass key material via
 *                          CLI args — shell history leakage.
 *   MUGA_WRAPPERS_FILE     (optional) Override wrappers.json path (for testing).
 *   MUGA_WRAPPERS_SIG_FILE (optional) Override .sig output path (for testing).
 *   MUGA_WORKER_PUBKEY_FILE(optional) Override worker-pubkey.txt path (for testing).
 *
 * Exit codes:
 *   0 — success (signature written AND verified against worker-pubkey.txt)
 *   1 — validation error in wrappers.json (schema, unsafe host, bad extractor)
 *   2 — signing setup error (missing key env, unreadable key, bad PEM, verify fail)
 *   3 — I/O error (cannot read wrappers.json, cannot write .sig)
 *
 * Security rules:
 *   - Private key path is ONLY accepted via MUGA_WORKER_SIGNING_KEY_PATH.
 *   - Key material is never logged, never on stdout.
 *   - The signature is verified against the pinned public key before the tool
 *     reports success, so a key/artifact mismatch fails loudly instead of
 *     shipping a bad .sig.
 *   - No npm dependencies — node:crypto and node:fs only.
 */

import {
  sign as cryptoSign,
  createPrivateKey,
  createHash,
  webcrypto,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  collidesWithAffiliateNetwork,
  HOST_DENYLIST,
} from "./rule-ingestion/harvest-unwrap.mjs";
import { WRAPPERS } from "../src/lib/wrapper-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RULES = join(REPO_ROOT, "src/rules");

const WRAPPERS_FILE = process.env.MUGA_WRAPPERS_FILE || join(RULES, "wrappers.json");
const SIG_FILE = process.env.MUGA_WRAPPERS_SIG_FILE || join(RULES, "wrappers.json.sig");
const PUBKEY_FILE = process.env.MUGA_WORKER_PUBKEY_FILE || join(RULES, "worker-pubkey.txt");

const KNOWN_EXTRACTOR_KINDS = new Set(["fromParam", "fromAnyParam", "fromUrlAfterQuery"]);

/**
 * Defence-in-depth validation of the artifact before we sign it. Signing is
 * the trust boundary, so re-assert the safety invariants here rather than
 * trusting whatever produced the file.
 *
 * @param {unknown} obj parsed wrappers.json
 * @returns {{ ok: boolean, error?: string }}
 */
function validateWrappers(obj) {
  if (!Array.isArray(obj)) return { ok: false, error: "wrappers.json must be a JSON array" };
  // Ids the engine actually unwraps. Entries whose id is NOT here are in
  // MUGA_EXCLUDED_IDS (awin, impact, rakuten, shareasale, skimlinks-*,
  // tradetracker) — affiliate hosts kept in the artifact but excluded from the
  // engine (pass-through, never unwrapped), so the affiliate/denylist host
  // checks below do not apply to them.
  const activeIds = new Set(WRAPPERS.map((w) => w.id));
  for (const entry of obj) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "each entry must be an object" };
    if (typeof entry.id !== "string" || !entry.id) return { ok: false, error: "entry missing string id" };
    if (typeof entry.label !== "string") return { ok: false, error: `entry ${entry.id} missing label` };
    if (!Array.isArray(entry.hostPatterns) || entry.hostPatterns.length === 0) {
      return { ok: false, error: `entry ${entry.id} missing hostPatterns` };
    }
    if (!entry.extractor || !KNOWN_EXTRACTOR_KINDS.has(entry.extractor.kind)) {
      return { ok: false, error: `entry ${entry.id} has unknown extractor kind "${entry.extractor?.kind}"` };
    }
    // Excluded (pass-through) entries carry affiliate hosts by design — the
    // engine never unwraps them, so skip the host safety checks for those.
    if (!activeIds.has(entry.id)) continue;
    // Re-assert the safety gates on every LITERAL host of an ACTIVE wrapper.
    // Regex host patterns (Impact's `^…\.pxf\.io$`) are hand-authored and
    // exempt from the host string checks; the affiliate guard for those lives
    // at runtime.
    for (const pattern of entry.hostPatterns) {
      if (typeof pattern !== "string") continue;
      if (pattern.startsWith("^")) continue; // regex host, not a literal
      const host = pattern.toLowerCase();
      if (HOST_DENYLIST.has(host)) {
        return { ok: false, error: `entry ${entry.id} host "${host}" is on HOST_DENYLIST` };
      }
      if (collidesWithAffiliateNetwork(host)) {
        return { ok: false, error: `entry ${entry.id} host "${host}" is an affiliate redirect network — must not be unwrapped` };
      }
    }
  }
  return { ok: true };
}

async function main() {
  const keyPath = process.env.MUGA_WORKER_SIGNING_KEY_PATH;
  if (!keyPath) {
    console.error("[sign-wrappers] ERROR: MUGA_WORKER_SIGNING_KEY_PATH env var is not set.");
    console.error("  Set it to the path of the Ed25519 worker private key PEM file.");
    process.exit(2);
  }

  let privateKey;
  try {
    const keyPem = readFileSync(keyPath, "utf8");
    privateKey = createPrivateKey({ key: keyPem, format: "pem" });
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: Cannot read private key from "${keyPath}": ${err.message}`);
    process.exit(2);
  }

  // Read the RAW bytes — the signature is over the file bytes verbatim, which
  // is exactly what rules-wrappers-sync.test.mjs verifies.
  let body;
  try {
    body = readFileSync(WRAPPERS_FILE);
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: Cannot read "${WRAPPERS_FILE}": ${err.message}`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: wrappers.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const validation = validateWrappers(parsed);
  if (!validation.ok) {
    console.error(`[sign-wrappers] ERROR: artifact validation failed: ${validation.error}`);
    process.exit(1);
  }

  let sigBuf;
  try {
    sigBuf = cryptoSign(null, body, privateKey);
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: Signing failed: ${err.message}`);
    process.exit(2);
  }
  const sigBase64 = sigBuf.toString("base64");

  // Verify against the pinned public key before declaring success — a bad
  // key/artifact pairing must fail here, not in CI.
  try {
    const pubkeyB64 = readFileSync(PUBKEY_FILE, "utf8").trim();
    const pubkey = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(pubkeyB64, "base64"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await webcrypto.subtle.verify("Ed25519", pubkey, sigBuf, body);
    if (!ok) {
      console.error("[sign-wrappers] ERROR: signature does not verify against worker-pubkey.txt — wrong key. Refusing to write.");
      process.exit(2);
    }
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: verification step failed: ${err.message}`);
    process.exit(2);
  }

  try {
    writeFileSync(SIG_FILE, sigBase64 + "\n", "utf8");
  } catch (err) {
    console.error(`[sign-wrappers] ERROR: Cannot write signature to "${SIG_FILE}": ${err.message}`);
    process.exit(3);
  }

  const sha256 = createHash("sha256").update(body).digest("hex");
  console.log(JSON.stringify({
    wrappers: WRAPPERS_FILE,
    sig: SIG_FILE,
    entries: parsed.length,
    sha256,
    verified: true,
  }));
  process.exit(0);
}

main().catch((err) => {
  console.error("[sign-wrappers] Unexpected error:", err.message);
  process.exit(3);
});
