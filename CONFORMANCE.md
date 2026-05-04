# CAPS Conformance

MUGA implements the [Creator Affiliate Preservation Standard](https://github.com/yocreoquesi/caps-spec) (CAPS) and claims conformance at the levels listed below. The standard is the formal contract for what a privacy tool MUST preserve so creators get paid, and what it MUST strip so users do not get tracked across sites.

## Claimed level

**CAPS-Basic + Contextual** against `caps-spec` v1.0.0-rc1.

| Level | Status | Source of truth |
|---|---|---|
| Basic | claimed | [`caps-spec/test-vectors/basic/`](https://github.com/yocreoquesi/caps-spec/tree/main/test-vectors/basic) |
| Full | not yet claimed | — |
| Strict | not yet claimed | — |
| Contextual extension | claimed | [`caps-spec/test-vectors/contextual.json`](https://github.com/yocreoquesi/caps-spec/blob/main/test-vectors/contextual.json) |

The Contextual extension is independent of the base levels per [SPEC §4.4](https://github.com/yocreoquesi/caps-spec/blob/main/SPEC.md#44-contextual-extension-normative-optional). MUGA's combined claim is `Basic + Contextual`.

## How to verify

The Contextual extension is enforced by a CI gate on every PR (see `.github/workflows/ci.yml`). To run the same check locally:

```bash
npm run conformance:contextual
```

This drives every vector in `vendor/caps-spec/test-vectors/contextual.json` through `src/lib/cleaner.js`'s `processUrl` and asserts the observable behaviour matches the spec's expected outputs:

- params listed in `expected.preservedParams` MUST be present in the cleaned URL with the expected value
- params listed in `expected.removedParams` MUST NOT be present in the cleaned URL
- on `network-redirect` hosts (wrappers in `vendor/caps-spec/wrappers.json`), the bounded-scope rule MUST short-circuit per SPEC §3.2 step 6 — the harness asserts `PARAM_PAIRS` entries survive on those hosts

The harness lives at `tests/unit/conformance-contextual.test.mjs`.

## Implementation

The Contextual algorithm is implemented in `src/lib/param-classifier.js` (`PARAM_PAIRS`, `ANCHOR_TRACKERS`, `classify()`), and integrated into the cleaner pipeline in `src/lib/cleaner.js` between the unwrap and tracker-strip phases.

The network-redirect short-circuit is wired in `src/lib/cleaner.js`: when `detectWrapper(url)` returns a recipe (signalling the host is a redirect-network wrapper), the classifier is invoked with `_skipBoundedScope: true` and the bounded-scope rule does not fire. Wrapper-network classification itself comes from `vendor/caps-spec/wrappers.json`, the Ed25519-signed normative artifact.

## Vendored artifacts

The `vendor/caps-spec/` directory holds the snapshots MUGA verifies against:

- `wrappers.json` (+ `.sig`, `worker-pubkey.txt`) — the redirect-network recipe table, signature verified at sync time
- `test-vectors/contextual.json` — the conformance test vectors

To refresh the snapshot from the upstream caps-spec checkout:

```bash
npm run sync:wrappers
```

This verifies the Ed25519 signature on `wrappers.json` fail-closed before writing anything.

## Reporting a conformance regression

If you observe MUGA stripping a creator referral that the spec says to preserve, or preserving a tracker that the spec says to strip, please open an issue with:

1. The exact input URL.
2. The expected behaviour per the relevant SPEC section.
3. The cleaned URL MUGA actually returned.

This is what makes CAPS valuable: a third party can hold MUGA accountable to a written contract instead of trusting our blog post.
