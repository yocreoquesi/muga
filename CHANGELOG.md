# Changelog

All notable changes to MUGA will be documented in this file.

## [1.0.1] - 2026-03-19

### Fixed
- Strip Amazon path-based tracking (`/ref=.../session-id`) after the ASIN in product URLs
- Add missing Amazon query params: `_encoding`, `content-id`, `ref_`, `pd_rd_i`

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.0.1] — 2026-03-19

### Added
- **Clean URL on copy (Ctrl+C)** — when the user selects a URL as text on any page and copies it, MUGA strips tracking parameters before the text reaches the clipboard. Respects the `injectOwnAffiliate` setting: if affiliate injection is enabled, our tag is added to the copied URL too. No toast is shown on copy.
- **Clean URL on context menu copy** — "Copy clean link" already respected `injectOwnAffiliate`; now consistent with Ctrl+C behaviour.

### Fixed
- GitHub Actions release workflow: use wildcard `*.zip` when renaming build artifacts — web-ext generates `muga_make_urls_great_again-X.Y.Z.zip`, not `muga-X.Y.Z.zip`
- GitHub Actions release workflow: add `permissions: contents: write` so the workflow can create GitHub Releases

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

[Unreleased]: https://github.com/yocreoquesi/muga/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yocreoquesi/muga/compare/v0.1.2...v1.0.0
[0.1.2]: https://github.com/yocreoquesi/muga/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/yocreoquesi/muga/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yocreoquesi/muga/releases/tag/v0.1.0
