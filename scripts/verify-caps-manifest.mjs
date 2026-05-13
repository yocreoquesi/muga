#!/usr/bin/env node
/**
 * Verify the signature on manifest.json against signer-pubkey.txt.
 *
 * Used by:
 *   - The manifest-pr-gates workflow (gate 2).
 *   - The CI auto-sign workflow as a post-sign sanity check.
 *   - Maintainers locally before publishing the offline-signed manifest.
 *
 * Exit codes: 0 ok, 1 manifest unsigned (informational), 2 verify failed.
 */

import { readFileSync } from "node:fs";
import { createPublicKey, verify } from "node:crypto";

const MANIFEST_PATH = process.argv[2] ?? "manifest.json";
const SIGNER_PUBKEY_PATH = "signer-pubkey.txt";

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
      "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}"
    );
  }
  throw new Error(`unsupported value type ${typeof value}`);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
if (!manifest.signature || !manifest.signer_pubkey) {
  console.log(`${MANIFEST_PATH} is unsigned (pre-release).`);
  process.exit(1);
}

const trustedB64 = readFileSync(SIGNER_PUBKEY_PATH, "utf8").trim();
if (manifest.signer_pubkey !== trustedB64) {
  console.error(
    `signer_pubkey in manifest does not match ${SIGNER_PUBKEY_PATH}.\n` +
      `  manifest: ${manifest.signer_pubkey}\n  trusted:  ${trustedB64}`,
  );
  process.exit(2);
}

const sigBytes = Buffer.from(manifest.signature, "base64");
const x = trustedB64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });

const { signature: _omit, ...rest } = manifest;
void _omit;
const ok = verify(null, Buffer.from(canonicalJson(rest), "utf8"), pub, sigBytes);
if (!ok) {
  console.error(`Signature verification FAILED on ${MANIFEST_PATH}.`);
  process.exit(2);
}
console.log(
  `${MANIFEST_PATH} signature OK (manifest_version=${manifest.manifest_version}, signed_at=${manifest.signed_at}).`,
);
