# Changelog

All notable changes to MUGA will be documented in this file.

## [Unreleased]

### Added
- Popup now headlines a count celebration when MUGA cleans a URL: "MUGA removed N trackers from this URL", with a one-shot pulse animation on the digits (gated by `prefers-reduced-motion: no-preference`). Pluralized via `Intl.PluralRules` so the en/es/pt/de variants stay grammatical. When MUGA evaluates a URL and finds nothing to clean, a quieter "URL was already clean" line surfaces instead — a positive signal that MUGA *checked*, not silence. Built via DOM nodes (no `innerHTML`) so the i18n template stays injection-proof. Three new keys: `preview_count_one`, `preview_count_other`, `preview_count_clean`. (#326)

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

[Unreleased]: https://github.com/yocreoquesi/muga/compare/v1.11.0...HEAD
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
