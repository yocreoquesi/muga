# MUGA: Storage Schema

Reference document for all data stored by the extension.

## chrome.storage.sync: User preferences

Synced across devices. ~100 KB quota.

Source of truth: `PREF_DEFAULTS` in `src/lib/storage.js`.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master on/off switch for all URL cleaning |
| `injectOwnAffiliate` | boolean | `true` | Scenario B: inject ourTag when no affiliate present (on by default; user can turn it off in onboarding or Settings) |
| `notifyForeignAffiliate` | boolean | `false` | Scenario C: show toast when foreign affiliate detected |
| `stripAllAffiliates` | boolean | `false` | Strip foreign affiliate params; own tag is still injected afterward if `injectOwnAffiliate` is on |
| `blacklist` | string[] | `[]` | Domain/param/value entries to always strip. Format: `"domain"` or `"domain::param::value"` |
| `whitelist` | string[] | `[]` | Affiliate values to never touch. Format: `"domain::param::value"` |
| `customParams` | string[] | `[]` | Extra tracking param names to strip beyond built-in list |
| `dnrEnabled` | boolean | `true` | Enable static DNR rule (declarativeNetRequest) for tracking param stripping |
| `activeDefenseEnabled` | boolean | `true` | Enable active-defense content scripts (history pushState/replaceState cleaning, window.name defusing, DOM link/click rewriting). Disable if these break a site (#1006) |
| `contextMenuEnabled` | boolean | `true` | Show "Copy clean link" in the right-click context menu |
| `blockPings` | boolean | `true` | Block `<a ping>` and `navigator.sendBeacon` calls |
| `ampRedirect` | boolean | `true` | Redirect AMP pages to canonical URL |
| `unwrapRedirects` | boolean | `true` | Unwrap tracking redirect URLs (e.g. ?url=, ?redirect=) |
| `language` | string | `"en"` | UI language. Supported: `"en"`, `"es"`, `"pt"`, `"de"` |
| `onboardingDone` | boolean | `false` | Whether the user has completed onboarding |
| `consentVersion` | string\|null | `null` | ToS version accepted (e.g. `"1.0"`). Bump to re-trigger consent on ToS changes |
| `consentDate` | number\|null | `null` | Unix timestamp (ms) of when the user accepted the ToS |
| `disabledCategories` | string[] | `[]` | Param categories to skip stripping (e.g. `["utm", "ads"]`) |
| `toastDuration` | number | `15` | How long the affiliate notification toast stays visible (seconds, 5–60) |
| `paramBreakdown` | boolean | `true` | Show per-category param breakdown in popup cleaned-URL receipt |
| `showReportButton` | boolean | `true` | Show "Report a problem" button in popup |
| `domainStats` | boolean | `true` | Track and display per-domain tracker counts in popup |
| `showBadge` | boolean | `true` | Show the tab's running count of stripped tracking params as a native toolbar badge (#910) |
| `remoteRulesEnabled` | boolean | `true` | On by default (#888): fetches Ed25519-signed rule updates at most once per 7 days (`credentials: "omit"`, no cookies, no identifiers). A fresh install makes this one outbound GET to rules.muga.app; disable in Settings for zero network activity. Supersedes REQ-OPT-1. |
| `honorCreatorMode` | boolean | `false` | Opt-in (#435, B12; wired in #452): preserve creator referral chains on trusted social-media and link-shortener redirects (a `detectWrapper()` match) when the referrer is in `creatorAllowlist`. Does not gate affiliate-redirect networks (Awin, Skimlinks, etc.) — those are preserved automatically via unconditional pass-through, independent of this pref (#907). |
| `creatorAllowlist` | string[] | `[]` | (#445, B13) Per-creator allowlist consumed by Honor Creator Mode. Referrer-domain-shaped strings (e.g. `youtube.com/@LinusTechTips`, `dot-css-news.com`). Capped at 100 entries (storage hygiene). CRUD in `src/lib/creator-allowlist.js`. |
| `canonicalExtractorEnabled` | boolean | `true` | (#442, B7) When the wrapper engine detects an opaque wrapper (host matched but no destination in URL), consult content-script-supplied `<link rel=canonical>` / JSON-LD `@id` before giving up. Default ON. |
| `crossSiteFrequencyEnabled` | boolean | `true` | (#446, B16) Local-only Cross-Site Frequency Tracker: maintains a `(paramName, sha256(value))` map keyed per first-party domain so the popup can flag params that appear on 3+ domains AND have 3+ distinct values. LRU-capped at 1000 unique params. NEVER transmitted. Toggle off to make observations a no-op and hide the freq subgroup. |
| `attributionLedgerEnabled` | boolean | `true` | (#460, A2) Persist the Attribution Ledger ring buffer to `chrome.storage.local["attributionLedger"]` so the popup's "Recent activity" section survives service-worker restarts. Toggle off to gate the SW writer (no local-storage writes; popup section stays empty). |
| `experimentalParamClassesEnabled` | boolean | `false` | (#544) EXPERIMENTAL shape-based param heuristic. Default OFF. When ON, strips params whose VALUE SHAPE matches a tracker pattern (suspicious key prefix `*_id`/`*clid`/`*_token`/`*_uid`/`*_session` AND value length > 16 AND Shannon entropy > 4.0 AND base64/hex/uuid charset — ALL four signals required). A hard-coded allowlist (`state`, `code`, `csrf_token`, `access_token`, …) is always exempt to protect oauth / session flows. With the flag OFF, behaviour is byte-identical to the #530 baseline. |
| `userCustomRules` | string[] | `[]` | (#536) Per-user custom strip rules promoted from the popup's "Strip locally" button on flagged Suspicious-params rows. Each entry is a bare param name (matched case-insensitively by the cleaner) stripped on EVERY host. Lives in sync so promotions follow the user across devices. Affiliate-preservation always wins (the affiliateParamSet skip in `stripTrackingParams` runs first), so a user can never accidentally strip their own creator referral tag. |
| `followShortenersEnabled` | boolean | `false` | (ADR-0004 phases 2-5, #699/#701) Opt-in: when ON, MUGA resolves the eight generic shorteners (bit.ly, tinyurl.com, t.co, link.medium.com, lnkd.in, fb.me, ebay.to, amzn.to) in-browser via `fetch(redirect:"manual")`. No MUGA server is involved. Requires the eight shortener host permissions, granted from the options toggle. Default OFF. Renamed from `privacyProxyEnabled` in phase 5 (ADR-0004, 2026-06-01); a one-time startup migration copies `privacyProxyEnabled=true` → `followShortenersEnabled=true` and deletes the old key. |
| `hoverPreviewEnabled` | boolean | `true` | (#1028, PoC) Desktop-only: `src/content/hover-preview.js` shows a small text-only tooltip with the real cleaned destination when the user hovers AND holds still over a link for `hoverPreviewDelayMs`, but ONLY when local unwrap/clean changes the link's host (wrappers / redirect networks). Fully local — no network, no new permissions. Default ON for this PoC. |
| `hoverPreviewDelayMs` | number | `3000` | (#1028, PoC) Hold duration (ms) before the hover preview tooltip appears. Not currently exposed in the Settings import/export path (see `src/lib/settings-schema.js`). |

### List entry format

```
"amazon.es"                      → strip all params on amazon.es
"amazon.es::tag::youtuber-21"    → strip/protect specific affiliate value
```

### Defaults source of truth

`src/lib/storage.js`: `PREF_DEFAULTS` object.

---

## chrome.storage.local: Stats, device flags, and ephemeral state

Device-only. ~10 MB quota.

| Key | Type | Default | Description |
|---|---|---|---|
| `stats.urlsCleaned` | number | `0` | Total URLs cleaned since install |
| `stats.junkRemoved` | number | `0` | Total tracking params stripped |
| `stats.referralsSpotted` | number | `0` | Total foreign affiliates detected |
| `firstUsed` | number\|null | `null` | Unix timestamp (ms) of first use. Used for nudge timing |
| `nudgeDismissed` | boolean | `false` | Whether the user dismissed the review nudge |
| `devMode` | boolean | `false` | Developer tools visible in Settings. Device-local — intentionally not synced across devices |
| `domainStats` | object | `{}` | Per-domain tracker counts map (`{ domain: { params, urls } }`). Capped at 50 domains (LRU eviction) |
| `remoteParams` | string[] | `[]` | Cached remote tracking params from the last signed fetch (only populated when remoteRulesEnabled) |
| `remoteRulesMeta` | object | see below | Metadata for the last remote-rules fetch: `{ version, fetchedAt, paramCount, lastError, published }` |
| `crossSiteFreq` | object | `{ params: {} }` | (#446, B16) Local-only frequency tracker state. Shape: `{ params: { [paramName]: { domains: string[], values: string[] /* sha256 hex */, lastSeen: number } } }`. LRU-capped at 1000 paramNames. NEVER transmitted. |
| `attributionLedger` | object | `{ events: [], capacity: 10 }` | (#460, A2) Rolling ring buffer of the last cleaner-pipeline events feeding the popup "Recent activity" section. Shape: `{ events: Array<{type, url, network?, creator?}>, capacity: number }`. Capacity caps the event count so the popup render is bounded. SW writes after every `processUrl` return; gated on `attributionLedgerEnabled`. Pure presenter lives in `src/lib/attribution-ledger.js`; popup view layer in `src/lib/attribution-ledger-view.js`. |
| `shortenerStats` | object | `{}` | (ADR-0004 phase 4, #700) Per-shortener native-resolution outcome counters. Shape: `{ "bit.ly": { pass: N, fail: N }, … }` for each host in `GENERIC_SHORTENERS`. Incremented by `incrementShortenerStat()` in `src/lib/storage.js` at the native-resolution callsite in the service worker. NEVER transmitted (not in PREF_DEFAULTS / sync). Visible in the Options advanced section when dev-mode is ON. |

---

## chrome.storage.session: Per-session state

Cleared when the browser closes. No quota concerns.

| Key | Type | Description |
|---|---|---|
| `history` | Array<{original, clean}> | Recent URL clean events (shown in popup history section) |
| `tab_{tabId}` | number | Count of URLs cleaned for a specific tab, reset on navigation (shown as tab badge in popup) |
| `tab_badge_{tabId}` | number | Running total of tracking params stripped for a specific tab, reset ONLY on tab close (#910). Drives the native toolbar badge via `setBadgeText`; survives navigation AND service-worker restarts, unlike `tab_{tabId}` above |

---

## processUrl return shape

The core `processUrl(rawUrl, prefs)` function in `src/lib/cleaner.js` returns:

```js
{
  cleanUrl: string,           // The cleaned URL (equals rawUrl if no changes)
  action: string,             // "untouched" | "cleaned" | "injected" | "detected_foreign" | "blacklisted" | "honored-creator"
  removedTracking: string[],  // Names of tracking params removed
  junkRemoved: number,        // Count of params removed + path segments cleaned
  detectedAffiliate: {        // null unless a foreign affiliate is detected (notifyForeignAffiliate on)
    param: string,
    value: string,
    pattern: object,          // The matched affiliate pattern
  } | null,
  preservedAffiliate: object | null,  // A creator/foreign tag deliberately left intact, else null
  creatorReferralPreserved: boolean,  // true when a path-based creator referral (e.g. Bookshop /a/) was honored
  // network and creator are present ONLY on the "honored-creator" shape:
  network?: string,
  creator?: string,
}
```
