#!/usr/bin/env node
/**
 * Generate a fresh Ed25519 keypair for the CAPS manifest signer.
 *
 * Used for the initial setup AND for key rotation. Writes nothing into the
 * repo by default — the operator pipes outputs to disk under
 * `$HOME/.caps-keys/` (gitignored) and pastes the pubkey into the
 * caps.muga.app/signer-pubkey.txt distribution.
 *
 * Usage:
 *   node scripts/generate-signer-key.mjs
 *
 *   # Or write straight to disk:
 *   node scripts/generate-signer-key.mjs --out-private $HOME/.caps-keys/signer.pem \
 *     --out-public  /tmp/signer-pubkey.txt
 *
 * Output:
 *   private key in PEM PKCS8 (paste into the GitHub secret CAPS_MANIFEST_SIGNING_KEY,
 *   AND save offline under $HOME/.caps-keys/ for the manual ritual)
 *   public key as base64 of 32 raw bytes (paste into signer-pubkey.txt)
 */

import { writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const outPrivate = flag("--out-private");
const outPublic = flag("--out-public");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ format: "pem", type: "pkcs8" });
const xUrl = publicKey.export({ format: "jwk" }).x;
const xStdB64 =
  xUrl.replace(/-/g, "+").replace(/_/g, "/") +
  "=".repeat((4 - (xUrl.length % 4)) % 4);

if (outPrivate) {
  writeFileSync(outPrivate, pem, { mode: 0o600 });
  console.error(`wrote private key (PEM PKCS8) → ${outPrivate} (mode 600)`);
} else {
  console.log("=== PRIVATE KEY (PEM PKCS8) ===");
  console.log(pem);
}

if (outPublic) {
  writeFileSync(outPublic, xStdB64 + "\n");
  console.error(`wrote public key (raw base64) → ${outPublic}`);
} else {
  console.log("=== PUBLIC KEY (base64 of 32 raw bytes) ===");
  console.log(xStdB64);
}

console.error(
  [
    "",
    "Next steps:",
    "  1. Paste the PRIVATE KEY into the GitHub Actions secret CAPS_MANIFEST_SIGNING_KEY.",
    "  2. Save the same PRIVATE KEY offline under $HOME/.caps-keys/signer.pem (mode 600).",
    "  3. Update signer-pubkey.txt at the repo root with the PUBLIC KEY.",
    "  4. Update caps.muga.app/signer-pubkey.txt to match.",
    "  5. Add a CHANGELOG entry under [Unreleased] noting the key generation/rotation.",
  ].join("\n"),
);
