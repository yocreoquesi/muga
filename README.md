# MUGA — Make URLs Great Again

> You paste a link. It's 400 characters of garbage. MUGA makes it clean, honest, and short. That's it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)
[![Tests](https://img.shields.io/badge/tests-35_pass-brightgreen)](#development)

---

URLs have become a swamp. Every link you share arrives pre-loaded with `utm_source`, `fbclid`, `gclid`, affiliate tags, referral codes, and a dozen other parameters that exist purely to track you. **MUGA drains the swamp.**

The name is intentional. Make URLs Great Again. You get it.

---

## Before / After

Real examples of what MUGA does automatically, every time you click a link:

**Amazon product**
```
Before: https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21&linkCode=ll1&linkId=abc123&pd_rd_r=xyz&pd_rd_w=abc&pf_rd_p=def&pf_rd_r=ghi&ref_=nav_desktop_subscribe&psc=1&utm_source=youtube&utm_medium=video&utm_campaign=review2026

After:  https://www.amazon.es/dp/B08N5WRWNW?tag=youtuber-21
```

**YouTube video shared from mobile**
```
Before: https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789

After:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Google Ads click**
```
Before: https://example.com/product?utm_source=google&utm_medium=cpc&utm_campaign=spring_sale&utm_content=banner_v2&utm_term=running+shoes&gclid=EAIaIQobChMI...&gbraid=0AAAA...

After:  https://example.com/product
```

**eBay listing**
```
Before: https://www.ebay.es/itm/123456789?mkevt=1&mkcid=1&mkrid=1185-53479-19255-0&campid=5338722076&toolid=10001&customid=myid

After:  https://www.ebay.es/itm/123456789
```

**Booking.com link from a newsletter**
```
Before: https://www.booking.com/hotel/es/my-hotel.es.html?aid=304142&label=gen173nr-1FCAEoggI46AdIM1gEaFCIAQGYAQm4AQfIAQzYAQHoAQH4AQuIAgGoAgO4AoLs2K8GwAIB&utm_source=email&utm_medium=newsletter

After:  https://www.booking.com/hotel/es/my-hotel.es.html
```

---

## What works right now (v1.0.0)

| Feature | Status |
|---|---|
| Strip 50+ tracking params (UTMs, fbclid, gclid, eBay, YouTube `si`, AliExpress…) | ✅ |
| Passive affiliate support (invisible, optional, you keep the same price) | ✅ — pending affiliate account registration |
| Foreign affiliate detection with non-intrusive toast | ✅ — pending affiliate account registration |
| "Use ours" button in toast (only when you opt in) | ✅ |
| Right-click → Copy clean link | ✅ |
| Blacklist enforcement — domain blacklist strips all params | ✅ |
| Specific affiliate blacklist (`domain::param::value`) | ✅ |
| Whitelist — protect trusted creator affiliates | ✅ |
| First-run onboarding with transparent affiliate consent | ✅ |
| EN / ES language toggle in settings | ✅ |
| Supported stores panel in settings | ✅ |
| Privacy policy page | ✅ |
| Automated GitHub Release on version tag | ✅ |
| Chrome Web Store listing | ⏳ pending account registration |
| Firefox Add-ons listing | ⏳ pending account registration |
| URL shortener (muga.link) | ⏳ Phase 2 |

---

## Supported stores

MUGA can strip affiliate noise and optionally add our tag on:
**Amazon** (ES · DE · FR · IT · UK · US), **Booking.com**, **AliExpress**, **eBay** (ES · DE · FR · IT · UK · US), **PcComponentes**, **El Corte Inglés**

Tracking parameters are stripped on **every site** — not just the ones listed above.

---

## How the affiliate model works (and why it's not annoying)

When you visit a supported store and the link you clicked has **no affiliate tag at all**, MUGA silently adds ours before you land on the page. You pay the exact same price — the store just knows you came via MUGA. This is how the extension stays free.

A few things to know:
- The URL in your address bar looks clean — the tag is added as part of the navigation, not visible noise.
- It only fires on supported stores (Amazon, Booking, eBay…) and only when there's already no affiliate tag present.
- You can turn it off in settings, per-domain or globally, at any time.
- We **never** touch a link that already carries someone else's affiliate tag. That's not our call to make.

This is opt-out, not opt-in — but you're told about it during onboarding, it's in the privacy policy, and the source code is public.

---

## What MUGA will never do

- **Silently replace** someone else's affiliate tag with ours. That's what [Honey did](https://en.wikipedia.org/wiki/Honey_(browser_extension)) — and why they got sued. The default is always "keep the original". Replacing requires explicit opt-in.
- **Collect your browsing data.** Every URL is processed locally. Nothing leaves your browser.
- **Send your URLs to any server for processing.** No cloud, no API calls, no analytics.

The code is MIT-licensed and public. Read it. Verify it.

---

## Installation

### Chrome / Firefox

> Not yet on the stores — [tracking here](https://github.com/yocreoquesi/muga/issues/7). Soon.

### From source

```bash
git clone https://github.com/yocreoquesi/muga.git
cd muga
npm install
npm run build:chrome   # outputs to dist/chrome/
npm run build:firefox  # outputs to dist/firefox/
```

Load the unpacked extension from `chrome://extensions` (Developer mode) or `about:debugging` in Firefox.

---

## Development

```bash
npm install
npm test                # 35 unit tests
npm run test:serve      # manual browser tests at http://localhost:5555
npm run build:chrome
npm run build:firefox
npm run lint
```

### Releasing

```bash
# After merging all changes to main:
git tag v1.0.1
git push --tags
# GitHub Actions picks it up, runs tests, builds .zips, publishes the release
```

---

## Project structure

```
src/
├── background/
│   └── service-worker.js   # MV3 service worker — processes URLs, handles messages
├── content/
│   └── cleaner.js          # Content script — intercepts clicks, handles clipboard, shows toast
├── lib/
│   ├── affiliates.js       # Affiliate & tracking parameter database (50+ params)
│   ├── cleaner.js          # Core URL processing logic (blacklist/whitelist enforcement)
│   ├── i18n.js             # EN/ES translations
│   └── storage.js          # chrome.storage.sync helpers
├── popup/                  # Extension popup
├── options/                # Advanced settings page (behaviour, stores, lists, language)
├── onboarding/             # First-run consent screen
├── privacy/                # Privacy policy page
└── manifest.json           # MV3 manifest (Chrome)
```

---

## Contributing

PRs welcome — especially for:

- New stores in the affiliate database ([`src/lib/affiliates.js`](src/lib/affiliates.js))
- New tracking parameters to strip
- Additional UI language translations

---

## Support

MUGA is free and open source. If it saves you from one cursed Amazon link, consider:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

## License

[MIT](LICENSE) — do whatever you want, keep the attribution.
