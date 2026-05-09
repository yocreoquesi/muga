<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.15.1-blue)](#)
[![Tests](https://img.shields.io/badge/tests-2531_pass-brightgreen)](#development)
[![CAPS](https://img.shields.io/badge/CAPS-Basic%20%2B%20Contextual-2ea44f)](CONFORMANCE.md)
# MUGA: Privacy Without Breaking Creator Links

### Install now

[![Firefox](https://img.shields.io/badge/Firefox-Install_from_AMO-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/muga/)
[![Chrome](https://img.shields.io/badge/Chrome-Install_from_CWS-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh)

---

**MUGA strips tracking from every URL, without breaking the affiliate links of the creators who recommended you.** Every other URL cleaner removes `utm_source`, `fbclid`, `gclid`, and the rest. So does MUGA. But every other URL cleaner also strips the affiliate tag of the YouTuber whose video you came from, the newsletter that shared the link, the reviewer who took the time to write the comparison. That tag is how independent creators get paid for the recommendation. **MUGA leaves it alone**, and the popup tells you so, every time, with a "Creator referral preserved" badge. No other URL cleaner does this. None of them can without contradicting their own pitch.

On stores whose affiliate model forces your clicks through external tracking servers, MUGA strips their tracking parameters anyway. We do not believe forcing redirects on users is necessary or fair, and we refuse to collaborate with networks that do.

> **MUGA?** Most URLs Get Abused. **MUGA.** Mercilessly Undoing Garbage Attachments. **MUGA!** Make URLs Genuine Again.

[Privacy policy](https://rules.muga.app/) · [Comparison vs other URL cleaners](https://rules.muga.app/comparison.html) · [Objectives & non-goals](OBJECTIVES.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Maintainer ops docs](docs/ops/README.md)

</div>

---

## How it works

![Before and after URL cleaning](docs/assets/screenshot-ss1-before-after.png)

MUGA intercepts URLs as you browse and strips tracking parameters before the page loads. The result is a shorter, cleaner URL with no tracking noise: your browsing stays the same, minus the surveillance.

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

Settings give you full control: affiliate behavior, per-domain rules, blacklists, whitelists, and advanced features. The UI ships in English and Spanish (officially maintained); Portuguese and German are community-contributed and may have gaps that fall back to English.

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

- Per-domain blacklist: strip everything on a specific site, a single param value (`domain::param::value`), or a param regardless of its value (`domain::param::*`)
- Per-domain disable (`domain::disabled`): opt entire domains out of MUGA
- Whitelist: protect specific creator affiliate tags from detection. Supports `domain::param::value` (one exact value) and `domain::param::*` (any value of that param). A Whitelist match always wins over a Blacklist match for the same parameter
- Custom tracking params: add your own parameter names
- Strip all affiliate parameters (opt-in)
- Strip all third-party affiliate tags (opt-in; our tag is always preserved)
- Toast notification when a third-party affiliate is detected (opt-in)
- **Remote rule updates**: weekly signed updates to the tracking-param list from `rules.muga.app`. **Off by default while the signing infrastructure stabilizes**; the default may flip in a future release, and the [CHANGELOG](CHANGELOG.md) will record the change when it happens. The fetch is a plain GET to a public URL: no user data is sent.
- Export / Import settings as JSON
- Languages: English and Spanish (officially maintained), Portuguese and German (community-contributed; missing entries fall back to English)

### Mode model

MUGA combines two independent toggles — **Honor Creator Mode** and **Privacy Proxy** — into four named operating modes:

| Mode | Honor Creator | Privacy Proxy | What it does |
|------|:---:|:---:|---|
| **Strict Local** | Off | Off | Strips all tracking params locally. No creator-referral preservation. No network requests. Default. |
| **Honor Creator** | On | Off | Strips tracking, but preserves creator referral chains on trusted redirect networks so independent creators get credit for the recommendation. |
| **Privacy Proxy** | Off | On | Strips tracking locally; sends opaque affiliate redirect URLs to `unwrap.muga.app` (a Cloudflare Worker operated by MUGA) to retrieve the final destination. Every response is verified with an Ed25519 signature before navigation. Requires an optional host permission. |
| **Honor + Proxy** | On | On | Full coverage: creator-referral preservation plus proxy-assisted resolution of opaque redirects. Both features active simultaneously. |

Privacy Proxy can be toggled on and off at any time from Settings. Disabling it revokes no permissions automatically — you can remove the host permission from your browser's extension manager if desired.

---

## Affiliate model: the honest version

MUGA is an open-source project maintained by real people. To keep it maintained and improving over time, it uses a simple affiliate model.

When you navigate to a supported store and there is **no existing affiliate tag** in the link, MUGA adds ours. The price you pay is exactly the same. The store just knows you arrived via MUGA. That's how affiliate programs work.

**Not every store is compatible.** We evaluated 10+ affiliate programs from major retailers and marketplaces. All of them require redirect-based tracking: your click passes through an external server before reaching the store. We do not believe forcing users through external tracking servers is necessary or fair. We rejected every one of these programs and chose to give up that revenue rather than compromise your privacy.

**What this means in practice:**
- On compatible stores: if the link has no affiliate tag, MUGA adds ours. If it has someone else's, we leave it alone by default.
- On incompatible stores: MUGA actively strips affiliate tracking parameters (`awc`, `wt_mc`, `lgw_code`, and others) placed by the same redirect networks we refuse to use. When possible, MUGA also unwraps affiliate redirect URLs and sends you directly to the store.

This is explained during onboarding before the feature is enabled, disclosed in the extension description, documented in the [privacy policy](https://rules.muga.app/), and verifiable in the source code.

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

MUGA preserves creator affiliate tags on **6 programs**: Amazon, eBay, Vercel, DigitalOcean, Lemon Squeezy, Apple Performance Partners. The full allowlist lives in the open [CAPS spec](https://github.com/yocreoquesi/caps-spec) so any URL cleaner can claim conformance.

On two of those programs, Amazon (ES, DE, FR, IT, UK, US) and eBay (US, ES, DE, UK, FR, IT), MUGA also has its own affiliate account active. That is where the optional affiliate-injection feature can add MUGA's tag when a link arrives with no tag at all.

Only stores that support direct URL parameter injection are compatible with MUGA. We evaluated and rejected 10+ stores whose affiliate programs require redirect-based tracking, because routing your clicks through external servers would violate our privacy policy.

Affiliate injection is only active on stores where an account is registered and `ourTag` is set in the source.

---

## Installation

**Firefox.** [Install from AMO](https://addons.mozilla.org/firefox/addon/muga/)

**Chrome.** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh)

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
