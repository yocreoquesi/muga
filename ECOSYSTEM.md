# muga: where the pieces live

MUGA is the user-facing product. A couple of companion deployments support it, and a couple of artefacts are published externally so anyone can verify what the extension applies. This file is the orientation for someone landing on the repo who wants to know "where does X come from, and who verifies it?".

## Your role

You are the **browser extension** — the artefact users install in Chrome (MV3) or Firefox (MV2). You run on the user's device, intercept URLs at navigation time, and enforce every published rule locally. There is no server-side cleaning pipeline.

## What you produce

| Artefact | Channel | Audience |
|---|---|---|
| Distributable extension | Chrome Web Store + Firefox AMO | end users |
| Signed remote-rules updates | Ed25519 + GitHub release artifacts under `docs/rules/v1/` | the deployed extension auto-fetches |
| Public rule snapshots | `caps.muga.app/manifest.json`, `caps.muga.app/wrappers.json` | anyone who wants to audit what MUGA applies; can be consumed by other tools without being part of MUGA |
| Popup "Report upstream" deep-links | GitHub issues opened by users | the maintainer (rule-list curation) |

## What you consume

| Artefact | Source | Used for |
|---|---|---|
| `src/rules/caps-manifest.json` | maintained in this repo, signed at release | identifying creator referrals per host |
| `src/rules/caps-wrappers.json` | maintained in this repo, signed at release | detecting + unwrapping redirect networks locally |
| `unwrap.muga.app/unwrap` | the muga-unwrap Worker (separate repo, deployed to Cloudflare) | resolving opaque wrappers the local engine can't decode (opt-in via Privacy Proxy mode) |
| `src/rules/keys/signer-pubkey.txt`, `keys/worker-pubkey.txt` | maintained in this repo | verifying signatures on remote-rules updates and unwrap responses |

## Key local files for orientation

| File | Why it matters |
|---|---|
| [`src/lib/cleaner.js`](src/lib/cleaner.js) | The hot path. Every URL the user navigates flows through here. |
| [`src/lib/param-classifier.js`](src/lib/param-classifier.js) | Source of truth for `PARAM_PAIRS` and `ANCHOR_TRACKERS` — the Contextual decision algorithm. Documented in [`docs/rules/decision-algorithm.md` §4.4](docs/rules/decision-algorithm.md). |
| [`src/lib/wrapper-engine.js`](src/lib/wrapper-engine.js) | Detection + unwrap of redirect networks. Consumes `src/rules/caps-wrappers.data.js`. |
| [`src/lib/cross-site-frequency.js`](src/lib/cross-site-frequency.js) | Local tracker observation. Feeds the popup's "Suspicious params" UI. Pure module, never sends data off-device. |
| [`src/lib/csft-upstream.js`](src/lib/csft-upstream.js) | Privacy-contract enforcer for the "Report upstream" button. Strictly emits `{paramName, firstPartyDomainCount}` — nothing else. |
| [`src/lib/remote-rules.js`](src/lib/remote-rules.js) + [`src/lib/remote-rules-keys.js`](src/lib/remote-rules-keys.js) | The extension's signed update channel. |
| [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md) | The documented algorithm the rule files encode. Internal contract; not operated as a multi-party standard. |
| [`AGENTS.md`](AGENTS.md) | Project standards (vanilla JS, security rules, naming, error handling). MUST be followed for every change. |

## Trust boundaries you participate in

- **You verify** signatures on `src/rules/caps-wrappers.json` at build / release time using `src/rules/keys/signer-pubkey.txt`.
- **You verify** signatures on muga-unwrap responses using `src/rules/keys/worker-pubkey.txt`.
- **You verify** signatures on your own remote-rules updates using `TRUSTED_PUBLIC_KEYS` in `src/lib/remote-rules-keys.js`.
- You do NOT verify caps-crawler's discovery artefacts directly — those flow through human maintainer review (PRs to this repo) before becoming part of any signed artefact.

## Companion projects

- **muga-unwrap** (separate repo, Cloudflare Worker deployment) — resolves opaque affiliate wrappers without leaking the user IP. Opt-in via Privacy Proxy mode. Sibling deployment, not part of this codebase.
- **caps-crawler** (separate repo, internal infrastructure) — observes new tracking parameters and surfaces candidates for inclusion in the rule files via PR. Runs weekly; outputs land here as code review, not as automated commits.

## Governing principles

1. **False-positive principle** — never strip what could be legitimate.
2. **Bounded scoping** — ambiguous params only stripped under anchor co-occurrence.
3. **Affiliate precedence** — preserving wins over stripping.
4. **Zero telemetry** — no user data leaves the device without explicit user action.
