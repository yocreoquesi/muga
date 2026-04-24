<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.9.10-blue)](#)
[![Tests](https://img.shields.io/badge/tests-1471_pass-brightgreen)](#development)
# MUGA: Clean URLs, Fair to Every Click

### Install now

[![Firefox](https://img.shields.io/badge/Firefox-Install_from_AMO-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/muga/)
[![Chrome](https://img.shields.io/badge/Chrome-Install_from_CWS-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh)

---

URLs arrive pre-loaded with `utm_source`, `fbclid`, `gclid`, e-commerce noise, share tokens, and 450+ more. MUGA strips them automatically, before the page renders. **We clean tracking, but we respect referrals. By default, we never touch what isn't ours.** On stores whose affiliate model forces your clicks through external tracking servers, we strip their tracking parameters too -- we do not believe that forcing redirects on users is necessary or fair, and we refuse to collaborate with networks that do.

> **MUGA?** Most URLs Get Abused. **MUGA.** Mercilessly Undoing Garbage Attachments. **MUGA!** Make URLs Genuine Again.

[Privacy policy](https://yocreoquesi.github.io/muga/) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## How it works

![Before and after URL cleaning](docs/assets/screenshot-ss1-before-after.png)

MUGA intercepts URLs as you browse and strips tracking parameters before the page loads. The result is a shorter, cleaner URL with no tracking noise — your browsing stays the same, minus the surveillance.

<details>
<summary><strong>More examples</strong></summary>

**E-commerce**: link from a video review
```
Before: https://www.amazon.es/dp/B08N5WRWNW?utm_source=google&gclid=EAIaIQ...&linkCode=ll1&pd_rd_r=xyz&pf_rd_p=def&ref_=nav

After:  https://www.amazon.es/dp/B08N5WRWNW
```

**Video**: shared from mobile
```
Before: https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789

After:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Marketplace**: from a newsletter
```
Before: https://www.ebay.es/itm/123456789?mkevt=1&mkcid=1&mkrid=1185-53479-19255-0&campid=5338722076

After:  https://www.ebay.es/itm/123456789
```

</details>

---

## What it strips

**459 tracking parameters** across 6 categories, on every site:

| Category | Examples |
|---|---|
| UTM / Campaign | `utm_source`, `utm_medium`, `utm_campaign` + 6 more |
| Paid Ads | `fbclid`, `gclid`, `msclkid`, `ttclid`, `li_fat_id` + 30 more |
| Email Marketing | `mc_cid`, `_hsenc`, `mkt_tok`, `_mkto_trk`, `_kx` + 20 more |
| Social Media | `igshid`, `igsh`, `epik`, `sc_channel`, `pin_unauth` + 5 more |
| Platform Noise | E-commerce session IDs, click params, marketplace tokens + 25 more |
| Generic | `s_cid`, `wickedid`, and catch-all click IDs |

Domain-specific rules for **167 domains** preserve functional query params (search queries, pagination, filters) while stripping noise.

---

## What you see

The popup shows what MUGA cleaned on the current page: which parameters were removed, and what the URL looks like now.

![Popup showing cleaned URL on a store page](docs/assets/screenshot-ss2-popup.png)

Settings give you full control: affiliate behavior, per-domain rules, blacklists, whitelists, and advanced features. Available in English, Spanish, Portuguese, and German.

![Settings page](docs/assets/screenshot-ss3-options.png)

---

## Features

### Always on, no configuration needed

- Strip 459 tracking params on every navigation (UTMs, fbclid, gclid, share tokens, click IDs, and more)
- Strip e-commerce path noise (`/ref=nav_logo`, session IDs after product ID, product slug, locale params)
- Right-click any link → **Copy clean link**
- **Alt+Shift+C**: copy clean URL of current tab to clipboard
- Badge counter showing params stripped on current tab
- Popup with before/after preview for the current page

### Optional, configured during first setup

- **Pre-navigation cleaning**: browser-native DNR rules strip tracking params *before* the page loads, covering address-bar navigation, bookmarks, and external apps
- **Block `<a ping>` beacons**: prevents background tracking requests on click
- **AMP redirect**: silently redirects AMP pages to the canonical article URL
- **Redirect-wrapper unwrapping**: detects and bypasses intermediary redirect wrappers so you land on the real URL
- **Affiliate injection**: adds our tag when none is present *(you pay the same price; off by default, enabled during onboarding or manually in Settings at any time)*

### Configurable

- Per-domain blacklist: strip everything on a specific site
- Per-domain disable (`domain::disabled`): opt entire domains out of MUGA
- Whitelist: protect specific creator affiliate tags from detection
- Custom tracking params: add your own parameter names
- Strip all affiliate parameters (opt-in)
- Strip all third-party affiliate tags (opt-in; our tag is always preserved)
- Toast notification when a third-party affiliate is detected (opt-in)
- Export / Import settings as JSON
- 4 languages: English, Spanish, Portuguese, German

---

## Affiliate model: the honest version

MUGA is an open-source project maintained by real people. To keep it maintained and improving over time, it uses a simple affiliate model.

When you navigate to a supported store and there is **no existing affiliate tag** in the link, MUGA adds ours. The price you pay is exactly the same. The store just knows you arrived via MUGA. That's how affiliate programs work.

**Not every store is compatible.** We evaluated 10+ affiliate programs from major retailers and marketplaces. All of them require redirect-based tracking -- your click passes through an external server before reaching the store. We do not believe forcing users through external tracking servers is necessary or fair. We rejected every one of these programs and chose to give up that revenue rather than compromise your privacy.

**What this means in practice:**
- On compatible stores: if the link has no affiliate tag, MUGA adds ours. If it has someone else's, we leave it alone by default.
- On incompatible stores: MUGA actively strips affiliate tracking parameters (`awc`, `wt_mc`, `lgw_code`, and others) placed by the same redirect networks we refuse to use. When possible, MUGA also unwraps affiliate redirect URLs and sends you directly to the store.

This is explained during onboarding before the feature is enabled, disclosed in the extension description, documented in the [privacy policy](https://yocreoquesi.github.io/muga/), and verifiable in the source code.

- Only fires when the link has **no affiliate tag at all**
- The tag is added as a standard URL parameter. Nothing hidden, nothing obfuscated.
- **Off by default**: enabled during onboarding or manually in Settings at any time
- Turn it off any time: Settings → toggle off, globally or per domain
- **By default, we never touch what isn't ours**: if a link already has someone else's affiliate tag on a compatible store, MUGA leaves it alone. Replacing requires a separate, deliberate opt-in

---

## Privacy

- Every URL is processed **entirely inside your browser**. MUGA never acts behind your back.
- Zero browsing data collected, zero analytics, zero telemetry
- No account, no sign-in, no cloud
- Minimal permissions: `storage`, `activeTab`, `contextMenus`, `declarativeNetRequestWithHostAccess`, `clipboardWrite`. Nothing else.

---

## Supported stores

2 active affiliate programs across multiple markets (ES, DE, FR, IT, UK, US).

Only stores that support direct URL parameter injection are compatible with MUGA. We evaluated and rejected 10+ stores whose affiliate programs require redirect-based tracking, because routing your clicks through external servers would violate our privacy policy.

Affiliate injection is only active on stores where an account is registered and `ourTag` is set in the source.

---

## Installation

**Firefox** — [Install from AMO](https://addons.mozilla.org/firefox/addon/muga/)

**Chrome** — [Install from Chrome Web Store](https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh)

Or install from source:

```bash
git clone https://github.com/yocreoquesi/muga.git
cd muga && npm install
npm run build:chrome   # → dist/chrome/
npm run build:firefox  # → dist/firefox/
```
Load unpacked from `chrome://extensions` (Developer mode) or `about:debugging` in Firefox.

---

## Development

```bash
npm test               # 964 unit tests
npm run test:e2e       # 37 E2E tests (Playwright, requires headed Chromium)
npm run build:chrome
npm run build:firefox
```

New release: tag `vX.Y.Z` → push → GitHub Actions builds and publishes automatically.

---

## Contributing

PRs welcome for new tracking parameters, new stores, or additional languages. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and conventions.

Key contribution points:

- **New tracking parameters**: add to `TRACKING_PARAMS` and the appropriate `TRACKING_PARAM_CATEGORIES` group in [`src/lib/affiliates.js`](src/lib/affiliates.js)
- **New stores**: add an entry to `AFFILIATE_PATTERNS` in [`src/lib/affiliates.js`](src/lib/affiliates.js)
- **Domain-specific param preservation**: add a rule to [`src/rules/domain-rules.json`](src/rules/domain-rules.json)
- **Tests**: see [`tests/unit/cleaner.test.mjs`](tests/unit/cleaner.test.mjs)

---

## Support

If MUGA saves you time or annoyance, consider supporting it on [Ko-fi](https://ko-fi.com/yocreoquesi). It helps keep the project going.

---

## License

[GPL v3](LICENSE): forks and derivative works must remain open source under the same license.

This project was relicensed from MIT to GPL v3 on 2026-03-22 by the sole copyright holder. All versions, including prior releases, are retroactively covered under GPL v3.

---

*Built with the assistance of AI agents ([Claude](https://www.anthropic.com/claude) by Anthropic).*
