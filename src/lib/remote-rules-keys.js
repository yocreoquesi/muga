/** MUGA: trusted Ed25519 public keys for remote rule updates */
//
// Per proposal §3.1 and design ADR-D5: the key bundle lives in a separate
// file so key-rotation PRs are trivially reviewable — no surrounding code
// diff to eyeball.
//
// Format: standard base64-encoded raw Ed25519 public keys (32 bytes → 44 chars).
// Verification (in remote-rules.js) accepts the signed payload if ANY key in
// this array validates. No keyId field in the payload — iteration order only.
//
// Rotation is a 3-release cycle:
//   1. Add new key K2 alongside existing K1 — ship release
//   2. Switch signing secret to K2 — ~2 weeks user adoption
//   3. Remove K1 — ship release
//
// Changing this file is an extension-release event. The private key MUST
// never appear in this file or in any test file. Keep it in the GitHub secret
// MUGA_SIGNING_KEY (or local .muga-keys/ directory, gitignored).
//
// Test-only key override: when process.env.MUGA_TEST === '1', callers in the
// test environment may supply their own keys via globalThis.__MUGA_TRUSTED_KEYS__
// (wired in T7.2). This guard is inert in production builds.

export const TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "muga-2026-a" — first production key (generated 2026-04-23)
  // Fingerprint SHA-256 DER: 3w+KJI71uQeCy9tvmyl272ThQZSp+OHwSGdyOCx3Dks=
  "20Kz2HkuE2/GxXJX6DDIUzxQ2XQRJ7aUAG1J1qJNfg4=",
]);

// Trusted public keys for the Privacy Proxy Worker (unwrap.muga.app).
// Separate from the remote-rules key bundle: the worker has its own
// signing identity even when it currently shares the same key material —
// keeping the export separate means a future independent rotation
// touches one file, not two.
//
// Rotation follows the same 3-release cycle documented above.
//
// Test-only key override: tests define their own TEST_PUBLIC_KEY
// in-process and pass it directly to verifyUnwrapResponse.
export const PROXY_TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "worker-2026-b" — production Cloudflare Worker key. Mirrored from
  // caps-spec/worker-pubkey.txt and muga-unwrap/wrangler.toml SIGNING_PUBLIC_KEY.
  "ya3eMwaMswn4Y2hO+7rnKhthc3qkPEeAQQcL8Y8+TCk=",
]);
