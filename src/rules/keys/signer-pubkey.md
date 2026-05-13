# CAPS manifest signer key

The CAPS manifest signer key is the Ed25519 keypair whose **public** half is published at:

- This repository: [`signer-pubkey.txt`](./signer-pubkey.txt)
- Distribution endpoint: `https://caps.muga.app/signer-pubkey.txt`

It signs `manifest.json` per SPEC §5.2 (RFC 8785 canonicalisation, Ed25519 per RFC 8032). Adopters pin this key out-of-band on first fetch and refuse manifests signed by a different key without an explicit user action (SPEC §5.3).

## Trust-root separation

CAPS uses three independent Ed25519 keypairs, each with its own rotation procedure and its own blast radius. Compromise of one MUST NOT cascade.

| Key | Signs | Lives at | Used by |
|---|---|---|---|
| **Manifest signer** (this file) | `manifest.json` | `caps.muga.app/signer-pubkey.txt` | Any tool consuming the CAPS manifest |
| Worker key | `/unwrap` responses from muga-unwrap; `wrappers.json` | `caps.muga.app/worker-pubkey.txt` | MUGA verifying Privacy Proxy responses + wrappers consumers |
| Crawler key | `discovered/<date>.json` candidate-tracker reports | `caps.muga.app/crawler-pubkey.txt` | caps-spec CI when ingesting crawler PRs |

The worker key happens to sign two artifacts (`/unwrap` and `wrappers.json`) by design — those two have the same trust boundary (the Privacy Proxy operator). The manifest signer is **separate** because the manifest publishes the trust boundary itself: an attacker who controls the manifest signer can introduce malicious entries that adopters trust by default. The smaller the surface, the better.

## Custody

The private key has **two homes**, both required for the hybrid signing model in [GOVERNANCE.md → Signing](./GOVERNANCE.md#signing):

1. **GitHub Actions secret** `CAPS_MANIFEST_SIGNING_KEY` in the `caps-spec` repository. Used by `.github/workflows/manifest-auto-sign.yml` for the routine additive-PR signing path. Encrypted at rest by GitHub; never rendered in logs.

2. **Offline copy** under `$HOME/.caps-keys/signer.pem` (mode 600) on the editor's machine. Used by the offline ritual for any change outside `programs[]` or any batch larger than the auto-sign path is willing to handle. The directory is gitignored (see `.gitignore`).

The two copies MUST be byte-identical. Generation and rotation use `scripts/generate-signer-key.mjs` which produces the canonical PEM PKCS8 form on stdout (or `--out-private` to file).

## Rotation

Routine rotation follows a **three-release cycle** mirroring the MUGA `remote-rules-keys.js` pattern:

1. **Generate** the new keypair offline. Update `signer-pubkey.txt` to list both the current and the new pubkey, with the **new** key marked as the next active. Publish a CHANGELOG entry.
2. **One release later** (next first-Monday batch), the new key becomes the active signer. The old key remains listed in `signer-pubkey.txt` so adopters that have not yet refreshed can still verify the prior manifest.
3. **One release after that**, the old key is removed from `signer-pubkey.txt` and retired. Adopters that have not refreshed in two cycles will receive `signature_verify_failed` from `loadManifest` and SHOULD fall back to their cached prior-manifest per SPEC §5.4.

Emergency rotation (suspected compromise) collapses the cycle:

1. Open a `[SECURITY-HOTFIX]` incident issue using `incident-disclosure.yml`. Triggers the 24-hour SLA per `GOVERNANCE.md → Publication cadence`.
2. Generate a fresh keypair, publish the new pubkey AS THE ONLY entry in `signer-pubkey.txt`, rotate the GitHub secret, sign the next manifest with the new key.
3. Publish a post-mortem in `incidents/` per `GOVERNANCE.md → Program revocation` post-mortem requirements (the malicious-cause clause applies to compromised keys regardless of the underlying trigger).

## Verification

Anyone consuming `manifest.json` MUST verify the signature before trusting its contents. Two paths:

- **JS/TS adopters**: `loadManifest(json, { trustedPubkey: PUBKEY_BYTES })` from `@yocreoquesi/caps-validator` (per SPEC §5 / `validator/README.md`).
- **Shell / CI**: `node scripts/verify-manifest.mjs` (uses `signer-pubkey.txt` as the trusted key; exits 0 on OK, 2 on failure).

Both paths reproduce the SPEC §5.2 procedure: canonicalise the manifest with the `signature` field elided, then Ed25519-verify the base64-decoded signature against the trusted pubkey.
