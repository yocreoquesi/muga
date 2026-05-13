#!/usr/bin/env node
/**
 * Roundtrip test: generate a fresh keypair, sign a sample manifest with
 * scripts/sign-manifest.mjs (env-var path), then verify it with
 * scripts/verify-manifest.mjs. Both raw-seed and PEM-PKCS8 secret formats
 * are exercised so a regression in the format-detection logic is caught.
 *
 * Run: node scripts/sign-manifest.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL ${name}`);
    console.error(e?.stack ?? e);
    failed++;
  }
}

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "caps-sign-"));
  // Minimal repo shape needed by sign-manifest.mjs and verify-manifest.mjs.
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        caps_version: "1.0.0-rc1",
        manifest_version: 5,
        signed_at: null,
        signer_pubkey: null,
        signature: null,
        programs: [],
      },
      null,
      2,
    ),
  );
  return dir;
}

function freshKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  const xUrl = publicKey.export({ format: "jwk" }).x;
  const xStdB64 = xUrl.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (xUrl.length % 4)) % 4);
  // Raw seed: PKCS8 DER for Ed25519 has the seed as the last 32 bytes after the fixed prefix.
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  const seedB64 = Buffer.from(der.subarray(der.length - 32)).toString("base64");
  return { pem: pem.toString(), pubB64: xStdB64, seedB64 };
}

function signAndVerify({ keyEnv }) {
  const repo = makeTempRepo();
  const keys = freshKeys();
  writeFileSync(join(repo, "signer-pubkey.txt"), keys.pubB64 + "\n");

  // Copy the scripts into the temp repo so cwd-relative reads work.
  copyFileSync("scripts/sign-manifest.mjs", join(repo, "sign-manifest.mjs"));
  copyFileSync("scripts/verify-manifest.mjs", join(repo, "verify-manifest.mjs"));

  const env = { ...process.env, CAPS_MANIFEST_SIGNING_KEY: keyEnv === "pem" ? keys.pem : keys.seedB64 };
  execFileSync("node", ["sign-manifest.mjs", "--bump"], { cwd: repo, env, stdio: "pipe" });

  const after = JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8"));
  assert.equal(after.manifest_version, 6, "manifest_version was bumped");
  assert.equal(after.signer_pubkey, keys.pubB64, "signer_pubkey written from signer-pubkey.txt");
  assert.ok(after.signature, "signature populated");
  assert.match(after.signed_at, /^\d{4}-\d{2}-\d{2}T/, "signed_at is ISO 8601");

  // verify-manifest exits 0 on success
  execFileSync("node", ["verify-manifest.mjs"], { cwd: repo, env: process.env, stdio: "pipe" });

  rmSync(repo, { recursive: true, force: true });
}

console.log("sign + verify roundtrip");
it("PEM PKCS8 secret format", () => signAndVerify({ keyEnv: "pem" }));
it("raw 32-byte base64 seed secret format", () => signAndVerify({ keyEnv: "seed" }));

it("verify rejects a tampered manifest after signing", () => {
  const repo = makeTempRepo();
  const keys = freshKeys();
  writeFileSync(join(repo, "signer-pubkey.txt"), keys.pubB64 + "\n");
  copyFileSync("scripts/sign-manifest.mjs", join(repo, "sign-manifest.mjs"));
  copyFileSync("scripts/verify-manifest.mjs", join(repo, "verify-manifest.mjs"));

  const env = { ...process.env, CAPS_MANIFEST_SIGNING_KEY: keys.pem };
  execFileSync("node", ["sign-manifest.mjs"], { cwd: repo, env, stdio: "pipe" });

  // Tamper: bump manifest_version after signing.
  const m = JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8"));
  m.manifest_version += 1;
  writeFileSync(join(repo, "manifest.json"), JSON.stringify(m, null, 2));

  let exitCode = 0;
  try {
    execFileSync("node", ["verify-manifest.mjs"], { cwd: repo, env: process.env, stdio: "pipe" });
  } catch (e) {
    exitCode = e.status ?? -1;
  }
  assert.equal(exitCode, 2, "verify-manifest exits 2 on tampered payload");
  rmSync(repo, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
