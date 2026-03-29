# Contributing to MUGA

Thanks for your interest in contributing! This document covers how to set up the project, run tests, and submit changes.

## Development setup

**Requirements:** Node.js 20+, npm, git

```bash
git clone https://github.com/yocreoquesi/muga.git
cd muga
npm install
```

## Running tests

```bash
npm test
```

Uses the Node.js built-in test runner. All tests live in `tests/unit/*.mjs`.

## Project structure

```
src/
├── manifest.json          Chrome MV3
├── manifest.v2.json       Firefox MV2
├── background/
│   └── service-worker.js  URL processing, message handling
├── content/
│   ├── cleaner.js         Click interceptor (document_start)
│   ├── amp-redirect.js    AMP → canonical redirect (document_end)
│   └── redirect-unwrap.js Tracking redirect unwrapper (document_end)
├── lib/
│   ├── cleaner.js         Core URL processing logic (pure, testable)
│   ├── affiliates.js      Affiliate patterns + tracking params
│   ├── storage.js         chrome.storage helpers + PREF_DEFAULTS
│   └── i18n.js            EN/ES translations
├── popup/                 Browser action popup
└── options/               Full options page
tests/unit/                Node.js test runner tests
```

## Workflow

**Never commit directly to `main`.** Always:

1. Create an issue: `gh issue create --title "..." --label bug|enhancement`
2. Create a branch: `git checkout -b fix/name` or `feat/name`
3. Implement + write/update tests
4. `npm test` must pass
5. `git push origin branch-name`
6. `gh pr create --fill`
7. `gh pr merge --squash`
8. `git checkout main && git pull origin main`

## Security rules

- No `eval()`, inline scripts, or remote code: violates CSP
- No silent external requests that send user data: all URL processing is local
- Minimal permissions in manifests: only what is strictly needed
- Content scripts must be explicitly listed in `manifest.json` and `manifest.v2.json`

## Commit message format

```
type: short description (#ISSUE)
```

Types: `feat`, `fix`, `test`, `docs`, `ci`, `refactor`

## Building the extension

```bash
npm run build          # both targets
npm run build:chrome   # Chrome MV3 only → dist/chrome/
npm run build:firefox  # Firefox MV2 only → dist/firefox/
```

Output goes to `dist/`. Uses `web-ext` (Mozilla).

## Browser compatibility

- Chrome: Manifest V3, `declarativeNetRequest`
- Firefox: Manifest V2, requires Firefox 128+ for `queryTransform` support in DNR rules

## Adding tracking parameters

Edit `src/lib/affiliates.js` and add to the `TRACKING_PARAMS` array. Then regenerate the DNR rules file:

```bash
npm run build:rules
```

`src/rules/tracking-params.json` is a **generated artifact**. Do not edit it by hand. The single source of truth is `TRACKING_PARAMS` in `affiliates.js`. The CI pipeline enforces this: it runs `npm run build:rules` and fails if the generated file differs from what is committed.

## Adding affiliate stores

Edit `src/lib/affiliates.js` and add an entry to `AFFILIATE_PATTERNS`:

```js
{
  id: "store_id",
  name: "Store Name",
  domains: ["store.com", "store.co.uk"],
  param: "affiliate_param",
  type: "affiliate",
  ourTag: "",   // filled in by the extension owner
}
```

Leave `ourTag` empty. It is filled in privately by the repository owner.
