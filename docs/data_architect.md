# MUGA: Storage Schema

Reference document for all data stored by the extension.

## chrome.storage.sync: User preferences

Synced across devices. ~100 KB quota.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master on/off switch for all URL cleaning |
| `injectOwnAffiliate` | boolean | `true` | Scenario B: inject ourTag when no affiliate present |
| `notifyForeignAffiliate` | boolean | `false` | Scenario C: show toast when foreign affiliate detected |
| `allowReplaceAffiliate` | boolean | `false` | Scenario C: allow replacing foreign tag with ours (requires notifyForeignAffiliate) |
| `stripAllAffiliates` | boolean | `false` | Strip ALL affiliate params, never inject |
| `dnrEnabled` | boolean | `true` | Enable static DNR rule (declarativeNetRequest) for tracking param stripping |
| `blockPings` | boolean | `true` | Block `<a ping>` and `navigator.sendBeacon` calls |
| `ampRedirect` | boolean | `true` | Redirect AMP pages to canonical URL |
| `unwrapRedirects` | boolean | `true` | Unwrap tracking redirect URLs (e.g. ?url=, ?redirect=) |
| `blacklist` | string[] | `[]` | Domain/param/value entries to always strip. Format: `"domain"` or `"domain::param::value"` |
| `whitelist` | string[] | `[]` | Affiliate values to never touch. Format: `"domain::param::value"` |
| `customParams` | string[] | `[]` | Extra tracking param names to strip beyond built-in list |
| `language` | string | `"en"` | UI language. Supported: `"en"`, `"es"` |
| `onboardingDone` | boolean | `false` | Whether the user has completed onboarding |

### List entry format

```
"amazon.es"                      → strip all params on amazon.es
"amazon.es::tag::youtuber-21"    → strip/protect specific affiliate value
```

### Defaults source of truth

`src/lib/storage.js`: `PREF_DEFAULTS` object.

---

## chrome.storage.local: Stats and ephemeral state

Device-only. ~10 MB quota.

| Key | Type | Default | Description |
|---|---|---|---|
| `stats.urlsCleaned` | number | `0` | Total URLs cleaned since install |
| `stats.junkRemoved` | number | `0` | Total tracking params stripped |
| `stats.referralsSpotted` | number | `0` | Total foreign affiliates detected |
| `firstUsed` | number\|null | `null` | Unix timestamp (ms) of first use. Used for nudge timing |
| `nudgeDismissed` | boolean | `false` | Whether the user dismissed the review nudge |

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
