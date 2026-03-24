# Changelog

All notable changes to MUGA will be documented in this file.

## [1.8.0] — 2026-03-24

### Features
- **431 tracking parameters** + 13 prefix patterns (utm_, cm_sw_, pd_rd_, pf_rd_, __mk_, hsa_, mt_, int_, ir_, asc_, cv_ct_, scm_, sb-ci-) — catches future variants automatically
- **112 domain rules** — added 10 Amazon TLDs (co.jp, com.br, in, com.au, ca, com.mx, nl, pl, se, sg), enriched Facebook (+10 stripParams), Instagram (+4), YouTube/youtu.be (si share token +2)
- **AliExpress aggressive mode** — /item/ pages strip ALL params (item pages need zero params to load)
- **OAuth/auth/payment flow exemption** — paths with /oauth, /authorize, /checkout, /payment, /signin, /sso, /saml are never cleaned
- **Rewrite loop guard** — >3 rewrites on same domain in 2 seconds = bail out, prevents CPU spikes
- **Ping blocking hardened** — MutationObserver watches attribute changes, navigator.sendBeacon neutralized
- **Smart rating nudge** — 200 URLs + 7 days + 3-day cooldown, max 3 sessions, permanent silence after click or ignore
- **Viral share** — dynamic phrases with user's real stats, 8 seasonal easter eggs (Pi Day, May 4th, Halloween, etc.)
- **Milestone titles** — hover on MUGA logo for fun titles based on URLs cleaned (10→First steps, 1000→Tracking Terminator, 10000→Legendary)
- **Landing page** (docs/index.html) with SEO meta, OG/Twitter cards, JSON-LD SoftwareApplication
- **Cleaning receipt** — popup shows ALL removed params (no cap)
- **Structured debug logging** — source field (navigation, copy_link, copy_selection, shortcut), domain, path, removed params, clean URL
- **Dev tools** — preview rating nudge with dismiss counter + reset

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
- Context menu: "Copy clean link or selection" — describes full capability
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

## [1.7.0] — 2026-03-23

### Features
- **421 tracking parameters** — expanded from 188 to 421 via industry-standard sources, AdGuard URL Tracking Filter 17 (151 params), utm_* prefix match, and Asian/Russian market coverage. 99% parity with AdGuard achieved
- **102 domain-specific rules** — added 24 EU/US domain rules from AdGuard filter 17, plus domain `stripParams` engine for site-specific forced stripping
- **Simplified affiliate toast** — removed "Use ours" button and `allowReplaceAffiliate` toggle. Toast now shows only "Keep it" / "Remove it" / "Dismiss"
- **Enhanced debug log** — structured JSON entries with timestamps, consistent toast preview, configurable toast duration (5–60s)
- **Positioning and UI design document** — added `docs/MUGA-Positioning-UI-Design.md`

### Bug Fixes
- **Amazon `th` param preserved** — product variant selector param was incorrectly stripped
- **Amazon store page params stripped** — `ingress` and `visitId` removed from Amazon URLs
- **Spanish translation for opts_subtitle** — was missing, now included
- **toastDuration validation** — clamped to 5–60 in all code paths
- **Stale JSDoc and README counts** — corrected param and test counts

### Legal
- **Terms of Use finalized** — removed draft status, added EU/GDPR compliance language

### Internal
- 393 passing tests, 0 failures (+112 new tests)
- Tracking param categories: UTM/Campaign, Paid Ads, Email Marketing, Social Media, Platform Noise, Generic

## [1.6.0] — 2026-03-22

### Features
- **"Copy clean links in selection" now handles hyperlinks** — the context menu handler previously only cleaned plain text URLs via `info.selectionText`. It now delegates to the content script, which reads the real DOM selection, collects `href` attributes from all `<a>` elements plus plain URLs from text nodes, cleans each one, and writes the result to clipboard. Falls back to the plain-text approach if the content script is unavailable (#247)
- **History panel — full URL display** — cleaned URLs in the history list no longer truncate with ellipsis. CSS updated to `white-space: normal; overflow-wrap: break-word; word-break: break-all` so long URLs wrap fully (#248)
- **History panel — clipboard icon per entry** — a copy-to-clipboard icon button now appears next to each clean URL in the history list. Click the icon to copy the clean URL; clicking anywhere else on the row still copies as before. Accessibility label corrected (#248, #256)
- **Developer section in Settings** — a new "Developer" section (off by default, toggled via `devMode` preference) exposes four tools (#248):
  - **Preview affiliate notification** — triggers the foreign-affiliate toast on the active tab for testing
  - **Show welcome screen** — re-opens the first-run onboarding page at any time
  - **Export debug log** — downloads a JSON file with `console.error` and `console.warn` entries captured in the active session (up to 200 entries)
  - **URL tester** — paste any URL and see the cleaned result plus which tracking params were removed, using the same `processUrl` logic as live cleaning

### Bug Fixes
- **Dev "Preview notification" button** — was sending `PREVIEW_TOAST` but the content script handler checks for `SHOW_TEST_TOAST`. Button silently did nothing. Fixed (#252, #254)
- **History copy button `aria-label`** — incorrectly set to `"Copied!"` (post-action text) before any action. Changed to `"Click to copy clean URL"` (#253, #256)

### Internal
- 281 passing tests, 0 failures (+20 new tests covering selection URL cleaning logic, URL tester behaviour, and `devMode` default in `PREF_DEFAULTS`)
- Debug log capture: `console.error`/`console.warn` in the service worker are patched to append structured entries to `sessionStorage` under `debugLog` (max 200 entries, cleared on session end)

## [1.5.4] — 2026-03-22

### Bug Fixes
- **Options page crash fixed** — `block-pings`, `amp-redirect`, and `categories-card` elements were missing from `options.html`. `options.js` tried to bind toggles to these non-existent elements, causing `TypeError: Cannot set properties of null (setting 'checked')` on every options page load — all settings were inaccessible (#244)

## [1.5.3] — 2026-03-22

### Bug Fixes
- **Replace toggle hint rewritten** — old text "You always decide, per link" was ambiguous. New text accurately describes the flow: replacement happens via the toast, requires both affiliate injection and notifications to be enabled (#237)
- **Replace toggle dependency** — row now dims and becomes non-interactive when affiliate injection is off, since replacing with our tag makes no sense without injection (#237)
- **Version number now always visible** — moved out of the Statistics card (where it collapsed when empty) to a standalone line above the footer (#237)
- **History panel always opens on click** — clicking "URLs cleaned" was a no-op when session history was empty. Now always opens, showing an empty-state message when no URLs have been processed yet in the current session (#237)

## [1.5.2] — 2026-03-22

### Bug Fixes
- **Toast Allow/Block buttons now work correctly** — the "Allow" and "Block" buttons in the foreign-affiliate toast were storing entries in `param=value` format, which `parseListEntry` treated as a domain name. The entries never matched any real hostname, so the buttons had no effect. Entries are now stored in `domain::param::value` format so the whitelist/blacklist rule fires on subsequent visits (#229)

### Internal
- 261 passing tests, 0 failures (4 new tests covering the #229 bug and its regression guard)

## [1.5.1] — 2026-03-22

### Bug Fixes
- Remove `_sri_browser_polyfill` custom key from `manifest.json` — Chrome MV3 does not allow unrecognized manifest keys and was showing a warning on extension load. The SRI hash is enforced by CI via `tools/verify-polyfill-integrity.mjs` (#227)

## [1.5.0] — 2026-03-22

### Security & Compliance
- **Explicit consent onboarding** — onboarding now requires active acceptance of Terms of Use and Privacy Policy before the extension activates. Affiliate injection is opt-in with a dedicated checkbox; ToS acceptance is mandatory (#224)
- **Terms of Use** — new `src/privacy/tos.html` covering functionality, affiliate model, no-data-collection guarantee, GPL v3 license, and disclaimer
- **`injectOwnAffiliate` default changed to `false`** — affiliate injection is now off until the user explicitly enables it during onboarding. Consent version and timestamp recorded in storage.
- **Manifest description updated** — both MV3 and MV2 manifests now explicitly disclose affiliate injection as required by Chrome Web Store policies (#222)
- **Temu removed from affiliate patterns** — proprietary affiliate program with opaque ToS poses unacceptable legal risk without a verified registered account. Tracking param stripping on temu.com is unaffected (#222)

### Internal
- 257 passing tests, 0 failures
- `consentVersion` and `consentDate` fields added to `PREF_DEFAULTS`

## [1.4.0] — 2026-03-22

### Features
- **130 tracking parameters** — expanded coverage with LinkedIn Ads (`li_fat_id`, `li_extra`, `li_source`), Adobe Analytics (`s_kwcid`, `ef_id`), TikTok Ads (`ttclid`), Microsoft Advertising (`mscid`), Outbrain (`oborigurl`, `outbrainclickid`), Taboola (`taboola_campaign_id`, `tblci`), Criteo (`criteo_id`), Google Ads (`gad_source`), Facebook/Meta (`fbc`, `fbp`), Snapchat (`sccid`), Pinterest (`pin_unauth`), Zemanta (`zemclick`), Klaviyo (`_kx`, `klaviyo_id`), ActiveCampaign (`vgo_ee`), Marketo (`_mkto_trk`), Pardot (`pi_ad_id`, `pi_campaign_id`, `sfdcimpactsrc`), Drip (`dm_i`), Omnisend (`omnisendcontactid`), Sendinblue (`sib_id`), HubSpot query-param forms (`__hstc`, `__hsfp`, `__hssc`), Iterable (`itm_*`), generic ids (`click_id`, `ad_id`, `ab_version`)
- **TRACKING_PARAM_CATEGORIES** — tracking params now organised into 6 named groups (`utm`, `ads`, `email`, `social`, `platform_noise`, `generic`) for per-category display in the options page

### Bug Fixes
- Case-insensitive param lookup in redirect-unwrap — parameters passed as mixed-case no longer bypass the unwrap check (#191)
- AMP redirect detection uses stricter heuristic — prevents false positives on `/trampoline` and similar paths that contain "amp" as a substring (#189)
- Deep subdomain matching in `getPatternsForHost` — `it.aliexpress.com` and other regional subdomains now correctly match their parent domain entry in `AFFILIATE_PATTERNS` (#187)
- Firefox MV2: `chrome.storage.session` ponyfilled with in-memory fallback — extension no longer crashes on Firefox where `storage.session` is not available (#184)

### Improvements
- README rewritten for v1.4.0 — real param counts (130), real store count (19), real test count (244), real domain-rules count (54); Contributing section now calls out `domain-rules.json` and `TRACKING_PARAM_CATEGORIES` as contribution points
- Domain-rules coverage expanded to 54 sites — added Renfe, Iberia, Idealista, Fotocasa, Marca, AS, RTVE, 20minutos, El Mundo, El País, BBC, CNN, NYT, Office.com, and others

### Internal
- Test suite at 244 passing tests, 0 failures (#193 #196 #197 #198 #199)
- `getSupportedStores()` helper filters AWIN network entry from UI lists — avoids displaying a domain-less pattern as a store

## [1.3.0] — 2026-03-21

### Added
- **Pre-navigation DNR stripping** — browser-native `declarativeNetRequest` rules strip 89 tracking parameters *before* the page loads, covering address-bar navigation, bookmarks, and external app links. Togglable via Settings → URL Cleaning.
- **Block `<a ping>` tracking beacons** — removes `ping` attributes from links so the browser doesn't send a background tracking request on click. Enabled by default; Settings → Privacy.
- **AMP redirect** — detects Google AMP pages and silently redirects to the canonical article URL. Enabled by default; Settings → Redirect handling.
- **Redirect-wrapper unwrapping** — unwraps common redirect intermediaries (Reddit `out.reddit.com`, Steam `linkfilter/`, and generic `?redirect=`, `?destination=`, `?url=`, `?to=` patterns). Enabled by default; Settings → Redirect handling.
- **Batch URL cleaner** — new "Batch" tab in the popup: paste a block of text with multiple URLs and clean them all at once with a "Copy all" button.
- **Options page — new sections**: URL Cleaning, Privacy, and Redirect handling with individual toggles for all four new features.
- **Amazon extended cleaning** — strips product slug from URLs (`/ProductName/dp/ASIN/` → `/dp/ASIN/`) and locale params (`__mk_es_ES`, `__mk_de_DE`, `__mk_fr_FR`, `__mk_it_IT`, `ie`).

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

## [1.2.0] — 2026-03-19

### Added
- **Custom tracking params** — users can add their own parameter names to strip on every site (options page, new section above Blacklist)
- **Clean URLs embedded in copied text** — when copying any text that contains a dirty URL, MUGA cleans the URL(s) in-place and leaves all surrounding text intact (Ctrl+C / copy event)
- **Right-click "Copy clean link" on selected text** — in addition to the existing link context menu, right-clicking on a text selection now shows "MUGA: Copy clean link"; mixed selections (text + URL) are handled the same way as Ctrl+C
- **Session history in popup** — last 5 cleaned URLs shown as a collapsible "Recent" section at the bottom of the popup
- **Browser language auto-detection** — on first install, MUGA picks up the browser's UI language (`chrome.i18n.getUILanguage()`) instead of always defaulting to English; no extra permissions required; manual override in settings always takes precedence
- **15 new tracking parameters** — Pinterest (`e_t`, `epik`), Snapchat (`sc_channel`, `sc_country`, `sc_funnel`, `sc_segment`, `icid`), Reddit (`rdt_cid`), Rakuten (`ranmid`, `raneaid`, `ransiteid`), TradeTracker (`ttaid`, `ttrk`, `ttcid`), Google Shopping (`srsltid`), WickedFire (`wickedid`)
- **8 new affiliate stores** — Temu, Zalando ES/DE, SHEIN, Fnac ES/FR, MediaMarkt ES/DE
- **Per-domain disable** — add `domain::disabled` to the blacklist to make MUGA completely ignore a domain (no params stripped, no affiliate injected)
- **`Strip all affiliate parameters` toggle** in options — strips every known affiliate param on every site, overriding injection
- **Import / Export settings** — export all preferences to a JSON file; import to restore or migrate between browsers/profiles
- **Statistics section** in options — shows current version, URL count, junk removed, referrals spotted; reset button clears all counters
- **Tab badge** — action icon badge shows how many tracking params were stripped on the current tab; resets on navigation
- **Keyboard shortcut** `Alt+Shift+C` — copies the clean URL of the current tab to the clipboard without opening the popup
- **URL preview in popup** — shows the before/after of the current tab's URL, or "✓ This page is already clean"

---

## [1.1.0] — 2026-03-19

### Added
- **Clean URL on copy (Ctrl+C)** — when the user selects a URL as text on any page and copies it, MUGA strips tracking parameters before the text reaches the clipboard. Respects the `injectOwnAffiliate` setting: if affiliate injection is enabled, our tag is added to the copied URL too. No toast is shown on copy.
- **Clean URL on context menu copy** — "Copy clean link" already respected `injectOwnAffiliate`; now consistent with Ctrl+C behaviour.

### Fixed
- GitHub Actions release workflow: use wildcard `*.zip` when renaming build artifacts — web-ext generates `muga_make_urls_great_again-X.Y.Z.zip`, not `muga-X.Y.Z.zip`
- GitHub Actions release workflow: add `permissions: contents: write` so the workflow can create GitHub Releases

---

## [1.0.1] — 2026-03-19

### Fixed
- Strip Amazon path-based tracking (`/ref=.../session-id`) after the ASIN in product URLs
- Add missing Amazon query params: `_encoding`, `content-id`, `ref_`, `pd_rd_i`

---

## [1.0.0] — 2026-03-18

### Added
- **First-run onboarding** — new tab on first install with transparent explanation of what MUGA does, two opt-in/opt-out toggles (affiliate injection and foreign affiliate notification), and an honest disclaimer about what MUGA will never do
- **Blacklist/whitelist enforcement** — entries saved in the options page are now enforced during URL processing:
  - Domain-only blacklist entry → strips all params from that domain (Scenario D)
  - Specific `domain::param::value` blacklist entry → strips that exact affiliate
  - Whitelist entries → protect a trusted affiliate from detection or modification
- **i18n system** — EN/ES language toggle in settings; all UI strings (popup, options, toast) fully translated to English and Spanish; language stored in `chrome.storage.sync`
- **Expanded tracking parameter coverage** — added YouTube `si`, eBay `mkevt`/`mkcid`/`mkrid`/`campid`, AliExpress `aff_trace_key`/`algo_expid`/`algo_pvid`, Amazon internal noise (`linkCode`, `linkId`, `ascsubtag`), Impact Radius `irgwc`, CJ `cjevent`, Tradedoubler `tduid`, Microsoft `ocid`, TikTok `_r` — total 50+ tracked parameters
- **Supported stores panel** in options page — shows all affiliate-enabled stores with status dot (green = active, grey = pending)
- **Privacy policy page** (`src/privacy/privacy.html`) — accessible from the options footer; covers data handling, permissions, affiliate disclosure, and open source transparency
- **GitHub Actions release workflow** — pushes to `v*` tags trigger automated unit tests + Chrome and Firefox `.zip` builds, published as a GitHub Release
- **eBay** affiliate pattern added to the database
- **"Use ours" button in toast** — now correctly shown only when `allowReplaceAffiliate` is on and our affiliate tag is configured
- **CSP compliance** — removed all inline `onclick` handlers from options page; extension now passes strict Content Security Policy

### Changed
- All TRACKING_PARAMS entries normalised to lowercase (lookup was already case-insensitive; entries were inconsistent)
- Popup and options pages now use `type="module"` scripts
- Toast in content script now renders in user's selected language

### Fixed
- `linkCode` and other camelCase tracking params were not being stripped (case normalisation bug)

---

## [0.1.2] — 2026-03-18

### Added
- Unit test suite (`npm test`) — 27 tests covering URL processing logic
- Browser manual test page (`npm run test:serve` → `http://localhost:5555`)
- `"type": "module"` in `package.json`

### Changed
- `web-ext-config.cjs` — exclude `tests/` from extension bundle

---

## [0.1.1] — 2026-03-18

### Fixed
- **Critical:** `src/lib/cleaner.js` was missing — service worker crashed on load
- **Navigation:** content script ignored `target="_blank"` and modifier keys
- **Navigation:** `e.stopImmediatePropagation()` was breaking SPA router handlers

### Added
- `src/lib/cleaner.js` — `processUrl(rawUrl, prefs)` with full URL processing logic

---

## [0.1.0] — 2026-03-18

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

[Unreleased]: https://github.com/yocreoquesi/muga/compare/v1.6.0...HEAD
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
