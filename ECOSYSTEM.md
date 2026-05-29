# muga in the MUGA Ecosystem

Short per-repo orientation. This file gives you what you need to act locally with awareness of the wider system.

## Your role

You are the **browser extension** — the primary implementation of MUGA's internal URL rules. You run in the user's Chrome (MV3) or Firefox (MV2) and intercept URLs at navigation time. You are where the false-positive principle is enforced in production, on real user clicks.

## What you produce

| Artifact | Channel | Audience |
|---|---|---|
| Distributable extension | Chrome Web Store + Firefox AMO | end users |
| Signed remote-rules updates | Ed25519 + GitHub release artifacts | the deployed extension auto-fetches |
| Popup "Report upstream" deep-links | GitHub issues opened by users | maintainers |

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
| [`src/lib/param-classifier.js`](src/lib/param-classifier.js) | Source of truth for `PARAM_PAIRS` and `ANCHOR_TRACKERS` — the lists that drive the contextual bounded-scope layer (documented in [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md)). |
| [`src/lib/wrapper-engine.js`](src/lib/wrapper-engine.js) | Detection + unwrap of redirect networks. Pulls from `src/rules/wrappers.json`. |
| [`src/rules/manifest.json`](src/rules/manifest.json) | The affiliate-program roster. Edit this to add or remove programs from MUGA's preservation list. |
| [`src/rules/wrappers.json`](src/rules/wrappers.json) | The redirect-network recipe table (Ed25519-signed). Edit this to add or update wrapper entries, then re-sign and regenerate `wrappers.data.js`. |
| [`src/lib/cross-site-frequency.js`](src/lib/cross-site-frequency.js) | Local tracker observation. Feeds the popup's "Suspicious params" UI. Pure module, never sends data off-device. |
| [`src/lib/csft-upstream.js`](src/lib/csft-upstream.js) | Privacy-contract enforcer for the "Report upstream" button. Strictly emits `{paramName, firstPartyDomainCount}` — nothing else. |
| [`src/lib/remote-rules.js`](src/lib/remote-rules.js) + [`src/lib/remote-rules-keys.js`](src/lib/remote-rules-keys.js) | The extension's own update-signing channel. Distinct from the rule-artifact signing. |
| [`AGENTS.md`](AGENTS.md) | Project standards (vanilla JS, security rules, naming, error handling). MUST be followed for every change. |

## Trust boundaries you participate in

- **You verify** signatures on `manifest.json` + `wrappers.json` before applying their contents.
- **You verify** signatures on muga-unwrap responses using the public key bundled at build time AND/OR fetched from `caps.muga.app/worker-pubkey.txt`.
- **You verify** signatures on your own remote-rules updates using `TRUSTED_PUBLIC_KEYS` in `src/lib/remote-rules-keys.js`.
- You do NOT verify the caps-crawler's discovery artifacts directly — those flow through maintainer review before landing in `src/rules/`.

## Things that ripple beyond this repo

| If you change… | Action required |
|---|---|
| `param-classifier.js` PARAM_PAIRS or ANCHOR_TRACKERS | Update `docs/rules/decision-algorithm.md` in lockstep; update the conformance vectors in `tests/rules-vectors/contextual.json` if the observable behaviour changes |
| `src/rules/wrappers.json` | Re-sign the artifact and regenerate `src/rules/wrappers.data.js`; the sync test (`tests/unit/rules-wrappers-sync.test.mjs`) will catch drift |
| `src/rules/manifest.json` | Regenerate `src/rules/manifest.data.js`; update any relevant conformance vectors |
| `remote-rules-keys.js` | Release event; rotation per ADR-D5 (3-release cycle) |
| The popup's "Report upstream" payload shape | Breaks the privacy contract if extra fields leak — review `csft-upstream.js` tests |

## What sits upstream of you

- `caps-crawler` — runs weekly and surfaces new redirect-wrapper and affiliate-program candidates. Those candidates are reviewed by the maintainer; accepted ones land in `src/rules/manifest.json` or `src/rules/wrappers.json` via a normal PR. The rule decision algorithm is documented in [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md).

## What sits downstream of you

- The deployed extension on user devices. Your release cadence (CWS review queue) determines how fast rule changes reach end users.
- The muga-unwrap Worker doesn't depend on you, but its allowlist (`wrappers.json`) is what you use to decide when to call it.

## Governing principles

1. False-positive principle — never strip what could be legitimate
2. Bounded scoping — ambiguous params only stripped under anchor co-occurrence
3. Affiliate precedence — preserving wins over stripping
4. Zero telemetry — no user data leaves the device without explicit user action
