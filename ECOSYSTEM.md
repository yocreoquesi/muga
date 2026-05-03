# muga in the MUGA Ecosystem

> Short per-repo orientation. **For the full picture, read [`caps-spec/ECOSYSTEM.md`](https://github.com/yocreoquesi/caps-spec/blob/main/ECOSYSTEM.md).** This file gives you only what you need to act locally with awareness of the wider system.

## Your role

You are the **browser extension** — the most-deployed consumer of the CAPS standard. You run in the user's Chrome (MV3) or Firefox (MV2) and intercept URLs at navigation time. You are where the false-positive principle is enforced in production, on real user clicks.

## What you produce

| Artifact | Channel | Audience |
|---|---|---|
| Distributable extension | Chrome Web Store + Firefox AMO | end users |
| Signed remote-rules updates | Ed25519 + GitHub release artifacts | the deployed extension auto-fetches |
| Popup "Report upstream" deep-links | GitHub issues opened by users | caps-spec maintainers |

## What you consume

| Artifact | Source | Used for |
|---|---|---|
| `manifest.json` | `https://caps.muga.app/manifest.json` (signed by `caps-2026-a`) | identifying creator referrals per host |
| `wrappers.json` | `https://caps.muga.app/wrappers.json` (signed by `worker-2026-b`) | detecting + unwrapping redirect networks locally |
| `unwrap.muga.app/unwrap` | the muga-unwrap Worker | resolving opaque wrappers the local engine can't decode |
| `signer-pubkey.txt`, `worker-pubkey.txt` | `caps.muga.app/*` | verifying signatures on the above |

## Key local files for orientation

| File | Why it matters |
|---|---|
| [`src/lib/cleaner.js`](src/lib/cleaner.js) | The hot path. Every URL the user navigates flows through here. |
| [`src/lib/param-classifier.js`](src/lib/param-classifier.js) | Source of truth for `PARAM_PAIRS` and `ANCHOR_TRACKERS` — the same lists transcribed verbatim into CAPS SPEC §4.4 (Contextual conformance). If you change either list here, propose a matching change to caps-spec. |
| [`src/lib/wrapper-engine.js`](src/lib/wrapper-engine.js) | Detection + unwrap of redirect networks. Pulls from `wrappers.json` (slice [muga#538](https://github.com/yocreoquesi/muga/issues/538) — currently inline, migrating to caps-spec consumption). |
| [`src/lib/cross-site-frequency.js`](src/lib/cross-site-frequency.js) | Local tracker observation. Feeds the popup's "Suspicious params" UI. Pure module, never sends data off-device. |
| [`src/lib/csft-upstream.js`](src/lib/csft-upstream.js) | Privacy-contract enforcer for the "Report upstream" button. Strictly emits `{paramName, firstPartyDomainCount}` — nothing else. |
| [`src/lib/remote-rules.js`](src/lib/remote-rules.js) + [`src/lib/remote-rules-keys.js`](src/lib/remote-rules-keys.js) | The extension's own update-signing channel. Distinct from CAPS signing. |
| [`AGENTS.md`](AGENTS.md) | Project standards (vanilla JS, security rules, naming, error handling). MUST be followed for every change. |

## Trust boundaries you participate in

- **You verify** signatures on `manifest.json` + `wrappers.json` before applying their contents (CAPS SPEC §5.2 + §5A.3).
- **You verify** signatures on muga-unwrap responses using the public key bundled at build time AND/OR fetched from `caps.muga.app/worker-pubkey.txt`.
- **You verify** signatures on your own remote-rules updates using `TRUSTED_PUBLIC_KEYS` in `src/lib/remote-rules-keys.js`.
- You do NOT verify the caps-crawler's discovery artifacts directly — those flow through caps-spec maintainer review first.

## Things that ripple beyond this repo

| If you change… | Notify / coordinate with… |
|---|---|
| `param-classifier.js` PARAM_PAIRS or ANCHOR_TRACKERS | open caps-spec PR to update SPEC §4.4 lists in lockstep |
| `wrapper-engine.js` WRAPPERS table | open caps-spec PR to update `wrappers.json` (still source of truth post-#538) |
| `remote-rules-keys.js` | release-event; rotation per ADR-D5 (3-release cycle) |
| The popup's "Report upstream" payload shape | breaks the privacy contract if extra fields leak — review `csft-upstream.js` tests |

## What sits upstream of you

- `caps-spec` — the standard you implement. Spec changes (new conformance levels, new anchor tracker, new pair) land there first, then you update to match.
- `caps-crawler` — runs weekly and may surface new candidates. Those candidates land in caps-spec via PR; eventually accepted ones promote to spec lists you implement.

## What sits downstream of you

- The deployed extension on user devices. Your release cadence (CWS review queue) determines how fast spec changes reach end users.
- The muga-unwrap Worker doesn't depend on you, but its allowlist (`wrappers.json`) is what you use to decide when to call it.

## Governing principles (full list in caps-spec/ECOSYSTEM.md)

1. False-positive principle — never strip what could be legitimate
2. Bounded scoping — ambiguous params only stripped under anchor co-occurrence
3. Affiliate precedence — preserving wins over stripping
4. Zero telemetry — no user data leaves the device without explicit user action
