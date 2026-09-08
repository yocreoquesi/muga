# Affiliate Synthetic Test Harness

Source of truth for the matrix-to-code contract: the invariants that keep MUGA's URL cleaning from breaking creator attribution on affiliate-redirect networks.

The harness lives in `tests/integration/affiliate-harness.test.mjs` and reads per-network fixtures from `tests/integration/affiliate-harness/fixtures/`. It runs on every PR as part of `npm run test:integration`. It touches no network: every guard resolves against the bundled source-of-truth modules.

## What it guards

Three guards, one per matrix invariant:

| Guard | Question it asks | Status today |
|---|---|---|
| **G1** | Does the cleaner treat every fixture's redirect host as pass-through (affiliate-redirect, NOT a generic shortener)? | HARD — must always pass |
| **G2** | Does the cleaner strip every "tracking noise" param the fixture lists on a landing URL? | HARD — must always pass |
| **G3** | Does the cleaner preserve every "required-at-landing" attribution param the matrix lists? | HARD — must always pass |

G3 was skipped when the harness first landed, blocked on the #655 `TRACKING_PARAMS` audit that moved attribution params out of universal-strip and into the per-network `getLandingPolicy()` lookup (#656). That shipped, and G3 has been a hard gate since #657. It asserts three things per landing sample: the matrix-required param is absent from `TRACKING_PARAMS`, `getLandingPolicy()` returns it in the preserve set, and an end-to-end `processUrl()` call with the sample referrer keeps it while stripping everything the fixture marks as noise.

## Coverage today

Twelve networks, one fixture each:

| Network | Redirect hosts |
|---|---|
| A8.net (Japan) | `px.a8.net` |
| Admitad | `ad.admitad.com` |
| AliExpress (Portals direct) | `s.click.aliexpress.com` |
| Awin | `awin1.com`, `www.awin1.com` |
| CJ Affiliate | `anrdoezrs.net`, `dpbolvw.net`, `jdoqocy.com`, `kqzyfj.com`, `tkqlhce.com`, `emjcd.com`, `qksrv.net`, `cj.dotomi.com` |
| Impact Radius (impact.com) | `target.pxf.io`, `walmart.pxf.io`, `gohealth.pxf.io` |
| Partnerize (Performance Horizon) | `prf.hn` |
| Rakuten Advertising (LinkShare) | `click.linksynergy.com` |
| ShareASale | `shareasale.com`, `www.shareasale.com` |
| Skimlinks | `go.redirectingat.com`, `go.skimresources.com` |
| Tradedoubler | `clk.tradedoubler.com` |
| TradeTracker | `tc.tradetracker.net` |

Adding another is a single JSON file under `fixtures/`, with no test code changes.

## How to add a network

1. Confirm the network has a "Recommended cleaner policy" block in [`docs/affiliate-networks-matrix.md`](affiliate-networks-matrix.md). If not, the network is research-stage and is not ready for the harness.
2. Create a new fixture at `tests/integration/affiliate-harness/fixtures/<slug>.json`. Use one of the existing fixtures as a template. Fields:
   - `network` — display name shown in the summary table.
   - `matrix_section` — relative link to the matrix entry (for review traceability).
   - `redirect_hosts` — every host the network uses as a click endpoint. The harness asserts each one is in `AFFILIATE_REDIRECT_NETWORKS` and NOT in `GENERIC_SHORTENERS`.
   - `redirect_url_samples` — synthetic redirect URLs in the network's documented shape. Used by G1 to assert pass-through on real URL parsing.
   - `landing_samples` — for each sample, a `url` plus an `expected` object listing `preserve` params (the network's attribution params from the matrix) and `strip` params (utm/fbclid/gclid/etc. that should be removed universally). A `referrer` is required on each sample: G3 resolves the landing policy from it.
3. Run `npm run test:integration` locally. All three guards must pass.
4. Open the PR. The harness summary table will show the new network alongside the existing ones.

## The `pending_resolution` escape hatch

When a fixture documents a network that the codebase does NOT yet handle the way the matrix prescribes (a known design conflict, not a bug-to-fix-in-this-PR), set a top-level `pending_resolution` string on the fixture. The runner will skip G1 for that network and surface `PENDING` in the summary table instead of `PASS`/`FAIL`.

No fixture uses this flag today. Awin used to: its redirect (`awin1.com/cread.php?p=<encoded URL>`) embeds the merchant URL in the query string, and MUGA local-unwrapped it instead of passing it through. That was resolved, and every fixture now clears G1.

The escape hatch stays in the runner for the next network that needs it. It only ever skips G1. G2 and G3 are enforced against a `pending_resolution` fixture like any other, because the landing policy resolves via `REDIRECT_NETWORK_PATTERNS` whether or not the host is wired for pass-through.

## Reading the summary

The runner ends with a per-network verdict block:

```
  affiliate-harness summary:
  - Awin                          pass-through:PASS  strip:PASS  preserve:PASS
  - CJ Affiliate                  pass-through:PASS  strip:PASS  preserve:PASS
  - AliExpress (Portals direct)   pass-through:PASS  strip:PASS  preserve:PASS
```

A `FAIL` in `pass-through` means a fixture host disagrees with `AFFILIATE_REDIRECT_NETWORKS` — either the fixture needs updating or the source-of-truth list does.

A `FAIL` in `strip` means a param the fixture lists as tracking noise is NOT in `TRACKING_PARAMS` — the cleaner has lost coverage and the universal-strip needs to be widened.

A `FAIL` in `preserve` means an attribution param the matrix requires at landing does not survive: it is back in universal-strip, or `getLandingPolicy()` no longer returns it for that host and referrer. That is the failure mode that costs a creator their commission.

## Why the harness lives in `tests/integration/`

It depends on the live source-of-truth modules (`opaque-networks.js`, `affiliates.js`, `cleaner.js`) but exercises no network and no server. It is a contract-level check: too coarse for a unit test, cheap enough to run on every PR.

## Weekly scheduled run (future)

The issue calls for a weekly scheduled run against `rules.muga.app`. That is not wired up: the `TRACKING_PARAMS` source of truth the harness reads is bundled, not fetched. A scheduled run becomes meaningful once `rules.muga.app` starts shipping the per-network landing policy as a signed payload. Track in a follow-up issue.
