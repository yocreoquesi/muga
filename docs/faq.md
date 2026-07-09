# MUGA: Frequently Asked Questions

A direct, evidence-cited FAQ for skeptics. MUGA is the denoise extension for the web, it quiets the noise on every URL so the web feels clean and fast again. Every factual claim below is backed
by a line in the source tree of this repository. If you find a discrepancy
between what is written here and the code, the code wins, please open an
issue.

This document is intentionally written for a technical audience that has
already read the [Privacy policy](privacy-page.html) and the
[Terms of service](../src/privacy/tos.html) and wants to verify the claims.

---

## For skeptics

### Q: Why install MUGA when I already have uBlock Origin / Brave / ClearURLs?

Because they solve a different problem. The generic class of "URL cleaners
and content blockers" (uBO with the privacy lists, Brave's built-in shields,
ClearURLs, etc.) is built to **strip everything that looks like noise**,
which is the right default for a general-purpose cleaner, but it also strips
affiliate parameters indiscriminately, because to a noise-detector they look
identical to tracking.

MUGA's design point is narrower and more opinionated:

1. **Remove the same noise parameters those tools remove**, `utm_*`,
   `fbclid`, `gclid`, `msclkid`, `mc_cid`, `igshid`, the rest of the usual
   set ([`src/lib/affiliates-data.js:18`](../src/lib/affiliates-data.js#L18)).
2. **Preserve affiliate parameters that belong to a creator**, even on
   programs MUGA itself has no commercial relationship with (Booking,
   Vercel, DigitalOcean, etc.). The preservation table is sourced from
   MUGA's documented affiliate-program rules
   ([`src/lib/affiliates.js:136`](../src/lib/affiliates.js#L136)).
3. **Be explicit about the one case where MUGA itself benefits**, affiliate
   injection, which is on by default for new installs and can be turned off
   during onboarding or any time in Settings, with cleaning and every
   protection unaffected ([`src/lib/prefs.js:25`](../src/lib/prefs.js#L25)).

If you only want noise removed and don't care about creator attribution,
a generic cleaner is fine. If you want the YouTuber who recommended you
that USB-C dock to actually get paid for the recommendation, you need a
tool that knows the difference between a noise param and an affiliate tag.

### Q: Doesn't preserving affiliate parameters defeat the denoise goal?

No, and the distinction matters. An affiliate tag like `?tag=somecreator-21`
identifies **the recommender**, not you. A tracking parameter like
`?fbclid=IwAR3...` identifies **you**, across sessions, across sites. MUGA
strips the second and preserves the first.

You can verify the distinction in the code: the `TRACKING_PARAMS` list
([`src/lib/affiliates-data.js:18`](../src/lib/affiliates-data.js#L18)) and the
`AFFILIATE_PATTERNS` table
([`src/lib/affiliates.js:136`](../src/lib/affiliates.js#L136)) are
separate sources and are joined by the cleaner only at strip time.

### Q: What about parameters that are technically "noise" but live inside a redirect wrapper?

MUGA leaves the redirect itself alone. Awin / ShareASale / Admitad / Impact
Radius and similar redirect-based networks are classified as
"network-redirect" affiliates and pass through unchanged: the redirect click
is the attribution event, so unwrapping it would break the payout the creator
earns. MUGA only strips generic tracking noise (UTM tags, click IDs) from the
final destination URL once you land there. These networks are listed in
`MUGA_EXCLUDED_IDS` (`src/lib/wrapper-engine.js`) and in
`AFFILIATE_REDIRECT_NETWORKS` (`src/lib/opaque-networks.js`), which mark them
pass-through.

### Q: How do I verify what MUGA does on my own machine?

- The full ruleset is in [`src/lib/affiliates.js`](../src/lib/affiliates.js).
- The cleaning pipeline is in [`src/lib/cleaner.js`](../src/lib/cleaner.js).
- The content-script bundle that runs in the page is committed at
  `src/content/cleaner-bundle.js` so reviewers can diff it against the
  ES module source it is generated from (noted explicitly in the privacy
  page at [`docs/privacy-page.html:73`](privacy-page.html#L73)).
- The unit tests under `tests/unit/` cover the cleaner's behaviour
  exhaustively. Run them locally with `npm test`.

---

## Affiliate model

### Q: Is MUGA monetised? How?

Yes. On a small set of supported stores, MUGA injects its own affiliate tag
into URLs that arrive **without any affiliate tag at all**. This is on by
default for new installs, and you can turn it off during onboarding or any
time in Settings. The set of programs MUGA has
its own tag for is hardcoded in
[`src/lib/affiliates.js:74`](../src/lib/affiliates.js#L74)
(Amazon and eBay marketplaces; a handful of programs pending account
approval; everything else is preservation-only).

### Q: Is injection on by default?

Yes, for new installs. The default for `injectOwnAffiliate` is `true`:

```js
// src/lib/prefs.js:25
injectOwnAffiliate: true,  // on by default; user can turn it off in onboarding or Settings (#1032)
```

The user sees this clearly during onboarding via a checkbox that ships
checked, and can uncheck it to opt out before finishing setup
([`src/onboarding/onboarding.html:96`](../src/onboarding/onboarding.html#L96),
[`src/onboarding/onboarding.js:183-184`](../src/onboarding/onboarding.js#L183-L184)).
On a per-device basis, the user can turn it off even if a sibling device
enabled it; the choice is stored as a local override and does not propagate
back to sync ([`src/onboarding/onboarding.js:170-176`](../src/onboarding/onboarding.js#L170-L176)).

### Q: Does MUGA ever overwrite an existing affiliate tag?

Only if you have BOTH "Remove all affiliate tags from other sources" and
MUGA's own-tag injection turned on. In that case the foreign tag is
first stripped (per your remove-all choice), then ours is injected into the
now-tagless URL. With injection alone (remove-all off), MUGA never touches an
existing foreign tag: it is detected and honored (`action = "detected_foreign"`).

The injection branch itself is still gated by
`!url.searchParams.has(pattern.param)`, so it never overwrites a tag that is
present at injection time (an own tag the remove-all step preserved
short-circuits it):

```js
// src/lib/cleaner.js (Step 6)
if (prefs.injectOwnAffiliate && action !== "detected_foreign" && !blacklistRemovedAffiliate) {
  const hostKeyInject = hostname.replace(/^www\./, "");
  for (const pattern of patterns) {
    const ourTagForHost = pattern.ourTag[hostKeyInject] || pattern.ourTag[hostname] || "";
    if (ourTagForHost && !url.searchParams.has(pattern.param)) {
      url.searchParams.set(pattern.param, ourTagForHost);
      action = "injected";
      break;
    }
  }
}
```

That `!url.searchParams.has(pattern.param)` is the contract: a tag already on
the URL at injection time is never overwritten in place.

### Q: What happens if a creator's tag is on a program MUGA has no account on?

It is preserved anyway. The `ourTag` map is allowed to be empty for a
program, preservation does not require MUGA to have its own tag for that
program. The detection loop at
[`src/lib/cleaner.js:679`](../src/lib/cleaner.js#L679) iterates
every pattern that matches the host, not just patterns where
`OUR_TAGS[prog.id]` is populated. Programs like Booking, Vercel,
DigitalOcean, Humble Bundle, and Lemon Squeezy ride this path
(the `AFFILIATE_PATTERNS` table,
[`src/lib/affiliates.js:136`](../src/lib/affiliates.js#L136)).

### Q: Does my price change when MUGA injects its tag?

No. Affiliate programs pay a commission to the store, not the buyer. The
URL change only affects who the store credits with the referral. Your
checkout total is unchanged. This is the standard rebate-economy model
that Amazon Associates / eBay Partner Network / Bookshop / etc. all run.

---

## Network behavior

MUGA ships with two features that involve network requests: Remote Rules
(on by default, #888) and "Follow shortener redirects" (opt-in,
default-off). If you disable both in Settings, MUGA makes zero outbound
network requests.

### Q: What is "Follow shortener redirects" and when does it fire?

"Follow shortener redirects" is an opt-in feature that resolves generic
URL shorteners (bit.ly, tinyurl.com, t.co, link.medium.com, lnkd.in,
fb.me, ebay.to) so you can see the destination before navigating. The
extension performs a direct `fetch(url, { redirect: "manual", credentials: "omit", cache: "no-store" })` to the shortener host and reads the
`Location` header. No MUGA server is contacted; there is no signed
envelope because the redirect comes straight from the shortener host.
Affiliate-redirect networks are NEVER followed.

- Default: **off** (`followShortenersEnabled: false`).
- Permissions are granted per-host only when you enable the feature, and
  are revocable at any time via your browser's extension settings.
- Implementation: `src/lib/native-shortener-resolver.js`.

### Q: What are Remote Rules and how are they signed?

Remote Rules is a feature that lets MUGA periodically refresh its
noise-parameter list from a signed public endpoint, so users get
protection against new noise sources without waiting for an extension release.

- Default: **on** (#888, once the signing infrastructure and defense-in-depth
  verification were ratified as production-ready, see the
  [CHANGELOG](../CHANGELOG.md)). See
  [`src/lib/prefs.js:65`](../src/lib/prefs.js#L65):
  `remoteRulesEnabled: true`. Disable it any time in Settings.
- Every fetched payload is verified with an **Ed25519 signature** against
  a hardcoded list of trusted public keys before any rule is applied.
  The verification is at
  [`src/lib/remote-rules.js:214-248`](../src/lib/remote-rules.js#L214-L248);
  the orchestrator that calls it is at
  [`src/lib/remote-rules.js:629-636`](../src/lib/remote-rules.js#L629-L636).
- On verification failure the previous ruleset is left untouched
  ([`src/lib/remote-rules.js:632-635`](../src/lib/remote-rules.js#L632-L635)).
- The fetch is size-capped and timeout-capped before the signature check
  even runs ([`src/lib/remote-rules.js:594-606`](../src/lib/remote-rules.js#L594-L606)).

### Q: Does any of this leak my browsing history?

When "Follow shortener redirects" is enabled, the **extension itself**
sends a `GET` directly to the shortener host (e.g. `bit.ly`)
with credentials omitted and no referrer. No MUGA server is involved;
the request goes to the same shortener host your browser would have
contacted on click. The only difference is that you never actually
navigate to that URL, so no page-load context is handed to the shortener.
It only fires on the seven opted-in shortener hosts when the feature is
enabled.

Remote Rules sends no user data at all: it is a one-way `GET` of a
signed JSON file.

If you want zero network activity, turn off both toggles in Settings.
"Follow shortener redirects" already defaults to off; Remote Rules
defaults to on (#888) and needs to be disabled explicitly.

---

## Sustainability

### Q: Who maintains MUGA?

A solo maintainer. MUGA is open source under GPL v3
([`LICENSE`](../LICENSE)) and accepts contributions, but the architectural
and release decisions are made by one person. This is a deliberate choice
to keep the project small enough to audit.

### Q: How does MUGA pay for itself?

Affiliate revenue from the injection feature described above, on the
small set of programs in
[`src/lib/affiliates.js:74`](../src/lib/affiliates.js#L74).
The cost base is intentionally low:

- The cleaner is a local computation; there is no per-user server cost.
- The "Follow shortener redirects" feature (opt-in, off by default) is
  resolved entirely inside the extension, no MUGA server is involved,
  so there is no per-resolution infrastructure cost.
- Remote Rules is a static signed JSON served from GitHub Pages, fetched
  at most once per 7 days.

If you want to support the project without enabling injection, the
[Ko-fi link in the README](../README.md#support) is the alternative.

### Q: What programs are NOT in MUGA, and why?

By design, MUGA refuses to participate in affiliate programs whose model
forces user clicks through external tracking servers (the "network-redirect"
class, Awin, ShareASale, Admitad, Impact Radius, and similar). The
extension still **strips** their noise parameters when encountered;
it just will not **inject** them on MUGA's behalf. The rationale is in
the `MUGA_EXCLUDED_IDS` set
([`src/lib/wrapper-engine.js:226`](../src/lib/wrapper-engine.js#L226))
and the comment at
[`src/lib/affiliates.js:105`](../src/lib/affiliates.js#L105):
deprecated Booking / Humble Bundle entries are removed, and Apple's PHG
is intentionally not in `OUR_TAGS` because the program is closed to
small publishers.

### Q: What is the roadmap?

The roadmap lives in [GitHub Issues](https://github.com/yocreoquesi/muga/issues), the concrete work items.

Material changes to the privacy contract trigger a re-onboarding flow on
each device the next time the service worker wakes up
([`docs/privacy-page.html:56`](privacy-page.html#L56)), so
the user always has a chance to re-consent before behaviour changes.
