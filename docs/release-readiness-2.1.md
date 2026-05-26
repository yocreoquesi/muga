# 2.1 Release Readiness

**Date**: 2026-05-27
**Version**: 2.1.0
**Status**: Ready for submit pending manual smoke + store submissions
**Strategic context**: [ADR-0002](./adr/0002-denoise-pivot-creator-agnostic.md) — denoise pivot to creator-agnostic positioning

## Why this document

Establishes the evidence base for submitting 2.1 to Chrome Web Store ([#666](https://github.com/yocreoquesi/muga/issues/666)) and Firefox AMO ([#667](https://github.com/yocreoquesi/muga/issues/667)). Replaces the heavy-touch QA scoped in [#663](https://github.com/yocreoquesi/muga/issues/663): per the project's risk posture (low user base, dual-channel rollback path via the unlisted xpi / dev mode load), a comprehensive 10+ flow real-network QA is **disproportionate to the surface change** in 2.1. This document scopes a lighter regime that targets the actual risks introduced by the pivot.

## Automated test surface

All numbers from `main` at commit `dad34b0` (post-#697 merge) plus the two new e2e regression guards in PR #702.

| Layer | Count | Pass rate | Source |
|---|---|---|---|
| Unit tests | **3813** | 100% | `npm test` — `tests/unit/*.mjs` |
| Integration tests | **173** | 100% | `npm run test:integration` — `tests/integration/*.mjs` |
| E2E (Chromium, headed) | **90 passed / 12 skipped / 0 failed** | 100% of run | `npx playwright test` — `tests/e2e/*.spec.mjs` |
| Conformance — CAPS basic + contextual | 100% | 100% | `npm run conformance:contextual` |

The 12 skipped e2e are explicit `test.skip` calls, not failures. They are documented in `tests/e2e/privacy-proxy.spec.mjs` (PR-02-A/B, PR-03, PR-04, PR-05 — require live server interaction) and `tests/e2e/privacy-proxy.spec.mjs:278` (amzn.to placeholder, requires `__TEST__` sentinel). Their non-execution is by design and does not block 2.1 — every one of them tests `unwrap.muga.app` integration which is staged for decommissioning under [ADR-0004](./adr/0004-decommission-unwrap-server-native-shortener-resolution.md).

## 2.1 feature coverage matrix

Each pivot-2.1 feature mapped to its automated test surface. Audited 2026-05-27.

| Feature | Source of truth | E2E | Unit | Integration |
|---|---|---|---|---|
| `OPAQUE_NETWORKS` split into `GENERIC_SHORTENERS` + `AFFILIATE_REDIRECT_NETWORKS` | `src/lib/opaque-networks.js` ([#653](https://github.com/yocreoquesi/muga/issues/653)) | ✅ via `redirect-unwrap-merged.spec.mjs` | ✅ `opaque-networks.test.mjs` | — |
| Wrapper retirement (Awin, Impact, Rakuten, TradeTracker) — pass-through model | [ADR-0003](./adr/0003-awin-redirect-model-resolution.md), `src/lib/wrapper-engine.js` | ✅ awin1.com NOT unwrapped client-side | ✅ `redirect-network-patterns.test.mjs` | ✅ `affiliate-harness.test.mjs` |
| `getLandingPolicy(hostname, referrer)` — matrix-required param preservation at landing | `src/lib/cleaner.js` ([#656](https://github.com/yocreoquesi/muga/issues/656)) | indirect via cleaning flows | ✅ 23 dedicated tests in `get-landing-policy.test.mjs` | — |
| `honorCreatorMode` semantics | `src/lib/cleaner.js` | indirect | ✅ 15 tests in `honor-creator-mode.test.mjs` + `cleaner-honor-creator.test.mjs` | — |
| Content-script legacy unwrap retired for affiliate-redirect hosts ([#695](https://github.com/yocreoquesi/muga/pull/695)) | `src/content/cleaner.js` | ✅ shareasale unwrap + awin pass-through assertions | ✅ `content-unwrap-no-affiliate-redirect.test.mjs` | — |
| Per-device confirmation (#406) | `src/lib/storage.js` | ✅ 6 dedicated tests | — | — |
| Re-onboard delta + material rendering (#407) | `src/onboarding/onboarding.js` | ✅ 3 dedicated tests | — | — |
| URL Unwrapper rebrand (was "Privacy Proxy") — user-visible | i18n values + UI labels | ✅ **PR #702** — rebrand sanity guard | — | — |
| Onboarding `chrome.storage.sync` clarification (`ob_browser_sync_note`, #697) | `src/onboarding/onboarding.html` + `src/lib/i18n.js` | ✅ **PR #702** — rendering assertion | — | — |
| Defense-in-depth polish — CSP explicit + mergeIntoCache cap + renderList cap + popup replaceChildren ([#697](https://github.com/yocreoquesi/muga/pull/697)) | `src/manifest.json` + various | implicit (every e2e load uses the new CSP; all pass) | — | — |
| CSP: `connect-src` + `style-src` cascade fix from #697 | `src/manifest.json` | ✅ caught by URL tester + remote-rules e2e during PR merge | — | — |

**No 2.1 feature ships without at least one automated test on it.** The only path that touches no test is `RENDER_LIST_MAX_ITEMS` (silent truncation cap for malformed `chrome.storage.sync` state) — it is a defense against a malformed-storage state that is by definition outside the normal test surface.

## Honest limitations

The automated surface does not cover, by design:

1. **Real third-party network behaviour.** Playwright tests use fixtures and synthetic URLs. The actual response shape of `awin1.com`'s 30x in production, the actual `awc` cookie set by a merchant's MasterTag at landing, the actual `tag=` survival through Amazon's redirect chain — none of these are exercised against live infrastructure. **Mitigation**: the matrix v1.0 documents the contract for each network, and the synthetic harness ([#650](https://github.com/yocreoquesi/muga/pull/650)) asserts the cleaner respects that contract on fixtured payloads. Live verification requires a manual click on a real publisher link, observable in the manual smoke below.
2. **Cross-browser parity beyond Chromium.** The e2e suite runs only on Chromium. Firefox-specific behaviour (MV2 storage shape, MV2 DNR differences, AMO review-time linting) is not exercised. **Mitigation**: the manual smoke includes a Firefox-side install + popup check; AMO submission ([#667](https://github.com/yocreoquesi/muga/issues/667)) blocks on its own review.
3. **Visual regression.** No screenshot diffing. Layout breakage that the e2e selectors don't notice (e.g., a CSS rule that clips an overflow but doesn't change `display`) won't fail any test. **Mitigation**: the manual smoke includes a 5-minute visual pass on popup + options + onboarding at three viewport widths.
4. **`unwrap.muga.app` end-to-end.** The 12 skipped e2e tests stop at the proxy-client boundary; they don't probe the Cloudflare Worker. Live Worker health is observable through the build-hash endpoint (`https://unwrap.muga.app/healthz`) which the options page already exposes. **Mitigation**: this surface is being decommissioned (ADR-0004) — investing in better tests for it now is wasted effort.

## Manual smoke checklist

**Target time**: 30 minutes. Run on a clean profile in each of Chrome stable, Firefox stable. The checklist exists to catch what the automated surface can't.

### Install + onboarding (5 min per browser)

- [ ] Install the unsigned zip / xpi via developer mode (Chrome: chrome://extensions → Load unpacked / Firefox: about:debugging → Load Temporary Add-on)
- [ ] Onboarding tab opens automatically
- [ ] All three feature rows render with the new copy (denoise framing, no "creator-only" wording)
- [ ] The `.sync-note` paragraph is visible and reads "MUGA never sends data anywhere. If you have browser sync enabled..." — the exact text is asserted by the new e2e, but a visual confirmation here catches font/colour/contrast regressions the e2e can't see
- [ ] ToS link opens in a new tab, page resolves at `rules.muga.app/tos.html`
- [ ] Privacy link opens in a new tab, page resolves at `rules.muga.app/privacy.html`
- [ ] Accepting ToS enables the Start button; declining keeps it disabled
- [ ] Clicking Start closes the onboarding tab

### Popup smoke (3 min per browser)

- [ ] Visit any HTTPS site (e.g. `https://example.com?utm_source=manual&fbclid=test123`)
- [ ] Popup opens via toolbar icon; **toggle is checked**
- [ ] "Creator referral preserved" badge does NOT appear (clean URL — no affiliate present)
- [ ] URL in the address bar is rewritten to `https://example.com/` (params stripped)
- [ ] Stats counter in popup increments

### Options page smoke (5 min per browser)

- [ ] Options opens in a new tab
- [ ] No text on the page contains "Privacy Proxy" — only "URL Unwrapper" (the new e2e guards this, but visual confirms the rebrand applied to all locales the user is browsing in)
- [ ] Language selector lists 4 options (the e2e tests assert exactly 4)
- [ ] Switching language updates UI text immediately (no reload required)
- [ ] Adding a blacklist entry, then a whitelist entry, then removing both — all persist across an Options page reload
- [ ] Dev mode toggle reveals advanced section; URL tester pastes-and-tests cleanly

### Real-world wedge moment (10 min, Chrome only)

Pick ONE real publisher link from your own browsing history that uses an affiliate redirect (a tech-review article linking to Amazon, a YouTube description, a newsletter). Click it.

- [ ] The URL the browser lands on at the merchant retains the affiliate signal (Amazon: `?tag=`; Awin: arrives at the merchant via the network's 30x with `awc` set; CJ: hits the merchant via the network's redirect)
- [ ] The popup shows the **"Creator referral preserved"** badge for that tab
- [ ] No console errors in the extension's service worker (chrome://extensions → service worker → inspect)

This is the only step that exercises the live attribution contract. One real link from each tier of the matrix would be ideal but is not required — one link from any tier is enough to confirm the pipeline.

### Sign-off

Once every box above is checked, file the completion comment on [#663](https://github.com/yocreoquesi/muga/issues/663) and proceed to:

- Build 2.1.0-beta.1 ([#664](https://github.com/yocreoquesi/muga/issues/664))
- Submit to Chrome Web Store ([#666](https://github.com/yocreoquesi/muga/issues/666))
- Submit to Firefox AMO ([#667](https://github.com/yocreoquesi/muga/issues/667))

## Risk acceptance

The deliberate omissions in the automated surface are accepted under the project's current risk posture:

- **User base size**: small enough that a regression discoverable only via live click on a real affiliate flow is recoverable through a fast follow-up patch (2.1.1).
- **Distribution channel**: both stores allow unlisted updates within hours; AMO accepts xpi self-hosted as fallback.
- **Telemetry-free design**: regressions surface through user reports, not through silent metrics — which is consistent with the 2.1 framing and mitigates the lack of server-side observability.

If user base grows by an order of magnitude, this risk calculation changes and the surface should be re-evaluated against a heavier QA regime (the original scope of [#663](https://github.com/yocreoquesi/muga/issues/663)) before 3.x ships.
