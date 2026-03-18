# MUGA — Make URLs Great Again

> URLs have become a mess — bloated with tracking parameters, hidden referral tags, and garbage that makes them impossible to share cleanly. MUGA fixes that.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-coming%20soon-lightgrey)]()
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-coming%20soon-lightgrey)]()

---

## What it does

- **Strips tracking parameters automatically** — UTMs, `fbclid`, `gclid`, and 30+ others, gone before you even notice.
- **Full transparency on affiliate tags** — if a link carries someone else's referral tag, MUGA shows you and lets you decide what to do.
- **Blacklist & whitelist** — fine-grained control over which domains and affiliate tags are touched, and which are left alone.
- **Non-intrusive** — notifications are optional, dismissable, and self-destruct in 5 seconds.

## What MUGA will never do

- Silently replace other people's affiliate tags with ours (that's what Honey did — we don't).
- Collect your browsing data.
- Send your URLs to any external server for processing.

Everything runs locally in your browser. The code is public so you can verify it yourself.

---

## Installation

### Chrome
> Coming soon on the Chrome Web Store

### Firefox
> Coming soon on Firefox Add-ons

### From source

```bash
git clone https://github.com/YOUR_USERNAME/muga.git
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
npm run dev:chrome    # launches Chrome with the extension live-reloaded
npm run dev:firefox   # same for Firefox
npm run lint          # validates the manifest and extension structure
```

---

## Project structure

```
src/
├── background/
│   └── service-worker.js   # MV3 service worker — processes URLs, handles messages
├── content/
│   └── cleaner.js          # Content script — intercepts link clicks
├── lib/
│   ├── affiliates.js       # Affiliate & tracking parameter database
│   ├── cleaner.js          # Core URL processing logic (used by service worker)
│   └── storage.js          # chrome.storage.sync helpers
├── popup/                  # Extension popup UI
├── options/                # Advanced settings page
└── manifest.json           # MV3 manifest (Chrome)
```

---

## Contributing

PRs are welcome, especially for:

- Adding new stores to the affiliate database (`src/lib/affiliates.js`)
- Identifying new tracking parameters to strip
- Translations for the popup and options page

---

## Support the project

MUGA is free and open source. If you find it useful:

- [Ko-fi](https://ko-fi.com/YOUR_USERNAME)
- [GitHub Sponsors](https://github.com/sponsors/YOUR_USERNAME)

---

## License

[MIT](LICENSE) — do whatever you want with the code, just keep the attribution.
