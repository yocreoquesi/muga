# MUGA — Make URLs Great Again

> You paste a link. It's 400 characters of garbage. MUGA makes it clean. That's it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-lightgrey)](https://github.com/yocreoquesi/muga/issues/7)
[![Tests](https://img.shields.io/badge/tests-36_pass-brightgreen)](#development)

URLs have become a swamp. Every link arrives pre-loaded with `utm_source`, `fbclid`, `gclid`, and a dozen other parameters that exist purely to track you. **MUGA drains the swamp** — silently, automatically, before the page loads.

---

## Before / After

**Amazon** — clicked from a Google ad
```
Before: https://www.amazon.es/dp/B08N5WRWNW?utm_source=google&utm_medium=cpc&utm_campaign=deals&gclid=EAIaIQ...&linkCode=ll1&pd_rd_r=xyz&pf_rd_p=def&ref_=nav

After:  https://www.amazon.es/dp/B08N5WRWNW
```

**YouTube** — shared from mobile
```
Before: https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789

After:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**eBay** — from a newsletter
```
Before: https://www.ebay.es/itm/123456789?mkevt=1&mkcid=1&mkrid=1185-53479-19255-0&campid=5338722076&toolid=10001

After:  https://www.ebay.es/itm/123456789
```

**Booking.com** — from an email campaign
```
Before: https://www.booking.com/hotel/es/my-hotel.html?aid=304142&label=gen173nr&utm_source=email&utm_medium=newsletter

After:  https://www.booking.com/hotel/es/my-hotel.html
```

---

## What it does

| | Default |
|---|---|
| Strip 50+ tracking params (UTMs, fbclid, gclid, eBay, YouTube `si`…) | **Always on** |
| Right-click → Copy clean link | **Always on** |
| Add our affiliate tag when none is present (you pay the same price) | On — opt-out |
| Toast notification when a third-party affiliate is detected | Off — opt-in |
| Replace detected affiliate with ours | Off — explicit opt-in |
| Per-domain blacklist (strip everything) | Configurable |
| Whitelist (protect specific creator affiliates) | Configurable |
| EN / ES language toggle | Configurable |

Tracking removal works on **every site**. Affiliate features only apply to supported stores.

---

## Affiliate model — the honest version

When you navigate to a supported store with no affiliate tag in the link, MUGA silently adds ours. **You pay the same price.** The store just knows you came via MUGA — that's how the extension stays free.

- Only fires when there is no existing affiliate tag
- Invisible — the tag is not shown as URL noise in your address bar
- Off in two taps: Settings → toggle off, globally or per domain
- We **never** touch a link that already carries someone else's tag — that's what [Honey did](https://en.wikipedia.org/wiki/Honey_(browser_extension)), and why they got sued

Disclosed during onboarding, documented in the [privacy policy](https://yocreoquesi.github.io/muga/), and verifiable in the source code.

---

## What MUGA will never do

- Silently replace someone else's affiliate tag
- Collect your browsing data
- Send anything to any server — every URL is processed locally

---

## Installation

> Not yet on the stores. [Track progress here](https://github.com/yocreoquesi/muga/issues/7).

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
npm test                # 36 unit tests
npm run test:serve      # manual tests at http://localhost:5555
npm run build:chrome
npm run build:firefox
```

New release: tag `vX.Y.Z` → push → GitHub Actions builds and publishes automatically.

---

## Contributing

PRs welcome for new tracking parameters, new stores, or additional languages — see [`src/lib/affiliates.js`](src/lib/affiliates.js).

---

## Support

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

## License

[MIT](LICENSE)
