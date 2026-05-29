# MUGA Rule Verification

MUGA's URL rules — what it preserves for creators and what it strips for privacy — are documented internally and enforced by a CI gate on every PR. The authoritative rule definition is [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md).

## Rule coverage

| Layer | Status | Internal reference |
|---|---|---|
| Basic tracking-param strip | active | [`src/lib/affiliates.js`](src/lib/affiliates.js) |
| Contextual bounded-scope strip | active, CI-gated | [`tests/rules-vectors/contextual.json`](tests/rules-vectors/contextual.json) |
| Wrapper unwrapping | active | [`src/rules/wrappers.json`](src/rules/wrappers.json) |

## How to verify

The Contextual layer is enforced by a CI gate on every PR (see `.github/workflows/ci.yml`). To run the same check locally:

```bash
npm run conformance:contextual
```

This drives every vector in `tests/rules-vectors/contextual.json` through `src/lib/cleaner.js`'s `processUrl` and asserts the observable behaviour matches the expected outputs:

- params listed in `expected.preservedParams` MUST be present in the cleaned URL with the expected value
- params listed in `expected.removedParams` MUST NOT be present in the cleaned URL
- on `network-redirect` hosts (wrappers in `src/rules/wrappers.json`), the bounded-scope rule MUST short-circuit (see the decision algorithm's step 6) — the harness asserts `PARAM_PAIRS` entries survive on those hosts

The harness lives at `tests/unit/conformance-contextual.test.mjs`.

## Implementation

The Contextual algorithm is implemented in `src/lib/param-classifier.js` (`PARAM_PAIRS`, `ANCHOR_TRACKERS`, `classify()`), and integrated into the cleaner pipeline in `src/lib/cleaner.js` between the unwrap and tracker-strip phases.

The network-redirect short-circuit is wired in `src/lib/cleaner.js`: when `detectWrapper(url)` returns a recipe (signalling the host is a redirect-network wrapper), the classifier is invoked with `_skipBoundedScope: true` and the bounded-scope rule does not fire. Wrapper-network classification itself comes from `src/rules/wrappers.json`, the Ed25519-signed normative artifact (see [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md) — Wrappers section).

## Rule artifacts

The `src/rules/` directory holds the internal rule artifacts MUGA verifies against:

- `wrappers.json` (+ `wrappers.json.sig`, `worker-pubkey.txt`) — the redirect-network recipe table, Ed25519 signature verified at sync time
- `manifest.json` / `manifest.data.js` — the affiliate-program roster
- `tests/rules-vectors/contextual.json` — the conformance test vectors for the Contextual bounded-scope layer

The `wrappers.data.js` ESM module is the runtime form; it must mirror `wrappers.json` byte-for-byte. Integrity is checked by `tests/unit/rules-wrappers-sync.test.mjs`.

## Reporting a rule regression

If you observe MUGA stripping a creator referral that the documented rules say to preserve, or preserving a tracker that the rules say to strip, please open an issue with:

1. The exact input URL.
2. The expected behaviour per [`docs/rules/decision-algorithm.md`](docs/rules/decision-algorithm.md).
3. The cleaned URL MUGA actually returned.
