# ADR-0004: Decommission `unwrap.muga.app`, migrate shortener resolution to native

**Date**: 2026-05-27
**Status**: Implemented (phase 5 shipped 2026-06-01; phase 6 complete — `unwrap.muga.app` now answers 522, and the in-repo cleanup it required landed 2026-08-19)
**Issue**: TBD (this ADR + three implementation issues to be filed under milestone v2.2.0)
**Supersedes**: nothing
**Builds on**: [ADR-0002](./0002-denoise-pivot-creator-agnostic.md) (denoise pivot — creator-agnostic)
**Engram refs**: decision id 752 (decommission decision)
**Closes / supersedes**: [#652](https://github.com/yocreoquesi/muga/issues/652) (aggregate metrics endpoint — moot), [#659](https://github.com/yocreoquesi/muga/issues/659) server-side ACs #1 and #4 (server enforcement + server config in repo — moot)

## Context

The 2.1 pivot ([ADR-0002](./0002-denoise-pivot-creator-agnostic.md)) repositioned MUGA from a creator-favouring URL cleaner into a **creator-agnostic denoise tool**. As part of that work the `OPAQUE_NETWORKS` array was split into two buckets ([#653](https://github.com/yocreoquesi/muga/issues/653)):

- `AFFILIATE_REDIRECT_NETWORKS` — pass-through under 2.1. Every affiliate-redirect host (AliExpress, Awin, CJ, Admitad, Partnerize, A8.net, Impact, Rakuten, TradeTracker, Tradedoubler, alitems, viglink) reaches its merchant via the network's own 30x. **No proxy hop. No client-side unwrap.** ADR-0003 closed the last vestige of the 2.0 era (Awin local-unwrap).
- `GENERIC_SHORTENERS` — eight branded URL shorteners with no affiliate attribution contract (`bit.ly`, `tinyurl.com`, `t.co`, `link.medium.com`, `lnkd.in`, `fb.me`, `ebay.to`, `amzn.to`). These cannot be resolved client-side without following an HTTP redirect — there is no published query-string convention for the destination.

Under 2.1 these eight hosts are the **only** remaining path that routes user URLs through `unwrap.muga.app`, MUGA's Cloudflare Worker. The Worker resolves the shortener server-side via `fetch(shortenerUrl, { redirect: "manual" })`, signs the response, and returns the resolved URL to the extension.

This works. It also contradicts the public framing MUGA ships under 2.1.

The PR #697 (defense-in-depth polish) introduced an onboarding paragraph reading:

> *"MUGA never sends data anywhere. If you have browser sync enabled, your preferences sync through the browser (Google for Chrome, Firefox Accounts for Firefox) — that's a browser feature, not MUGA."*

The clarification is technically accurate **for preferences**. It is silent on the proxy. A user with `privacyProxyEnabled = true` who navigates to `bit.ly/xyz` triggers an `extension → unwrap.muga.app` fetch carrying that URL. The server (operated by MUGA) observes it. MUGA's own infrastructure now sees URLs the user visits. Mediation (signing, no logs, restricted allowlist) limits the exposure but does not eliminate it. The pitch and the implementation diverge.

The remaining work for the proxy ([#652](https://github.com/yocreoquesi/muga/issues/652) aggregate metrics endpoint, [#659](https://github.com/yocreoquesi/muga/issues/659) server-side allowlist enforcement) deepens the divergence rather than reducing it: more server-side logic means more reasons to keep the Worker, less ability to honestly claim "URLs never leave your browser."

The allowlist of eight hosts is small, stable, and well-known. A native resolution path in the extension's service worker, gated on `optional_host_permissions` (the same pattern already used for `rules.muga.app` and `unwrap.muga.app` itself), is technically sufficient. The browser already executes the redirect when a user clicks the shortener; the only thing the extension needs is to perform the same HTTP fetch the browser would perform, observe the `Location` header, and rewrite the URL before navigation.

## Decision

**`unwrap.muga.app` is decommissioned. Shortener resolution moves to a native in-extension `fetch(url, { redirect: "manual" })` path. The decommission is staged across the v2.2.0 milestone to preserve a working fallback during rollout.**

Concrete plan:

1. **Native resolver module** — `src/lib/native-shortener-resolver.js` exposes `resolveShortener(url)` that performs `fetch(url, { redirect: "manual", credentials: "omit", cache: "no-store" })` and returns the destination from the `Location` header. Unit tests cover the eight allowlisted hosts plus failure modes (network error, missing `Location`, non-3xx response, redirect loops, oversize Location). **No wiring into the service worker in this PR.**
2. **Permission UX** — `optional_host_permissions` is extended with the eight shorteners (`https://bit.ly/*`, `https://tinyurl.com/*`, `https://t.co/*`, `https://link.medium.com/*`, `https://lnkd.in/*`, `https://fb.me/*`, `https://ebay.to/*`, `https://amzn.to/*`). The Options page grows a "Follow shortener redirects" section using the same `chrome.permissions.request` pattern as the existing URL Unwrapper section. Onboarding adds a single short paragraph reflecting the native model.
3. **Feature flag + dual path** — `prefs.useNativeShortenerResolution` (default `false` on landing). When true, `service-worker.js` routes shortener resolution through the native resolver; otherwise through the existing `proxy-client.js`. The flag is exposed in advanced settings (dev-mode gated) for the first wave of testing.
4. **Beta 2.2.0-beta.1** — Flag defaults to `true`. The proxy path remains as fallback when native fails (host permission denied, native fetch throws). Telemetry: a per-shortener pass/fail counter held in `chrome.storage.local`, never transmitted, visible to the user in advanced settings.
5. **Deprecate proxy code** — After N days in beta without regression (N defined in the beta-feedback issue, default 14): remove `src/lib/proxy-client.js`, remove all `unwrap.muga.app` callsites from `src/background/service-worker.js`, remove `https://unwrap.muga.app/*` from `optional_host_permissions`, remove the URL Unwrapper section from options + onboarding, update privacy policy + ToS at `rules.muga.app`.
6. **Server shutdown** — The Cloudflare Worker is taken offline. DNS for `unwrap.muga.app` either resolves to a 404 explanation page or is left to fall through to the registrar's default. The repo `muga-unwrap` is archived. No proxy means no further surface in [#652](https://github.com/yocreoquesi/muga/issues/652) (closed as superseded).

The phases ship as separate PRs in this order. Phase 5 (proxy removal) is **gated** on:

- Phase 4's per-shortener counters showing native success rate ≥ 99% for each of the eight hosts on the beta channel, **and**
- No open critical-severity issue tagged `native-resolver` for 7 consecutive days.

If either gate fails, phase 5 is held and phase 3's flag default flips back to `false` while the cause is investigated.

> **Phase 5 beta gate WAIVED — 2026-06-01**: The 7-day ≥99% native-success beta gate was consciously waived by the operator on 2026-06-01. Rationale: solo-operator project with no active user base on the beta channel at the time of the waiver; native resolution shipped as the unconditional default in phase 4 / PR #801 / 2.2.0-beta.1 immediately prior; no open `native-resolver` critical issues. Phase 6 (Cloudflare Worker shutdown, DNS record removal, `muga-unwrap` repo archive) remains an external operation outside this codebase.

## Alternatives considered

**Option B — keep `unwrap.muga.app`, update the pitch.** Acknowledge in the onboarding and privacy policy that shorteners resolve through MUGA's server. Add the aggregate-metrics endpoint ([#652](https://github.com/yocreoquesi/muga/issues/652)) and the server-side enforcement ([#659](https://github.com/yocreoquesi/muga/issues/659)). Position the server as a privacy-preserving intermediary rather than a contradiction.

Rejected because the pitch isn't the problem — the contradiction is. The 2.1 pivot's value proposition is that MUGA is a **local** denoise tool: rules ship with the extension, the cleaner runs in the browser, no telemetry, no analytics. A server that sees URLs is the one component that doesn't fit that story. Reframing the pitch to accommodate the server reduces the philosophical clarity of the product; reframing the server to fit the pitch (this ADR) keeps it.

The aggregate-metrics endpoint ([#652](https://github.com/yocreoquesi/muga/issues/652)) is illustrative. The endpoint exists because operators of `unwrap.muga.app` want visibility into what the Worker is doing. That want is real — but it's a want generated by the existence of the Worker. Remove the Worker, remove the want.

**Option C — partial decommission: keep the server only for `amzn.to`, native for the other seven.** `amzn.to`'s G3 regression test (`tests/unit/amzn-to-tag-preservation.test.mjs`) gates whether the resolved URL preserves `?tag=` correctly. Argue that the post-resolution attribution check is server-side concern.

Rejected because the G3 test exercises `processUrl` on the **resolved** URL — the same input the native resolver would produce. There is no resolution-specific logic that lives on the server and not in the extension. The split would keep the server alive for one host out of eight, paying full infrastructure and pitch-divergence cost for marginal benefit. Either the server has a reason to exist for all eight or it has no reason to exist.

**Option D — keep the server but route through it only when native fails.** Native first, proxy as fallback on permission denial or fetch error. Same end state as today, but with a smaller proxy footprint.

Rejected because "fallback always exists" creates a permanent dependency on the Worker. The decommission goal is to **remove** the Worker entirely — leaving it as a fallback means it must remain operational, monitored, and updated indefinitely. The transition cost (phase 5's beta gate) is real but bounded; the perpetual fallback cost is unbounded. If native resolution succeeds at the rate the beta gate requires (≥99%), the 1% failure case is acceptable to surface to the user ("could not resolve, navigate to shortener anyway?") rather than silently forwarded to MUGA's infrastructure.

## Consequences

**Positive:**

- The onboarding paragraph "MUGA never sends data anywhere" stops being technically misleading.
- The pitch and the implementation align: 2.1 was "creator-agnostic, local-first cleaner"; 2.2 finishes the local-first half.
- `muga-unwrap` repo is archived, eliminating cross-repo coordination cost for any future shortener work.
- Issues [#652](https://github.com/yocreoquesi/muga/issues/652) and the server-side ACs of [#659](https://github.com/yocreoquesi/muga/issues/659) close as superseded — concrete board cleanup.
- Cloudflare Worker infrastructure cost goes to zero. Compliance surface shrinks (one fewer attack surface, one fewer service to threat-model).
- The privacy policy gets simpler: no third-party servers, no signed proxy responses, no allowlist enforcement to document.

**Negative:**

- Users must grant `optional_host_permissions` for the eight shorteners to enable resolution. The opt-in friction is real — some users will skip the prompt and lose shortener resolution. Mitigation: clear UX in onboarding + options, defaulting to "we don't follow shorteners unless you ask us to" framing.
- Native resolution makes one HTTP request per shortener click; the Worker centralised this (could in principle cache popular shorteners). In practice the shortener's own CDN caches the redirect, so the difference is negligible.
- No centralised observability. If a shortener changes its 30x behaviour (e.g. moves from `Location` header to a JS-based redirect), MUGA learns about it from user reports rather than server-side monitoring. Mitigation: the per-shortener pass/fail counter (phase 4) gives the user local visibility, and the eight hosts are stable enough that breaking changes are detectable in beta channels.
- Store reviewers may scrutinise the `optional_host_permissions` list. Each host is justifiable individually (popular shortener with no public query-string-based unwrap), and the list is small enough to enumerate in the store listing.

**Neutral:**

- The proxy-client.js code (about 280 lines) and the muga-unwrap repo (separate codebase) come out of the maintained surface. Net code change in this repo is approximately neutral — native resolver adds what proxy-client removes.
- The `privacyProxyEnabled` pref is renamed and re-scoped (proposed name: `followShortenersEnabled`). Migration: if `privacyProxyEnabled` was `true` in chrome.storage.sync, set `followShortenersEnabled = true` once on first 2.2 startup and clear the old key.

## Verification

The decommission is verified across four checkpoints:

1. **Phase 1 (native resolver)** — `npm test` includes the new resolver unit tests; all pass on the same Node version CI uses.
2. **Phase 4 (beta)** — at the end of the beta window, the per-shortener pass/fail counters show ≥99% native success rate for each of the eight hosts, **and** zero open critical-severity issues tagged `native-resolver` for the trailing 7 days. The numbers and the issue audit are recorded in the v2.2.0 release-readiness issue.
3. **Phase 5 (proxy removal)** — grep-based assertion in CI: `git grep -F unwrap.muga.app src/` returns no matches except in changelog / ADR text. `grep -F PrivacyProxy src/` returns no matches except in deprecation comments scheduled for removal in 2.3. **COMPLETED 2026-06-01** — `git grep -F unwrap.muga.app src/` returns zero matches. `proxy-client.js`, `proxy-navigate.js`, `fetchUnwrap`, `UNWRAP_VIA_PROXY`, `refreshBuildHashIfStale`, and `privacyProxyEnabled` (except a migration comment in `storage.js`) are removed from `src/`. The pref rename `privacyProxyEnabled` → `followShortenersEnabled` ships with one-time migration on startup. `useNativeShortenerResolution` is removed as vestigial. Beta gate waived (see note above).
4. **Phase 6 (server shutdown)** — `curl https://unwrap.muga.app/unwrap` returns 404 or DNS NXDOMAIN. Recorded in the shutdown PR's description as an external-state observation.

The ADR moves from Accepted to Implemented when all four checkpoints are recorded. A follow-up ADR-0005 may be filed if any phase surfaces a decision the present ADR did not anticipate (for example, a shortener that requires per-host special handling in the native resolver).
