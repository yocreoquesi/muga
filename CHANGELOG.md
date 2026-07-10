# Changelog

All notable changes to MUGA will be documented in this file.

## [Unreleased]

### Features

- **Hover destination preview** (#1028). On desktop, hover and hold a link to see where it really goes, already cleaned. Shown only for links that redirect elsewhere. On by default, fully local, opt-out in Settings > Advanced.

## [2.5.0] - 2026-07-09

Firefox now cleans at the network layer with a CSP-immune wrap, so cleaning works on strict-CSP sites where the previous approach was silently blocked. This release adds per-site control (pause cleaning, an Active Defense toggle, a fully inert allowlist), a popup that explains why each parameter was cleaned, and a weekly remote-rules changelog in Settings. It also fixes several Firefox Xray crashes, hardens the remote-payload affiliate guards, and lands a large tracking-parameter harvest. MUGA's own affiliate injection is now on by default, a deliberate and disclosed step to keep the project sustainable, and you can turn it off during onboarding or any time in Settings with no loss of cleaning or protection.

### Features

- **Pause cleaning per site from the popup** (#995). Turn MUGA off for the current domain without disabling it globally.
- **Active Defense toggle** (#1006). The page-facing defense layer (window.name defuser, history defuser, DOM link rewriting) can be turned off per install from Advanced settings when it breaks a site.
- **Allowlisted domains are fully inert** (#1011). An allowlisted or per-site-paused domain is now exempt across both the JS content scripts and the DNR layer, not just partially.
- **"Why was this cleaned?" in the popup** (#986). Each stripped parameter shows an inline, per-category explanation of what it was.
- **Weekly remote-rules changelog in Settings** (#984). Shows the "N added / N removed" diff of the signed rule list after each refresh.
- **Versioned settings schema** (#992). A single validated import/export path built on a versioned schema.
- **Settings import previews a dry-run diff before applying** (#994). After validating the file, MUGA shows exactly what will change and applies nothing until you confirm.
- **Round-trip and granular import errors** (#993). `remoteRulesEnabled` now round-trips through export and import, and a failed import tells a corrupt or unreadable file apart from one that is not a MUGA export.

### Changed

- **MUGA's own affiliate injection is now on by default** (#1032). On a few supported stores, MUGA adds its own referral only to links that carry no affiliate tag at all, and it never replaces anyone else's. Your price never changes. You can turn it off during onboarding or any time in Settings, and cleaning and every protection keep working exactly the same. This is a deliberate, disclosed choice to keep an independent project sustainable as it grows, and it leaves the decision with you. Existing users are not changed: the new default applies only to fresh installs, and anyone who already completed onboarding keeps the setting they chose.

### Fixed

- **Firefox: URL cleaning at the network layer, CSP-immune** (#1022). Firefox now strips tracking params via a blocking `webRequest` listener and wraps `history` via `wrappedJSObject`, so cleaning is no longer silently blocked by a strict page Content-Security-Policy (e.g. large retailers). Core cleaning on Chrome is unaffected.
- **Firefox: searchParams Xray crash fixed** (#1009). Content-side `processUrl` no longer throws on Xray-unwrapped `searchParams` iterators.
- **Firefox: CSP-immune window.name defuser** wrap on MV2.
- **Tracking params stripped from relative anchor hrefs** (#1012).
- **Whitelist / pause exempts the active-defense scripts** (#1008), so a broken site can be unbroken without fully disabling MUGA.
- **Bounce-tracking storage wipe gated on a curated redirector allowlist** (#1025).
- **DNR remote-param stripping scoped to `main_frame`** with host and origin denied, preventing over-broad application.
- **Domain-conditioned DNR strip instead of a global drop** (#1020).
- **Settings and onboarding hardening**: import hardened against gate bypass and desync (#970); onboarding-tab dedup across service-worker cold starts (#972); copy actions no longer inflate stats or duplicate history/ledger (#971); fresh-install remote-rules disclosure copy corrected (#973).

### Security

- **Remote payloads cannot strip affiliate attribution** (#1016, #1019). The affiliate guard is extended (including `cjevent`) so a signed remote rule list can never remove creator attribution params.

### Rules

- **Large tracking-parameter harvest** from AdGuard and ClearURLs with a corroboration/triage classifier (#998, #1015, #1018, #1021, #1023), plus signed remote params v7 (#1017). Domain-scoped preserve rules keep functional query keys intact.

### Docs

- **Privacy, transparency and FAQ pages corrected** to state that remote rules are on by default, to disclose the Firefox `webRequest` permissions, and to note that the weekly signed fetch exposes only the client IP (never logged or stored). The website was redesigned under a shared design system.

## [2.4.0] - 2026-07-03

Cleaning now follows same-document navigation, copy/share never leaks a tag, a per-tab badge shows what was stripped, and a settings reorganization plus a July audit wave hardens consent gating, accessibility, and Chrome path cleaning. Affiliate composition (remove-theirs then add-ours) now extends to Bookshop's path-based creator wrappers.

### Features

- **Cleaning on same-document (SPA) navigation** (#951). On-site banner clicks and other `history.pushState`/`replaceState`, `popstate`, and `hashchange` navigations never hit the network, so DNR never saw them and the one-shot self-clean did not re-run. These in-page navigations now re-run the full pipeline, so path rules (Amazon `/ref=`) and domain-scoped params (`aref`) are stripped instead of surviving.
- **Copy-safe URLs on every copy/share surface** (#946). Copying or sharing a link now yields a tracking-stripped, unwrapped URL that never carries MUGA's own affiliate tag, while third-party creator tags are preserved. Navigation-time injection is unchanged.
- **Per-tab tracking-param badge** (#910). The toolbar icon shows a running count of tracking params stripped for the active tab (native badge text, behind a `showBadge` pref, default on).
- **"Update now" for remote rules** (#954). Settings can force an immediate signed remote-rules fetch, bypassing the 7-day cadence.
- **Amazon internal-nav and SEO-slug cleaning on Chrome** (#916, #903). Scoped DNR rules strip Amazon internal-navigation tracking tags and the SEO path slug on direct Chrome navigation.
- **Settings reorganization** (#936, #925, #948). Reworked the Settings information architecture: stable controls surfaced, power-user and experimental toggles consolidated behind Advanced (fixing the inverted gate that hid stable options while exposing experimental ones), and the remote-rules section relocated.

### Security

- **Remote rule updates enabled by default** (#888). The weekly client-side fetch of the Ed25519-signed tracking-param list from `rules.muga.app` (`src/lib/remote-rules.js`) now defaults to on, activating the self-scaling ingestion pipeline (EPIC C, #780–#785) for all installs. Readiness was ratified against evidence: signing infrastructure running in production, freshness/regression guards (#738), and full defense-in-depth coverage (verify → denylist → affiliate-guard → preserve-collision → freshness → version-regression) under test. The fetch remains a single HTTPS GET at most once per 7 days, `credentials: "omit"`, `cache: "no-store"`, carrying no user data. Disable it any time in Settings.
- **Remote-params DNR rule and shortener egress gated on consent** (#907 family). The dynamic remote-params DNR rule is now cleared when the consent gate closes, and live shortener-resolution network egress is blocked unless the extension is both enabled and onboarded.
- **Affiliate-redirect unwrapping gated on consent** (#907, #919, #920, #945). Affiliate-redirect hosts are no longer unwrapped before consent; `runRedirectUnwrap` is hardened against affiliate-redirect hosts.
- **Remote-rules ingestion hardened against empty-params version poisoning**. A payload whose params all dedupe to empty can no longer persist a bad version that blocks later updates.
- **Onboarding/privacy/ToS styles externalized** (#901). Inline `<style>` removed so the extension-pages CSP keeps `style-src 'self'`.

### Fixed

- **Path and domain-scoped cleaning were dead at runtime on Chrome** (#951, #955). Content scripts could not fetch their rule JSON on Chrome MV3 (the files were missing from `web_accessible_resources`), so path stripping (`/ref=`) and domain-scoped params (`aref`) silently no-op'd on every content-script navigation. The rule files are now web-accessible in both manifests and threaded into all content-script call sites. This is not a permission and adds no install/update warning.
- **Guarded privacy prefs now display and persist** (#952). Settings could show a guarded pref (e.g. remote rules) as off despite its default and the fetch running; the onboarding↔settings read/write path is reconciled.
- **Settings import respects the list cap** (#911, #912). Valid entries imported over the list cap are kept instead of rejecting the whole import.
- **Accessibility: localized aria-labels and AA contrast** (#930, #931, #932, #933). Consent-gate and control `aria-label`s are now translated; diff-strip contrast raised to meet WCAG AA.
- **`www` host regex escaped** (#934). Prevents partial-host matches (e.g. `wwwshop.com`) in landing-policy and affiliate host matching.
- **Own affiliate tag resolved by hostname** (#906), not against the pattern map object.
- **AliExpress redirect-network landing family preserved on item pages without referrer** (#885).
- **Onboarding shortener description renders bold** (#944); notify hint no longer hardcodes a duration (#929); `bindToggle` guards against missing elements (#927).

### Changed

- **"Remove all affiliate tags from other sources" now composes with tag injection.** When both that toggle and MUGA's own-tag injection are enabled, a foreign tag is stripped and ours is then injected into the now-tagless URL (remove theirs, then add ours), matching the toggle's label. Previously injection was suppressed whenever remove-all was on. With injection off, remove-all still leaves the link with no affiliate tag. Supersedes the earlier #353 guard; the two settings are independent, explicit opt-ins.
- **Path-based affiliate composition on Bookshop** (#959). The remove-all + inject composition now also covers Bookshop's path-based `/a/{creator}/` creator wrappers. With remove-all on, the foreign creator wrapper is unwrapped to its destination; if injection is also on and the destination is a product page, MUGA's affiliate is then added. Storefront (`/shop/`) pages are never touched, and Honor Creator Mode still preserves the creator wrapper untouched. Cross-origin embedded destinations are refused (no open redirect).
- **Copy rebranded around URL-cleaner DNA** (#953). User-facing copy makes the URL-cleaning purpose explicit, Spanish copy is peninsular (Castilian), Allowlist/Blocklist terminology, and em-dashes removed.

### Ruleset pipeline (infrastructure)

- Expanded the self-scaling ingestion pipeline that feeds `rules.muga.app`: `discovered/` receiver with Ed25519 verification (#787), three-arm corroboration gate combining entropy and cross-site-frequency (#798), ClearURLs gap reporting / moat-expansion (#793), and a corpus-driven false-positive/false-negative harness for `processUrl` (#890). These change which params can be promoted upstream, not the installed extension's behavior directly.

## [2.3.0] - 2026-06-10

Self-scaling ruleset pipeline (EPIC C, ingestion from ClearURLs + AdGuard) and a 25-issue June 2026 audit wave covering security, parity, robustness, and quality infrastructure.

### Features

- **Self-scaling ruleset pipeline (EPIC C, #780–#782, #785 family)**. Clean-room ingestion from ClearURLs and AdGuard with corroboration, affiliate-safety, canary, and functional-bias gates. Auto-merge for pass-all candidates; quarantine surface with full exclusion accounting (#782). Scheduled self-contained CI ingestion workflow (#781). Ed25519-signed promotion into the remote-rules source (#780).

### Security

- **Consent gate now covers all DNR rulesets** (#810). `amp_redirect` and `wrapper_unwrap` were active before the user completed onboarding consent. Both rulesets are now gated on consent and the `ampRedirect`/`unwrapRedirects` pref toggles actually control the DNR layer.
- **Nonce-validated `muga:history-gate` events** (#811). Cross-world event listeners now require a handshake nonce — pages can no longer spoof the defuser gate.
- **Workflow hardening** (#812). PR-body injection escaping, SHA-pinned actions, line-by-line PEM masking, bot identity enforcement in ingestion CI.
- **Settings-import param validation** (#818). Imported remote-rules params are now validated against the canonical 64-char limit and denylist rules.
- **SSRF ranges extended + landing security headers** (#830). CGNAT and TEST-NET ranges added to SSRF blocklist; landing worker now ships security headers; SECURITY.md added.

### Fixed

- **Amazon SubTag and Impact/Partnerize click IDs no longer stripped** (#794). `ascsubtag` (Amazon Associates sub-publisher attribution), `irclickid`/`irgwc` (BestBuy via Impact Radius) and `clickref` (Coolblue via Partnerize) left every strip list; the ingestion gate gained a static preserve source so upstream lists can never auto-merge them back. The #816 contamination-guard allowlist is now empty.
- **Inline styles migrated to CSS; `style-src 'unsafe-inline'` dropped** (#858). All 22 inline style attributes in the options page moved to classes; the extension-pages CSP no longer allows inline styles, with a guard test preventing regression.
- **Firefox MV2 wrapper_unwrap parity** (#820). `wrapper_unwrap` DNR ruleset declared in `manifest.v2.json` — pre-navigation unwrapping now works on Firefox.
- **Shortener stat lost-update race** (#817). `incrementShortenerStat` now uses a pending-flush batch to avoid concurrent-write data loss.
- **AliExpress `aff_request_id` contradiction** (#816). Removed from `aliexpress` `stripParams` — it is a required landing param, not a tracking param.
- **fr/it/ja toast translations + popup count animation** (#819). Missing locales restored; count-one `<span>` celebration animation fixed.
- **Bounce-state latch re-arm + listener once-guard** (#832). Latch re-arms correctly after a navigation; event listener registered with `once: true` to prevent duplicate firings.
- **Single-flight rules loaders** (#833). Concurrent rule-fetch calls are now deduplicated; `firstUsed` and migrations moved out of the hot path.
- **Latent data-shape guards** (#831). Specificity, duplicates, origin-normalization, and anchoring guards added to rule processing.

### Robustness

- **Ingestion adapter timeouts + per-adapter isolation** (#813). A silent upstream outage no longer produces a deceptively green scheduled run; each adapter is independently isolated with a fetch timeout.
- **Pipeline boundary hardening** (#821). Atomic writes, promote-side validation, markdown escaping, no-shell exec in ingestion pipeline.

### Quality

- **Release publishing gated on integration + E2E** (#814). `release.yml` now requires integration and E2E suites to pass before store artifacts are built.
- **Affiliate commission-preservation invariant** (#815). End-to-end STRIP coherence guards and redirect-URL pass-through invariant pinned in tests.
- **Coverage tooling + baseline** (#822). `node --test --experimental-test-coverage` script added; CI uploads coverage artifact.
- **TypeScript checkJs + ESLint flat config** (#823). `jsconfig.json` + `eslint.config.mjs` introduced; 5 real bugs caught at introduction.
- **Source-grep ratchet** (#824). Tombstone cleanup and flaky-vector fixes; ratchet enforces no-regression on source-level invariants.
- **PR gate decoupled from live Worker** (#825). Integration stub suite runs on every PR; live Worker contract runs on `main` pushes only.

### Architecture

- **`affiliates.js` and `storage.js` split into focused modules** (#826). Acyclicity and export-parity guards enforce module boundaries going forward.
- **Test fixtures stripped from store artifacts** (#827). `strip-test-seams.mjs` ships an inert stub; test-only fixtures never reach the extension bundle.
- **i18n split into per-locale modules** (#834). `TRANSLATIONS` object extracted into one file per locale for tree-shaking and maintainability.
- **Docs drift fixed with machine-enforced claims tests** (#828). README/CONTRIBUTING claims validated against code at CI time.
- **ADR-0005 + living architecture map** (#783, #784). The rule-scaling pipeline's architecture and moat/legal rationale documented as ADR-0005 with an ADR index; `CONTEXT.md` added as the path-guarded living system map.

## [2.2.0] - 2026-06-01

Beta release (2.2.0-beta.1) completing ADR-0004 phase 4: native shortener resolution becomes the default path; the proxy remains as fallback.

### Features

- **ADR-0004 phase 4: native shortener default** (#700). `useNativeShortenerResolution` flips from `false` to `true` in `PREF_DEFAULTS` — native in-browser `fetch(redirect:"manual")` is now the primary path for the eight generic shorteners. The `unwrap.muga.app` proxy remains as a fallback when native resolution fails (host permission denied or fetch error). No proxy code removed (phase 5 / #701).
- **Per-shortener pass/fail counters** (#700). `shortenerStats: { "bit.ly": { pass: N, fail: N }, … }` held in `chrome.storage.local`, never transmitted. Incremented at the native-resolution callsite in the service worker. Exposed via `getShortenerStats()` / `incrementShortenerStat()` in `src/lib/storage.js`.
- **Advanced-settings counter display** (#700). Dev-mode-gated card in the Options page shows per-shortener pass/fail counts. DOM built with `createElement` + `textContent` (no `innerHTML` for dynamic data). Refreshes on each options page open.

### Changed

- **Beta version 2.2.0-beta.1**: `package.json` version = `"2.2.0"` (numeric); `src/manifest.json` and `src/manifest.v2.json` carry `version_name: "2.2.0-beta.1"` for human-readable display in Chrome / Firefox extension management pages. Chrome extension `version` field remains numeric-only as required by the store.

## [2.1.0] - 2026-05-27

The denoise pivot release. MUGA repositions from creator-only to creator-agnostic denoise: redirect-attribution networks (Awin, Impact, Rakuten, TradeTracker, …) are now pass-through, the per-landing param-preservation policy honors each network's matrix-required attribution params, the "Privacy Proxy" surface is rebranded to "URL Unwrapper", and the audit-tier rules engine consolidates to a v2 manifest with declarative path rules. See [ADR-0002](docs/adr/0002-denoise-pivot-creator-agnostic.md) for the full strategic rationale and [ADR-0003](docs/adr/0003-awin-redirect-model-resolution.md) for the redirect-network resolution model.

### Architecture

- **Declarative path rules** (#625). `cleanAmazonPath()` and `isBookshopPathReferral()` retired from `src/lib/cleaner.js`. The Amazon path-strip (4 regex passes) and Bookshop creator-referral + own-affiliate injection now live in `src/rules/path-strip-rules.json` and `src/rules/path-affiliate-rules.json`, consumed by a new pure module `src/lib/path-rules.js` with WeakMap-cached compiled regex. Adding a new path-based retailer is a single JSON entry. Rules manifest bumped to v2 (`path_strip_rules` + `path_affiliate_rules` first-class keys; v1 `path_rules: []` placeholder retired). Observable behavior is identical.

### Tooling

- **CI drift gate for `src/rules/`** (#626). Every PR runs `npm run compile:rules` and `git diff --exit-code -- src/rules/` — any hand-edit or forgotten compile is caught loudly with an actionable error message. Covers `tracking-params.json`, `rules-manifest.json`, and any future generated file by construction. To make a clean diff achievable, the manifest's two volatile fields (`generatedAt`, `generator`) are removed; they had zero consumers and the sync unit test already masked them.

### Fixed

- **Content-script bugs in click rewriter + bounce-state Awin race** (#703). Three closely-related defects: (1) `src/content/dom-link-rewriter.js` and `dom-link-rewriter-click.js` read `out.url` after calling the bundled `processUrl(raw)`, but the bundled API returns `cleanUrl`. The branch never fired and the full 459-pattern cleaner was bypassed at click time (DNR still caught most cases on navigation). (2) `src/content/bounce-state-cleaner.js` still had `awin1.com` in its inline WRAPPERS table — missed in #684's pass-through retirement — and would wipe Awin localStorage during the race window before the bundle attaches. (3) Added an `INLINE_AFFILIATE_REDIRECT_NETWORKS` mirror + runtime guard inside `inlineDetectWrapper` so any future re-add of an affiliate-redirect host to WRAPPERS gets short-circuited. Two new structural test files (9 cases) pin the invariants at CI time.

### Security

- **Defense-in-depth polish bundle** (#631). Five small audit findings, each S effort, each non-critical, all increasing auditability. (1) `content_security_policy` in both `src/manifest.json` (MV3) and `src/manifest.v2.json` now declares `worker-src 'self'`, `default-src 'self'`, `connect-src 'self' https://rules.muga.app https://unwrap.muga.app`, and `style-src 'self' 'unsafe-inline'` explicitly. `worker-src` and `default-src` were implicit via the `script-src` fallback before; `connect-src` and `style-src` are required alongside `default-src 'self'` to preserve existing behavior — `default-src` cascades into every fetch-type directive that isn't explicitly set, so `connect-src` keeps fetches to MUGA's own `rules.muga.app` (remote-rules sync) and `unwrap.muga.app` (URL Unwrapper + healthz) working, and `style-src 'self' 'unsafe-inline'` keeps the extension's inline `style="..."` attributes (used throughout `options.html`, `popup.html`, and `onboarding.html`) from being silently dropped. (2) `mergeIntoCache()` in `src/lib/remote-rules.js` now throws if the `accepted` array exceeds `MAX_PARAM_COUNT` — explicit guard rather than relying on the caller's prior `validateRemotePayload()` (defense-in-depth against a future caller wiring the function differently). (3) `renderList()` in `src/options/options.js` caps DOM rendering at 1000 entries — silent truncation prevents UI bloat from a corrupted or hostile `chrome.storage.sync` state. (4) New onboarding paragraph (`ob_browser_sync_note`, 7 locales) clarifies that `chrome.storage.sync` is browser-native sync (Google for Chrome, Firefox Accounts for Firefox), not MUGA telemetry — a privacy-paranoid user could otherwise misread the existing onboarding copy. (5) `src/popup/popup.js` consent gate now uses `document.body.replaceChildren(gate)` instead of `document.body.innerHTML = ""` + `appendChild` — same effect, scanner-friendly intent, avoids the HTML-parser detour.

### Fixed

- **Content-script legacy unwrap no longer defeats #684 / #693 pass-through** (#695). `src/content/cleaner.js`'s `AFFILIATE_REDIRECT_PARAMS` map — gated on `prefs.unwrapRedirects` (default `true`) — was still client-side-unwrapping `awin1.com` (via `?ued=`) and `ad.admitad.com` (via `?ulp=`) at DOMContentLoaded, even though both hosts had been moved into `AFFILIATE_REDIRECT_NETWORKS` for pass-through. The content script never reached the network's 30x, so the merchant's first-party attribution cookie (`awc` / `wt_mc` for Awin, `admitad_uid` / `tagtag_uid` for Admitad) never got populated at landing — silently breaking creator commissions. Both hosts are now retired from the legacy map alongside `alitems.com`, `clk.tradedoubler.com`, and `redirect.viglink.com`; only `shareasale.com` (a true wrapper) remains. A new regression test (`tests/unit/content-unwrap-no-affiliate-redirect.test.mjs`) asserts no `AFFILIATE_REDIRECT_NETWORKS` host can ever appear in the legacy map again.

### Changed

- **Tradedoubler retired from content-script legacy unwrap; promoted into the matrix** (#695). `clk.tradedoubler.com` joins `AFFILIATE_REDIRECT_NETWORKS` for pass-through, and `REDIRECT_NETWORK_PATTERNS` gains a Tradedoubler entry with `tduid` declared as `landingParams` — the same shape as the other 9 matrix v1.0 networks. `tduid` is removed from `TRACKING_PARAMS` and the `TRACKING_PARAM_CATEGORIES.affiliate_click_ids` mirror so it can survive on the merchant landing. New affiliate-harness fixture covers G1+G3 end-to-end.
- **`alitems.com` and `redirect.viglink.com` declared pass-through** (#695). Per the matrix's bias toward preservation, both move into `AFFILIATE_REDIRECT_NETWORKS` even though their full per-network matrix entries are still pending (next quarterly review). The legacy content-script unwrap that previously local-extracted their `?ulp=` / `?u=` is retired.

### Performance

- **Cleaner hot-path micro-optimisations** (#629). `getDomainParamSets` now consults a `Map(domain → rule)` index instead of scanning the entire `domainRules` array (~167 entries today) on every call — lookup is bounded by the hostname's suffix count (3–4 probes typical). Affiliate-pattern Set construction is cached per host: `getAffiliateParamSetForHost(hostname)` returns the same Set on repeated calls, eliminating ~3 redundant Set allocations per `processUrl`. The service-worker no longer eagerly fetches `domain-rules.json` at startup; the load is deferred to the first `PROCESS_URL` message (the existing `_domainRulesReady` gate already handles on-demand load + retry). Per-call savings are modest individually but compound across the cleaner's main pipeline. The fourth win listed in the issue (`URL.searchParams.clear()` on AliExpress item pages) was DEFERRED — its premise no longer holds after #657 added the landing-policy preserve gate inside that branch, and the resulting "clear-then-restore-preserved" shape is not cleaner than the current single-pass loop.

### Added

- **Regression tests for three documented behaviour contracts** (#630). `tests/unit/cleaner-test-gaps.test.mjs` pins (a) the honor-creator × stripAllAffiliates precedence — honor wins when both are set and the referrer matches, including the host-precise allowlist boundary (subdomain `m.youtube.com` does NOT match a bare `youtube.com` entry; path prefix `@foobar` does NOT match `@foo`), (b) wrapper-engine recursion depth bounds — 10-level pathological nesting terminates at default `maxHops=3` and respects custom overrides, with malformed-inner-extract behaviour also pinned, and (c) the param-classifier `_skipBoundedScope` short-circuit — ambiguous params (`pid`, `icid`, `CMP`, …) survive on wrapper / affiliate-redirect hosts even when an anchor tracker co-occurs, and conversely fall under the bounded-scope strip on regular merchant hosts. 13 new tests; no production code changed for #630.

### Changed

- **Retired the local-unwrap path for three more redirect-attribution networks** (#692, ADR-0003 follow-up). Impact Radius (`*.pxf.io`), Rakuten LinkShare (`click.linksynergy.com`), and TradeTracker (`tc.tradetracker.net`) join Awin (#684) in the pass-through bucket: each id is added to `MUGA_EXCLUDED_IDS` in `src/lib/wrapper-engine.js` and each host is declared in `AFFILIATE_REDIRECT_NETWORKS` in `src/lib/opaque-networks.js`. The membership check now supports a wildcard suffix primitive (`*.pxf.io`) that matches any subdomain but not the bare apex — mirrors the resolver in `affiliates.js`. `detectWrapper` gains an early pass-through guard so an affiliate-redirect host is never claimed by the generic-wrapper fallback even when its query string happens to carry `?u=`. The Rakuten DNR wrapper rule is removed (5 wrapper rules total, was 6). `bounce-state-cleaner.js` no longer detects the three hosts as intermediaries — their localStorage stays intact during the network's redirect step. The synthetic affiliate-harness drops `pending_resolution` from the three fixtures and G1 now enforces for all 9 matrix v1.0 networks.

### Added

- **Per-network regression coverage for landing-policy preservation** (#657). The synthetic affiliate-flow harness now ships an end-to-end G3 that calls `getLandingPolicy(landing_host, referrer)` and `processUrl(...)` for every network in the matrix, asserting matrix-required params survive while tracking noise strips. Six new fixtures cover Partnerize, Admitad, A8.net, Impact Radius, Rakuten LinkShare, and TradeTracker (the last three are flagged `pending_resolution` for the G1 surface-inversion follow-up to [ADR-0003](docs/adr/0003-awin-redirect-model-resolution.md), but G3 enforces today because the policy function resolves all networks via `REDIRECT_NETWORK_PATTERNS`). Existing Awin / CJ / AliExpress fixtures drop their `blocked_on:#655` annotations now that the audit has shipped.

### Fixed

- **AliExpress item-page wholesale strip now honours landing-policy preserve** (#657). The fast path in `classifyAndStripTracking` that strips ALL query params on `/item/<id>.html` URLs previously ignored the per-landing preservation policy, killing `aff_trace_key` and the `algo_*` family on first-touch from `s.click.aliexpress.com` before the AliExpress front-end tag could consume them. The branch now respects `landingPolicy.preserve` in addition to the existing domain-rules preserveParams set.

### Changed

- **Retired the local-unwrap path for a redirect-attribution network** (#684, [ADR-0003](docs/adr/0003-awin-redirect-model-resolution.md)). The wrapper-engine entry that previously short-circuited `awin1.com/cread.php` and `/awclick.php` has been removed; the host is now declared in `AFFILIATE_REDIRECT_NETWORKS` so the browser follows the network's 30x and the merchant's first-party tag can populate the attribution cookie at landing. The MUGA-side exclusion lives in a new `MUGA_EXCLUDED_IDS` filter in `src/lib/wrapper-engine.js` — upstream `caps-spec` is unchanged. Cleaner's contextual-rule short-circuit (#543) extended to also cover `AFFILIATE_REDIRECT_NETWORKS` so the bounded-scope strip no longer fires on the network's own redirect page. DNR rule count drops from 7 to 6, synthetic harness fixture clears its `pending_resolution` annotation, and 3 new wrapper-engine tests assert the retirement.

### Added

- **`getLandingPolicy(hostname, referrer)` per-landing preservation gate** (#656) in `src/lib/cleaner.js`. When `document.referrer` matches a redirect-network host declared in `REDIRECT_NETWORK_PATTERNS`, the function returns the matrix-required preservation Set for that network; the cleaner's strip pass honours it so the merchant's tag can read its attribution params on first-touch landings before any cleanup runs. Returns an empty no-op policy when the referrer is null, same-origin, or unknown — default strip behaviour unchanged. Exposed on `window.__mugaCleaner.getLandingPolicy` via the content-script bundle. 23 new unit tests cover each of the 9 matrix v1.0 networks, defensive referrer parsing, and the `processUrl` integration. Active stripping on subsequent same-site navigations is deliberately deferred — the matrix biases toward preservation, and the synthetic harness should cover the first-touch → second-nav flow end-to-end before that ships.

### Changed

- **Tracking-param strip lists now respect matrix v1.0 attribution requirements** (#655). The universal strip list, the UI category mirrors, and the network-layer DNR rules previously included a set of click identifiers that the per-network attribution matrix declares as `required-at-landing`. Stripping them at the network layer killed the merchant's first-party cookie write before the conversion tag could fire. Those identifiers are now sourced exclusively from `REDIRECT_NETWORK_PATTERNS.landingParams` in `src/lib/affiliates.js` and excluded from `TRACKING_PARAMS`, every `TRACKING_PARAM_CATEGORIES.*.params` bucket, and `src/rules/tracking-params.json`. The per-landing policy that decides preserve-vs-strip on a per-page basis ships in `getLandingPolicy(hostname, referrer)` (#656); until then, the params travel through the URL untouched on first-touch and on subsequent navigations alike. A new regression test in `tests/unit/redirect-network-patterns.test.mjs` enforces the three-way invariant. 21 params removed from the strip surface; matrix-mapped to 9 redirect networks.

## [2.1.0] - 2026-05-25

Evolution of the 2.0 denoise positioning. 2.0 redefined the north — quiet every URL without taking credit from creators. 2.1 extends that north to creators who chose redirect-based attribution: their click is the attribution event, and MUGA now respects it instead of treating it as a redirect to defeat. The result is one coherent stance — fair to every creator, whatever affiliate model they chose — backed by code, tests, docs, and the matrix that drives the per-network policy.

### Changed

- **Creator-agnostic affiliate stance** ([ADR-0002](docs/adr/0002-denoise-pivot-creator-agnostic.md)). Where 2.0 deliberately rejected redirect-based affiliate programs as a privacy-first principle, 2.1 treats them as a legitimate attribution mechanism. Affiliate-redirect networks are now in `AFFILIATE_REDIRECT_NETWORKS` (`src/lib/opaque-networks.js`) — the cleaner preserves the redirect untouched so the network's 30x can populate the merchant's first-party cookie at landing. Generic URL shorteners stay in `GENERIC_SHORTENERS` and remain eligible for the URL Unwrapper.
- **URL Unwrapper rename** (#658) — "Privacy Proxy" → "URL Unwrapper" across the UI, all 7 locales, the options page, the disclosure tooltip, and the inline content-script CTA strings. PT and DE FIXME stubs were resolved as part of the rename. The disclosure now states explicitly that affiliate redirects are NEVER sent to the Worker.
- **URL Unwrapper client allowlist tightened** (#659, part) — `src/background/service-worker.js` UNWRAP_VIA_PROXY handler now gates on `isGenericShortener(hostname)` instead of the legacy `OPAQUE_NETWORKS` union. Affiliate-redirect hosts are rejected client-side with `reason:"invalid_url"` so the click reaches the network unchanged. Server-side enforcement on `unwrap.muga.app` lives in the `muga-unwrap` repo and is tracked separately.
- **`OPAQUE_NETWORKS` split into semantic buckets** (#653) — the legacy union remains exported for backwards compat, but new code reads `GENERIC_SHORTENERS` / `AFFILIATE_REDIRECT_NETWORKS` / `PENDING_VERDICT` so the caller's intent (shortener vs affiliate redirect) is explicit at the call site. `amzn.to` sits in `PENDING_VERDICT` awaiting the G3/T19 probe verdict (#665, sub-bullet).
- **Store listings rewritten** (#660) — Chrome Web Store and Firefox AMO listings retagged with the lead headline "Shorter, cleaner URLs — fair to every creator." The 2.0-era anti-redirect sections ("We rejected 10+ affiliate programs because they require redirect-based attribution") were deleted in both listings; the affiliate-model section now explicitly covers BOTH tag-based programs and redirect-based affiliate networks. URL Unwrapper disclosure rewritten with honest scope (generic shorteners only, list enumerated). Third-party retailer brand names removed after Chrome Web Store flagged the 2.0 list as keyword spam (rejection routing ID FZSL, 2026-05). Char counts: Chrome short 121/132, Firefox summary 200/250.

### Added

- **`REDIRECT_NETWORK_PATTERNS` + helpers** (#654) — 9 redirect-network entries in `src/lib/affiliates.js` (Awin, CJ, AliExpress, Impact, Partnerize, Admitad, A8.net, Rakuten/LinkShare, TradeTracker) plus three helpers (`getRedirectNetworkPatterns`, `getRedirectNetworkForRedirectHost`, `getLandingParamsForReferrer`). Introduces a wildcard host primitive (`*.<host>`) for suffix-matching subdomains — currently only Impact's `*.pxf.io` uses it. 34 new unit tests pin the data and the wildcard semantics.
- **Affiliate networks attribution matrix v1.0** (#646, #647, #648, #649) at [`docs/affiliate-networks-matrix.md`](docs/affiliate-networks-matrix.md). Per-network surface, click flow, attribution mechanism, cookie TTL, param table, recommended cleaner policy, and verification status — across all 9 redirect networks the codebase recognises. This doc is the contract that drives `getLandingPolicy()` (#656), the `TRACKING_PARAMS` audit (#655), the synthetic harness (#650), and the URL Unwrapper allowlist (#659).
- **`docs/adr/0002-denoise-pivot-creator-agnostic.md`** (#645) — the ADR that captures the pivot's context, decision, alternatives, consequences, and the full Fase 5 surface inventory.
- **`docs/unwrap-observability.md`** (#651) — design for non-PII aggregate observability on `unwrap.muga.app` (counts only, no per-request data), plus the privacy-policy delta required to ship the endpoint. Implementation tracked in #652.
- **Synthetic affiliate-flow test harness MVP** (#650) at [`tests/integration/affiliate-harness.test.mjs`](tests/integration/affiliate-harness.test.mjs). Fixture-driven contract test for tier-1 networks (Awin, CJ, AliExpress). Three guards: G1 redirect-host pass-through (HARD), G2 tracking-noise stripped at landing (HARD), G3 attribution params preserved at landing (skipped pending the #655 audit). Per-network summary table at end of run. Runs on every PR via `npm run test:integration`. Companion doc at [`docs/affiliate-test-harness.md`](docs/affiliate-test-harness.md). Tier-2 and tier-3 networks (Impact, Partnerize, Admitad, A8.net, Rakuten, TradeTracker) follow the same fixture shape — adding any is a single JSON edit.

### Known known-unknowns

- **`amzn.to` bucket verdict** — Amazon's branded shortener sits in `PENDING_VERDICT` until G3/T19 probes confirm whether `?tag=` survives the 30x. If yes → moves to `GENERIC_SHORTENERS`. If no → moves to `AFFILIATE_REDIRECT_NETWORKS` and exits the URL Unwrapper allowlist permanently.
- **Awin redirect model conflict** (#681, surfaced by #680) — `awin1.com` is currently a wrapper-engine local-unwrap (the redirect carries the merchant URL in `?p=`), but the matrix recommends pass-through with referrer-based preservation of `awc`/`wt_mc`. Design decision pending; harness skips G1 for Awin via the `pending_resolution` escape hatch until the model is resolved.

## [2.0.0] - 2026-05-24

Major release. Headline: full brand pivot from "privacy-first URL cleaner" to "the denoise extension for the web." Six-commit, multi-phase rebrand covering visual identity, voice, all 7 supported locales, public surfaces, and a strategic retirement of the local-first claim and competitor-comparison apparatus. Internal behaviour is unchanged — this is a positioning, voice, and visual layer change.

### Changed

- **Brand positioning** pivoted from privacy-first ("Privacy Without Breaking Creator Links" / "Fair to Every Click") to denoise / clean-browsing experience ("MUGA — The denoise extension for the web" / "The web, with the noise turned down" / "Fair to creators · nice to you · honest about both"). Affiliate framing now leads with "Creators come first — we don't take credit from people who earned it." instead of the previous defensive "we deliberately rejected 10+ stores" lead.
- **Visual identity** — replaced amber accent palette (`#B8862C` / `#8C651F` / `#F5EBD3`) with violet (`#6A2BCF` / `#5318B5` / `#EFE6FB`) across popup, options, onboarding, landing page, docs site, brand-asset generator, screenshot mock-ups and promo tiles. Replaced the moth glyph with a landscape M-arrow brand mark (`src/icons/muga-mark.svg` + square source `tools/brand/muga-mark-square.svg`); regenerated 16 / 48 / 128 PNG icons; de-tiled `.brand-mark` and `.logo-mark` backgrounds. Darkened `--text-3` from `#76747F` to `#6E6C78` so WCAG AA 4.5:1 holds against all three new light surfaces (the design's value was tuned for `--surface-1` only).
- **Copy across the extension** — 26 i18n keys retagged in English (`stat_junk`, `domain_stats_label`, `tooltip_cleaned`, `ob_tagline`, `ob_step1_title`, `ob_feat1`/`2`/`3`, `ob_affiliate_desc`, `ob_cta_btn`, `ob_success_title`, `row_dnr_label`, `row_amp_label`, `row_pings_label`, `row_toast_duration_label`, `opts_subtitle`, `preview_count_*`, `dev_url_clean`, milestones, and others) — and propagated to es / pt / de / fr / it / ja with a consistent glossary (noise → ruido / ruído / Rauschen / bruit / rumore / ノイズ; denoise → reducir el ruido / tirar o ruído / entrauschen / réduire le bruit / togliere il rumore / ノイズを除去). HTML fallback text in `popup.html` / `options.html` / `onboarding.html` synced to the new EN values (enforced by `i18n-integrity.test.mjs`).
- **Public surfaces** — `README.md`, `docs/store-listing.md` (CWS + AMO sections), `docs/index.html`, `docs/faq.md`, `docs/comparison.html`, `docs/transparency.html`, `landing/index.html`, `tools/brand-assets.html`, manifest descriptions, and `package.json` description all retagged to the new voice. The 4 mascot PNGs (`mascot-cartoon.png`, `mascot-icon-m.png`, `mascot-pixel.png`, `mascot-realistic.png`) were removed; `docs/assets/muga-mark.svg` was added as the canonical brand mark.
- **`docs/transparency.html` "at-a-glance" table** — the absolute claim "Data sent anywhere: None. Not even to us." was softened to "Only what you opt into. By default nothing leaves your browser. Optional Remote rule updates and Privacy Proxy make HTTPS GETs only when you explicitly enable them in Settings." A new "Analytics / telemetry" row commits firmly to "None. No analytics, no telemetry, no usage reporting. We have no plans to add any."

### Removed

- **`docs/comparison.html` and its entire benchmark apparatus**. Under the new voice, single-axis comparison ("we preserve creator tags, they don't") reads defensive and the popup's "Creator referral preserved" badge already demonstrates the wedge in-product. Removed: the page itself, `tools/generate-comparison-benchmark.mjs`, the full `tests/benchmark/` tree (corpus, competitor adapters, runner, lib, reports), `scripts/refresh-competitor-snapshots.mjs`, 9 benchmark / comparison unit tests, two CI steps that regenerated and checked the page, and three npm scripts (`benchmark`, `benchmark:refresh-competitors`, `benchmark:update-comparison-page`). The README's comparison block (table + 9 footnotes) was also removed.
- **"100% local" / "zero data sent" / "never sends data" claims** from headlines, store listings, manifests, landing, mockup templates and promo generators. Under the denoise voice these claims (a) lose argumentative weight — denoise users do not decide on local-first — and (b) constrain the roadmap, since the existing optional `rules.muga.app` Remote rule updates and `unwrap.muga.app` Privacy Proxy already make HTTPS GETs when enabled. The firm commitment that remains: **no analytics, no telemetry, no account, no sign-in.**

### Tests

- Test count dropped from 3 861 to 3 730 — exactly the 131 tests that lived under `tests/benchmark/` and `tests/unit/benchmark-*.test.mjs`. All remaining suites pass. The README badge floor in `version-consistency.test.mjs` re-derives from actual `test()` call sites so the badge does not have to be hand-counted on each release.
- A11y contrast regression test (`tests/unit/a11y-contrast.test.mjs`) updated to check against the new violet surface tokens (`#FAFAFB`, `#FFFFFF`, `#F3F2F5`) instead of the retired amber surfaces.

## [1.17.0] - 2026-05-23

Maintenance release. Headline: two more release-pipeline hygiene fixes — per-install Chrome ruleset cache and the ESM bundle source were both leaking into every shipped zip — alongside the Steam Curator attribution support and the CWS upload-error handling already pending on `main`.

### Fixed

- **Chrome Web Store release pipeline silently masking upload failures** (#616). The CWS upload API returns HTTP 200 with an `itemError` array in the body when it rejects an upload — `release.yml` was only checking the HTTP status code, so every release from v1.13.4 through v1.16.0 reported "All store submissions succeeded" while CWS actually rejected the package with `PKG_INVALID_ZIP` or `ITEM_NOT_UPDATABLE`. Chrome users stayed on v1.13.3 for over a week before the regression was caught manually. Fixes the upload + publish steps by delegating response parsing to `scripts/cws-check-response.mjs`, which inspects the body for `itemError` regardless of HTTP status and only treats `ITEM_NOT_UPDATABLE` as a no-op when the `error_detail` actually confirms the version is unchanged. Adds 17 unit tests covering the real response shapes seen in the failing runs.
- **Firefox MV2 manifest leaking into the Chrome bundle** (#616). `manifest.v2.json` is build-time machinery used by `scripts/with-firefox-manifest.sh` to swap manifests during the Firefox build — it does not belong inside either bundle. Extended `--ignore-files` in both `build:chrome` and `build:firefox` to exclude it.
- **Per-install Chrome ruleset cache and ESM bundle source leaking into shipped zip** (#643). web-ext's CLI `--ignore-files` REPLACES the config's `ignoreFiles` array — it does not merge. Every release zip since `web-ext-config.mjs` was introduced shipped two unwanted artefacts: `_metadata/generated_indexed_rulesets/_ruleset{1,2,3}` (Chrome's per-installation DNR cache, regenerated on first load, ~12 KB) and `content/cleaner-bundle-src.mjs` (the ESM source whose `import` statements MV3 content scripts can't load). Moved the full ignore list onto the `build:chrome` / `build:firefox` CLI calls in `package.json` and added a top-of-file warning comment on `web-ext-config.mjs` explaining the shadowing. The config still keeps a `_metadata/**` glob because `web-ext run` (dev) does honor it — without it, Chrome rewriting the rulesets on every load creates a 2 Hz reload loop that makes the popup and onboarding flash unusably. Adds `tests/integration/release-zip-hygiene.test.mjs` which opens the latest `dist/{chrome,firefox}/*.zip` and fails on either pattern, so the regression can't sneak back in.

### Added

- **Steam Curator attribution preservation** (#614). Adds an explicit `steampowered.com` entry to `src/rules/domain-rules.json` preserving `curator_clanid` — the query param Steam uses to surface a curator's recommendation card inline on the store page. Steam Curator is functionally analogous to the Bookshop `/a/{id}/` creator-referral pattern shipped in #612: non-monetary, but real attribution value (analytics, follower-conversion surfacing). Subdomain-aware match covers `store.steampowered.com` automatically. Out of scope: Steam's internal nav telemetry (`snr`, host-emitted `utm_*`) and MUGA-own curator injection — see the issue for the rationale.

## [1.16.0] - 2026-05-11

Feature release. Headline: full Bookshop.org affiliate support — both creator-referral preservation (`/a/{id}/` and `/shop/{slug}` entry paths) and MUGA's own affiliate injection on unattributed product pages. Out-of-band escape hatch authorised by caps-spec#46 itself. Also bundled: three additional opaque redirector hosts (lnkd.in, fb.me, ebay.to), a live end-to-end integration test against the production Worker contract, and a toolbar polish (drop icon variant + per-tab junk badge counter).

### Added

- **3 new opaque redirector hosts** in `src/lib/opaque-networks.js` (#607 batch 3): `lnkd.in` (LinkedIn share tracker), `fb.me` (Facebook universal shortener), `ebay.to` (eBay branded shortener). All three verified STANDARD redirect shape (server-side 30x with `Location` header) via curl probe on 2026-05-09. Same pattern as v1.15.0's bit.ly / tinyurl.com / prf.hn / px.a8.net / amzn.to additions.
- **Worker allowlist entries** for the same three hosts in [muga-unwrap](https://github.com/yocreoquesi/muga-unwrap) (`src/lib/allowlist.ts`) shipped first per AD-05 cross-repo merge order, with matching tests in `muga-unwrap/tests/allowlist.test.ts`.
- **Extension unit tests** in `tests/unit/opaque-networks.test.mjs`: per-host inclusion assertions plus a corrective negative assertion that `aliexpress.us` is NOT in the list (probe verdict 2026-05-09: apex `.us` TLD redirect, not a shortener).
- **End-to-end integration test** `tests/integration/proxy-client-contract.test.mjs` (#608) — calls the live production Worker at `unwrap.muga.app` with an extension-shaped request and verifies the signed envelope round-trip. Wired into CI as `npm run test:integration`. Catches contract drift of the kind that caused the v1.14.0 → v1.15.1 silent failure (path drift, param-shape drift, public-key drift).
- **Bookshop.org affiliate support** (#603, caps-spec#46 deferred). Bookshop's affiliate attribution lives in the path and sets a session cookie at entry — there is no `?aff=` query param ever. Two entry shapes are covered: `/a/{id}/...` (creator referral, requires trailing slash) and `/shop/{slug}` (storefront, terminal). The cleaner detects either entry on `bookshop.org` (and `www.` variant), preserves it intact, and surfaces a top-level `creatorReferralPreserved: boolean` on `processUrl`. The service worker ORs that flag with the existing `preservedAffiliate` check so the standard "Creator referral preserved" toolbar wedge cue fires for both entry shapes. Additionally, when `injectOwnAffiliate` is on, MUGA injects its own `?affiliate=124046` on unattributed `/p/books/...` product URLs — never on `/shop/{slug}` or `/a/{id}/` (those are someone else's attribution) and never when a foreign `?affiliate=` is already present. Out-of-band escape hatch authorised by caps-spec#46 itself; the implementation is deliberately narrow (single-host, two well-known patterns) so caps-spec stays uninflated until a second path-based program lands and the RFC reopen criteria fire.

### Fixed

- **Toolbar icon variant dropped + per-tab badge counter** (commit f6a6e2b). The toolbar now uses a single icon variant and the junk-removed counter is scoped per tab, replacing the previous global-counter behavior that could surface stale numbers when switching tabs.

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

[Unreleased]: https://github.com/yocreoquesi/muga/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/yocreoquesi/muga/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/yocreoquesi/muga/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/yocreoquesi/muga/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/yocreoquesi/muga/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/yocreoquesi/muga/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/yocreoquesi/muga/compare/v1.17.0...v2.0.0
[1.17.0]: https://github.com/yocreoquesi/muga/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/yocreoquesi/muga/compare/v1.15.1...v1.16.0
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
