# Changelog

All notable changes to MUGA will be documented in this file.

## [Unreleased]

### Added

- **3 new opaque redirector hosts** in `src/lib/opaque-networks.js` (#607 batch 3): `lnkd.in` (LinkedIn share tracker), `fb.me` (Facebook universal shortener), `ebay.to` (eBay branded shortener). All three verified STANDARD redirect shape (server-side 30x with `Location` header) via curl probe on 2026-05-09. Same pattern as v1.15.0's bit.ly / tinyurl.com / prf.hn / px.a8.net / amzn.to additions.
- **Worker allowlist entries** for the same three hosts in [muga-unwrap](https://github.com/yocreoquesi/muga-unwrap) (`src/lib/allowlist.ts`) shipped first per AD-05 cross-repo merge order, with matching tests in `muga-unwrap/tests/allowlist.test.ts`.
- **Extension unit tests** in `tests/unit/opaque-networks.test.mjs`: per-host inclusion assertions plus a corrective negative assertion that `aliexpress.us` is NOT in the list (probe verdict 2026-05-09: apex `.us` TLD redirect, not a shortener).
- **End-to-end integration test** `tests/integration/proxy-client-contract.test.mjs` (#608) — calls the live production Worker at `unwrap.muga.app` with an extension-shaped request and verifies the signed envelope round-trip. Wired into CI as `npm run test:integration`. Catches contract drift of the kind that caused the v1.14.0 → v1.15.1 silent failure (path drift, param-shape drift, public-key drift).
- **Bookshop.org affiliate support** (#603, caps-spec#46 deferred). Bookshop's affiliate attribution lives in the path and sets a session cookie at entry — there is no `?aff=` query param ever. Two entry shapes are covered: `/a/{id}/...` (creator referral, requires trailing slash) and `/shop/{slug}` (storefront, terminal). The cleaner detects either entry on `bookshop.org` (and `www.` variant), preserves it intact, and surfaces a top-level `creatorReferralPreserved: boolean` on `processUrl`. The service worker ORs that flag with the existing `preservedAffiliate` check so the standard "Creator referral preserved" toolbar wedge cue fires for both entry shapes. Additionally, when `injectOwnAffiliate` is on, MUGA injects its own `?affiliate=124046` on unattributed `/p/books/...` product URLs — never on `/shop/{slug}` or `/a/{id}/` (those are someone else's attribution) and never when a foreign `?affiliate=` is already present. Out-of-band escape hatch authorised by caps-spec#46 itself; the implementation is deliberately narrow (single-host, two well-known patterns) so caps-spec stays uninflated until a second path-based program lands and the RFC reopen criteria fire.

## [1.15.1] - 2026-05-09

Hotfix release. Headline: Privacy Proxy now actually works end-to-end. Three contract bugs were preventing the toggle from doing anything in v1.14.0 and v1.15.0 — the extension was calling the Worker on the wrong path (`/v1/unwrap` vs `/unwrap`) and with the wrong query param shape (`?url=raw` vs `?u=base64url`). Both were silent because the cleaner's failure mode is to fall back to the original navigation. The Worker contract is unchanged; this fix aligns the extension to it. Users who had Privacy Proxy enabled but never saw any difference will start getting actual server-side resolution after upgrading.

### Fixed

- **`src/lib/proxy-client.js` PROXY_URL path corrected** from `https://unwrap.muga.app/v1/unwrap` to `https://unwrap.muga.app/unwrap`. The `/v1/unwrap` path was never deployed on the Worker; every Privacy Proxy request returned `404 Not Found` and silently fell back to the wrapper navigation. Discovered via direct curl probe of the production Worker.
- **`src/lib/proxy-client.js` query param contract corrected** from `?url=<raw>` to `?u=<base64url-encoded>`. The Worker handler reads the `u` param and base64url-decodes it (`muga-unwrap/src/handlers/unwrap.ts:110-111`); the extension was sending the raw URL under the wrong key, which would have returned `400 missing_u_parameter` even if the path had been correct.

### Added

- **`base64UrlEncode(str)` helper** exported from `src/lib/proxy-client.js`. Symmetric to the Worker's `decodeBase64Url` decoder. Uses `TextEncoder` for Unicode safety (theoretical IRIs in URLs).
- **Endpoint-contract regression tests** in `tests/unit/proxy-client.test.mjs`. Three new assertions: PROXY_URL points to `/unwrap`, fetch is called with `?u=` (NOT `?url=`), and the encoded value round-trips through `atob` to the original input. The pre-existing fetch-stubbing tests asserted on response shape but not on request shape — that gap is now closed.

### Operational notes

- The Worker side (muga-unwrap) is unchanged. The canonical Worker contract `?u=<base64url>` was always correct; the bug was purely client-side.
- Smoke probe in `muga-unwrap/.github/workflows/deploy.yml` (added in v0.2.x post-mortem hardening) was already exercising the correct path and param shape — that's why deploy CI never caught the extension-side bug. Future-proofing: a separate smoke probe on the *extension* side that verifies the actual request shape would have caught this; out of scope for this hotfix.

## [1.15.0] - 2026-05-09

Redirector coverage release. Headline: Privacy Proxy now covers seven more redirector hosts — the generic shorteners `bit.ly`, `tinyurl.com`, `t.co`, and `link.medium.com`; the Partnerize affiliate redirector `prf.hn`; A8.net Japan's `px.a8.net`; and Amazon's branded shortener `amzn.to`. The toggle disclosure copy is reworded so the broader scope is honest — what was "opaque affiliate links" is now "opaque redirector links (affiliate networks and generic shorteners)." A foundational refactor eliminates the duplicate opaque-host list that previously lived in two files; adding a host now requires a one-line edit in `src/lib/opaque-networks.js`. The Worker side (cross-repo) landed first in [muga-unwrap#29](https://github.com/yocreoquesi/muga-unwrap/pull/29).

### Added

- **7 new / activated opaque redirector hosts** in `src/lib/opaque-networks.js`:
  - `bit.ly` — generic URL shortener (PR-02).
  - `tinyurl.com` — generic URL shortener (PR-03).
  - `prf.hn` — Partnerize / Performance Horizon affiliate; resolved via Worker HEAD chain, no client-side path-segment extractor (PR-04).
  - `px.a8.net` — A8.net Japan affiliate; hostname confirmed via T00 STANDARD curl probe (`r.a8.net` does not resolve) (PR-05).
  - `amzn.to` — Amazon branded shortener; ships conditional on G3 regression gate (PR-06); `tag=` preservation verified.
  - `t.co` — Twitter/X URL shortener; extension-only activation — Worker already accepts `t.co` via caps-spec `buildSpecAllowlist` (PR-07).
  - `link.medium.com` — Medium URL shortener; extension-only activation, same pattern as `t.co` (PR-08).
- **`isOpaqueNetworkHost(hostname)` helper** exported from `src/lib/opaque-networks.js`. Centralises the `www.` normalization that previously lived inline inside the content-script IIFE. The helper is re-exported through the content bundle (`src/content/cleaner-bundle-src.mjs`) so that `cleaner.js` can delegate to `window.__mugaCleaner.isOpaqueNetworkHost` without a private replica.
- **`amzn.to` tag= preservation regression test** (`tests/unit/amzn-to-tag-preservation.test.mjs`). Four cases: `.com` with Honor Creator mode, `.es` with Honor Creator mode, control case (stripAllAffiliates strips tag), and noise-param stripping alongside tag survival. D7 shipping gate per design AD-03.
- **New helpers unit test** (`tests/unit/opaque-networks-helpers.test.mjs`). Covers `isOpaqueNetworkHost` contract: bare host match, www-stripped match, false for non-opaque host, false for empty/null/undefined. Replaces the obsolete sync test.

### Changed

- **Privacy Proxy disclosure copy** (`privacy_proxy_disclosure` i18n key) updated in EN + ES. "Unresolvable affiliate links" reworded to "unresolvable opaque redirector links (affiliate networks and generic shorteners such as bit.ly)" to accurately reflect the broader scope after adding generic shorteners. PT and DE remain `FIXME: translate` stubs per project convention.
- **Single source of truth for opaque host detection.** The inline `_OPAQUE_NETWORK_HOSTS` array and `_isOpaqueNetworkHost` function previously duplicated in `src/content/cleaner.js` are removed. Adding a new opaque host now requires editing exactly one file (`src/lib/opaque-networks.js`). Drift is structurally impossible.

### Removed

- **`tests/unit/opaque-networks-content-sync.test.mjs` deleted.** The drift it guarded against is now structurally impossible after the single-source refactor. Coverage transferred to `cleaner-bundle-sync.test.mjs` (existing) and the new `opaque-networks-helpers.test.mjs`.

### Cross-repo

- **CJ Affiliate 4-vs-8 Worker gap closed** in [muga-unwrap#29](https://github.com/yocreoquesi/muga-unwrap/pull/29): `dpbolvw.net`, `emjcd.com`, `qksrv.net`, `cj.dotomi.com` added to the Worker allowlist (these were already in the extension; the Worker only had 4 of the 8 CJ domains). Also adds `bit.ly`, `tinyurl.com`, `prf.hn`, `px.a8.net`, and `amzn.to` to the Worker. Merged and deployed to Cloudflare Workers production before this extension release per AD-05 cross-repo merge order.

## [1.14.0] - 2026-05-08

Privacy Proxy release. Headline: MUGA can now resolve opaque affiliate wrappers — links where the destination URL is hidden inside a redirector your browser would normally have to load — through `unwrap.muga.app`, an open-source Cloudflare Worker that follows the redirect chain server-side and returns the resolved destination signed with Ed25519. The opaque host never loads on your machine. Fully opt-in via a new "Privacy Proxy" toggle in Settings, off by default; the existing Strict Local and Honor Creator modes are unchanged. Closes [#453](https://github.com/yocreoquesi/muga/issues/453).

### Added

- **Privacy Proxy mode for opaque affiliate networks** ([#453](https://github.com/yocreoquesi/muga/issues/453)). When enabled and a click hits an opaque wrapper (AliExpress `s.click.aliexpress.com`, CJ Affiliate's eight redirector domains, Admitad `ad.admitad.com`), MUGA's content script intercepts the navigation, posts the URL to the `unwrap.muga.app` Worker, verifies the Ed25519 signature on the response locally against a hardcoded public key, and navigates the tab directly to the resolved destination. The opaque host never loads. On signature failure, network failure, or any error path, the original click proceeds unmodified — Privacy Proxy is a privacy enhancement, never a navigation gate. Files: [`src/lib/proxy-client.js`](src/lib/proxy-client.js), [`src/lib/proxy-navigate.js`](src/lib/proxy-navigate.js), [`src/lib/opaque-networks.js`](src/lib/opaque-networks.js), [`src/content/cleaner.js`](src/content/cleaner.js), [`src/background/service-worker.js`](src/background/service-worker.js).
- **Three-mode matrix UI in Settings.** A new "Privacy Proxy" section in the options page exposes two toggles (`Honor Creator`, `Privacy Proxy`) that combine into three modes: **Strict Local** (both off — default; behavior unchanged from v1.13.x), **Honor Creator** (creator referral preserved on direct affiliate links; behavior unchanged from v1.13.x), and **Honor + Proxy** (Honor Creator behavior plus opaque-wrapper resolution via the Worker). The active mode is shown above the toggles in plain English so users can confirm what they're enabling. The pure `deriveModeLabel` helper ([`src/lib/mode-label.js`](src/lib/mode-label.js)) is unit-tested independently of the UI. Files: [`src/options/options.html`](src/options/options.html), [`src/options/options.js`](src/options/options.js).
- **Worker build hash disclosure with 24h auto-refresh.** The options page surfaces the `unwrap.muga.app` Worker's deployed commit SHA so users can verify the running code matches the audited source. The hash is fetched once per browser-session and refreshed every 24 hours via `chrome.alarms`; manual refresh is available from the section. Files: [`src/lib/relative-time.js`](src/lib/relative-time.js), [`src/options/options.js`](src/options/options.js).
- **Self-heal on permission revocation.** If the user revokes the `unwrap.muga.app` host permission outside the extension (browser settings page), the service worker detects the missing permission on the next proxy request, automatically disables `privacyProxyEnabled` in storage, and surfaces a `proxy_auto_disabled` toast with a one-click CTA to re-enable. Avoids the silent-failure mode where Privacy Proxy is on in storage but every request 403s. Files: [`src/background/service-worker.js`](src/background/service-worker.js).
- **Sixteen new i18n keys** for the Privacy Proxy section (English + Spanish locked, Portuguese and German added as `FIXME` stubs for community translation). Files: [`src/lib/i18n.js`](src/lib/i18n.js).
- **`PROXY_TRUSTED_PUBLIC_KEYS` registry.** The Ed25519 public key used to verify Worker responses lives alongside the existing remote-rules key registry, so key rotation follows the same audited path. Files: [`src/lib/remote-rules-keys.js`](src/lib/remote-rules-keys.js).

### Changed

- **`browser_specific_settings.gecko.strict_min_version` raised from `128.0` to `129.0`** in the Firefox manifest. Required because `crypto.subtle.verify({ name: "Ed25519" }, ...)` — the primitive that verifies Worker response signatures locally — only ships in Firefox 129+. Users on Firefox 128 will not receive this update through AMO; AMO weekly active stats will quantify the breakage post-release. The alternative (feature-gating Privacy Proxy on FF 128 while still shipping the rest of v1.14) was rejected during the SDD design phase: Privacy Proxy is the headline of this release and a partial install would surface a permanently-disabled toggle on FF 128 with no clear remediation. Files: [`src/manifest.v2.json`](src/manifest.v2.json).
- **Optional `unwrap.muga.app` host permission added** to both manifests. Granted only when the user enables Privacy Proxy in Settings; never requested at install time. Mirrors the pattern used by the existing optional `rules.muga.app` permission for Remote rule updates. Files: [`src/manifest.json`](src/manifest.json), [`src/manifest.v2.json`](src/manifest.v2.json).
- **`privacyProxyEnabled` pref added to the export/import bool key set.** Settings export/import preserves the toggle state across reinstalls. Files: [`src/lib/storage.js`](src/lib/storage.js), [`src/options/options.js`](src/options/options.js).

### Tests

- **Six new unit specs and one e2e spec, net +106 tests vs v1.13.7.** Coverage hits the canonical-JSON signature-verification path ([`tests/unit/proxy-client.test.mjs`](tests/unit/proxy-client.test.mjs)), the content-script proxy-navigation flow ([`tests/unit/proxy-navigate.test.mjs`](tests/unit/proxy-navigate.test.mjs)), the opaque-networks predicate including the IIFE-replica sync test that asserts the content-script copy can never drift from the source-of-truth list ([`tests/unit/opaque-networks.test.mjs`](tests/unit/opaque-networks.test.mjs), [`tests/unit/opaque-networks-content-sync.test.mjs`](tests/unit/opaque-networks-content-sync.test.mjs)), the mode-label derivation ([`tests/unit/derive-mode-label.test.mjs`](tests/unit/derive-mode-label.test.mjs)), the relative-time helper used by the Worker-build-hash UI ([`tests/unit/relative-time.test.mjs`](tests/unit/relative-time.test.mjs)), and the service-worker handlers for `UNWRAP_VIA_PROXY` and `REFRESH_BUILD_HASH_NOW` including the permission pre-flight and self-heal paths ([`tests/unit/service-worker-privacy-proxy.test.mjs`](tests/unit/service-worker-privacy-proxy.test.mjs)). The e2e spec ([`tests/e2e/privacy-proxy.spec.mjs`](tests/e2e/privacy-proxy.spec.mjs)) covers four end-to-end paths in a real Firefox+Chrome environment; five SW-fetch interception scenarios are documented `test.skip` pending a `__TEST__` sentinel pattern that lets Playwright stub the SW fetch (followup).

### Operational notes

- **Worker abuse mitigations on `unwrap.muga.app` (wave 1)** shipped pre-release in `muga-unwrap` v0.2.1 (commit `eca0d60`): origin allowlist for `chrome-extension://*` and `moz-extension://*`, code-level per-IP rate limit, plus Cloudflare dashboard configuration (per-IP rate limit rule on URI path `/unwrap` and Bot Fight Mode toggled on for the zone). Wave 2 (required `X-MUGA-Client` header gate) lands after this release reaches 100% rollout on AMO + CWS, tracked in [#602](https://github.com/yocreoquesi/muga/issues/602).

## [1.13.7] - 2026-05-07

Toolbar icon recovery release. Headline: the toolbar action icon now renders consistently in both Firefox and Chrome — the gray placeholder some users were seeing on `about:addons` and across tabs is fixed. The "creator referral preserved" green-check icon variant, which had been retired earlier the same day on a misdiagnosis, is also restored.

### Added

- **`OBJECTIVES.md`** — public North Star metric (Firefox AMO weekly active users), 6-month targets, explicit non-goals, and the four decision principles used to triage every new proposal. Closes [#338](https://github.com/yocreoquesi/muga/issues/338). Linked from the README header.
- **`docs/ops/` finalised** — the three runbooks (`health-signals.md`, `rollback-playbook.md`, `staged-release.md`) plus the `README.md` index are now wired up end to end. Closes [#397](https://github.com/yocreoquesi/muga/issues/397). Two broken `rollback.md` references in `health-signals.md` were fixed (the actual filename is `rollback-playbook.md`); a third integrity check was added to `tests/unit/ops-docs-sync.test.mjs` that asserts every relative `.md` link inside `docs/ops/` points to a file that exists, so a future typo cannot ship silently. The `staged-release.md` decision log was reset to start at v1.13.5 / v1.13.6 with real entries instead of TBD placeholders. README header now links to `docs/ops/README.md` alongside Contributing.

### Coverage

- **TikTok `_t` added to universal TRACKING_PARAMS** ([`src/lib/affiliates.js`](src/lib/affiliates.js), platform_noise category). Sister to existing `_r` — share token, not functional for the web URL. Closes the corresponding [#508](https://github.com/yocreoquesi/muga/issues/508) gap.
- **AliExpress `aff_fcid`** added to `aliexpress.com.stripParams` in [`src/rules/domain-rules.json`](src/rules/domain-rules.json). Domain-scoped — CPS click ID, transient and not creator-attributing.
- **Walmart `sourceid` + `athcpid`** added to `walmart.com.stripParams`. Campaign source tag and per-impression content ID respectively.
- **`bestbuy.com`** is a new domain-rules entry (#508). Strips `ref` (referral source) + `loc` (campaign location) + `irclickid` + `irgwc` (Impact Radius affiliate ad-attribution); preserves `q` / `id` / `intl` / `page`.

### Fixed

- **Toolbar icon was rendering as a gray placeholder in Firefox and Chrome.** Two compounding bugs collapsed onto each other: (1) PR [#564](https://github.com/yocreoquesi/muga/issues/564) had restored the v1.13.0 icons by copying the `*-preserved.png` (creator-referral check-mark variant) bytes over `src/icons/{16,48,128}.png`, leaving both the default and the preserved variant pointing at the same image; (2) commit `3b06111` later retired the `setIcon` swap on the (then-correct) observation that the swap had no visible effect, deleting `src/icons/{16,48,128}-preserved.png` in the process. After the retirement the only icons in the bundle were the check-mark variants masquerading as the default — and Firefox was showing a gray placeholder for them in the toolbar and `about:addons`. The original A1 Navy+Gold default (white M on navy with amber stripe — `8b2a652` design) is restored from git, the check-mark variant is restored as `*-preserved.png` (now genuinely distinct from the default), and the `setIcon` swap that surfaces the "creator referral preserved" cue is reinstated. Files: [`src/icons/`](src/icons/), [`src/lib/toolbar-presenter.js`](src/lib/toolbar-presenter.js), [`src/background/service-worker.js`](src/background/service-worker.js), [`tests/unit/toolbar-presenter.test.mjs`](tests/unit/toolbar-presenter.test.mjs), [`tests/e2e/toolbar-visibility.spec.mjs`](tests/e2e/toolbar-visibility.spec.mjs).
- **`tests/benchmark/runner.mjs` was loading `[]` for domain-rules**, silently exempting every domain-scoped strip from the benchmark and keeping stale "GAP — not in TRACKING_PARAMS today" notes around long after the rule had landed. The runner now loads `src/rules/domain-rules.json` once and feeds it into every `processUrl` call. Benchmark coverage went from a misleading 99.2% (with hidden gaps) to a real 100% (129/129).

## [1.13.6] - 2026-05-06

Onboarding hardening release. Headline: the first-run onboarding flow on Firefox no longer leaves the user staring at an unchanged tab after they accept — the silent regression that made "Start browsing clean" appear to do nothing is fixed, the cleaner is now provably off until acceptance, and the toolbar surfaces a "!" badge while consent is pending. Plus a separate gate fix: opening Settings right after a clean acceptance no longer bounces back to onboarding.

### Added

- **Apple Services Performance Partners as a direct-injection program** (#594, partial — Apple half). Refresh of the vendored caps-spec snapshot brought in `apple-phg` (caps-spec PR #45), so MUGA now preserves `?at=` affiliate tokens on `music.apple.com`, `geo.music.apple.com`, `tv.apple.com`, `books.apple.com`, `podcasts.apple.com`, `apps.apple.com`, and `itunes.apple.com`. The "Creator referral preserved" badge fires on those hosts when a third-party `at` token is present, even though MUGA has no Apple Performance Partners account (per the #523 decoupling). The companion `?ct=` parameter is intentionally NOT matched as a creator referral — it is the campaign-name field, not the attribution token. The Bookshop.org half of #594 remains blocked on caps-spec#46 (RFC for path-based affiliate program schema).
- **Toolbar consent-required cue.** A global `"!"` badge surfaces on the toolbar icon while `onboardingDone === false` (including hard-reonboard, where `getPrefs()` forces the flag back to false). Cleared on acceptance. Wired through `onInstalled`, the cold-start fallback, and a new `mugaConsent` branch in the storage `onChanged` listener that re-runs DNR + badge in one shot. Files: [`src/background/service-worker.js`](src/background/service-worker.js).
- **Onboarding success state.** After consent persistence, the page renders an in-place "You're all set / Close tab" confirmation and attempts a best-effort tab close (`window.close()` then `chrome.tabs.remove`). Firefox refuses `window.close()` on tabs not opened by JS, so the in-place state is the safety net that proves to the user the click landed. Files: [`src/onboarding/onboarding.js`](src/onboarding/onboarding.js), [`src/onboarding/onboarding.html`](src/onboarding/onboarding.html), [`src/lib/i18n.js`](src/lib/i18n.js) (en/es/pt/de).

### Changed

- **`booking` and `humble-bundle` programs removed from the direct-injection preserve set.** Both were deprecated upstream in caps-spec (Booking terminated direct affiliate partnerships May 2025 and migrated to Awin globally; Humble Bundle migrated affiliate onboarding to Impact). The sync script filters out `programType=deprecated`, so the consolidated `AFFILIATE_PATTERNS` no longer contains them. Coverage of those click flows continues through the existing `awin` and `impact-radius` network-redirect entries — users clicking a Booking or Humble Bundle link with someone else's affiliate redirect URL still see the unwrap path. The orphaned `OUR_TAGS["booking"]` and `OUR_TAGS["humble-bundle"]` placeholder entries were removed (dead code post-deprecation).
- **DNR cleaner is now gated on `onboardingDone`.** `applyDnrState` previously only checked `enabled && dnrEnabled`. Content scripts already short-circuited on `!onboardingDone`, but the declarative `tracking_params` ruleset was firing before acceptance. Now the ruleset is disabled until the user accepts, mirroring the dynamic path. Files: [`src/background/service-worker.js`](src/background/service-worker.js).

### Fixed

- **Onboarding completion was a silent no-op on Firefox.** Clicking "Start browsing clean" persisted consent but `window.close()` on a tab the user did not open via JS is rejected by Firefox; the page sat unchanged and people assumed the click failed. The completion path now renders an in-place success state before attempting close, so the confirmation survives any browser that refuses both close paths. Files: [`src/onboarding/onboarding.js`](src/onboarding/onboarding.js).
- **Settings bounced back to onboarding right after a clean acceptance.** `options.js` was reading `onboardingDone` from `chrome.storage.sync`, but consent fields moved to `chrome.storage.local` under `mugaConsent` in #355 (ADR-0001). The sync read silently returned the `PREF_DEFAULTS` default `false`, so the consent gate redirected every visit. Now `options.js` reads consent through `getConsent()` like the popup and service worker already do. The test fixture `completeOnboarding` had the same bug (write to sync, not local) and hid the regression — both are fixed in lockstep. Files: [`src/options/options.js`](src/options/options.js), [`tests/e2e/fixtures.mjs`](tests/e2e/fixtures.mjs).
- **Consent-required `"!"` badge disappeared on every tab the user touched.** `chrome.tabs.onUpdated` emitted `navigationStarted` on every page load, which made the toolbar-presenter clear the per-tab badge to `""` — overriding the global `"!"` for that tab. Visible on `addons.mozilla.org` and any other tab opened post-install. The emit is now gated on `onboardingDone`: while pending there are no per-tab counts to clear anyway. Files: [`src/background/service-worker.js`](src/background/service-worker.js).

### Tests

- **`tests/e2e/onboarding-regression.spec.mjs`**: five regression tests covering the success state render, the global `"!"` badge toggle, the badge surviving real tab navigation, the DNR ruleset toggle, and the options page not bouncing back to onboarding after acceptance. Two new `__TEST__` handlers (`readGlobalBadge`, `readDnrEnabledRulesets`) expose the SW state the assertions need.

## [1.13.5] - 2026-05-05

Branded-domain release. The signed remote-rules endpoint moves under `rules.muga.app` so the public surface no longer depends on a personal GitHub username. No user-visible behavior change on a default install.

### Changed

- **Remote rules endpoint moved to `rules.muga.app`** (#481, landed via #596). The signed `params.json` is now served from `https://rules.muga.app/rules/v1/params.json` (was `https://yocreoquesi.github.io/muga/rules/v1/params.json`). DNS-only CNAME points at GitHub Pages — same hosting, branded subdomain. The optional permission users grant when enabling Remote rule updates is now scoped to `https://rules.muga.app/*` (Chrome MV3 `optional_host_permissions` / Firefox MV2 `optional_permissions`). Existing installs that opted in to remote rules on v1.13.4 or earlier will be re-prompted to grant the new host on the next 7-day refresh — the host changed, so the previous grant no longer applies. Files: [`src/manifest.json`](src/manifest.json), [`src/manifest.v2.json`](src/manifest.v2.json), [`src/lib/remote-rules.js`](src/lib/remote-rules.js), [`src/options/options.js`](src/options/options.js), [`docs/CNAME`](docs/CNAME), [`.github/workflows/publish-rules.yml`](.github/workflows/publish-rules.yml).

## [1.13.4] - 2026-05-05

Coverage + standards-compliance + CI hygiene release. Headline: MUGA now consumes `caps-spec/manifest.json` as the source of truth for affiliate program identity, and the preserve set is decoupled from MUGA's own affiliate accounts — creator referrals are honored on Booking, Vercel, DigitalOcean, Humble Bundle, and Lemon Squeezy even though MUGA has no direct account on those programs.

### Added

- **`caps-spec/manifest.json` consumed as source of truth for the affiliate preserve set** (#523, landed via #576/#577/#578). The 12-entry hand-maintained `AFFILIATE_PATTERNS` array is replaced by 7 consolidated entries generated at module load by joining the vendored `caps-spec` direct-injection programs with MUGA's hand-maintained `OUR_TAGS` map. New `scripts/sync-affiliate-manifest.mjs` mirrors the existing `sync-wrappers.mjs` pattern (Ed25519 signature verification when available, `--allow-unsigned` for the interim). Files: [`scripts/sync-affiliate-manifest.mjs`](scripts/sync-affiliate-manifest.mjs), [`src/vendor/caps-spec/manifest.data.js`](src/vendor/caps-spec/manifest.data.js), [`src/lib/affiliates.js`](src/lib/affiliates.js).
- **Sprinklr campaign-manager params (`spr`, `sprtype`) added to universal `TRACKING_PARAMS`** ([`src/lib/affiliates.js`](src/lib/affiliates.js), [`src/rules/tracking-params.json`](src/rules/tracking-params.json)). Stripped on every domain. False-positive risk is low — these identify the campaign and asset that referred a click inside Sprinklr's backend and have no functional payload from the user's perspective. Closes the last "low-risk universal" gap from the #508 acceptance list (the merchant-specific gaps remain). (#508)
- **`tracker-flag.yml` issue template** ([`.github/ISSUE_TEMPLATE/tracker-flag.yml`](.github/ISSUE_TEMPLATE/tracker-flag.yml)). Wires Channel 1 of CAPS decision 6 — receives structured tracker reports prefilled by MUGA's local heuristics (entropy + cross-site frequency). Schema mirrors the privacy contract already enforced by `csft-upstream.js`: only the SHAPE of the observation, never raw URLs or raw values. The existing `tracking-param.md` template is preserved (different intent — hand-written carrier-aware param requests). (#522)
- **`tracker-candidate` repo label** to receive auto-labelled issues from the new form.

### Changed

- **Preserve set is now declarative, not gated on MUGA's own affiliate account.** The `if (!pattern.ourTag) continue` short-circuit in `detectPreservedAffiliate` (cleaner.js line 124 pre-#523) is removed. Result: when a user clicks a Booking, Vercel, DigitalOcean, Humble Bundle, or Lemon Squeezy link that carries someone's affiliate tag, MUGA preserves it and shows the "Creator referral preserved" badge in the popup — even though MUGA has no account on those programs. Aligns with the wedge ("MUGA preserves any creator's tag") and with caps-spec's declarative semantics. (#523 phase 3)
- **`pattern.ourTag` shape**: was a flat string per legacy per-marketplace entry. Now a `{ host -> tag }` map per consolidated program. Cleaner-side comparisons read `pattern.ourTag[hostname]`. Service-worker, options page, and the legacy unit-test patterns updated to match. (#523 phase 3)
- **Release pipeline submission gate now distinguishes "version already submitted" from real store errors** ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Each store step (AMO, CWS upload, CWS publish) emits a `result` output of `success | noop | failure`. The summary gate fails the workflow only on `failure`; `noop` is treated as success-or-no-op. This unblocks the partial-recovery scenario from v1.13.1 — a maintainer can re-tag a patch release without the gate spuriously failing on the store that already published the previous tag. Detection patterns are conservative; real failures still surface. (#557)

### Fixed (CI / hygiene)

- **Branch protection on `main`** now requires both `test` and `e2e` jobs to pass before merge. Fixes the gap that allowed PRs #487-#490 to land with `cleaner-bundle.js` drift even though CI flagged it. `enforce_admins: false` preserves the admin-merge escape hatch for legitimate flakes. (#513)
- **`actions/upload-artifact@v4` SHA-pinned in `benchmark.yml`** to commit `ea165f8` (v4.6.2). Brings the workflow in line with the existing pin convention used for `actions/checkout` and `actions/setup-node` in the same file and across `ci.yml`. The previous tag-only reference shipped with a `FIXME` comment from the original workflow author. (#528)

### Internal

- **Playwright spec for DNR wrapper rules** ([`tests/e2e/dnr-wrapper-rules.spec.mjs`](tests/e2e/dnr-wrapper-rules.spec.mjs)). The first CI run answered the empirical question raised by the issue: Chromium's `regexSubstitution` copies the captured group **verbatim** into the redirect URL, so a percent-encoded destination becomes a malformed URL and the redirect is silently dropped. Per-wrapper redirect tests are enumerated but `.skip`ped with the finding inline; the negative-case test (regex must not over-match `awin1.com` paths without `p=`) stays active. Follow-up belongs to the maintainer: drop the inert wrapper rules, reshape them when Chromium adds decode support, or live with the partial coverage. (#510)

## [1.13.3] - 2026-05-05

User-visible polish release. Two critical fixes for users on v1.13.0–v1.13.2 (broken toolbar icon, stuck onboarding) plus a copy/visual pass on the onboarding and a popup cleanup. Also bundles two feature PRs that had been sitting on `[Unreleased]` since the 1.13.2 cut: wildcard whitelist/blacklist values and the CAPS-Basic + Contextual conformance claim.

### Fixed

- **Toolbar icon was invisible on Firefox and Chrome** (#564). The 16/48/128 PNGs introduced in v1.13.0 were 96–99% transparent — only 6/256, 13/2304, and 32/16384 pixels respectively were opaque. The accompanying `*-preserved.png` files in the tree were the intact RGB sources, mistakenly left as the optimization input rather than the shipped output. This release copies those bytes over the broken files. Users on v1.13.0–v1.13.2 will see the working icon on the next AMO/Chrome Store update.
- **Onboarding "Start browsing clean" button did nothing** (#565). The CTA was natively `disabled` until the ToS checkbox was checked, so clicks were silently swallowed. Users who didn't notice the ToS gate clicked repeatedly with no feedback and assumed the onboarding was broken. Now the button uses `aria-disabled` so the click event still fires; the handler flashes the ToS card (respects `prefers-reduced-motion`), smooth-scrolls it into view, focuses the checkbox, and announces the requirement via an `sr-only` `aria-live` region. Playwright's `toBeDisabled()` recognises the new state, so existing e2e coverage carries over.
- **Onboarding tagline pinned to a narrow left column** (#565). The header had `max-width: 26ch / 48ch / 52ch` while the rest of the page used the full container width, leaving the tagline visually orphaned. Now flows to container width like the feature cards beneath.
- **Redundant "Still see tracking?" link in the popup** (#567). Two report links (`#report-broken`, `#report-unclean`) were splitting a single user intent — "this didn't work as expected" — across two GitHub queues. Removed `#report-unclean`; the remaining `#report-broken` absorbs both intents.
- **Share button doubled the 📋 emoji on click** (#567). The static `<span aria-hidden="true">📋 </span>` already held the icon and the click handler also wrote `share_copy_prefix` (another 📋) into the visible label, producing `📋📋 Share`. The fix removes the entire share feature (see Removed below) — the bug dies with it.
- **Creator-referral hint hidden behind a `cursor: help` tooltip** (#567). The OS-level tooltip surfaces slowly (and not at all on touch), and the help cursor implied a click action that never existed. Now the hint renders inline as a small line below the badge — visible without interaction.

### Added

- **Wildcard value support in Blocked Domains and Whitelist** (`domain.com::param::*`). Strips or protects a parameter on a specific domain regardless of its value — useful for params like `pid` that share legitimate and tracking uses. Both lists now accept the new shape. Priority rule made uniform and explicit: a Whitelist match always wins over a Blacklist match for the same parameter. Documented in the options page hints and README. ([`src/lib/cleaner.js`](src/lib/cleaner.js), [`src/lib/validation.js`](src/lib/validation.js), [`src/lib/i18n.js`](src/lib/i18n.js)). (#301)
- **CAPS-Basic + Contextual conformance claim** ([`CONFORMANCE.md`](CONFORMANCE.md)). MUGA now formally conforms to the [Creator Affiliate Preservation Standard](https://github.com/yocreoquesi/caps-spec) at the Basic level + Contextual extension. Every vector in `caps-spec/test-vectors/contextual.json` is enforced as a CI gate (`npm run conformance:contextual`) on every PR — regressions fail the build before merge. Test vectors are vendored at `vendor/caps-spec/test-vectors/contextual.json`. README badge updated. (#543)

### Changed

- **Onboarding copy trimmed to the user-facing wedge** (#566). Removed `ob_tagline_values` (a meta-statement about being honest when wrong — slowed the flow without earning trust on its own); rewrote `ob_tagline_sub` from "Open source. Transparent. Built to protect your privacy." to "No servers. No telemetry. URLs never leave your browser." (concrete mechanisms vs jargon); renamed `ob_step2_title` from "Fair to every click" (which duplicated the page tagline word-for-word) to "How MUGA stays free"; dropped "Open source, GPL v3." from `ob_cta_note` — the licence does not influence a regular user's install decision.
- **Onboarding visuals**: replaced the CSS-pattern logo decoration and the unrelated unicode glyphs (✕, ◆, →) on feature rows with coherent stroke-only SVGs (sparkle for the wordmark — same mark as the popup; X-in-circle, shield-with-check, and link icon for the three feature rows). a11y test rewritten to assert that every `.feature-icon` container is `aria-hidden`, regardless of inner shape. (#566)
- **Network-redirect short-circuit** in [`src/lib/cleaner.js`](src/lib/cleaner.js) and [`src/lib/param-classifier.js`](src/lib/param-classifier.js). Per CAPS SPEC §3.2 step 6, the bounded-scope rule (#530) MUST NOT fire on `network-redirect` hosts. When `detectWrapper(url)` returns non-null and the URL was not unwrapped (no extractable destination), the cleaner now passes `_skipBoundedScope: true` to the classifier and `PARAM_PAIRS` entries survive on the wrapper host. Required for Contextual conformance vector #12. (#543)

### Removed

- **Popup share button and its supporting copy** (#567). A low-leverage growth surface (clipboard-only sharing of a marketing blurb plus a Store URL) that carried real maintenance cost: 9 phrase translations × 4 locales, 8 seasonal easter-egg keys, the prefix/suffix indirection, and the `📋📋` rendering bug above. The "Rate MUGA" nudge (gated on 200 URLs cleaned + 7 days since install + max-3 nudges spacing) and the always-visible footer "Rate MUGA" link continue to cover word-of-mouth. The growth bar now hides whenever the rate nudge does not fire, instead of always rendering an empty container.

## [1.13.2] - 2026-05-04

Recovery release. No functional or user-visible changes vs v1.13.1 — same code, same rules, same behavior. The v1.13.1 release was tagged but its `Release` workflow failed at the unit-test step because the `[Unreleased]` reference link at the bottom of `CHANGELOG.md` still pointed at `v1.13.0...HEAD` after the bump. The `tests/unit/changelog-links.test.mjs` guard correctly flagged the drift, which blocked the AMO publish step from running. AMO therefore stayed on v1.11.0.

### Fixed
- **Release pipeline**: `[Unreleased]` link in `CHANGELOG.md` now tracks the latest released tag, satisfying the `changelog-links` test that gates the `Release` workflow. Without this, every bump that forgot to update the link would silently skip AMO publish.

## [1.13.1] - 2026-05-04

Recovery release. No functional or user-visible changes vs v1.13.0 — same code, same rules, same behavior. The v1.13.0 release reached Chrome Web Store but never reached Firefox AMO: the upload was rejected with HTTP 400 because the auto-generated `release_notes` (full CHANGELOG slice) was 4938 characters, over Mozilla's 3000-character cap. The release workflow had `continue-on-error: true` on the AMO step plus a lenient AND-gate on the summary, so the failure shipped green while AMO got nothing.

### Fixed
- **Release pipeline**: AMO `release_notes` are now truncated to 2900 characters (100-char headroom under Mozilla's 3000 cap) with a link back to the GitHub Release for the full notes. Truncation logic lives in `tools/amo-build-metadata.mjs` (testable) and is pinned by `tests/unit/amo-release-notes-truncation.test.mjs`. (#556)
- **Release pipeline**: `release.yml` `Check store submissions` step now fails the workflow if **any** store step fails (AMO, CWS upload, CWS publish), with per-store error annotations. The previous gate only failed if both stores failed, which masked the v1.13.0 AMO regression. (#556)

## [1.13.0] - 2026-05-04

PRD #529 first wave — adaptive URL coverage expansion. Six user-visible features land together. The wave shifts MUGA from purely curated rules toward a mix of curated + bounded-scope contextual + user-mediated discovery, while keeping the false-positive principle intact and the zero-telemetry promise unchanged.

### Added

- **PARAM_PAIRS bounded-scoping classifier** ([`src/lib/param-classifier.js`](src/lib/param-classifier.js)). Generic ambiguous parameters (`pid`, `icid`, `icmp`, `CMP`, `NLID`, `soc_src`) are now stripped — but ONLY when a definitive **anchor tracker** (`gclid`, `fbclid`, `msclkid`, `dclid`, `twclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `mc_eid`, `mc_cid`) co-occurs in the same URL. Standalone `pid=42` on a clean GitHub URL is preserved (functional). The same `pid` next to `gclid=…` on a marketing URL is stripped. Affiliate-precedence still wins: a pair that is also a creator-referral param for the host stays preserved. Unlocks 6+ benchmark-corpus URLs that were previously left untouched. (#530)
- **Generic wrapper templates** in [`src/lib/wrapper-engine.js`](src/lib/wrapper-engine.js). When no explicit per-host wrapper recipe matches, the engine falls through to a generic code path that probes 5 common destination-parameter keys (`url`, `u`, `redirect`, `dest`, `target`) with 4 safety guards (destination must be absolute http(s), destination host ≠ wrapper host, destination must not be an auth/checkout shape, length cap). Catches new redirect networks the spec doesn't yet enumerate, without wide false-positive risk. Explicit per-host wrappers still take precedence. (#531)
- **CSFT graduation pipeline** ([`src/lib/cross-site-frequency.js`](src/lib/cross-site-frequency.js)). Each tracked param record now carries a `state` field with three values: `observed → suspicious → candidate`. Promotion happens locally based on first-party domain count + value entropy + recurrence thresholds. Surfaces in the popup's "Suspicious params" section as evidence-graded recommendations, not just raw counters. New exports: `getState(paramName)`, `valueEntropy(s)`. The 17 pre-existing B16 unit tests still pass alongside new state-machine tests. (#532)
- **"Strip locally" button** per flagged param in the popup's Suspicious section. One click promotes the param into a new local `userCustomRules: []` array in `chrome.storage.sync`. The cleaner consults the array on every navigation; affiliate-preservation still beats it. Per-user expansion of coverage with zero latency to upstream. (#536)
- **"Report upstream" button** per flagged param in the same Suspicious section. One click opens a deep-linked GitHub issue in the muga repo containing strictly the parameter name and the count of distinct first-party domains the user observed it on — no value, no hash, no domain history, no telemetry. Privacy contract enforced structurally by the new [`src/lib/csft-upstream.js`](src/lib/csft-upstream.js) deep pure module: the only fields the payload-builder can produce are `paramName` and `firstPartyDomainCount`. (#537)
- **Experimental param-class shape heuristic** behind `experimentalParamClassesEnabled` flag (default OFF). When enabled, the cleaner additionally strips parameters whose VALUE SHAPE matches a tracker pattern: suspicious key prefix (`*_id`, `*clid`, `*_token`, `*_uid`, `*_session`) AND value length > 16 AND Shannon entropy > 4.0 AND base64/hex/uuid charset. All four signals must hit (multi-signal AND). A small allowlist (`state`, `code`, `nonce`, `csrf`, `csrf_token`, `_csrf`, `oauth_token`, `oauth_verifier`, `access_token`, `refresh_token`, `id_token`, `session_id`, `sessionid`, `jsessionid`, `phpsessid`, `sid`, `aspsessionid`) is ALWAYS exempt to protect login flows. With the flag OFF, cleaner behaviour is byte-identical to the #530 baseline. (#544)

### Changed

- **`PREF_DEFAULTS`** in [`src/lib/storage.js`](src/lib/storage.js) gains two new fields: `userCustomRules: []` (per-user locally-promoted params from #536) and `experimentalParamClassesEnabled: false` (the #544 flag, default OFF).
- **i18n keys** added in en + es for the two new popup buttons + the experimental-flag label. pt + de FIXME-flagged per project convention.
- **CHANGELOG.md** structure: this 1.13.0 release sits above the previously-documented 1.12.0 (post-grill rollout). v1.12.0 was bumped in code on 2026-04-26 but never tagged into the wild; users on Chrome Web Store / Firefox AMO updating from v1.11.0 receive both waves under the v1.13.0 tag.

### Internal

- **Benchmark phase 2 + 3** ([`tests/benchmark/`](tests/benchmark/)): synthetic-baseline competitor adapter (#506 phase 2a — 9 UTM + 10 click IDs floor); Markdown report writer (#507 phase 3a); HTML report writer (#507 phase 3b); CI workflow on release-tag push (#507 phase 3c — `.github/workflows/benchmark.yml` with 90-day artifact retention). A6 #458 fully closed across phases 1-3.

## [1.12.0] - 2026-05-01

This is the post-grill rollout release. The architectural surface that v1.11.0 took for granted was retrospectively interrogated in late April 2026; this release ships the resulting changes. Most of the user-visible behavior is unchanged — the work was structural: where consent lives, how the URL pipeline runs, and what the toolbar tells you at a glance.

### Added

- **Per-device consent** ([ADR-0001](docs/adr/0001-per-device-consent.md)). Acceptance of the Terms now lives in `chrome.storage.local` on each device rather than syncing across your browser account. Behavioural preferences (language, blacklist, whitelist, toggles) keep syncing as before. Installing MUGA on a second device now asks you to read and accept again on that device — the reasoning is in the ADR. A one-way sync→local migration runs on first wake post-upgrade so existing installs do not re-onboard. (#355, #364, #399, #400)
- **Toolbar visibility surface**. Per-tab dynamic tooltip describes what MUGA did on the current page (default / cleaned / preserved / combined). Semantic badge color: blue for routine cleaning, green when a creator's affiliate was preserved, yellow when a foreign affiliate was detected (toast-off case). Variant icon adds a small check badge in the corner when a creator's referral is preserved on this tab. All three signal independently and do not require the popup to be open. (#358, #367, #368)
- **Migration banner mechanism in the popup**. Dormant in this release — the `MIGRATIONS` spec ships empty. The plumbing activates the first time MUGA flips a pref default in a future release; users will see an in-popup banner explaining the change with explicit accept / decline / dismiss actions. No data is sent anywhere; responses are recorded per-device. (#369)
- **Re-onboard rendering modes**. Dormant in this release — the consent-version manifest has only `1.0`. The plumbing surfaces a `delta` mode (lists newly added clauses) for additive ToS changes and a `material` mode (gates features until re-acceptance) for substantive changes. Activates on the first ToS bump that uses the new mechanism. (#370)
- **Local cleaning paths** for click and copy. Click on a link to a supported store now cleans synchronously inside the content script via the bundled cleaning library — no more 3-second timeout fallback when the service worker is cold. Copy operations on selections containing URLs are intercepted and cleaned in-page. The service worker still receives a fire-and-forget `BADGE_AND_STATS` message for stats and badge updates, but URL cleaning itself never round-trips. (#356, #366)
- **AMP redirect via `declarativeNetRequest`** on Chrome. Three rules redirect Google's AMP cache (`/amp/s/`), `cdn.ampproject.org/c/s/`, and `amp.*` subdomains to the canonical URL at the network layer, before the AMP page loads. Firefox MV2 keeps the existing content-script-based redirect because the equivalent dynamic-rules API is not available. (#357)
- **Redirect unwrap merged into a single content-script module** covering Awin, ShareASale, Admitad, Pepper deal-site meta-refresh chains, Amazon `/sspa/click`, and the generic redirect-wrapper pattern. Same unwrap behavior as before, less code. The `destination=` and `location=` parameters remain explicitly excluded to avoid breaking SSO and OAuth flows. (#371)
- **End-to-end test suite** (Playwright on Chromium). 75+ specs covering the post-grill surfaces: consent migration, per-device confirmation prompts, re-onboard rendering, migration banner round-trip, toolbar visibility, local cleaning paths, AMP DNR, redirect-unwrap, plus the pre-existing URL-cleaning, popup, options, onboarding, service-worker lifecycle, and remote-rules specs. Helpers under `tests/e2e/helpers/` provide fixture seeding, test-mode sentinel install, service-worker control, and chrome.action surface read-back. (#398, #406, #407, #408, #409, #410)
- **Operational runbooks** under `docs/ops/`: `health-signals.md` (what to watch and how to read it), `rollback-playbook.md` (incident response), `staged-release.md` (rollout decision doc). Indexed by `docs/ops/README.md`. Plain markdown, ignored by the web-ext build. (#403, #404, #405, #413)
- Popup now headlines a count celebration when MUGA cleans a URL: "MUGA removed N trackers from this URL", with a one-shot pulse animation on the digits (gated by `prefers-reduced-motion: no-preference`). Pluralized via `Intl.PluralRules` so the en/es/pt/de variants stay grammatical. When MUGA evaluates a URL and finds nothing to clean, a quieter "URL was already clean" line surfaces instead — a positive signal that MUGA *checked*, not silence. Three new keys: `preview_count_one`, `preview_count_other`, `preview_count_clean`. (#326)

### Changed

- **Privacy policy** ([`src/privacy/privacy.html`](src/privacy/privacy.html)) re-read end-to-end against the post-grill code. Added the per-device consent disclosure, the migration-on-upgrade explanation, the cross-browser AMP redirect split, the post-#353 conditional preservation of MUGA's own tag, and the bundle architecture. Effective date: 2026-05-01. (#399)
- **Terms of Use** ([`src/privacy/tos.html`](src/privacy/tos.html)) re-read against the post-grill code. Section 3 now describes the conditional our-tag preservation precisely. Section 4 describes both sync (behavioural prefs) and local (consent + per-device decisions) buckets and cross-references ADR-0001. Section 10 distinguishes material vs additive Terms changes (re-onboard semantics from #370). Last updated: 2026-05-01. (#400)
- **AMO `amo-metadata.json` approval notes** updated to acknowledge the esbuild bundle pipeline introduced in #356. The notes now point AMO reviewers at `tools/bundle-content.mjs` and the verification command sequence, and update the test count claim to ~2500 unit tests. (#401)
- **`docs/transparency.html`** re-read against post-grill architecture. New "Architecture" and "Per-Device Consent" sections; "How to Verify" now includes a bundle-diff verification step. Remote-rules bullet reframed as interim engineering per #362. (#402)
- **`docs/store-listing.md`** aligned with the privacy + ToS rollout. The "settings sync" claim now distinguishes per-account behavioural prefs from per-device consent. The "Strip all third-party affiliates" rule entry reflects the post-#353 conditional preservation. (#411)
- **Remote rule updates** off-by-default posture documented as interim engineering across the listing, the README, the privacy policy, and the transparency report. The default may flip in a future release once the signing infrastructure stabilizes; the change will surface in the soft re-onboard flow. (#362)
- **Comparison page** (`docs/comparison.html`) refreshed to lead with the wedge. New table column for **Brave (built-in)**. New rows surfacing v1.11.0+ user-visible features: "Surfaces preserved creator tag in UI" and "Tracker count celebration in popup". Existing "Replaces creator affiliates" row updated to honestly reflect that ClearURLs / Brave / Neat URL all *can* strip a creator's tag depending on rule set / filter list version, while MUGA never does. New "Refuses redirect-based affiliate networks" row documents the wedge at the policy level. Plain-language "the wedge in plain English" section above the honest notes. Page linked from README, the docs landing, and the store listing footer. (#329)
- **Store listing** rewritten to lead with the differentiator: "Privacy Without Breaking Creator Links". The "fair to creators" wedge is now the headline of both Chrome Web Store and Firefox AMO listings, plus README.md and the manifest descriptions. Listing example shows a third-party reviewer's `?tag=reviewer-21` being preserved while 7 tracking params are removed, so the value proposition is visible in the first 5 seconds of reading. Section ordering: wedge → before/after → param coverage → why we rejected 10+ networks → privacy. New CWS short description (118 chars). (#328)

### Internal

- New `tests/unit/legal-sync.test.mjs` and `tests/unit/ops-docs-sync.test.mjs` catch obvious doc drift mechanically. (#412, #414)
- New `src/lib/test-fixtures.js` reads runtime fixture overrides from `chrome.storage.local` when the test-mode sentinel is set. Production builds never set the sentinel; the module returns null at runtime and the static module-level constants always win. Lets the e2e suite drive dormant rendering paths (re-onboard, migration banner) deterministically without shipping fixture data into the release artifact. (#407)

## [1.11.0] - 2026-04-26

### Added
- Popup now surfaces when MUGA preserved a third-party creator's affiliate tag on the current URL. New "Creator referral preserved" badge inside the preview section, with a tooltip explaining the policy. Fires regardless of whether the URL was otherwise modified — including on URLs MUGA leaves untouched. Wedge of "fair to creators" made tangible. New cleaner result field `preservedAffiliate` exposing `{ param, value, store, group }`. Independent of the existing `notifyForeignAffiliate` toast preference: this is a passive UI signal, not a notification. New i18n keys `preview_preserved_creator` and `preview_preserved_creator_hint` in en/es/pt/de. (#327)
- New collaborative report link in the popup: "Still see tracking? Help us improve" (i18n key `report_unclean_url`). Visible only when MUGA modified the URL and `showReportButton` is on, alongside the existing "Report a problem with this URL" link. Opens a pre-filled GitHub issue tagged `unclean-url` with hostname, version, browser and the params MUGA already removed — never the full URL or query string. Same zero-network, no-new-permissions model as the broken-site report. Feeds the remote-rules catalog with real-world misses. (#271)

## [1.10.2] - 2026-04-25

### Changed
- Options page: the "Remote rule updates" section now appears before the "Advanced" block, so Advanced remains the last section on the page.
- Remote-rules copy softened to reflect the on-wake refresh model introduced in 1.10.1: "Enable rule updates" (toggle) and "Periodically checks for signed updates… about once a week, while you browse" (description). No behavioral change — the max cadence is still ~7 days.

### Added
- Popup now reacts live to settings changes. Toggling MUGA on/off, or adding the current domain to the per-domain-disable list (blacklist entries of the form `domain::disabled`), updates the preview without reopening the popup. The trigger is both an optimistic in-popup re-render on the enabled-toggle click AND a `chrome.storage.onChanged` listener that catches changes made from the Options page in another tab.
- Distinct popup status when MUGA is globally active but the current site is on the per-domain-disable list. Previously only "MUGA is disabled" (global) was shown; now "MUGA is disabled on this site" surfaces the per-domain state. New i18n key `muga_disabled_for_domain` in all four locales.

## [1.10.1] - 2026-04-25

### Changed
- Remote rule updates no longer require the `alarms` permission. The weekly refresh now piggybacks on natural service-worker wake events (browser startup, page visits, popup messages) and is throttled by a stored `fetchedAt` timestamp — at most one fetch per 7 days, short-circuited immediately when the feature is off. This drops one permission from the manifest without changing the opt-in default or the privacy posture.

### Removed
- `alarms` permission from `manifest.json` and `manifest.v2.json`.

## [1.10.0] - 2026-04-24

### Added
- Optional weekly updates for the tracking parameter list, off by default. Ed25519-signed payloads fetched from a public GitHub Pages endpoint (`https://yocreoquesi.github.io/muga/rules/v1/params.json`). Enable in Settings → Remote rule updates. Zero outbound requests on a default install. See `docs/transparency.html`. (#270)

## [1.9.10] - 2026-04-13

### Fixed
- Firefox TDZ: `_contentPrefs` declarations hoisted to top of the content script IIFE so early-firing event handlers (copy, click, runtime.onMessage) can no longer reference them before initialization (#298)
- Security: `navigate()` now enforces the 2000-char URL length cap before parsing
- Security: hostname extraction in the affiliate toast wrapped in `safeHostname()` — malformed URLs no longer throw inside event handlers

### Added
- Static-analysis regression tests asserting `_contentPrefs` / `_contentPrefsPending` declarations stay above any reader and within the first 120 lines of `cleaner.js`

## [1.9.9] - 2026-04-10

### Fixed
- Security: add URL payload length limit, reject non-HTTP schemes, harden sanitizeHTML
- Robustness: cache version counter prevents stale prefs, time-based rewrite loop eviction
- Firefox MV2: shim chrome.runtime.sendMessage, deduplicate browser-polyfill loading
- MutationObserver ping blocking debounced via requestAnimationFrame
- Document silent .catch() handlers in content scripts
- Safe manifest swap script with trap-based restoration

### Added
- Automated Firefox AMO submission on tag push
- Automated Chrome Web Store submission on tag push
- README: Chrome Web Store install badge (no longer "Coming soon")

## [1.9.8] - 2026-04-06

### Added
- Param breakdown: expanding cleaned URLs shows what was removed, grouped by category
- Per-domain stats: "Your top trackers" section in popup (50-domain cap, LRU eviction)
- Public report button: "Report a problem with this URL" visible to all users
- Three new feature flags: paramBreakdown, showReportButton, domainStats
- 26 new tests (922 total), strict TDD

### Changed
- Report button moved from dev-tools-only to popup (gated by showReportButton flag)
- History entries now store removedTracking array for breakdown display
- Stats reset also clears domain stats

## [1.9.7] - 2026-04-06

### Fixed
- Remove 9 DNR params that conflicted with domain-rules.json preserveParams
- Enforce disabled-state guards across all features (DNR, context menus, content scripts)
- Wrap all chrome.storage calls in try/catch with error logging
- Fix case sensitivity in param matching and remove dead code
- Fix inverted aria-expanded on store group chips
- Fix reportBtn listener accumulation in options dev tools

### Added
- AGENTS.md code review rules for GGA pre-commit hook
- Version-consistency test for manifest/package.json sync
- 166 new tests (896 total): prefix params, defensive inputs, scheme rejection, DNR exclusions
- All user-visible strings now go through i18n (milestones, share phrases, seasonal easter eggs)
- Spanish translations for all new strings

### Improved
- Upgrade toast/consent dialogs to role="alert"/alertdialog with aria-live
- Add aria-labels, initial aria-expanded on all toggle controls
- Build clipboard SVG via createElementNS instead of innerHTML
- Add customParams regex validation
- Add noopener noreferrer to all external links
- Add focus-visible styles for consent gate button

## [1.9.6] - 2026-04-05

### Fixes
- **Content script intercepts clicks when disabled**: the capture-phase click handler in `content/cleaner.js` called `e.preventDefault()` on ALL link clicks without checking if the extension was enabled. This broke notification dropdowns, modal triggers, and any UI element using `<a>` tags (e.g. mediavida.com notifications). Click and copy handlers now check `_contentPrefs.enabled` and `_contentPrefs.onboardingDone` synchronously before any interception
- **Self-clean fires when disabled**: the `history.replaceState` fallback (Firefox MV2 and Chrome safety net) ran on every page load without checking the enabled pref. Now gated behind `getContentPrefs().then()` with an enabled check
- **Prefs loaded eagerly**: `getContentPrefs()` is now called immediately on content script load so that `_contentPrefs` is populated by the time the user clicks or copies. Previously prefs were only loaded when ping blocking initialized

### Improvements
- **Selective click interception**: click handler now only intercepts links to affiliate store domains (Amazon, eBay, Booking, etc.). All other clicks pass through unmodified, preserving SPA navigation on YouTube, forums, and other sites. Tracking param removal on non-affiliate sites is handled by DNR (Chrome) and self-clean replaceState (Firefox)

### Tests
- 852 passing tests (up from 821): 5 disabled-state guard tests, 4 selective interception tests, 5 getAffiliateDomains functional tests

## [1.9.5] - 2026-04-02

### Features
- **Self-clean on page load**: content script now cleans the current page URL when it loads, using `history.replaceState` to update the address bar without reloading. This is the primary cleaning mechanism on Firefox MV2 (no DNR support) and acts as a safety net on Chrome for params that DNR rules miss (e.g. case-sensitive params)
- **Pepper network redirect unwrap**: unwraps deal-aggregator redirects from Chollometro, mydealz, dealabs, hotukdeals, and 10 more Pepper.com sites. Extracts the store destination from the `<meta refresh>` intermediary (digidip.net) and navigates directly, skipping all tracking servers
- **Amazon `sp_cr` param**: added to stripParams for all 16 Amazon TLDs

### Fixes
- **DNR case-sensitive `__mk_*` params**: added mixed-case variants (`__mk_es_ES`, `__mk_de_DE`, etc.) to DNR rules — Chrome's `removeParams` is case-sensitive, so lowercase-only rules missed the actual params
- **Keyword spam removal**: all brand/platform names removed from store listings, README, privacy policy, ToS, and marketing copy to comply with Chrome Web Store policy (violation ref: Yellow Argon). Replaced with parameter names and generic categories
- **Promo tiles updated**: regenerated all promotional images with current slogan, stats, and store count

### Tests
- 821 passing tests (up from 802): Pepper network redirect unwrap (18 tests), DNR sync verification improved (split into bidirectional checks)

## [1.9.4] - 2026-04-01

### Features
- **Consent gate**: extension is fully disabled until user accepts Terms of Use in onboarding. Popup shows a consent screen, options redirects to onboarding, service worker blocks URL processing, content script skips ping blocking. Works on both Firefox and Chrome
- **120+ new domain-specific tracking params**: comprehensive audit against ClearURLs, AdGuard Filter 17, Neat-URL, and Mozilla's built-in strip list. Major additions:
  - Amazon (16 TLDs): +45 params (qid, sr, crid, sprefix, pf_rd_*, pd_rd_*, ascsubtag, linkCode, _encoding, psc, etc.) — 60 total
  - Facebook/fb.com: +14 params (__cft__, dti, tracking, sfnsn, wtsid, rdid, extid, etc.)
  - TikTok: +19 params (share_link_id, tt_from, sec_user_id, web_id, embed_source, etc.)
  - Google: +8 params (sei, iflsig, pcampaignid, cshid, fbs, vet, dpr)
  - LinkedIn: +8 params (refId, trk, trkEmail, eBP, lgCta, origin, etc.)
  - Reddit: +7 params (correlation_id, ref_campaign, rdt, post_index, etc.)
  - eBay (6 TLDs): +3 params (_trkparms, _trksid, _from)
  - YouTube: +3 (embeds_referring_euri, embeds_referring_origin, kw)
  - Spotify: +4 (sp_cid, dlsi, pi, referral)
  - Also: Netflix, NYTimes, BBC, AliExpress, Bing, Yahoo, Twitter/X, Etsy
- **Shopify recommendation tracking**: 5 new global params (pr_prod_strat, pr_rec_id, pr_ref_pid, pr_rec_pid, pr_seq)
- Global tracking params: 459 (up from 454). Domain-specific strip rules: 1,528 across 106 domains

### Fixes
- **Double onboarding tabs**: `openOnboardingOnce()` dedup function prevents both `onInstalled` and the fallback IIFE from opening duplicate tabs
- **Promise shim double-execution**: the Firefox MV2 shim was probing each API call by invoking it without a callback first — for side-effectful methods like `chrome.tabs.create`, this executed the action twice. Now detects the environment once at startup with a safe `storage.sync.get` probe

### Tests
- 802 passing tests (up from 775): consent gate enforcement (6 tests), onboarding dedup (2 tests), cross-portal tracking param coverage (14 tests), Amazon param groups (5 tests), shim safe-probe (1 test), Amazon /sspa/click redirect unwrap (10 tests)

## [1.9.3] - 2026-04-01

### Fixes
- **Firefox compatibility**: guard all `declarativeNetRequest` calls with `hasDNR` check -- Firefox MV2 does not support DNR, causing background script crash that blocked onboarding, context menus, and all extension functionality
- **Firefox Android**: guard `contextMenus` and `commands` APIs (not available on mobile)
- **Browser polyfill**: add `browser-polyfill.min.js` to popup, options, and onboarding HTML (was only in background.html)
- **strict_min_version**: lowered from 140.0 to 128.0 (Firefox ESR) to support current stable Firefox
- **dev:firefox**: script now swaps manifest to MV2 before running (was loading MV3 manifest in Firefox)

### Tests
- 22 new Firefox MV2 compatibility tests (752 total): DNR guards, contextMenus guards, polyfill presence and load order, manifest structure checks
- Tests prevent future regressions -- removing any guard or polyfill will fail the test suite

## [1.9.2] - 2026-04-01

### Improvements
- **Onboarding redesigned**: 5 features reduced to 3, privacy-first messaging, "How MUGA stays free" replaces "Support an indie developer", claim about rejecting 10+ stores, "Start browsing clean" CTA, GPL v3 badge
- **Report button renamed**: "Report broken site" changed to "Report a bug or suggest an improvement" in popup, options, and i18n (EN + ES)
- **Collapsible store groups fix**: CSS `display:flex` was overriding `hidden` attribute on `.store-detail`. Amazon group now collapses correctly
- Version bump to 1.9.2 with Chrome and Firefox build artifacts

## [1.9.1] - 2026-04-01

### Features
- **Privacy-first affiliate policy**: redirect-based affiliate networks (Awin, Admitad, ShareASale, VigLink, Tradedoubler) force users through external tracking servers. MUGA now actively works against this:
  - `awc` (Awin) and `wt_mc` (Webtrekk) moved to TRACKING_PARAMS -- stripped globally (454 total)
  - Domain-specific `stripParams` added to 9 stores: SHEIN, Zalando ES/DE, Fnac ES/FR, MediaMarkt ES/DE, PcComponentes, El Corte Ingles
  - Affiliate redirect unwrap: awin1.com (`ued`), shareasale.com (`urllink`), ad.admitad.com (`ulp`), alitems.com (`ulp`), redirect.viglink.com (`u`), clk.tradedoubler.com (`url`)
- **New privacy policy section**: "Stores removed for privacy reasons" explains why 10+ stores were rejected
- **Privacy messaging**: README, store-listing, and privacy policy updated with privacy-over-revenue stance

### Internal
- 730 passing tests, 0 failures
- Health check test updated to reflect intentional policy change (awc, wt_mc no longer protected as affiliate params)
- Tracking param count: updated to 454

## [1.9.0] - 2026-03-31

### Features
- **Amazon Associates activated**: 6 marketplace tags configured (ES `muga0b-21`, DE `muga0f-21`, FR `muga08a-21`, IT `muga04f-21`, UK `muga0a-21`, US `muga0b-20`). Affiliate injection is now live on all Amazon markets
- **eBay Partner Network activated**: campaign ID `5339147108` configured for 6 markets (US, ES, DE, UK, FR, IT)
- **42 new domain rules** (125 to 167 total): LATAM 14 (Mercado Libre, Falabella, Liverpool, Coppel, etc.), Germany 9 (Otto, Douglas, Thomann, etc.), Korea 8 (Coupang, Yes24, Interpark, etc.), US/Global 7 (Newegg, Wayfair, Nike, etc.), China 1 (JD.com)
- **Report broken site**: pre-filled GitHub issue with hostname (never full URL), MUGA version, browser, active features, and params removed. Available in popup (Advanced mode) and Settings dev tools
- **Report button in URL tester**: opens pre-filled GitHub issue with hostname only for privacy

### Fixes
- **stripAllAffiliates preserves our tag**: `stripAllAffiliates` no longer removes our own affiliate tag when `injectOwnAffiliate` is OFF. The UI says "from other sources", so our tag is now always preserved regardless of injection setting

### Improvements
- **UI consistency**: section names standardized ("Blocked domains: always strip", "Protected tags & domains: never strip", "Custom tracking params: always strip") with matching i18n keys and HTML fallbacks
- **Session history label**: "Recent" renamed to "This session" in popup to clarify ephemeral nature vs lifetime counters
- **Custom params hint**: now includes HTML examples (`mc_cid`, `oly_enc_id`)
- **stripAllAffiliates hint**: updated to "Our tag is always preserved" (removed conditional "when injection is active")
- **Privacy policy synced**: internal (`src/privacy/`) and public (`docs/`) pages updated with storage.session disclosure, Additional features section, stripAll behavior, and correct permissions
- **Persistent logs evaluated and rejected**: debug logs contain domains, paths, and cleaned URLs. Persisting them to `storage.local` would create a de facto browsing history, contradicting privacy commitments. Intentionally kept session-only with a code comment explaining why

### Internal
- 715 passing tests, 0 failures (+109 new)
- 34 export/import tests (new file `tests/unit/export-import.test.mjs`): source verification, `isValidListEntry` extraction, export payload completeness
- 18 Amazon marketplace tests (3 per market: injection, no-replace, no-false-foreign)
- 17 preference interaction matrix tests covering all toggle combinations (inject, stripAll, notify, whitelist, blacklist)
- 18 eBay marketplace tests (3 per market: injection, no-replace, no-false-foreign)
- Health check domain count assertion updated 125 to 167

## [1.8.2] - 2026-03-30

### Fixes (Chrome Web Store rejection)
- **Permission**: `declarativeNetRequest` replaced with `declarativeNetRequestWithHostAccess` (required for redirect-type DNR rules in MV3)
- **Permission**: `tabs` replaced with `activeTab` (narrower scope, all `tab.url` access is user-gesture-triggered)
- **Privacy policy**: public URL at `https://yocreoquesi.github.io/muga/privacy-page.html` for CWS submission

## [1.8.1] - 2026-03-30

### Fixes
- **Amazon ASIN regex**: accept mixed-case ASINs (`[A-Za-z0-9]{10}` instead of `[A-Z0-9]{10}`)
- **Amazon domain regex**: `notamazon.com` no longer matches Amazon rules
- **Content script memory leak**: `_rewriteLog` Map capped at 200 entries
- **MV3 stats flush**: switched from microtask to `setTimeout(50ms)` for service worker reliability
- **getStats error handling**: returns STAT_DEFAULTS on chrome.runtime.lastError
- **Copy handler**: sort URL matches by length descending to prevent partial replacements
- **sendBeacon override removed**: ineffective in MV3 isolated world
- **DuckDuckGo**: removed duplicate `ko`/`kp` in preserveParams
- **Firefox AMO**: removed custom `_sri_browser_polyfill` manifest key (issue #272)

### Domain rules
- **Coupang**: moved `itemId`/`vendorItemId` to stripParams (product ID is in the URL path); added 11 new tracking params (`addtag`, `ctag`, `lptag`, `itime`, `pageType`, `pageValue`, `wPcid`, `wRef`, `wTime`, `redirect`, `mcid`)
- **Danawa**: new domain rule (Korea's largest price comparison site); `go_link_goods.php` redirect wrapper already handled by existing unwrap logic

### Improvements
- Brand name: "MUGA: Clean URLs, Fair to Every Click" (SEO)
- Copy: "stays free" reframed as "support an indie developer"; absolute "never replaces" qualified with "by default"
- Onboarding dark mode `--text2` raised to `#aaa` for WCAG AA contrast
- Added `aria-label` on language select, toast duration select, ToS checkbox, affiliate checkbox
- Hardcoded popup strings (Copied!, Share) replaced with i18n keys
- Merged duplicate `.history-entry` CSS rule
- Removed unused `SESSION_LOG_MAX_BYTES` constant
- MV3 `web_accessible_resources` declared for onboarding/privacy pages
- 606 tests (16 new regression tests)

## [1.8.0] - 2026-03-24

### Features
- **431 tracking parameters** + 13 prefix patterns (utm_, cm_sw_, pd_rd_, pf_rd_, __mk_, hsa_, mt_, int_, ir_, asc_, cv_ct_, scm_, sb-ci-): catches future variants automatically
- **112 domain rules**: added 10 Amazon TLDs (co.jp, com.br, in, com.au, ca, com.mx, nl, pl, se, sg), enriched Facebook (+10 stripParams), Instagram (+4), YouTube/youtu.be (si share token +2)
- **AliExpress aggressive mode**: /item/ pages strip ALL params (item pages need zero params to load)
- **OAuth/auth/payment flow exemption**: paths with /oauth, /authorize, /checkout, /payment, /signin, /sso, /saml are never cleaned
- **Rewrite loop guard**: >3 rewrites on same domain in 2 seconds = bail out, prevents CPU spikes
- **Ping blocking hardened**: MutationObserver watches attribute changes, navigator.sendBeacon neutralized
- **Smart rating nudge**: 200 URLs + 7 days + 3-day cooldown, max 3 sessions, permanent silence after click or ignore
- **Viral share**: dynamic phrases with user's real stats, 8 seasonal easter eggs (Pi Day, May 4th, Halloween, etc.)
- **Milestone titles**: hover on MUGA logo for fun titles based on URLs cleaned (10→First steps, 1000→Tracking Terminator, 10000→Legendary)
- **Landing page** (docs/index.html): SEO meta, OG/Twitter cards, JSON-LD SoftwareApplication
- **Cleaning receipt**: popup shows ALL removed params (no cap)
- **Structured debug logging**: source field (navigation, copy_link, copy_selection, shortcut), domain, path, removed params, clean URL
- **Dev tools**: preview rating nudge with dismiss counter + reset

### Security
- sender.id validation in content script
- navigate() protocol validation (http/https only)
- Redirect loop guard via sessionStorage
- Import entries restricted to printable ASCII
- innerHTML sanitized via tag/attribute allowlist
- INCREMENT_STAT whitelist validation
- OAuth path matching uses regex word boundaries (no false positives)
- web_accessible_resources removed (pages only accessed internally)
- addEntry() validates with isValidListEntry() before saving

### Accessibility
- --text2 contrast WCAG AA (#555/#aaa)
- Focus-visible on all interactive elements
- aria-labels on form inputs and toast buttons
- Confirm dialog focus trap + aria-labelledby
- CSS variables for --success, --toggle-off, --danger in both light/dark

### Copy & UX
- Affiliate hint: "this is how MUGA stays free"
- Context menu: "Copy clean link or selection" (describes full capability)
- Stats hint: explains counter persistence vs session logs
- Affiliate stores moved behind Advanced settings
- GitHub link in popup replaced with Rate MUGA store link
- Store listing: 431 params, 112 domains, MV3 native positioning

### Bug Fixes
- Amazon ref/social_share now stripped (was in preserveParams)
- AliExpress params (tt, afSmartRedirect, gatewayAdapt) now stripped
- Selection copy counts as 1 stat (not N per URL)
- Reset stats no longer re-triggers rating nudge
- _flushStats restores _pendingStats on write failure
- prefsFetchPromise cleared alongside cachedPrefs
- Whitelist/blacklist mutations serialized via queue (race condition fix)

### Internal
- 484 passing tests, 0 failures (+90 new: smoke tests, idempotency, encoding, hash, OAuth, Amazon TLD matrix, security patterns)
- 15 smoke tests covering Google, Amazon, AliExpress, YouTube, Facebook, Twitter, Reddit, LinkedIn, TikTok, Instagram
- Idempotency guarantee: clean(clean(url)) === clean(url)
- DNR resourceTypes assertion (main_frame only)

## [1.7.0] - 2026-03-23

### Features
- **421 tracking parameters**: expanded from 188 to 421 via industry-standard sources, AdGuard URL Tracking Filter 17 (151 params), utm_* prefix match, and Asian/Russian market coverage. 99% parity with AdGuard achieved
- **102 domain-specific rules**: added 24 EU/US domain rules from AdGuard filter 17, plus domain `stripParams` engine for site-specific forced stripping
- **Simplified affiliate toast**: removed "Use ours" button and `allowReplaceAffiliate` toggle. Toast now shows only "Keep it" / "Remove it" / "Dismiss"
- **Enhanced debug log**: structured JSON entries with timestamps, consistent toast preview, configurable toast duration (5–60s)
- **Positioning and UI design document**: added `docs/MUGA-Positioning-UI-Design.md`

### Bug Fixes
- **Amazon `th` param preserved**: product variant selector param was incorrectly stripped
- **Amazon store page params stripped**: `ingress` and `visitId` removed from Amazon URLs
- **Spanish translation for opts_subtitle**: was missing, now included
- **toastDuration validation**: clamped to 5–60 in all code paths
- **Stale JSDoc and README counts**: corrected param and test counts

### Legal
- **Terms of Use finalized**: removed draft status, added EU/GDPR compliance language

### Internal
- 393 passing tests, 0 failures (+112 new tests)
- Tracking param categories: UTM/Campaign, Paid Ads, Email Marketing, Social Media, Platform Noise, Generic

## [1.6.0] - 2026-03-22

### Features
- **"Copy clean links in selection" now handles hyperlinks**: the context menu handler previously only cleaned plain text URLs via `info.selectionText`. It now delegates to the content script, which reads the real DOM selection, collects `href` attributes from all `<a>` elements plus plain URLs from text nodes, cleans each one, and writes the result to clipboard. Falls back to the plain-text approach if the content script is unavailable (#247)
- **History panel - full URL display**: cleaned URLs in the history list no longer truncate with ellipsis. CSS updated to `white-space: normal; overflow-wrap: break-word; word-break: break-all` so long URLs wrap fully (#248)
- **History panel - clipboard icon per entry**: a copy-to-clipboard icon button now appears next to each clean URL in the history list. Click the icon to copy the clean URL; clicking anywhere else on the row still copies as before. Accessibility label corrected (#248, #256)
- **Developer section in Settings**: a new "Developer" section (off by default, toggled via `devMode` preference) exposes four tools (#248):
  - **Preview affiliate notification**: triggers the foreign-affiliate toast on the active tab for testing
  - **Show welcome screen**: re-opens the first-run onboarding page at any time
  - **Export debug log**: downloads a JSON file with `console.error` and `console.warn` entries captured in the active session (up to 200 entries)
  - **URL tester**: paste any URL and see the cleaned result plus which tracking params were removed, using the same `processUrl` logic as live cleaning

### Bug Fixes
- **Dev "Preview notification" button**: was sending `PREVIEW_TOAST` but the content script handler checks for `SHOW_TEST_TOAST`. Button silently did nothing. Fixed (#252, #254)
- **History copy button `aria-label`**: incorrectly set to `"Copied!"` (post-action text) before any action. Changed to `"Click to copy clean URL"` (#253, #256)

### Internal
- 281 passing tests, 0 failures (+20 new tests covering selection URL cleaning logic, URL tester behaviour, and `devMode` default in `PREF_DEFAULTS`)
- Debug log capture: `console.error`/`console.warn` in the service worker are patched to append structured entries to `sessionStorage` under `debugLog` (max 200 entries, cleared on session end)

## [1.5.4] - 2026-03-22

### Bug Fixes
- **Options page crash fixed**: `block-pings`, `amp-redirect`, and `categories-card` elements were missing from `options.html`. `options.js` tried to bind toggles to these non-existent elements, causing `TypeError: Cannot set properties of null (setting 'checked')` on every options page load. All settings were inaccessible (#244)

## [1.5.3] - 2026-03-22

### Bug Fixes
- **Replace toggle hint rewritten**: old text "You always decide, per link" was ambiguous. New text accurately describes the flow: replacement happens via the toast, requires both affiliate injection and notifications to be enabled (#237)
- **Replace toggle dependency**: row now dims and becomes non-interactive when affiliate injection is off, since replacing with our tag makes no sense without injection (#237)
- **Version number now always visible**: moved out of the Statistics card (where it collapsed when empty) to a standalone line above the footer (#237)
- **History panel always opens on click**: clicking "URLs cleaned" was a no-op when session history was empty. Now always opens, showing an empty-state message when no URLs have been processed yet in the current session (#237)

## [1.5.2] - 2026-03-22

### Bug Fixes
- **Toast Allow/Block buttons now work correctly**: the "Allow" and "Block" buttons in the foreign-affiliate toast were storing entries in `param=value` format, which `parseListEntry` treated as a domain name. The entries never matched any real hostname, so the buttons had no effect. Entries are now stored in `domain::param::value` format so the whitelist/blacklist rule fires on subsequent visits (#229)

### Internal
- 261 passing tests, 0 failures (4 new tests covering the #229 bug and its regression guard)

## [1.5.1] - 2026-03-22

### Bug Fixes
- Remove `_sri_browser_polyfill` custom key from `manifest.json`: Chrome MV3 does not allow unrecognized manifest keys and was showing a warning on extension load. The SRI hash is enforced by CI via `tools/verify-polyfill-integrity.mjs` (#227)

## [1.5.0] - 2026-03-22

### Security & Compliance
- **Explicit consent onboarding**: onboarding now requires active acceptance of Terms of Use and Privacy Policy before the extension activates. Affiliate injection is opt-in with a dedicated checkbox; ToS acceptance is mandatory (#224)
- **Terms of Use**: new `src/privacy/tos.html` covering functionality, affiliate model, no-data-collection guarantee, GPL v3 license, and disclaimer
- **`injectOwnAffiliate` default changed to `false`**: affiliate injection is now off until the user explicitly enables it during onboarding. Consent version and timestamp recorded in storage.
- **Manifest description updated**: both MV3 and MV2 manifests now explicitly disclose affiliate injection as required by Chrome Web Store policies (#222)
- **Temu removed from affiliate patterns**: proprietary affiliate program with opaque ToS poses unacceptable legal risk without a verified registered account. Tracking param stripping on temu.com is unaffected (#222)

### Internal
- 257 passing tests, 0 failures
- `consentVersion` and `consentDate` fields added to `PREF_DEFAULTS`

## [1.4.0] - 2026-03-22

### Features
- **130 tracking parameters**: expanded coverage with LinkedIn Ads (`li_fat_id`, `li_extra`, `li_source`), Adobe Analytics (`s_kwcid`, `ef_id`), TikTok Ads (`ttclid`), Microsoft Advertising (`mscid`), Outbrain (`oborigurl`, `outbrainclickid`), Taboola (`taboola_campaign_id`, `tblci`), Criteo (`criteo_id`), Google Ads (`gad_source`), Facebook/Meta (`fbc`, `fbp`), Snapchat (`sccid`), Pinterest (`pin_unauth`), Zemanta (`zemclick`), Klaviyo (`_kx`, `klaviyo_id`), ActiveCampaign (`vgo_ee`), Marketo (`_mkto_trk`), Pardot (`pi_ad_id`, `pi_campaign_id`, `sfdcimpactsrc`), Drip (`dm_i`), Omnisend (`omnisendcontactid`), Sendinblue (`sib_id`), HubSpot query-param forms (`__hstc`, `__hsfp`, `__hssc`), Iterable (`itm_*`), generic ids (`click_id`, `ad_id`, `ab_version`)
- **TRACKING_PARAM_CATEGORIES**: tracking params now organised into 6 named groups (`utm`, `ads`, `email`, `social`, `platform_noise`, `generic`) for per-category display in the options page

### Bug Fixes
- Case-insensitive param lookup in redirect-unwrap: parameters passed as mixed-case no longer bypass the unwrap check (#191)
- AMP redirect detection uses stricter heuristic: prevents false positives on `/trampoline` and similar paths that contain "amp" as a substring (#189)
- Deep subdomain matching in `getPatternsForHost`: `it.aliexpress.com` and other regional subdomains now correctly match their parent domain entry in `AFFILIATE_PATTERNS` (#187)
- Firefox MV2: `chrome.storage.session` ponyfilled with in-memory fallback. Extension no longer crashes on Firefox where `storage.session` is not available (#184)

### Improvements
- README rewritten for v1.4.0: real param counts (130), real store count (19), real test count (244), real domain-rules count (54); Contributing section now calls out `domain-rules.json` and `TRACKING_PARAM_CATEGORIES` as contribution points
- Domain-rules coverage expanded to 54 sites: added Renfe, Iberia, Idealista, Fotocasa, Marca, AS, RTVE, 20minutos, El Mundo, El País, BBC, CNN, NYT, Office.com, and others

### Internal
- Test suite at 244 passing tests, 0 failures (#193 #196 #197 #198 #199)
- `getSupportedStores()` helper filters AWIN network entry from UI lists: avoids displaying a domain-less pattern as a store

## [1.3.0] - 2026-03-21

### Added
- **Pre-navigation DNR stripping**: browser-native `declarativeNetRequest` rules strip 89 tracking parameters *before* the page loads, covering address-bar navigation, bookmarks, and external app links. Togglable via Settings → URL Cleaning.
- **Block `<a ping>` tracking beacons**: removes `ping` attributes from links so the browser doesn't send a background tracking request on click. Enabled by default; Settings → Privacy.
- **AMP redirect**: detects Google AMP pages and silently redirects to the canonical article URL. Enabled by default; Settings → Redirect handling.
- **Redirect-wrapper unwrapping**: unwraps common redirect intermediaries (Reddit `out.reddit.com`, Steam `linkfilter/`, and generic `?redirect=`, `?destination=`, `?url=`, `?to=` patterns). Enabled by default; Settings → Redirect handling.
- **Batch URL cleaner**: new "Batch" tab in the popup: paste a block of text with multiple URLs and clean them all at once with a "Copy all" button.
- **Options page - new sections**: URL Cleaning, Privacy, and Redirect handling with individual toggles for all four new features.
- **Amazon extended cleaning**: strips product slug from URLs (`/ProductName/dp/ASIN/` → `/dp/ASIN/`) and locale params (`__mk_es_ES`, `__mk_de_DE`, `__mk_fr_FR`, `__mk_it_IT`, `ie`).

### Fixed
- `declarativeNetRequestFeedback` permission removed from manifest (was declared but never used).
- AMP redirect now requires canonical URL to be `https:` before redirecting (prevents accidental http downgrade).
- `tracking-params.json` corrected to top-level JSON array (Chrome DNR requirement).
- DNR `action.redirect` structure corrected: `queryTransform` must nest under `transform`.
- Inactive affiliate stores no longer shown in options page or popup when no `ourTag` is configured.
- Copy-clean (Ctrl+C and context menu) no longer injects our affiliate tag into copied URLs.
- Toast auto-dismiss navigates to clean URL instead of original.

### Security
- Toast rendering hardened with `escHtml()` to prevent XSS via malicious affiliate param values.
- Options page list rendering migrated from `innerHTML` to `createElement` + `textContent`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-03-19

### Added
- **Custom tracking params**: users can add their own parameter names to strip on every site (options page, new section above Blacklist)
- **Clean URLs embedded in copied text**: when copying any text that contains a dirty URL, MUGA cleans the URL(s) in-place and leaves all surrounding text intact (Ctrl+C / copy event)
- **Right-click "Copy clean link" on selected text**: in addition to the existing link context menu, right-clicking on a text selection now shows "MUGA: Copy clean link"; mixed selections (text + URL) are handled the same way as Ctrl+C
- **Session history in popup**: last 5 cleaned URLs shown as a collapsible "Recent" section at the bottom of the popup
- **Browser language auto-detection**: on first install, MUGA picks up the browser's UI language (`chrome.i18n.getUILanguage()`) instead of always defaulting to English; no extra permissions required; manual override in settings always takes precedence
- **15 new tracking parameters**: Pinterest (`e_t`, `epik`), Snapchat (`sc_channel`, `sc_country`, `sc_funnel`, `sc_segment`, `icid`), Reddit (`rdt_cid`), Rakuten (`ranmid`, `raneaid`, `ransiteid`), TradeTracker (`ttaid`, `ttrk`, `ttcid`), Google Shopping (`srsltid`), WickedFire (`wickedid`)
- **8 new affiliate stores**: Temu, Zalando ES/DE, SHEIN, Fnac ES/FR, MediaMarkt ES/DE
- **Per-domain disable**: add `domain::disabled` to the blacklist to make MUGA completely ignore a domain (no params stripped, no affiliate injected)
- **`Strip all affiliate parameters` toggle** in options: strips every known affiliate param on every site, overriding injection
- **Import / Export settings**: export all preferences to a JSON file; import to restore or migrate between browsers/profiles
- **Statistics section** in options: shows current version, URL count, junk removed, referrals spotted; reset button clears all counters
- **Tab badge**: action icon badge shows how many tracking params were stripped on the current tab; resets on navigation
- **Keyboard shortcut** `Alt+Shift+C`: copies the clean URL of the current tab to the clipboard without opening the popup
- **URL preview in popup**: shows the before/after of the current tab's URL, or "✓ This page is already clean"

---

## [1.1.0] - 2026-03-19

### Added
- **Clean URL on copy (Ctrl+C)**: when the user selects a URL as text on any page and copies it, MUGA strips tracking parameters before the text reaches the clipboard. Respects the `injectOwnAffiliate` setting: if affiliate injection is enabled, our tag is added to the copied URL too. No toast is shown on copy.
- **Clean URL on context menu copy**: "Copy clean link" already respected `injectOwnAffiliate`; now consistent with Ctrl+C behaviour.

### Fixed
- GitHub Actions release workflow: use wildcard `*.zip` when renaming build artifacts. web-ext generates `muga_make_urls_great_again-X.Y.Z.zip`, not `muga-X.Y.Z.zip`
- GitHub Actions release workflow: add `permissions: contents: write` so the workflow can create GitHub Releases

---

## [1.0.1] - 2026-03-19

### Fixed
- Strip Amazon path-based tracking (`/ref=.../session-id`) after the ASIN in product URLs
- Add missing Amazon query params: `_encoding`, `content-id`, `ref_`, `pd_rd_i`

---

## [1.0.0] - 2026-03-18

### Added
- **First-run onboarding**: new tab on first install with transparent explanation of what MUGA does, two opt-in/opt-out toggles (affiliate injection and foreign affiliate notification), and an honest disclaimer about what MUGA will never do
- **Blacklist/whitelist enforcement**: entries saved in the options page are now enforced during URL processing:
  - Domain-only blacklist entry → strips all params from that domain (Scenario D)
  - Specific `domain::param::value` blacklist entry → strips that exact affiliate
  - Whitelist entries → protect a trusted affiliate from detection or modification
- **i18n system**: EN/ES language toggle in settings; all UI strings (popup, options, toast) fully translated to English and Spanish; language stored in `chrome.storage.sync`
- **Expanded tracking parameter coverage**: added YouTube `si`, eBay `mkevt`/`mkcid`/`mkrid`/`campid`, AliExpress `aff_trace_key`/`algo_expid`/`algo_pvid`, Amazon internal noise (`linkCode`, `linkId`, `ascsubtag`), Impact Radius `irgwc`, CJ `cjevent`, Tradedoubler `tduid`, Microsoft `ocid`, TikTok `_r`. Total 50+ tracked parameters
- **Supported stores panel** in options page: shows all affiliate-enabled stores with status dot (green = active, grey = pending)
- **Privacy policy page** (`src/privacy/privacy.html`): accessible from the options footer; covers data handling, permissions, affiliate disclosure, and open source transparency
- **GitHub Actions release workflow**: pushes to `v*` tags trigger automated unit tests + Chrome and Firefox `.zip` builds, published as a GitHub Release
- **eBay** affiliate pattern added to the database
- **"Use ours" button in toast**: now correctly shown only when `allowReplaceAffiliate` is on and our affiliate tag is configured
- **CSP compliance**: removed all inline `onclick` handlers from options page; extension now passes strict Content Security Policy

### Changed
- All TRACKING_PARAMS entries normalised to lowercase (lookup was already case-insensitive; entries were inconsistent)
- Popup and options pages now use `type="module"` scripts
- Toast in content script now renders in user's selected language

### Fixed
- `linkCode` and other camelCase tracking params were not being stripped (case normalisation bug)

---

## [0.1.2] - 2026-03-18

### Added
- Unit test suite (`npm test`): 27 tests covering URL processing logic
- Browser manual test page (`npm run test:serve` → `http://localhost:5555`)
- `"type": "module"` in `package.json`

### Changed
- `web-ext-config.cjs`: exclude `tests/` from extension bundle

---

## [0.1.1] - 2026-03-18

### Fixed
- **Critical:** `src/lib/cleaner.js` was missing. Service worker crashed on load
- **Navigation**: content script ignored `target="_blank"` and modifier keys
- **Navigation**: `e.stopImmediatePropagation()` was breaking SPA router handlers

### Added
- `src/lib/cleaner.js`: `processUrl(rawUrl, prefs)` with full URL processing logic

---

## [0.1.0] - 2026-03-18

### Added
- Initial extension codebase (Chrome MV3 + Firefox MV2)
- Tracking parameter removal (UTM, fbclid, gclid, msclkid, Mailchimp, 30+ params)
- Affiliate injection when no tag present (Scenario B)
- Foreign affiliate detection with 5-second toast (Scenario C)
- Blacklist/whitelist UI in options (storage only)
- Popup with stats counters and global toggles
- Context menu "Copy clean link"
- `chrome.storage.sync` for cross-device sync
- MIT License, README

[Unreleased]: https://github.com/yocreoquesi/muga/compare/v1.15.1...HEAD
[1.15.1]: https://github.com/yocreoquesi/muga/compare/v1.15.0...v1.15.1
[1.15.0]: https://github.com/yocreoquesi/muga/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/yocreoquesi/muga/compare/v1.13.7...v1.14.0
[1.13.7]: https://github.com/yocreoquesi/muga/compare/v1.13.6...v1.13.7
[1.13.6]: https://github.com/yocreoquesi/muga/compare/v1.13.5...v1.13.6
[1.13.5]: https://github.com/yocreoquesi/muga/compare/v1.13.4...v1.13.5
[1.13.4]: https://github.com/yocreoquesi/muga/compare/v1.13.3...v1.13.4
[1.13.3]: https://github.com/yocreoquesi/muga/compare/v1.13.2...v1.13.3
[1.13.2]: https://github.com/yocreoquesi/muga/compare/v1.13.1...v1.13.2
[1.13.1]: https://github.com/yocreoquesi/muga/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/yocreoquesi/muga/compare/v1.11.0...v1.13.0
[1.12.0]: https://github.com/yocreoquesi/muga/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/yocreoquesi/muga/compare/v1.10.2...v1.11.0
[1.10.2]: https://github.com/yocreoquesi/muga/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/yocreoquesi/muga/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/yocreoquesi/muga/compare/v1.9.10...v1.10.0
[1.9.10]: https://github.com/yocreoquesi/muga/compare/v1.9.9...v1.9.10
[1.9.9]: https://github.com/yocreoquesi/muga/compare/v1.9.8...v1.9.9
[1.9.8]: https://github.com/yocreoquesi/muga/compare/v1.9.7...v1.9.8
[1.9.7]: https://github.com/yocreoquesi/muga/compare/v1.9.6...v1.9.7
[1.9.6]: https://github.com/yocreoquesi/muga/compare/v1.9.5...v1.9.6
[1.9.5]: https://github.com/yocreoquesi/muga/compare/v1.9.4...v1.9.5
[1.9.4]: https://github.com/yocreoquesi/muga/compare/v1.9.3...v1.9.4
[1.9.3]: https://github.com/yocreoquesi/muga/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/yocreoquesi/muga/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/yocreoquesi/muga/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/yocreoquesi/muga/compare/v1.8.2...v1.9.0
[1.8.2]: https://github.com/yocreoquesi/muga/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/yocreoquesi/muga/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/yocreoquesi/muga/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/yocreoquesi/muga/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/yocreoquesi/muga/compare/v1.5.4...v1.6.0
[1.5.4]: https://github.com/yocreoquesi/muga/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/yocreoquesi/muga/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/yocreoquesi/muga/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/yocreoquesi/muga/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/yocreoquesi/muga/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/yocreoquesi/muga/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/yocreoquesi/muga/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/yocreoquesi/muga/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/yocreoquesi/muga/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/yocreoquesi/muga/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yocreoquesi/muga/compare/v0.1.2...v1.0.0
[0.1.2]: https://github.com/yocreoquesi/muga/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/yocreoquesi/muga/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yocreoquesi/muga/releases/tag/v0.1.0
