# tests/fixtures

Test-only artifacts for the MUGA test suite.

## Contents

- `test-keys.mjs` — Ed25519 keypair generation and payload signing helpers.
  Used exclusively by unit and E2E tests. Contains no private key material;
  keypairs are generated at test runtime via `node:crypto.generateKeyPairSync`.

## IMPORTANT

- No private key material is committed here or anywhere in the repository.
- Keypairs generated via `generateTestKeypair()` exist only in memory during a test run.
- The production signing key lives in the GitHub secret `MUGA_SIGNING_KEY` and
  in `C:\Users\parada\.muga-keys\muga-signing.key` (gitignored, local only).
- Never import these helpers in production code paths.
