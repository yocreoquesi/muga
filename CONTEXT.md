# MUGA — Living Architecture Map

> **Read this first.** This document is the one-stop map for contributors and AI agents navigating the codebase. README has the pitch; CONTEXT.md has the system.

MUGA is a browser extension (Chrome MV3 + Firefox MV2) that removes 447 tracking parameters and 12 prefix-based noise patterns from URLs before a page loads, while preserving affiliate attribution tags that pay independent creators. It operates entirely in the browser — no server, no telemetry, no remote processing — and ships a self-scaling rule-ingestion pipeline that grows its coverage automatically from upstream filter lists without human review in the hot path.

---

## Quick orientation

| If you want to… | Go to… |
|---|---|
| Add a tracking param | `src/lib/affiliates-data.js` → `TRACKING_PARAMS`, then `npm run add-rule` |
| Change affiliate logic | `src/lib/affiliates.js` (hub) + `src/lib/affiliates-data.js` (data) |
| Change storage / prefs | `src/lib/prefs.js` (data) or `src/lib/storage.js` (hub) |
| Understand URL processing | `src/lib/cleaner.js` → `processUrl()` |
| Add a wrapper unwrap recipe | `src/rules/wrappers.json` |
| Update domain-specific rules | `src/rules/domain-rules.json` |
| Understand the pipeline | `tools/rule-ingestion/` + [ADR-0005](docs/adr/0005-rule-scaling-pipeline.md) |
| Run gates before commit | `npm test && npm run typecheck && npm run lint:js` |

---

## 1. What MUGA is

MUGA intercepts URL navigation at the browser layer and applies a three-tier cleaning pipeline: a declarative DNR pre-filter, a service-worker processing step, and a content-script layer. It preserves affiliate-attribution tags for independent creators (YouTube reviewers, newsletters, bloggers) while stripping everything else. The CAPS (Creator Affiliate Preservation Spec) conformance invariant — "never strip an affiliate or functional param" — is the product's primary safety constraint and is enforced by structural guards, behavioral canaries, and module-level tests.

---

## 2. The two manifests

| | Chrome (`src/manifest.json`) | Firefox (`src/manifest.v2.json`) |
|---|---|---|
| Manifest version | MV3 | MV2 |
| Background | `service_worker` (ephemeral, module) | `page` (background.html, persistent) |
| Action API | `chrome.action` | `chrome.browserAction` |
| DNR rulesets | `tracking_params`, `amp_redirect`, `wrapper_unwrap` | `tracking_params`, `wrapper_unwrap` (no `amp_redirect`) |
| MAIN-world injection | Inline content-script entry with `world: "MAIN"` | Separate content-script entry (second block) |
| Host permissions | `host_permissions: ["<all_urls>"]` | Inline in `permissions` array |
| Optional permissions | `optional_host_permissions` | `optional_permissions` |

**Why it differs:** MV3 requires separate declarative rulesets and explicit `world: "MAIN"` for history-defuser and window-name-defuser injections. Firefox MV2 injects those scripts as a second content-script block without the `world` key. The `amp_redirect` DNR ruleset is absent from MV2 because Firefox does not support `queryTransform` in DNR rules (handled by `src/content/amp-redirect.js` instead — a `document_end` content script present only in MV2).

---

## 3. URL-processing tiers + data flow

```
┌──────────────────────────────────────────────────────┐
│                   BROWSER / DNR LAYER                │
│  Pre-navigation — fires before request leaves browser│
│  tracking_params → strip universal tracking params   │
│  amp_redirect    → redirect AMP → canonical (Chrome) │
│  wrapper_unwrap  → unwrap known redirect wrappers     │
│  (src/rules/tracking-params.json, amp-redirect.json, │
│   wrapper-dnr-rules.json)                            │
└───────────────────────┬──────────────────────────────┘
                        │ URL enters page load
                        ▼
┌──────────────────────────────────────────────────────┐
│            SERVICE WORKER — PROCESS_URL              │
│  Triggered by content-script message on every nav    │
│                                                      │
│  processUrl() steps (src/lib/cleaner.js):            │
│  0a. Honor Creator?  — if honorCreatorMode + wrapper │
│      + referrer in creatorAllowlist → pass through   │
│  0b. Unwrap          — wrapper-engine detects and    │
│      extracts destination from redirect wrappers     │
│  0c. Canonical       — try canonical-extractor if   │
│      wrapper was opaque (t.co, link.medium.com…)     │
│  1.  Strip params    — TRACKING_PARAMS + prefixes +  │
│      domain-specific stripParams + remote params     │
│      landing policy: preserve matrix-required params │
│      on first-touch redirect-network landings        │
│  2.  Affiliate check — preserve/inject affiliate tag │
│      (AFFILIATE_PATTERNS from affiliates.js)         │
│  3.  Path strip      — path-strip-rules.json         │
│  → returns { cleanUrl, action, removedTracking, … }  │
└───────────────────────┬──────────────────────────────┘
                        │ PROCESS_URL response
                        ▼
┌──────────────────────────────────────────────────────┐
│              CONTENT SCRIPT LAYER                    │
│  src/content/cleaner.js        — click interceptor,  │
│    receives PROCESS_URL result, rewrites link before  │
│    navigation; shows toast notification               │
│  src/content/dom-link-rewriter.js — rewrites <a>     │
│    href values in DOM (MutationObserver)              │
│  src/content/dom-link-rewriter-click.js — click-time │
│    rewrite for dynamically injected links             │
│  src/content/bounce-state-cleaner.js — cleans        │
│    history-state bounce tracking patterns             │
│  src/content/history-defuser.js (isolated) +         │
│    history-defuser-mainworld.js (MAIN world)         │
│    — wraps pushState/replaceState; nonce gate (#811) │
│    prevents hostile page scripts from spoofing events│
│  src/content/window-name-defuser.js (isolated) +     │
│    window-name-defuser-mainworld.js (MAIN world)     │
│    — clears window.name tracking vectors             │
│  src/content/amp-redirect.js (MV2 only, document_end)│
│    — AMP → canonical redirect on Firefox            │
└───────────────────────┬──────────────────────────────┘
                        │ Badge/popup updates
                        ▼
┌──────────────────────────────────────────────────────┐
│              POPUP / OPTIONS SURFACES                │
│  src/popup/popup.js   — badge, recent activity,     │
│    "Creator referral preserved" badge, stats         │
│  src/options/options.js — full settings page,        │
│    blacklist/whitelist, category toggles, export     │
│  src/onboarding/onboarding.js — consent + opt-in    │
└──────────────────────────────────────────────────────┘
```

**Nonce gate (#811):** `history-defuser.js` generates a random nonce at `document_start` before any page script runs, fires a one-shot `muga:history-gate:nonce` event to `history-defuser-mainworld.js`, and requires every subsequent `muga:history-gate` control event to carry that nonce. This blocks hostile page scripts from spoofing gate events to disable or force-open the active-defense layer.

---

## 4. Domain language

**Tracking param** — a URL query parameter that carries surveillance signal (click IDs, session tokens, campaign attribution) with no bearing on what the user sees. Safe to strip universally. Lives in `TRACKING_PARAMS` (`src/lib/affiliates-data.js`). DNR rules in `src/rules/tracking-params.json` strip them pre-navigation.

**Affiliate param** — a parameter that carries creator-attribution for a monetization program (Amazon `tag=`, eBay `campid=`). MUGA preserves or injects these. Lives in `AFFILIATE_PATTERNS` (`src/lib/affiliates.js`). Stripping one silently kills a creator's commission.

**Landing param** — a parameter that a redirect-network's first-party merchant tag reads on landing to populate its attribution cookie (`awc` for Awin, `cjevent` for CJ Affiliate, etc.). Must survive the first page load; may be stripped on same-site subsequent navigations. Lives in `REDIRECT_NETWORK_PATTERNS.landingParams` (`src/lib/redirect-networks.js`). The `getLandingPolicy()` function in `src/lib/cleaner.js` implements this via referrer matching.

**Functional param** — a parameter that changes what the user sees (search query, pagination, locale, sort order). Never strip. Protected by `preserveParams` entries in `src/rules/domain-rules.json` and by Gate 4 of the ingestion pipeline.

**Honor Creator** — a user-opt-in mode that passes a redirect-network wrapper URL through unmodified when the navigation referrer matches the user's `creatorAllowlist`. Prevents MUGA from unwrapping a creator's affiliate link before the commission is recorded. Implemented in `src/lib/honor-creator.js`.

**Redirect network** — an affiliate network whose attribution model is "the click IS the conversion event" (Awin, CJ Affiliate, Impact Radius, Admitad, etc.). MUGA never injects on these; it only preserves their `landingParams`. See `src/lib/redirect-networks.js` and [ADR-0003](docs/adr/0003-awin-redirect-model-resolution.md).

**Wrapper** — a URL that encodes a destination URL in its query string (l.facebook.com, t.co, link.medium.com, etc.). The wrapper engine (`src/lib/wrapper-engine.js`) extracts the destination URL without contacting the wrapper server.

**Asymmetric-risk principle** — stripping a tracker by mistake is cheap (URL is noisier than it should be, nobody is harmed). Stripping an affiliate or functional param by mistake is catastrophic (creator revenue evaporates silently, or site search breaks). The entire ingestion pipeline is built around this asymmetry: aggressive toward preserve, conservative toward strip. See [ADR-0005](docs/adr/0005-rule-scaling-pipeline.md) for the formal statement.

---

## 5. Module map (post-#826)

The #826 refactor split two monolithic files into focused modules with hub re-exports that maintain backward compatibility for all existing importers.

### Affiliates split

```
affiliates-data.js   (domain a — static data, no imports from siblings)
  exports: TRACKING_PARAMS, TRACKING_PREFIXES, TRACKING_PARAM_CATEGORIES

redirect-networks.js (domain c — redirect-network table, no imports from siblings)
  exports: REDIRECT_NETWORK_PATTERNS, getRedirectNetworkPatterns,
           getRedirectNetworkForRedirectHost, getLandingParamsForReferrer

affiliates.js        (hub — imports both; re-exports full pre-split API)
  exports: all of the above + AFFILIATE_PATTERNS, getPatternsForHost,
           getAffiliateParamSetForHost, getSupportedStores, getAffiliateDomains
```

### Storage split

```
prefs.js             (sync domain — PREF_DEFAULTS, getPrefs, setPrefs)
  no import from storage.js (acyclic)

storage-migrations.js (one-time migrations — migrateStatsToLocal, migrateLegacyProxyPref)
  calls chrome.storage directly, no import from storage.js (acyclic)

storage.js           (hub — re-exports prefs + migrations + stats/session/domain/shortener)
  exports: full pre-split API (see module-boundary-826.test.mjs for the snapshot)
```

### Acyclicity rules

Leaf/data modules (`affiliates-data.js`, `redirect-networks.js`, `prefs.js`, `storage-migrations.js`) must NOT import from their hub. The hub imports the leaves and re-exports everything. Guards: `tests/unit/module-boundary-826.test.mjs`.

### i18n split

`src/lib/i18n.js` is the hub; per-locale data lives in `src/lib/locales/{en,es,pt,de,fr,it,ja}.mjs`. Each locale module is imported dynamically at language switch or during `applyTranslations()`.

### Data files and their generators

| File | Source of truth | Generator |
|---|---|---|
| `src/rules/tracking-params.json` | `TRACKING_PARAMS` in `affiliates-data.js` | `npm run compile:rules` |
| `src/rules/rules-manifest.json` | `affiliates-data.js` + `domain-rules.json` | `npm run compile:rules` |
| `src/rules/wrapper-dnr-rules.json` | `src/rules/wrappers.json` (Ed25519-signed) | `npm run build:dnr` |
| `src/content/cleaner-bundle.js` | `src/content/cleaner-bundle-src.mjs` (esbuild) | `npm run build:content` |
| `src/rules/manifest.data.js` | caps-spec vendored manifest | hand-maintained; edit directly and update `EXPECTED_PROGRAM_IDS` in `tests/unit/caps-manifest-sync.test.mjs` |

**Rule:** if you edit `affiliates-data.js` run `npm run compile:rules && npm run build:content`. If you edit `wrappers.json` run `npm run build:dnr`. CI fails if any artifact under `src/rules/` or `src/content/cleaner-bundle.js` is out of sync.

---

## 6. Rule-ingestion pipeline

> For full design rationale see [ADR-0005](docs/adr/0005-rule-scaling-pipeline.md).

```
runIngestion()   →   runOrchestrateCli()   →   runPromote()
(adapters fetch       (4 gates + Ed25519        (sig verify + preserve
 signals; raw data     signing; quarantine        backstop; atomic write
 stays in quarantine)  report always written)     to params.json)
```

**Adapters** (`tools/rule-ingestion/adapters/`): `ENABLED_ADAPTERS = [adguardTp, clearurls]` — two independent, license-compatible sources. Raw bytes land in `tools/rule-ingestion/quarantine/` (gitignored, never committed, never under `src/`). Only literal param-name facts are extracted.

**Gate stack** (evaluated without short-circuit; all four must pass for auto-merge):

| # | Gate | Guards | Fail-safe posture |
|---|---|---|---|
| 1 | `affiliate-guard` | Collision with known affiliate/landing param | Accept (no match = safe) |
| 2 | `corroboration-gate` | Fewer than `MIN_SIGNALS=2` independent sources | Reject (uncorroborated = unsafe) |
| 3 | `canary-gate` | Param breaks affiliate-survival canary in live `processUrl()` | Accept (no canary hit = safe) |
| 4 | `functional-bias-gate` | Known-functional name (search, pagination, locale, etc.) | Accept (no name = safe) |

Gates 1 and 3 are the P0 affiliate moat guards. Gate 2 is the corroboration floor (false-positive control). Gate 4 protects UX. The postures encode the asymmetric-risk principle structurally.

**Schedule:** `auto-ingest-rules.yml` runs Sunday 04:00 UTC + `workflow_dispatch`. It replicates the full CI gate suite inline, signs the artifact, opens/updates an idempotent PR, and squash-merges. Squash-merge is required because PRs opened by `GITHUB_TOKEN` do not re-trigger `ci.yml` (GitHub recursion guard).

---

## 7. Quality machinery

### PR gate (`.github/workflows/ci.yml`)

Every PR to `main` must pass, in order:

1. `typecheck` — `tsc --checkJs` over the full source tree
2. `lint:js` — ESLint flat config
3. `compile:rules` + artifact sync check (tracking-params.json, rules-manifest.json)
4. `build:dnr` + artifact sync check (wrapper-dnr-rules.json)
5. `build:content` + bundle sync check (cleaner-bundle.js)
6. `verify:quarantine` — confirms nothing under quarantine is tracked
7. `check:i18n` — no FIXME stubs or empty locale slots
8. `npm test` — full unit suite
9. `test:integration:stub` — stub integration tests (no live network)
10. `conformance:contextual` — CAPS Contextual conformance gate
11. `lint` (web-ext)

On push to `main`, step 9 is replaced by the full integration suite including live Worker contract tests.

### Release gate (`.github/workflows/release.yml`)

Triggered on `v*` tag push: unit tests → live integration → e2e Playwright → build:chrome → build:firefox → publish (CWS + AMO). DAG order enforced by job dependencies.

### Parity and sync guards (unit tests)

| Guard | Test file |
|---|---|
| Content bundle in sync with source | `cleaner-bundle-sync.test.mjs` |
| DNR STRIP tables match TRACKING_PARAMS | `strip-table-parity.test.mjs` |
| Manifests (Chrome/Firefox) in sync | `firefox-mv2.test.mjs`, `caps-manifest-sync.test.mjs` |
| CONTRIBUTING project-structure paths exist | `docs-claims.test.mjs` (assertion d) |
| README tracking-param/domain counts match live data | `docs-claims.test.mjs` (assertions a, b) |
| Module acyclicity (affiliates + storage splits) | `module-boundary-826.test.mjs` |
| Source-grep ratchet (no banned patterns in source) | `source-grep-ratchet.test.mjs` |
| URL_RE regex literal identical in SW + content script | `url-regex-sync.test.mjs` |
| Wrapper DNR rules match wrappers.json | `wrapper-dnr-rules-sync.test.mjs` |

### Discovered artifact validation (`.github/workflows/discovered-validate.yml`)

Triggered on `pull_request` and `push` scoped to `discovered/**`, `discovered.schema.json`, `tools/rule-ingestion/discovered-verify.mjs`, `tools/rule-ingestion/crawler-pubkey.txt`, and the workflow file itself. Runs `node tools/rule-ingestion/discovered-verify.mjs` (CLI mode: iterates `discovered/*.json`, validates shape + Ed25519 signature, fails closed on any error). Permissions: `contents: read` only. No auto-merge — CODEOWNERS at `.github/CODEOWNERS` auto-requests the maintainer for every `discovered/` PR.

### Conventions

- After editing `src/lib/affiliates-data.js` or any file imported by the bundle: run `npm run build:content`.
- After editing `src/rules/domain-rules.json`, `src/lib/affiliates-data.js`, or `src/rules/wrappers.json`: run `npm run compile:rules` (and `npm run build:dnr` for wrappers).
- Coverage is tracked on push to `main` (non-blocking); no threshold gate yet.

---

## 8. Where things live

```
src/
├── manifest.json              Chrome MV3 manifest
├── manifest.v2.json           Firefox MV2 manifest
├── background/
│   └── service-worker.js      PROCESS_URL handler, storage bootstrap
├── content/
│   ├── cleaner.js             Click interceptor + content-side processing
│   ├── cleaner-bundle.js      Bundled lib (generated — do not edit by hand)
│   ├── cleaner-bundle-src.mjs Bundle entry point (esbuild input)
│   ├── amp-redirect.js        AMP → canonical (MV2 only, document_end)
│   ├── bounce-state-cleaner.js  Bounce-tracking history-state cleaner
│   ├── dom-link-rewriter.js   DOM link rewriter (MutationObserver)
│   ├── dom-link-rewriter-click.js  Click-time link rewriter
│   ├── history-defuser.js     pushState/replaceState gate (isolated world)
│   ├── history-defuser-mainworld.js  Same, MAIN world
│   ├── window-name-defuser.js      window.name cleaner (isolated)
│   └── window-name-defuser-mainworld.js  Same, MAIN world
├── lib/
│   ├── affiliates.js          Hub: affiliate patterns + re-exports (#826)
│   ├── affiliates-data.js     TRACKING_PARAMS/PREFIXES/CATEGORIES (data leaf)
│   ├── redirect-networks.js   REDIRECT_NETWORK_PATTERNS + lookups (data leaf)
│   ├── cleaner.js             processUrl() — core URL cleaning logic
│   ├── wrapper-engine.js      Wrapper detection + extraction
│   ├── honor-creator.js       Honor Creator Mode decision
│   ├── param-classifier.js    Bounded-scope contextual classifier
│   ├── path-rules.js          Path-strip and path-affiliate rules
│   ├── storage.js             Hub: stats, session, domain rules, shortener (#826)
│   ├── prefs.js               PREF_DEFAULTS, getPrefs, setPrefs (pref leaf)
│   ├── storage-migrations.js  One-time migrations (migration leaf)
│   ├── remote-rules.js        Remote rule fetch/verify/merge
│   ├── i18n.js                i18n hub (locale registry + applyTranslations)
│   └── locales/               Per-locale data: en.mjs es.mjs pt.mjs de.mjs …
├── rules/
│   ├── tracking-params.json   DNR rules (generated from TRACKING_PARAMS)
│   ├── domain-rules.json      Per-domain preserve/strip rules (169 entries)
│   ├── path-strip-rules.json  Path-token strip rules (Amazon slug/ref, etc.)
│   ├── path-affiliate-rules.json  Path-based affiliate injection rules
│   ├── wrapper-dnr-rules.json DNR wrapper-unwrap rules (generated)
│   ├── wrappers.json          Wrapper recipe table (Ed25519-signed source)
│   ├── manifest.data.js       caps-spec direct-injection programs (vendored)
│   ├── manifest.json          rules-manifest (generated)
│   └── amp-redirect.json      AMP redirect DNR rules
├── popup/                     Browser action popup (popup.js, popup.html)
└── options/                   Full options page (options.js, options.html)

tests/
├── unit/                      Node.js test runner — ~4,400+ unit tests
│   ├── module-boundary-826.test.mjs  Acyclicity + re-export guards
│   ├── docs-claims.test.mjs          Machine-enforced README/CONTRIBUTING accuracy
│   ├── context-map.test.mjs          Path + load-bearing-claim guards for CONTEXT.md
│   ├── discovered-verify.test.mjs    Behavioral: schema accept/reject + Ed25519 sig round-trip
│   ├── discovered-workflow.test.mjs  Structural: trigger paths, permissions, Node 20, no auto-merge
│   └── …
├── integration/               Stub + live Worker contract tests
└── e2e/                       Playwright browser tests

tools/
├── rule-ingestion/            Auto-ingest pipeline (ingest → orchestrate → promote)
│   ├── adapters/              Signal-source adapters (adguard-tp, clearurls)
│   ├── gates/                 Orchestration gates (affiliate, corroboration, canary, functional)
│   ├── quarantine/            Ephemeral raw signals (gitignored)
│   ├── promote/               Signed promote artifact (gitignored except .gitkeep)
│   ├── discovered-verify.mjs  Hand-rolled Ed25519 verify + shape validator for discovered/ artifacts
│   └── crawler-pubkey.txt     Ed25519 public key for keypair-id crawler-2026-a
├── generate-rules.mjs         compile:rules entry point
├── bundle-content.mjs         build:content entry point
└── sign-rules.mjs             Ed25519 signing tool

docs/
└── adr/                       Architecture Decision Records
    ├── 0001-per-device-consent.md
    ├── 0002-denoise-pivot-creator-agnostic.md
    ├── 0003-awin-redirect-model-resolution.md
    ├── 0004-decommission-unwrap-server-native-shortener-resolution.md
    └── 0005-rule-scaling-pipeline.md

discovered/                    Crawler discovery artifact landing zone (audit trail)
├── .gitkeep                   Keeps the directory tracked on a fresh clone
└── README.md                  Arrival flow, schema/sig validation steps, reviewer checklist

discovered.schema.json         Human-facing JSON Schema contract for crawler artifacts

.github/
├── CODEOWNERS                 /discovered/ @yocreoquesi — auto-requests reviewer on every artifact PR
└── workflows/
    └── discovered-validate.yml  PR+push validate: shape check + Ed25519 verify; contents:read; no auto-merge
```

---

## Keeping this current

This file is the living architecture map. Update it in the same PR as any structural change:

- New module, renamed file, or directory restructuring → update section 5 and the directory table in section 8.
- New URL-processing step → update the data-flow diagram in section 3.
- New gate, workflow, or CI step → update section 7.
- New domain-language term → update section 4.
- Changed manifest difference → update section 2.

A stale map is worse than no map. A failing `tests/unit/context-map.test.mjs` means this file claims a path that no longer exists — fix the map, not the test.
