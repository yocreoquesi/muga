# Contributing to MUGA

Thanks for your interest in contributing! This document covers how to set up the project, run tests, and submit changes.

> **Active strategic direction**: MUGA is mid-pivot to creator-agnostic denoise (2.1) — see [ADR-0002](docs/adr/0002-denoise-pivot-creator-agnostic.md) for the full rationale and surface inventory. Work is tracked under [milestone v2.1.0](https://github.com/yocreoquesi/muga/milestone/5). If your contribution touches product copy, affiliate handling, or the URL Unwrapper feature (ex Privacy Proxy), read the ADR first.

## How to contribute without code

Most contributions don't need a pull request. The fastest paths in:

- **A site MUGA broke?** Use the [broken-site issue template](.github/ISSUE_TEMPLATE/broken-site.yml). The popup's "Report broken site" button prefills it for you.
- **A tracking parameter MUGA missed?** Use the [missed-tracking-param template](.github/ISSUE_TEMPLATE/missed-tracking-param.yml). Names only — never values or full URLs.
- **A new affiliate program to add?** Use the [new-affiliate-program template](.github/ISSUE_TEMPLATE/new-affiliate-program.yml). Today MUGA injects on direct-injection programs only; preservation on redirect-based networks (AliExpress, CJ, Awin, Impact, Partnerize, Admitad) is being added under [ADR-0002](docs/adr/0002-denoise-pivot-creator-agnostic.md). See [Adding affiliate stores](#adding-affiliate-stores) for the current shape and the ADR for where this is going.
- **General question or design discussion?** Open a [GitHub Discussion](https://github.com/yocreoquesi/muga/discussions) instead of an Issue.
- **Suspected security issue?** [Open a private security advisory](https://github.com/yocreoquesi/muga/security/advisories/new), not a public Issue.

## Development setup

**Requirements:** Node.js 20+, npm, git

```bash
git clone https://github.com/yocreoquesi/muga.git
cd muga
npm install
```

## Running tests

```bash
npm test               # unit tests (Node.js built-in test runner)
npm run test:e2e       # Playwright e2e suite (Chromium, headed)
```

Unit tests live under `tests/unit/*.mjs`. E2E specs live under `tests/e2e/*.spec.mjs` with shared helpers in `tests/e2e/helpers/`.

### E2E test-mode sentinel

The e2e suite needs to read state that is otherwise inaccessible from a content-script's world (the toolbar action surface, in particular). This is gated through a single `__TEST__`-prefixed runtime-message handler in the service worker, which short-circuits unless the sentinel `chrome.storage.local["__muga_test_mode"]` is set to `true`.

Production builds **never** set the sentinel. The only setters are e2e fixtures (see `tests/e2e/helpers/storage.mjs`'s `installTestModeSentinel` / `clearTestModeSentinel`). Tests must clear the sentinel on teardown so subsequent tests in the same persistent context start clean.

Adding a new `__TEST__` message handler:

1. Add the case in `handleTestMessage` in `src/background/service-worker.js`.
2. Document the read/write contract in the helper that calls it (under `tests/e2e/helpers/`).
3. The gate (sentinel check) is shared, you do not re-implement it.

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
npm run build:content  # bundle the content-script lib (#356)
```

Output goes to `dist/`. Uses `web-ext` (Mozilla).

### Why is there a bundler if we said "no build step"?

The project still has no source-language transformation (no TypeScript, no Babel, no JSX). The single exception is the **content-script bundle** under `src/content/cleaner-bundle.js`, generated by `npm run build:content` (esbuild as a one-line invocation). It exists because MV3 content scripts cannot use ES module imports portably across Chrome and Firefox MV2, but the cleaning library lives as ESM in `src/lib/` for the service worker, popup, and tests.

The bundle output is **committed to the repo** (same pattern as `src/rules/tracking-params.json`) and CI verifies it stays in sync with its source. If you edit `src/lib/cleaner.js`, `src/lib/affiliates.js`, or `src/content/cleaner-bundle-src.mjs`, run `npm run build:content` and commit the regenerated bundle.

## Browser compatibility

- Chrome: Manifest V3, `declarativeNetRequest`
- Firefox: Manifest V2, requires Firefox 128+ for `queryTransform` support in DNR rules

## Tracking parameter contributions

A new tracking parameter can land in one of three places. The choice has real consequences. Before opening a PR, decide which carrier fits, then read the section that applies.

| Carrier | Scope | Source file |
|---|---|---|
| `TRACKING_PARAMS` (universal DNR) | Stripped on every domain | `src/lib/affiliates.js` |
| `stripParams` per domain | Stripped only on the listed domain(s) | `src/rules/domain-rules.json` |
| `preserveParams` per domain | Kept on the listed domain(s); implicitly removed from universal DNR | `src/rules/domain-rules.json` |

### When to use universal `TRACKING_PARAMS`

A parameter belongs in the universal list when **all** of the following hold:

- It is in active, observed use as a tracker on **multiple, unrelated** domains. A single store's custom tracker does not qualify.
- It is **never functional**. Its presence does not change what the user sees, only what is reported back to a tracking system.
- It does **not** appear in any domain's `preserveParams` list. The DNR ↔ domain-rules consistency test (`tests/unit/dnr-rules.test.mjs:184`) enforces this — adding a param to both is a CI failure.

If any of those fails, the param does not belong in the universal list. Pick a domain-specific carrier instead.

To add to the universal list, the **fastest path is `npm run add-rule`**:

```sh
npm run add-rule
# or non-interactive:
npm run add-rule -- --name=link_source --category=ads --source="AdGuard filter 17"
```

The script:

1. Appends the param to the `TRACKING_PARAMS` array in `src/lib/affiliates.js`.
2. Appends it to the matching `TRACKING_PARAM_CATEGORIES.<cat>.params` array (categories: `utm`, `ads`, `email`, `social`, `platform_noise`, `generic`).
3. Regenerates `src/rules/tracking-params.json` (`npm run build:rules`).
4. Regenerates `src/content/cleaner-bundle.js` (`npm run build:content`).
5. Appends a regression entry in `tests/unit/cleaner-add-rule-regression.test.mjs` that asserts the param strips on a synthetic URL.
6. Runs the unit-test suite to confirm no regression.
7. Stages the diff for review (does **not** commit — that step stays in your hands).

Manual path (if you prefer):

1. Add the param to the `TRACKING_PARAMS` array in `src/lib/affiliates.js`.
2. Regenerate the DNR rules file: `npm run build:rules`.
3. Commit both `affiliates.js` and `src/rules/tracking-params.json`.

`src/rules/tracking-params.json` is a **generated artifact** — do not edit it by hand. The single source of truth is `TRACKING_PARAMS` in `affiliates.js`. The CI pipeline runs `npm run build:rules` and fails if the generated file differs from what is committed.

### When to use per-domain `stripParams`

A parameter belongs in a domain's `stripParams` when:

- It is a tracker custom to that domain, or to a small set of related domains owned by the same operator (e.g. Amazon's `pd_rd_*` family, AliExpress's `aff_fsk` / `spm` / `scm`).
- It does not generalize to the broader web — adding it to the universal list would create rules with no benefit elsewhere and risk false positives on unrelated sites that legitimately use the same parameter name.

Edit `src/rules/domain-rules.json` and add the param to the matching domain entry's `stripParams` array (creating the domain entry if it does not exist).

### Hidden global cost of `preserveParams`

`preserveParams` declares that a parameter is **functional** on a specific domain (e.g. `q` is the search query on Google). The consistency test then **forbids** that parameter from appearing in the universal `TRACKING_PARAMS` list. The mechanism is correct and well-tested, but the contributor needs to understand the consequence:

> Adding a param to any domain's `preserveParams` list implicitly removes it from the universal DNR list. The param now **survives on every other domain too**, including domains where it acts as a tracker.

Before adding to `preserveParams`, consider:

- Is the param functional on **only** this domain? If it acts as a tracker on Domain X but is functional on Domain Y, you cannot add it to universal `TRACKING_PARAMS` (the test will fail). The correct shape is: `preserveParams` on Domain Y, `stripParams` on every domain where it acts as a tracker.
- Are you accepting the trade-off explicitly? If `track_id` is functional on `your-store.com` and adding it preserves it everywhere, that needs to be a deliberate choice noted in the PR description.

The consistency test catches the rule-level violation. It does not catch poor judgment about scope. That is your call — this section exists so the call is made deliberately.

## Translations

MUGA ships UI in English, Spanish, Portuguese, and German. The maintainer is a native Spanish speaker (English fluent); PT and DE are best-effort. The project's policy is:

- **Officially maintained**: `en` and `es`. Every translation key in `src/lib/i18n.js` must have a non-empty value in both. The completeness test in `tests/unit/i18n-completeness.test.mjs` enforces this floor — a PR that adds a key without an EN+ES pair fails CI.

- **Community-maintained**: `pt` and `de`. New keys may ship without these initially; the runtime fallback chain at `i18n.js:281` lands missing entries on EN cleanly. PT and DE PRs do not require native-speaker review by the maintainer (the maintainer is not a native speaker of either) — the EN+ES floor is what gates a merge.

To find which keys are missing in PT or DE, run:

```bash
node tools/missing-translations.mjs           # both languages
node tools/missing-translations.mjs pt        # PT only
node tools/missing-translations.mjs de        # DE only
```

The script's output is markdown suitable for pasting into the per-language tracking issues. Submit a PR editing the matching entries in `TRANSLATIONS` and the CI suite will validate the EN+ES floor for you.

### PT / DE: native-speaker review welcome

The current PT and DE strings in `src/lib/i18n.js` were produced with AI assistance. They are linguistically sound but have not been signed off by a native speaker. If you spot a string that reads awkward, regional, or just wrong, a PR fixing only that single key is a great first contribution:

1. Find the key in `src/lib/i18n.js`.
2. Edit the `pt:` or `de:` value in place.
3. Add a one-line note in the PR description explaining your variant (e.g., "PT-BR prefers `contatar` over `contactar`", "DE consistency with rest of file uses du-form").

The CI guard `tools/check-i18n-fixme.mjs` fails the build on FIXME markers, empty locale slots, or `'FIXME: translate'` stubs — it does not require native-speaker review to pass. The native review pipeline is purely social.

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

## Tracking-param contribution workflow

To add a new tracking parameter to MUGA's universal strip set:

1. **Edit `src/lib/affiliates.js`** — append the param name to `TRACKING_PARAMS` and add it to the appropriate `TRACKING_PARAM_CATEGORIES.<category>.params` array. The six valid category keys are: `utm`, `ads`, `email`, `social`, `platform_noise`, `generic`.

2. **Run `npm run add-rule`** (or `npm run add-rule -- --name=<param> --category=<category>` for a non-interactive run). The script internally calls `npm run compile:rules`, which regenerates both `src/rules/tracking-params.json` and `src/rules/rules-manifest.json` in a single pass. It also rebuilds `src/content/cleaner-bundle.js` and appends a regression test entry to `tests/unit/cleaner-add-rule-regression.test.mjs`.

3. **Commit the staged diff** — `add-rule` leaves the following files staged for you to review before committing:
   - `src/lib/affiliates.js` — the source edit
   - `src/rules/tracking-params.json` — updated DNR rule (Chrome MV3 + Firefox MV2)
   - `src/rules/rules-manifest.json` — updated documentation-grade manifest
   - `src/content/cleaner-bundle.js` — rebuilt content-script bundle
   - `tests/unit/cleaner-add-rule-regression.test.mjs` — new regression entry

4. You can also run **`npm run compile:rules`** manually at any time to regenerate both `src/rules/rules-manifest.json` and `src/rules/tracking-params.json` from the current state of `affiliates.js` without going through `add-rule`.

> **Note:** `npm run build:rules` is kept as an alias to `npm run compile:rules` for one release cycle (backward compatibility). Prefer `compile:rules` in new scripts or documentation.
