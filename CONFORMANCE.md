# CAPS rules — internal contract

MUGA's decision algorithm for distinguishing creator-affiliate parameters from cross-site trackers is documented in [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md) (referred to internally as the **CAPS rules**: Creator Attribution Preservation). This file describes which contracts the test suite enforces, and how to verify them.

We do not operate the CAPS rules as a multi-party standard — there is one editor (the maintainer) and one implementation (MUGA itself). The documentation exists so that every decision is auditable from outside the project, not so that adopters can claim conformance to a label.

## What the tests guarantee

**Basic + Contextual contracts**, enforced on every PR by CI (`.github/workflows/ci.yml`).

| Contract | Status | Test corpus |
|---|---|---|
| Basic | enforced | [`tests/rules-vectors/basic.json`](tests/rules-vectors/basic.json) |
| Contextual extension | enforced | [`tests/rules-vectors/contextual.json`](tests/rules-vectors/contextual.json) |
| Full | not enforced — no behavioural commitment yet | — |
| Strict | not enforced — no behavioural commitment yet | — |

The Contextual extension is independent of the base contracts per [decision-algorithm.md §4.4](docs/rules/decision-algorithm.md). MUGA's combined contract is `Basic + Contextual`.

## How to verify locally

```bash
npm run conformance:contextual
```

This drives every vector in `tests/rules-vectors/contextual.json` through `src/lib/cleaner.js`'s `processUrl` and asserts the observable behaviour matches the documented outputs:

- params listed in `expected.preservedParams` MUST be present in the cleaned URL with the expected value
- params listed in `expected.removedParams` MUST NOT be present in the cleaned URL
- on `network-redirect` hosts (wrappers in `src/rules/caps-wrappers.json`), the bounded-scope rule MUST short-circuit per [decision-algorithm.md §3.2 step 6](docs/rules/decision-algorithm.md) — the harness asserts `PARAM_PAIRS` entries survive on those hosts

The harness lives at `tests/unit/conformance-contextual.test.mjs`.

## Implementation

The Contextual algorithm is implemented in `src/lib/param-classifier.js` (`PARAM_PAIRS`, `ANCHOR_TRACKERS`, `classify()`), and integrated into the cleaner pipeline in `src/lib/cleaner.js` between the unwrap and tracker-strip phases.

The network-redirect short-circuit is wired in `src/lib/cleaner.js`: when `detectWrapper(url)` returns a recipe (signalling the host is a redirect-network wrapper), the classifier is invoked with `_skipBoundedScope: true` and the bounded-scope rule does not fire. Wrapper-network classification itself comes from `src/rules/caps-wrappers.json`, the Ed25519-signed wrapper-recipe table (served externally at `caps.muga.app/wrappers.json` so downstream consumers can verify).

## Rule artifacts

The `src/rules/` directory holds the rule snapshots the cleaner relies on:

- `caps-manifest.json` (+ `.schema.json`) — direct-injection affiliate programs MUGA preserves
- `caps-wrappers.json` (+ `.sig`, `.schema.json`) — the redirect-network recipe table, Ed25519 signed
- `keys/signer-pubkey.txt`, `keys/worker-pubkey.txt`, `keys/crawler-pubkey.txt` — public keys verifiers use against the corresponding signed artifacts
- `caps-manifest.data.js`, `caps-wrappers.data.js` — ESM wrappers consumed at runtime (the signed `.json` files are the source of truth; the `.data.js` modules mirror them for code-load convenience and a consistency test asserts they do not drift)

## Reporting a regression

If you observe MUGA stripping a creator referral the documented algorithm says to preserve, or preserving a tracker the algorithm says to strip, please open an issue with:

1. The exact input URL.
2. The expected behaviour per the relevant section of [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md).
3. The cleaned URL MUGA actually returned.

This is what makes the documentation valuable: a third party can hold MUGA accountable to a written contract instead of trusting our blog post.
