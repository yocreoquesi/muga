# ADR-0003: Awin redirect model — retire local-unwrap, adopt pass-through

**Date**: 2026-05-26
**Status**: Accepted
**Issue**: [#681](https://github.com/yocreoquesi/muga/issues/681) (this ADR)
**Supersedes**: nothing
**Builds on**: [ADR-0002](./0002-denoise-pivot-creator-agnostic.md), [docs/affiliate-networks-matrix.md#awin](../affiliate-networks-matrix.md#awin) (v1.0)
**Engram refs**: decision id 736 (branch-cleanup workflow), pivot 2.1 milestone v2.1.0

## Context

ADR-0002 established the 2.1 creator-agnostic pivot. As part of that pivot, the `OPAQUE_NETWORKS` array in `src/lib/opaque-networks.js` was split into `GENERIC_SHORTENERS` and `AFFILIATE_REDIRECT_NETWORKS` (P2.1 / [#653](https://github.com/yocreoquesi/muga/issues/653)). The new affiliate-redirect list contains AliExpress, CJ (8 domains), Admitad, prf.hn, px.a8.net — all **pass-through** under 2.1.

Awin (`awin1.com`) was **not** moved into `AFFILIATE_REDIRECT_NETWORKS`. It still lives in `src/lib/wrapper-engine.js` as a **local-unwrap** wrapper inherited from the 2.0 era: MUGA reads the `p=` (or `ued=`) query param on `awin1.com/cread.php`, extracts the merchant URL, and short-circuits the redirect entirely. The user never hits `awin1.com`. Tests in `tests/unit/wrapper-engine.test.mjs` ("Wrapper Engine — Awin") assert this behaviour.

The synthetic harness shipped in PR #680 ([#650](https://github.com/yocreoquesi/muga/issues/650) MVP) wired Awin into the fixture set expecting it in `AFFILIATE_REDIRECT_NETWORKS`. The G1 guard (redirect-host pass-through, HARD) failed on first run because `awin1.com` is not in that list. The harness was shipped with a `pending_resolution` field on the Awin fixture that downgrades G1 from FAIL to PENDING until this conflict is resolved.

The conflict between code and matrix is real and load-bearing:

- **Matrix v1.0** ([Awin section](../affiliate-networks-matrix.md#awin)) documents that `awc` is appended by Awin's server at the 30x step, then read by the merchant's MasterTag at landing to populate a first-party cookie. `wt_mc` (Webtrekk/Awin campaign tracking used by MediaMarkt and others) has the same requirement. Both are flagged `required-at-landing`.
- **Local-unwrap**, by definition, skips the 30x. The user lands directly on the merchant URL extracted from `p=`. `awc` and `wt_mc` are appended by Awin's server during the 30x — neither is present in the publisher's `p=` value in the typical case. **Local-unwrap therefore drops the attribution signal in the typical case.**

Under the 2.0 framing (privacy-first, redirect-hostile) this was a feature: shortcutting Awin's server was consistent with the "no clicks routed through external attribution servers" pitch. Under the 2.1 framing (creator-agnostic, redirect-tolerant) it is the **last remaining vestige of the 2.0 stance**, hiding inside `wrapper-engine.js` and silently breaking attribution for any creator on the Awin network.

This ADR resolves the deferred question.

## Decision

**Awin moves from `WRAPPERS` (local-unwrap) to `AFFILIATE_REDIRECT_NETWORKS` (pass-through). The Awin entry in `src/lib/wrapper-engine.js` is retired. The matrix v1.0 referrer-based preservation policy (preserve `awc` + `wt_mc` when `document.referrer.hostname` matches `awin1.com`) becomes the production model.**

Concrete steps:

1. Add `awin1.com` (and `www.awin1.com`) to `AFFILIATE_REDIRECT_NETWORKS` in `src/lib/opaque-networks.js`. Document `awinmid.com` and `aweur.com` as out-of-scope variants until observed in the wild (per the matrix surface note).
2. Remove the `awin` entry from the `WRAPPERS` map in `src/lib/wrapper-engine.js`. Remove the associated `PATH_PREFIX_EXTENSIONS.awin` entry (`/awclick.php`).
3. Remove the "Wrapper Engine — Awin" test suites from `tests/unit/wrapper-engine.test.mjs`.
4. Drop the `pending_resolution` field from `tests/integration/affiliate-harness/fixtures/awin.json`. G1 starts enforcing pass-through on Awin from that point forward.
5. Ensure `awc` and `wt_mc` are preserved at the merchant landing via the per-landing policy mechanism (`getLandingPolicy(hostname, referrer)`, P3.1 / [#656](https://github.com/yocreoquesi/muga/issues/656)) and removed from `TRACKING_PARAMS` ([#655](https://github.com/yocreoquesi/muga/issues/655)).

**Implementation is blocked on [#656](https://github.com/yocreoquesi/muga/issues/656) shipping first.** Steps 1–4 cannot land without step 5's substrate, because retiring the wrapper before `getLandingPolicy` exists would leave Awin attribution unprotected: the universal `TRACKING_PARAMS` strip would silently delete `awc` / `wt_mc` from every Awin landing during the gap window.

This ADR captures the decision so [#655](https://github.com/yocreoquesi/muga/issues/655) and [#656](https://github.com/yocreoquesi/muga/issues/656) have a load-bearing reference for the Awin policy direction. The code change itself is tracked in a separate follow-up issue blocked on #656.

## Alternatives considered

**Option B — keep the local-unwrap, document it as a creator-friendly exception.** Frame Awin as "Awin's redirect carries the merchant URL in `p=`, so MUGA can short-circuit the 30x without losing the merchant's identity." Update the matrix v1.0 Awin entry to declare local-unwrap as the policy. No code change.

Rejected because the framing collapses on technical inspection. The matrix documents that `awc` is appended at the 30x by Awin's server — **not** placed in `p=` by the publisher. The typical publisher's `p=` URL does not contain `awc` or `wt_mc`. Local-unwrap therefore loses the attribution signal in the typical case, regardless of how MUGA frames it publicly. Accepting this trade-off contradicts the 2.1 north ("fair to any creator, regardless of attribution model") for an implementation convenience.

The framing also leaks technical detail into the public matrix that doesn't generalise: every other affiliate redirect network in the matrix follows the same `redirect → 30x → attribution param at landing` pattern. Carving an exception for Awin because of how its publisher links happen to be shaped is a temporary alignment, not a stable policy.

**Option C — hybrid: local-unwrap only when the publisher's `p=` URL already contains `awc` (or `wt_mc`); otherwise pass-through.** Inspect `p=` before deciding. Preserve attribution when the publisher pre-attaches it, fall back to pass-through otherwise.

Rejected as over-engineering. Pre-attached `awc` in publisher links is a minority case (Awin's documented flow appends `awc` at the 30x, not at link creation). The branch covers an edge case while doubling the surface area of the wrapper-engine logic and the test matrix. Any future Awin parameter additions (e.g., S2S tokens, MasterTag custom params) require touching this logic again. Cost-to-benefit ratio is poor.

## Consequences

**Positive:**

- `wrapper-engine.js` becomes a smaller, sharper module — only handles networks that genuinely carry the merchant URL in the redirect (Facebook `l.facebook.com`, Instagram `l.instagram.com`, both link-share, not affiliate). Affiliate redirects are uniformly handled by `AFFILIATE_REDIRECT_NETWORKS` pass-through + `getLandingPolicy` preservation.
- The matrix v1.0 → code mapping becomes 1:1 for Awin. Future audits of "what does MUGA do with network X" answer cleanly: "look at `AFFILIATE_REDIRECT_NETWORKS` and the matrix entry."
- The synthetic harness G1 starts enforcing the pass-through invariant for Awin, catching any future regressions that would re-introduce local-unwrap.
- Closes the last 2.0-era code path that contradicted the 2.1 pivot. The product is internally coherent.

**Negative:**

- Implementation is blocked on [#656](https://github.com/yocreoquesi/muga/issues/656). The decision is recorded now, but the wrapper retirement waits.
- During the gap window (between this ADR landing and #656 + the retirement PR), Awin continues to local-unwrap in production. Attribution continues to drop in the typical case until the full chain ships. This is unchanged from current state — it does not make things worse, but it is not fixed by this ADR alone.
- Backwards compatibility: any users with bookmarks or shared URLs that point to `awin1.com/cread.php?...` will start hitting Awin's 30x once the retirement PR ships. This is the correct behaviour (the publisher who shared the link earned the click). No data migration needed.

**Neutral:**

- The non-Awin wrappers in `wrapper-engine.js` remain unchanged. Facebook `l.facebook.com`, Instagram `l.instagram.com`, `bing.com/ck/a` — none of these are affiliate networks; their local-unwrap is correct under any pivot.
- Skimlinks (`go.redirectingat.com`, `redirectingat.com`) is **flagged for review** under the same lens. Skimlinks is an affiliate network with the URL-in-query-string shape, structurally similar to Awin. A separate ADR or matrix audit is warranted, but is out of scope here. Filed for follow-up.

## Verification

Once the retirement PR lands (blocked on #656):

- `npm test` — full unit and integration suite passes.
- `tests/integration/affiliate-harness.test.mjs` — Awin fixture no longer reports `pass-through:PENDING`. G1 enforces and passes.
- Manual: visit a real Awin publisher link (e.g., a Skyscanner or Booking Awin link) in a dev build. Confirm the browser follows the 30x through `awin1.com`. Confirm the merchant landing URL contains `awc` (and `wt_mc` for advertisers that use it). Confirm the cleaner does **not** strip those params on the first document.

The synthetic harness will catch the structural regression; the manual step catches end-to-end correctness with a live Awin advertiser.
