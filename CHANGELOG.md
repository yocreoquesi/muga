# Changelog

All notable changes to MUGA will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- First-run onboarding flow with explicit affiliate consent
- Blacklist/whitelist enforcement in URL processing logic
- Privacy policy page (required for store submission)
- Store assets: screenshots, promotional tiles, descriptions
- GitHub Actions: automated .zip release on git tag
- Translate popup and options UI to English

---

## [0.1.2] — 2026-03-18

### Added
- Unit test suite (`npm test`) — 27 tests covering URL processing logic
  (Scenario A, edge cases, affiliate param preservation, result shape)
- Browser manual test page (`npm run test:serve` → `http://localhost:5555`)
  with clickable test cases for all currently testable scenarios
- `npm run test:serve` script — serves browser tests via HTTP for Chrome on Windows/WSL
- `"type": "module"` in `package.json` — eliminates Node.js ES module warning

### Changed
- `web-ext-config.cjs` — exclude `tests/` directory from extension bundle

---

## [0.1.1] — 2026-03-18

### Fixed
- **Critical:** `src/lib/cleaner.js` did not exist — service worker imported `processUrl`
  from a missing module, crashing on load and breaking all URL processing
- **Navigation:** content script ignored `target="_blank"` and modifier keys
  (Ctrl/Cmd/Shift+click) — was redirecting the current tab instead of opening a new one.
  Added `navigate(url, newTab)` helper that respects intended open behaviour
- **Navigation:** removed `e.stopImmediatePropagation()` which was blocking SPA router
  click handlers, causing full page reloads instead of client-side navigation.
  `e.preventDefault()` alone is sufficient to intercept browser navigation

### Added
- `src/lib/cleaner.js` — new module exporting `processUrl(rawUrl, prefs)` with full
  URL processing logic: tracking removal, foreign affiliate detection, affiliate injection

---

## [0.1.0] — 2026-03-18

### Added
- Initial extension codebase (Chrome MV3 + Firefox MV2 build)
- Tracking parameter removal: 30+ params including UTM, fbclid, gclid, msclkid, Mailchimp
- Affiliate injection when no tag present (Scenarios A + B)
- Foreign affiliate detection with non-intrusive toast notification (Scenario C)
- Blacklist/Whitelist UI in the options page (storage only — enforcement pending)
- Popup with stats counters and global toggles
- Advanced options page (toggles, blacklist, whitelist)
- Context menu entry: "Copy clean link"
- `chrome.storage.sync` for cross-device preference sync
- MIT License
- README in English with project structure

[Unreleased]: https://github.com/YOUR_USERNAME/muga/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/YOUR_USERNAME/muga/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/YOUR_USERNAME/muga/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/YOUR_USERNAME/muga/releases/tag/v0.1.0
