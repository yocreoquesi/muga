# MUGA: Frequently Asked Questions

A direct, evidence-cited FAQ for skeptics. MUGA is a URL cleaner: it removes the tracking parameters it knows about, unwraps redirects, and reveals where a shortened link really goes. Every factual claim below is backed
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
   set (`TRACKING_PARAMS` in [`src/lib/affiliates-data.js`](../src/lib/affiliates-data.js)).
2. **Preserve affiliate parameters that belong to a creator**, even on
   programs MUGA itself has no commercial relationship with (Vercel,
   DigitalOcean, Apple Performance Partners, etc.). The preservation table
   is sourced from MUGA's documented affiliate-program rules
   (`AFFILIATE_PATTERNS` in [`src/lib/affiliates.js`](../src/lib/affiliates.js)).
3. **Never monetize through an affiliate tag of its own.** MUGA does not add
   any affiliate tag; it only recognizes and, by default, preserves the tags
   creators and third-party networks already placed on the link
   ([`src/lib/affiliates.js`](../src/lib/affiliates.js)).

If you only want noise removed and don't care about creator attribution,
a generic cleaner is fine. If you want the YouTuber who recommended you
that USB-C dock to actually get paid for the recommendation, you need a
tool that knows the difference between a noise param and an affiliate tag.

### Q: Doesn't preserving affiliate parameters defeat the point of cleaning?

No, and the distinction matters. An affiliate tag like `?tag=somecreator-21`
identifies **the recommender**, not you. A tracking parameter like
`?fbclid=IwAR3...` identifies **you**, across sessions, across sites. MUGA
strips the second and preserves the first.

You can verify the distinction in the code: the `TRACKING_PARAMS` list
(in [`src/lib/affiliates-data.js`](../src/lib/affiliates-data.js)) and the
`AFFILIATE_PATTERNS` table
(in [`src/lib/affiliates.js`](../src/lib/affiliates.js)) are
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
  page's "What data does MUGA handle?" section, [`docs/privacy-page.html`](privacy-page.html)).
- The unit tests under `tests/unit/` cover the cleaner's behaviour
  exhaustively. Run them locally with `npm test`.

---

## Affiliate model

### Q: Is MUGA monetised? How?

No. MUGA doesn't add any affiliate tag of its own, and it doesn't monetize
your clicks. By default it respects the referral of the creator who
recommended you, so they keep their credit. If you prefer, you can turn on
an option to also remove third-party affiliate tags. If you'd like to
support MUGA, see the sponsor links in the
[README](../README.md#support).

### Q: Does MUGA ever overwrite an existing affiliate tag?

Only if you turn on "Remove all affiliate tags from other sources" in
Settings. With that off, the default, MUGA leaves an existing tag alone:
it is detected and left in place (`action = "detected_foreign"` when a
foreign tag is preserved). With it on, third-party tags are stripped from
the URL; MUGA does not add a tag of its own in their
place.

### Q: What happens if a creator's tag is on a program MUGA has no account on?

It is preserved anyway, the same as on any other supported program. MUGA
does not hold an affiliate account on any store, so this question has the
same answer everywhere: the tag stays unless you explicitly enable
stripping. The detection loop in
[`src/lib/cleaner.js`](../src/lib/cleaner.js) iterates every pattern that
matches the host, regardless of MUGA's commercial relationship with that
program. Programs like Vercel, DigitalOcean, Lemon Squeezy and Apple
Performance Partners ride this path (the `AFFILIATE_PATTERNS` table,
[`src/lib/affiliates.js`](../src/lib/affiliates.js)).

### Q: Does my price change if I strip third-party affiliate tags?

No. Affiliate programs pay a commission to the store, not the buyer.
Removing the tag only changes who the store credits with the referral
(nobody, once removed). Your checkout total is unchanged.

---

## Network behavior

MUGA ships with two features that involve network requests: Remote Rules
(on by default, #888) and "Follow shortener redirects" (two switches:
resolving a link you open is on by default, resolving one you only hover
over is opt-in). If you disable all of them in Settings, MUGA makes zero
outbound network requests.

### Q: What is "Follow shortener redirects" and when does it fire?

"Follow shortener redirects" resolves the 19 generic URL shorteners
listed in `GENERIC_SHORTENERS` (`src/lib/opaque-networks.js`) so you can
see the destination before navigating. The full host list is enumerated
in the [privacy policy](privacy-page.html). The
extension performs `fetch(url, { redirect: "follow", credentials: "omit", cache: "no-store" })`
on the short link: the browser follows the whole redirect chain, so the
shortener host and every hop after it, including the destination, are
contacted directly from your browser. MUGA reads the final address from
the response URL and discards the page body. No MUGA server is
contacted; there is no signed envelope because the redirects come
straight from the shortener and the sites it points to.
Affiliate-redirect networks are NEVER followed.

- Two independent switches, split by privacy cost
  (`src/lib/prefs.js`): resolving a link **when you open it** is on by
  default, since you were navigating there anyway; resolving one **when
  you merely hover** is off by default and opt-in.
- The toggle is the gate. The handler
  ([`src/background/service-worker.js`](../src/background/service-worker.js),
  `RESOLVE_SHORTENER`) resolves nothing unless the extension is enabled,
  onboarding is done, and the switch matching the source (click or hover)
  is on. It re-checks that itself rather than trusting the caller.
- MUGA's manifest already carries broad host access on both browsers, so
  no separate permission prompt stands between the toggle and the first
  resolution. The per-host permissions are declared as optional so the
  list stays visible in your browser's extension settings; revoking them
  does not stop resolution, turning the switch off does.
- Implementation: `src/lib/native-shortener-resolver.js`.

### Q: What are Remote Rules and how are they signed?

Remote Rules is a feature that lets MUGA periodically refresh its
noise-parameter list from a signed public endpoint, so users get
protection against new noise sources without waiting for an extension release.

- Default: **on** (#888, once the signing infrastructure and defense-in-depth
  verification were ratified as production-ready, see the
  [CHANGELOG](../CHANGELOG.md)). See
  [`src/lib/prefs.js`](../src/lib/prefs.js):
  `remoteRulesEnabled: true`. Disable it any time in Settings.
- Every fetched payload is verified with an **Ed25519 signature** against
  a hardcoded list of trusted public keys before any rule is applied.
  The verification is `verifySignature` in
  [`src/lib/remote-rules.js`](../src/lib/remote-rules.js);
  the orchestrator that calls it is `runRemoteRulesFetch` in the same
  file.
- On verification failure the previous ruleset is left untouched
  (`runRemoteRulesFetch` in
  [`src/lib/remote-rules.js`](../src/lib/remote-rules.js)).
- The fetch is size-capped and timeout-capped before the signature check
  even runs (`fetchWithCap` in
  [`src/lib/remote-rules.js`](../src/lib/remote-rules.js)).

### Q: Does any of this leak my browsing history?

When "Follow shortener redirects" is enabled, the **extension itself**
sends a `GET` directly to the shortener host (e.g. `bit.ly`)
with credentials omitted and no referrer. No MUGA server is involved;
the request goes to the same shortener host your browser would have
contacted on click. The only difference is that you never actually
navigate to that URL, so no page-load context is handed to the shortener.
It only ever fires on the 19 shortener hosts in `GENERIC_SHORTENERS`, and
only for the half of the feature you left switched on.

Remote Rules sends no user data at all: it is a one-way `GET` of a
signed JSON file.

If you want zero network activity, turn off every toggle in Settings.
Both "Follow shortener redirects" (the on-open half) and Remote Rules
(#888) default to on and need to be disabled explicitly; the on-hover
half is already off.

---

## Sustainability

### Q: Who maintains MUGA?

A solo maintainer. MUGA is open source under GPL v3
([`LICENSE`](../LICENSE)) and accepts contributions, but the architectural
and release decisions are made by one person. This is a deliberate choice
to keep the project small enough to audit.

### Q: How does MUGA pay for itself?

MUGA does not monetize your clicks. It's free, ad-free, and does not add
any affiliate tag of its own. The cost base is intentionally low:

- The cleaner is a local computation; there is no per-user server cost.
- The "Follow shortener redirects" feature (opt-in, off by default) is
  resolved entirely inside the extension, no MUGA server is involved,
  so there is no per-resolution infrastructure cost.
- Remote Rules is a static signed JSON served from GitHub Pages, fetched
  at most once per 7 days.

If MUGA saves you time, the [sponsor links in the README](../README.md#support)
are how you can support development.

### Q: What programs does MUGA not treat as attribution to preserve, and why?

By design, MUGA does not treat redirect-based affiliate programs (the
"network-redirect" class: Awin, ShareASale, Admitad, Impact Radius, and
similar) as attribution to keep on the landing URL. The redirect itself is
the attribution event, so MUGA lets it pass through unchanged and only
strips their noise parameters from the final destination once you land
there. The rationale is in the `MUGA_EXCLUDED_IDS` set
([`src/lib/wrapper-engine.js`](../src/lib/wrapper-engine.js)) and the
comments in [`src/lib/affiliates.js`](../src/lib/affiliates.js).

### Q: What is the roadmap?

The roadmap lives in [GitHub Issues](https://github.com/yocreoquesi/muga/issues), the concrete work items.

Updating the terms does not re-prompt you and does not gate any feature.
MUGA follows the model uBlock Origin uses: the documents stay permanently
reachable rather than being announced once, and continuing to use the
extension after an update means you accept the updated terms. The
versioned re-acceptance engine was removed in
[ADR-0007](adr/0007-terms-available-not-accepted.md).
