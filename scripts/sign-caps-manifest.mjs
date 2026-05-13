#!/usr/bin/env node
/**
 * Sign manifest.json in place with the CAPS manifest signer key.
 *
 * Decision 1 of caps-spec#3. This is the shared signing tool used by both
 * the CI auto-sign path (.github/workflows/manifest-auto-sign.yml) and the
 * offline manual-signing ritual documented in GOVERNANCE.md.
 *
 * Procedure (SPEC §5.2):
 *   1. Set signed_at to now (ISO 8601), signer_pubkey to the published key,
 *      signature to null.
 *   2. Canonicalize the manifest with the signature field elided.
 *   3. Sign canonical bytes with Ed25519 per RFC 8032.
 *   4. Write the base64-encoded signature back into the signature field.
 *   5. Re-verify before exit so a corrupt write fails loudly.
 *
 * Usage:
 *   # CI path — key from secret env var
 *   CAPS_MANIFEST_SIGNING_KEY=<pem-or-raw-seed-b64> node scripts/sign-manifest.mjs --bump
 *
 *   # Offline path — key from file under $HOME/.caps-keys/ (gitignored)
 *   node scripts/sign-manifest.mjs --key-file $HOME/.caps-keys/signer.pem --bump
 *
 * Flags:
 *   --bump          Increment manifest_version by 1 before signing
 *   --key-file P    Read PEM-PKCS8 private key from file P (overrides env)
 *   --no-verify     Skip the post-sign self-verification (debug only)
 *
 * Accepted private-key encodings (env or file):
 *   - PEM PKCS8 (BEGIN PRIVATE KEY ... END PRIVATE KEY) — preferred
 *   - 32-byte raw Ed25519 seed, base64-encoded (length 44 incl. padding)
 *
 * Exit codes: 0 ok, 1 bad usage, 2 key load failed, 3 sign failed, 4 verify failed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const MANIFEST_PATH = "manifest.json";
const SIGNER_PUBKEY_PATH = "signer-pubkey.txt";

function parseArgs(argv) {
  const args = { bump: false, keyFile: undefined, verify: true, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bump") args.bump = true;
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--key-file") args.keyFile = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 38).join("\n"));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function loadPrivateKey({ keyFile }) {
  let raw;
  if (keyFile) {
    raw = readFileSync(keyFile, "utf8").trim();
  } else {
    raw = (process.env.CAPS_MANIFEST_SIGNING_KEY ?? "").trim();
  }
  if (!raw) {
    console.error(
      "No signing key found. Provide CAPS_MANIFEST_SIGNING_KEY env var or --key-file.",
    );
    process.exit(2);
  }
  // Branch: PEM if it looks like one; otherwise treat as base64 raw seed.
  if (raw.startsWith("-----BEGIN")) {
    try {
      return createPrivateKey({ key: raw, format: "pem" });
    } catch (e) {
      console.error(`Failed to parse PEM key: ${e?.message ?? e}`);
      process.exit(2);
    }
  }
  // Raw 32-byte seed, base64-encoded. Wrap in PKCS8 DER and load.
  const seed = Buffer.from(raw, "base64");
  if (seed.length !== 32) {
    console.error(
      `Key is neither PEM nor a 32-byte base64 seed (got ${seed.length} bytes after decode).`,
    );
    process.exit(2);
  }
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const der = Buffer.concat([prefix, seed]);
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch (e) {
    console.error(`Failed to wrap raw seed into PKCS8: ${e?.message ?? e}`);
    process.exit(2);
  }
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    if (!Number.isInteger(value)) throw new Error("float not supported");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") +
      "}"
    );
  }
  throw new Error(`unsupported value type ${typeof value}`);
}

function signManifest({ bump, verify: doVerify, dryRun }, privKey) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (bump) manifest.manifest_version = (manifest.manifest_version | 0) + 1;

  manifest.signed_at = new Date().toISOString();
  manifest.signer_pubkey = readFileSync(SIGNER_PUBKEY_PATH, "utf8").trim();
  delete manifest.signature; // signature is computed over the manifest WITHOUT this field.

  const canonicalBytes = Buffer.from(canonicalJson(manifest), "utf8");
  let sigBuf;
  try {
    sigBuf = sign(null, canonicalBytes, privKey);
  } catch (e) {
    console.error(`Ed25519 sign failed: ${e?.message ?? e}`);
    process.exit(3);
  }
  manifest.signature = sigBuf.toString("base64");

  if (doVerify) {
    const pub = jwkPublicKeyFromBase64Raw(manifest.signer_pubkey);
    const ok = verify(null, canonicalBytes, pub, sigBuf);
    if (!ok) {
      console.error("Post-sign self-verification FAILED. Refusing to write a corrupt manifest.");
      process.exit(4);
    }
  }

  if (dryRun) {
    console.log(
      `[dry-run] would write manifest_version=${manifest.manifest_version} signed_at=${manifest.signed_at} (signature OK${doVerify ? "" : ", verify skipped"})`,
    );
    return;
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Signed manifest_version=${manifest.manifest_version} signed_at=${manifest.signed_at}`,
  );
}

function jwkPublicKeyFromBase64Raw(b64) {
  const x = b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

const args = parseArgs(process.argv);
const privKey = loadPrivateKey(args);
signManifest(args, privKey);
