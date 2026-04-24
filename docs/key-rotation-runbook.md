# Key Rotation Runbook — MUGA Remote Rules Signing Key

This runbook covers the full lifecycle of the Ed25519 signing key used to
authenticate remote rule-update payloads (`docs/rules/v1/params.json`).

The extension embeds `TRUSTED_PUBLIC_KEYS` in `src/lib/remote-rules-keys.js`.
A rotation is a 3-release cycle that ensures every installed extension version
accepts payloads during the handover window before the old key is retired.

---

## 1. Normal Key Rotation (3-release cycle)

### Step 1 — Generate new keypair (local, offline)

Run locally on the maintainer's machine. Do NOT run on CI or any shared system.

```sh
# Generate new Ed25519 private key (PEM format)
openssl genpkey -algorithm ed25519 -out muga-signing-2026-b.pem

# Derive the raw 32-byte public key as standard base64
# (last 32 bytes of the DER-encoded SubjectPublicKeyInfo = raw key material)
openssl pkey -in muga-signing-2026-b.pem -pubout -outform DER \
  | tail -c 32 \
  | base64
```

Save the output (44-char base64 string) — this is the new public key to embed.

Store the private key file securely:
- **Never commit it to git**
- **Never share it in chat, email, or CI logs**
- Recommended location: `C:\Users\parada\.muga-keys\muga-signing-2026-b.pem`
  (or equivalent on your OS; this path is gitignored)

### Step 2 — Overlap window: embed new key alongside old

Open a PR that **adds** the new public key to `TRUSTED_PUBLIC_KEYS` in
`src/lib/remote-rules-keys.js`. Do NOT remove the old key yet.

```js
// Before rotation (single key)
export const TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "muga-2026-a" — first production key
  "20Kz2HkuE2/GxXJX6DDIUzxQ2XQRJ7aUAG1J1qJNfg4=",
]);

// After Step 2 (overlap window — BOTH keys trusted)
export const TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "muga-2026-a" — first production key (retiring after next release)
  "20Kz2HkuE2/GxXJX6DDIUzxQ2XQRJ7aUAG1J1qJNfg4=",
  // "muga-2026-b" — replacement key (effective after this release)
  "<base64-of-new-key>",
]);
```

Ship a release. Wait for user adoption (~1 release cycle, typically 1–2 weeks).
During the overlap window, any payload signed by EITHER key is accepted by ALL
installed extension versions.

### Step 3 — Switch the signing secret to the new key

Upload the new private key to the GitHub Actions secret:

```sh
gh secret set MUGA_SIGNING_KEY < C:\Users\parada\.muga-keys\muga-signing-2026-b.pem
```

From this point on, `publish-rules.yml` signs payloads with the new key.
Existing installs still trust both keys (K1 and K2) until Step 4.

### Step 4 — Remove the old public key

After ~1 more release cycle, open a PR that **removes** the old public key
from `TRUSTED_PUBLIC_KEYS`. Only the new key remains.

```js
export const TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "muga-2026-b" — current signing key
  "<base64-of-new-key>",
]);
```

Ship a release. Rotation is complete.

**Total elapsed time**: approximately 2–4 weeks (two release cycles).

---

## 2. Compromise Response (Emergency Rotation)

Use this path if the private key is suspected or confirmed leaked.

**Do NOT follow the 3-step overlap window** — speed is more important than
continuity. Payload verification failures are safe (they leave existing
`remoteParams` untouched and show an error in Settings). A compromised key
is a worse outcome than a temporary verification failure.

### Emergency Step 1 — Generate new keypair immediately

Same command as normal rotation Step 1, but do it now.

```sh
openssl genpkey -algorithm ed25519 -out muga-signing-emergency.pem
openssl pkey -in muga-signing-emergency.pem -pubout -outform DER \
  | tail -c 32 \
  | base64
```

### Emergency Step 2 — Open a PR that REPLACES the compromised key

```js
export const TRUSTED_PUBLIC_KEYS = Object.freeze([
  // "muga-2026-emergency" — replaces compromised key immediately
  "<base64-of-emergency-key>",
]);
```

Do NOT include the old (compromised) key. Remove it entirely.

Ship an emergency release as fast as possible.

### Emergency Step 3 — Update the GitHub Actions secret

```sh
gh secret set MUGA_SIGNING_KEY < C:\Users\parada\.muga-keys\muga-signing-emergency.pem
```

### Emergency Step 4 — File a public advisory

Note the window during which the old (compromised) key was valid. Describe the
blast-radius bound:

- The feature is **opt-in** (default off): only users who enabled Remote rule
  updates are affected.
- The payload is **additive-only**: a malicious payload could add params to the
  strip list. It CANNOT remove built-in params, inject code, or redirect URLs.
- The `REMOTE_PARAM_DENYLIST` and `AFFILIATE_PARAM_GUARD` hard-code critical
  params (search keys, affiliate tags) that cannot be stripped via remote payload.
- The worst realistic outcome: some non-tracking URLs had one or more query
  parameters stripped during the exposure window. Users can disable and
  re-enable the toggle to clear the bad payload.

---

## 3. First Deploy (T7.3 — DEFERRED)

> **Status: DEFERRED** — T7.3 is blocked on uploading the `MUGA_SIGNING_KEY`
> secret. It MUST NOT be executed until the secret is in place.

When ready to publish the first real signed payload:

1. Upload the production private key (generated in Phase 0 / P0.1):

   ```sh
   gh secret set MUGA_SIGNING_KEY < C:\Users\parada\.muga-keys\muga-signing.key
   ```

2. Commit an updated `tools/rules-source/params.json` (bump version, update
   `published`, add/remove params as desired). For the initial deploy, an empty
   params array is recommended:

   ```json
   {
     "version": 1,
     "published": "<current-ISO-8601>",
     "params": []
   }
   ```

3. Push to `main`. The `publish-rules.yml` workflow triggers, signs the payload,
   and commits `docs/rules/v1/params.json`.

4. Wait for the GitHub Pages smoke-check job to succeed (verifies the URL is
   reachable from GitHub Actions).

---

## 4. Reference — Key Storage

| Location | What | Notes |
|----------|------|-------|
| `src/lib/remote-rules-keys.js` | Public key(s) | Committed to git. Change triggers release. |
| `C:\Users\parada\.muga-keys\muga-signing.key` | Production private key | Local only, gitignored. NEVER commit. |
| GitHub secret `MUGA_SIGNING_KEY` | Production private key (PEM) | Used by `publish-rules.yml`. Set via `gh secret set`. |
| `tests/fixtures/test-keys.mjs` | Test keypair generator | Generates throw-away keys at test run time. No private key on disk. |

---

## 5. Verification Commands

After any rotation, verify the new public key matches the private key:

```sh
# Derive the raw public key from the new private key
openssl pkey -in muga-signing-NEW.pem -pubout -outform DER \
  | tail -c 32 \
  | base64
# Compare output to the value in src/lib/remote-rules-keys.js
```

Verify the signed payload round-trip manually:

```sh
# Sign a test payload (requires MUGA_SIGNING_KEY_PATH set)
MUGA_SIGNING_KEY_PATH=muga-signing-NEW.pem \
  node tools/sign-rules.mjs \
  --in tools/rules-source/params.json \
  --out /tmp/test-signed.json

# Inspect the output
cat /tmp/test-signed.json
```

---

## 6. Key IDs (naming convention)

Name keys by year and sequence: `muga-YYYY-X` where `X` is a letter (a, b, c…).
Record the association between the name, the base64 public key, and the PEM
filename in your private notes (NOT in git).

Current active key: `muga-2026-a`
Fingerprint SHA-256 DER: `3w+KJI71uQeCy9tvmyl272ThQZSp+OHwSGdyOCx3Dks=`
