# Affiliate Synthetic Test Harness

Source of truth for the matrix-to-code contract under the 2.1 denoise pivot.

The harness lives in `tests/integration/affiliate-harness.test.mjs` and reads per-network fixtures from `tests/integration/affiliate-harness/fixtures/`. It runs on every PR as part of `npm run test:integration` (the same CI step that exercises the live `unwrap.muga.app` Worker contract).

## What it guards

Three guards, one per matrix invariant:

| Guard | Question it asks | Status today |
|---|---|---|
| **G1** | Does the cleaner treat every fixture's redirect host as pass-through (affiliate-redirect, NOT a generic shortener)? | HARD — must always pass |
| **G2** | Does the cleaner strip every "tracking noise" param the fixture lists on a landing URL? | HARD — must always pass |
| **G3** | Does the cleaner preserve every "required-at-landing" attribution param the matrix lists? | SKIPPED — blocked on [#655](https://github.com/yocreoquesi/muga/issues/655) TRACKING_PARAMS audit |

G3 is skipped intentionally. The matrix v1.0 documents the attribution params that must survive landing, but the 2.0-era cleaner still strips them universally via `TRACKING_PARAMS`. #655 is the audit that migrates them out of universal-strip into the per-network `getLandingPolicy()` lookup (#656). When #655 lands, flip the skip in G3 and the harness becomes a strict gate.

## MVP scope (today)

Tier-1 only:

- **Awin** — `awin1.com`, `www.awin1.com`
- **CJ Affiliate** — 8 redirect domains (`anrdoezrs.net`, `dpbolvw.net`, `jdoqocy.com`, `kqzyfj.com`, `tkqlhce.com`, `emjcd.com`, `qksrv.net`, `cj.dotomi.com`)
- **AliExpress (Portals)** — `s.click.aliexpress.com`

The matrix documents six more networks (Impact, Partnerize, Admitad, A8.net, Rakuten, TradeTracker). Adding any of them is a single JSON file under `fixtures/` — no test code changes required.

## How to add a network

1. Confirm the network has a "Recommended cleaner policy" block in [`docs/affiliate-networks-matrix.md`](affiliate-networks-matrix.md). If not, the network is research-stage and is not ready for the harness.
2. Create a new fixture at `tests/integration/affiliate-harness/fixtures/<slug>.json`. Use one of the existing tier-1 fixtures as a template. Fields:
   - `network` — display name shown in the summary table.
   - `matrix_section` — relative link to the matrix entry (for review traceability).
   - `redirect_hosts` — every host the network uses as a click endpoint. The harness asserts each one is in `AFFILIATE_REDIRECT_NETWORKS` and NOT in `GENERIC_SHORTENERS`.
   - `redirect_url_samples` — synthetic redirect URLs in the network's documented shape. Used by G1 to assert pass-through on real URL parsing.
   - `landing_samples` — for each sample, a `url` plus an `expected` object listing `preserve` params (the network's attribution params from the matrix) and `strip` params (utm/fbclid/gclid/etc. that should be removed universally). `blocked_on` references the issue gating G3.
3. Run `npm run test:integration` locally. G1 and G2 must pass; G3 will skip.
4. Open the PR. The harness summary table will show the new network alongside the existing tier-1 ones.

## The `pending_resolution` escape hatch

When a fixture documents a network that the codebase does NOT yet handle the way the matrix prescribes (a known design conflict, not a bug-to-fix-in-this-PR), set a top-level `pending_resolution` string on the fixture. The runner will skip G1 for that network and surface `PENDING` in the summary table instead of `PASS`/`FAIL`.

Today **Awin** is the only fixture using this flag. Awin's redirect (`awin1.com/cread.php?p=<encoded URL>`) embeds the merchant URL in the query string, so MUGA currently local-unwraps it via `src/lib/wrapper-engine.js`. Under the matrix v1.0 recommended policy, Awin should instead be in `AFFILIATE_REDIRECT_NETWORKS` (pass-through), with the `awc`/`wt_mc` preservation handled by `getLandingPolicy()` (#656) at the merchant landing. Resolving that requires a design decision (Awin wrapper retire vs. preserve the local-unwrap as a creator-fair shortcut). Until then, Awin is in the harness for G2/G3 coverage but skipped for G1.

When that decision lands, remove the `pending_resolution` field from `fixtures/awin.json` and the runner will start enforcing G1 against Awin.

## How to retire G3's skip

When [#655](https://github.com/yocreoquesi/muga/issues/655) ships:

1. Remove the `blocked_on` field from every fixture's `landing_samples[i]`.
2. Remove the `{ skip: ... }` option from G3 in `affiliate-harness.test.mjs`.
3. Verify the suite passes. If any G3 assertion fails, that's a real regression — investigate and either:
   - Fix the cleaner to preserve the param at landing (likely scope of #656 `getLandingPolicy()`), or
   - Re-verify against the matrix entry (the matrix may have shifted; the doc is the contract).

## Reading the summary

The runner ends with a per-network verdict block:

```
  affiliate-harness summary:
  - Awin                          pass-through:PASS  strip:PASS  preserve:BLOCKED on #655
  - CJ Affiliate                  pass-through:PASS  strip:PASS  preserve:BLOCKED on #655
  - AliExpress (Portals direct)   pass-through:PASS  strip:PASS  preserve:BLOCKED on #655
```

A `FAIL` in `pass-through` means a fixture host disagrees with `AFFILIATE_REDIRECT_NETWORKS` — either the fixture needs updating or the source-of-truth list does.

A `FAIL` in `strip` means a param the fixture lists as tracking noise is NOT in `TRACKING_PARAMS` — the cleaner has lost coverage and the universal-strip needs to be widened.

## Why the harness lives in `tests/integration/`

It depends on the live source-of-truth modules (`opaque-networks.js`, `affiliates.js`) but does NOT exercise the network or the production Worker. It belongs alongside `proxy-client-contract.test.mjs` for the same reason: contract-level checks that are too coarse for unit tests but cheap enough to run on every PR.

## Weekly scheduled run (future)

The issue calls for a weekly scheduled run against `rules.muga.app`. That's not part of the MVP — the current `TRACKING_PARAMS` source-of-truth is bundled, not fetched. A scheduled run becomes meaningful once `rules.muga.app` starts shipping the per-network landing policy as a signed payload. Track in a follow-up issue.
