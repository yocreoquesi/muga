<div align="center">

![MUGA — Make URLs Great Again](docs/assets/promo-marquee-1400x560.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-blue)](#)
[![Tests](https://img.shields.io/badge/tests-105_pass-brightgreen)](#development)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-lightgrey)](#installation)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-lightgrey)](#installation)

# Every link. Cleaned. Before it loads.

URLs arrive pre-loaded with `utm_source`, `fbclid`, `gclid`, Amazon noise, YouTube share tokens and dozens more. MUGA strips them — silently, automatically, before the page renders. **Zero clicks. Zero configuration.**

[Install from Chrome Web Store](#installation) · [Install for Firefox](#installation) · [View source](https://github.com/yocreoquesi/muga)

</div>

---

## See it in action

![Before and after URL cleaning](docs/assets/screenshot-ss1-before-after.png)

<details>
<summary><strong>More before / after examples</strong></summary>

**Amazon** — clicked from a YouTube review
```
Before: https://www.amazon.es/dp/B08N5WRWNW?utm_source=google&utm_medium=cpc&gclid=EAIaIQ...&linkCode=ll1&pd_rd_r=xyz&pf_rd_p=def&ref_=nav

After:  https://www.amazon.es/dp/B08N5WRWNW
```

**YouTube** — shared from mobile
```
Before: https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789

After:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**eBay** — from a newsletter
```
Before: https://www.ebay.es/itm/123456789?mkevt=1&mkcid=1&mkrid=1185-53479-19255-0&campid=5338722076

After:  https://www.ebay.es/itm/123456789
```

</details>

---

## What it does

| Feature | Default |
|---|---|
| Strip 89 tracking params before navigation (DNR — covers address bar, bookmarks, external apps) | On — opt-out |
| Strip tracking params on in-page clicks (UTMs, fbclid, gclid, YouTube `si`, Pinterest, Snapchat, Reddit…) | **Always on** |
| Strip Amazon path noise (`/ref=nav_logo`, session IDs after ASIN, product slug) | **Always on** |
| Block `<a ping>` tracking beacons | On — opt-out |
| Redirect AMP pages to canonical URL | On — opt-out |
| Unwrap redirect wrappers (Reddit, Steam, generic `?redirect=`, `?url=`…) | On — opt-out |
| **Batch cleaner** — paste multiple URLs, clean all at once | **Always on** |
| Right-click any link → **Copy clean link** | **Always on** |
| **Alt+Shift+C** — copy clean URL of current tab | **Always on** |
| Badge counter — items cleaned on current tab | **Always on** |
| Popup — before/after preview for the current page | **Always on** |
| Add our affiliate tag when none is present *(you pay the same price)* | On — opt-out |
| Toast when a third-party affiliate is detected | Off — opt-in |
| Replace detected affiliate with ours | Off — explicit opt-in |
| Strip **all** affiliate parameters | Off — opt-in |
| Per-domain blacklist — strip everything on a site | Configurable |
| Per-domain disable — `domain::disabled` | Configurable |
| Whitelist — protect specific creator affiliate tags | Configurable |
| Custom tracking params — add your own | Configurable |
| Export / Import settings as JSON | Configurable |
| EN / ES language toggle | Configurable |

Tracking removal works on **every site**. Affiliate features only apply to [supported stores](#supported-stores).

---

## The popup

![Popup open on Amazon](docs/assets/screenshot-ss2-popup.png)

---

## Advanced settings

![Options page](docs/assets/screenshot-ss3-options.png)

---

## Affiliate model — the honest version

When you navigate to a supported store with no affiliate tag in the link, MUGA silently adds ours. **You pay the same price.** The store just knows you came via MUGA — that's how the extension stays free.

- Only fires when there is **no** existing affiliate tag
- Invisible — not shown as URL noise in your address bar
- Off in two taps: Settings → toggle off, globally or per domain
- We **never** silently replace someone else's tag — that's what [Honey did](https://en.wikipedia.org/wiki/Honey_(browser_extension)), and why they got sued

Disclosed during onboarding, documented in the [privacy policy](https://yocreoquesi.github.io/muga/), verifiable in the source code.

---

## Privacy

- Every URL is processed **entirely inside your browser** — nothing is ever sent to any server
- Zero browsing data collected, zero analytics, zero telemetry
- No account, no sign-in, no cloud
- Minimal permissions: `storage`, `tabs`, `contextMenus`, `clipboardWrite` — nothing else

---

## Supported stores

20 stores with affiliate tracking support: Amazon (ES, DE, FR, IT, UK, US), Booking.com, AliExpress, PcComponentes, El Corte Inglés, eBay, Temu, Zalando (ES, DE), SHEIN, Fnac (ES, FR), MediaMarkt (ES, DE).

Affiliate injection is only active on stores where an account is registered and `ourTag` is set in the source.

---

## Installation

> Not yet on the stores. Track progress at [#7](https://github.com/yocreoquesi/muga/issues/7).

**From source:**
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
npm test               # 105 unit tests
npm run build:chrome
npm run build:firefox
```

New release: tag `vX.Y.Z` → push → GitHub Actions builds and publishes automatically.

---

## Contributing

PRs welcome for new tracking parameters, new stores, or additional languages. See [`src/lib/affiliates.js`](src/lib/affiliates.js) for the store database and [`tests/unit/cleaner.test.mjs`](tests/unit/cleaner.test.mjs) for the test suite.

---

## Support

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

## License

[MIT](LICENSE)

---

*Built with the assistance of AI agents ([Claude](https://www.anthropic.com/claude) by Anthropic).*
