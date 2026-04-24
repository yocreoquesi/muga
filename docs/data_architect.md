# MUGA: Storage Schema

Reference document for all data stored by the extension.

## chrome.storage.sync: User preferences

Synced across devices. ~100 KB quota.

Source of truth: `PREF_DEFAULTS` in `src/lib/storage.js`.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master on/off switch for all URL cleaning |
| `injectOwnAffiliate` | boolean | `false` | Scenario B: inject ourTag when no affiliate present (opt-in during onboarding) |
| `notifyForeignAffiliate` | boolean | `false` | Scenario C: show toast when foreign affiliate detected |
| `stripAllAffiliates` | boolean | `false` | Strip ALL affiliate params, never inject |
| `blacklist` | string[] | `[]` | Domain/param/value entries to always strip. Format: `"domain"` or `"domain::param::value"` |
| `whitelist` | string[] | `[]` | Affiliate values to never touch. Format: `"domain::param::value"` |
| `customParams` | string[] | `[]` | Extra tracking param names to strip beyond built-in list |
| `dnrEnabled` | boolean | `true` | Enable static DNR rule (declarativeNetRequest) for tracking param stripping |
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
| `remoteRulesEnabled` | boolean | `false` | Opt-in: fetch signed remote parameter updates weekly. Default off (zero network activity on fresh install) |

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

---

## chrome.storage.session: Per-session state

Cleared when the browser closes. No quota concerns.

| Key | Type | Description |
|---|---|---|
| `history` | Array<{original, clean}> | Recent URL clean events (shown in popup history section) |
| `tab_{tabId}` | number | Count of URLs cleaned for a specific tab (shown as tab badge in popup) |

---

## processUrl return shape

The core `processUrl(rawUrl, prefs)` function in `src/lib/cleaner.js` returns:

```js
{
  cleanUrl: string,           // The cleaned URL (equals rawUrl if no changes)
  action: string,             // "untouched" | "blacklisted" | "cleaned" | "error"
  removedTracking: string[],  // Names of tracking params removed
  junkRemoved: number,        // Count of params removed + path segments cleaned
  detectedAffiliate: {        // null if no foreign affiliate detected
    param: string,
    value: string,
    id: string,
    name: string,
  } | null,
}
```
