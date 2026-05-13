# muga-unwrap Worker public key

This file documents the Ed25519 public key that signs responses from the muga-unwrap Privacy Proxy Worker (`https://unwrap.muga.app`).

## Current key

```
WOrFiWn7rFFkhQXJFn0kfCxNxA3rPmDK9qfDenHBVV0=
```

Format: raw 32-byte Ed25519 public key, base64-encoded (RFC 4648 §4 standard alphabet, with `=` padding).

The same value is also returned at `https://unwrap.muga.app/pubkey` directly from the Worker. Clients SHOULD prefer fetching the value from this file (`https://caps.muga.app/worker-pubkey.txt`) rather than from the Worker itself, because the file is served from a different host with an independent trust path — pinning it here means a compromised Worker cannot silently rotate to its own key without the rotation being visible.

## Verification

Every response from `/unwrap` includes a `signature` field (Ed25519 over the deterministic-JSON canonicalisation of the response body, with the `signature` field elided). To verify:

1. Parse the response JSON.
2. Take the response object and remove the `signature` field.
3. Canonicalize the remaining object: keys sorted lexicographically, no insignificant whitespace, UTF-8 encoded.
4. Verify the signature against this public key using Ed25519.

A reference verifier in pure JS (no dependencies beyond Web Crypto) ships with the `@yocreoquesi/caps-validator` package.

## Rotation policy

If the maintainer rotates the Worker signing key, the new public key replaces this file's contents in a single commit. The previous key is preserved in this repository's git history (and reachable via the commit at the time of rotation).

A rotation is announced in the [CHANGELOG](CHANGELOG.md) with the new key fingerprint, the rotation date, and the reason. Adopters who pin the previous key will see signature verification failures until they refresh — that is intentional and gives them an opportunity to audit the rotation rather than silently accepting it.

## Also signs the wrappers normative artifact

The same Ed25519 key documented above signs `wrappers.json` (see [SPEC.md §5A](SPEC.md#5a-wrappers-normative-artifact)). The detached signature lives at:

```
https://caps.muga.app/wrappers.json.sig
```

The same rotation policy applies: a key rotation re-signs both the Worker response payloads AND the wrappers artifact, with the new public key replacing this file's contents in a single commit and announced in the [CHANGELOG](CHANGELOG.md).

Rationale for sharing the key: the wrappers artifact and the Worker are operationally coupled — the Worker uses the artifact's `hostPatterns` as its fetch allowlist (per SPEC §5A.2), so a compromise of either trust root would already let an attacker influence the other. Splitting the keys would add operational cost without reducing blast radius.

## Distinct from the manifest signing key

This is the **Worker** signing key. It is different from the **manifest** signing key referenced in [SPEC.md §5.3](SPEC.md#53-distribution-normative).

| Key | Signs | Lives at | Used by |
|---|---|---|---|
| Worker pubkey (this file) | `/unwrap` response payloads | `caps.muga.app/worker-pubkey.txt` | MUGA extension when verifying Privacy Proxy responses |
| Manifest pubkey | `caps.muga.app/manifest.json` itself | `caps.muga.app/signer-pubkey.txt` | Any tool consuming the CAPS manifest |

Two separate trust roots, two separate rotation procedures, two separate compromise blast radii.
