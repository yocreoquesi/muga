# MUGA — Make URLs Great Again

> You paste a link. It's 400 characters of garbage. MUGA makes it clean, honest, and short. That's it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)

---

URLs have become a swamp. Every link you share comes pre-loaded with `utm_source`, `fbclid`, `gclid`, affiliate tags, referral codes, and a dozen other parameters that exist purely to track you — not to help you get anywhere. MUGA drains the swamp.

**The name is intentional.** Make URLs Great Again. You get it.

---

## What works right now

- **Strips tracking parameters automatically** — UTMs, `fbclid`, `gclid`, `msclkid`, `yclid`, `igshid`, `ref`, `source`, and 20+ others. Gone before the page loads. You don't have to do anything.
- **Detects foreign affiliate tags** — if a link carries someone else's referral code, MUGA shows a non-intrusive toast with three choices: keep it, remove it, or replace it with ours (disabled by default — more on that below). Auto-dismisses in 5 seconds. Default is always "keep".
- **Affiliate injection** — MUGA can silently add our affiliate tag when a supported store link has none. You opted in to this during installation. You can disable it per-domain or globally in settings.
- **Right-click → Copy clean link** — cleans the URL and puts it on your clipboard without navigating.
- **Blacklist / whitelist UI** — the options page lets you add domains and tags to both lists. *(Enforcement logic coming in v0.3.0 — saved but not yet applied to URL processing.)*

### Supported stores for affiliate injection

Amazon (amazon.es · amazon.de · amazon.fr · amazon.it · amazon.co.uk), Booking.com, AliExpress, PcComponentes, El Corte Inglés. More stores are added regularly — see [`src/lib/affiliates.js`](src/lib/affiliates.js) for the full list.

---

## What MUGA will never do

- **Silently replace** someone else's affiliate tag with ours. That's what Honey did. It's not what we do. The default is always "keep the original". Replacing requires explicit opt-in — and even then, you're asked on each link.
- **Collect your browsing data.** Every URL is processed locally. Nothing leaves your browser.
- **Send your URLs to any server for cleaning.** No cloud, no API calls, no analytics.

The code is MIT-licensed and public. Read it. Verify it.

---

## What's not there yet (honest edition)

| Feature | Status |
|---|---|
| Strip tracking params | ✅ Works |
| Affiliate detection toast | ✅ Works |
| Affiliate injection | ✅ Works (blocked until affiliate accounts are registered) |
| Copy clean link (context menu) | ✅ Works |
| Blacklist / whitelist enforcement | ⏳ v0.3.0 — UI saves, logic not wired yet |
| Onboarding / first-run consent flow | ⏳ v0.2.0 |
| UI in English | ⏳ v0.3.0 — currently in Spanish |
| i18n (auto-detect browser language) | ⏳ v0.3.0 |
| Privacy policy page | ⏳ v1.0.0 |
| URL shortener (muga.link) | ⏳ Phase 2 |

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

Load the unpacked extension from `chrome://extensions` (Developer mode on) or `about:debugging` in Firefox.

---

## Development

```bash
npm install
npm test               # 27 unit tests
npm run test:serve     # serves test page at http://localhost:5555
npm run build:chrome
npm run build:firefox
npm run lint
```

---

## Project structure

```
src/
├── background/
│   └── service-worker.js   # MV3 service worker — processes URLs, handles messages
├── content/
│   └── cleaner.js          # Content script — intercepts clicks, handles clipboard
├── lib/
│   ├── affiliates.js       # Affiliate & tracking parameter database
│   ├── cleaner.js          # Core URL processing logic
│   └── storage.js          # chrome.storage.sync helpers
├── popup/                  # Extension popup UI
├── options/                # Advanced settings page
└── manifest.json           # MV3 manifest (Chrome)
```

---

## Contributing

PRs welcome — especially for:

- New stores in the affiliate database ([`src/lib/affiliates.js`](src/lib/affiliates.js))
- New tracking parameters to strip
- Translations

---

## Support

MUGA is free and open source. If it saves you from one cursed Amazon link, consider:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

## License

[MIT](LICENSE) — do whatever you want, keep the attribution.
