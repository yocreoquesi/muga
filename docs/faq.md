# MUGA — Frequently Asked Questions

A direct, evidence-cited FAQ for skeptics. MUGA is the denoise extension for the web — it quiets the noise on every URL so the web feels clean and fast again. Every factual claim below is backed
by a line in the source tree of this repository. If you find a discrepancy
between what is written here and the code, the code wins — please open an
issue.

This document is intentionally written for a technical audience that has
already read the [Privacy policy](../src/privacy/privacy.html) and the
[Terms of service](../src/privacy/tos.html) and wants to verify the claims.

---

## For skeptics

### Q: Why install MUGA when I already have uBlock Origin / Brave / ClearURLs?

Because they solve a different problem. The generic class of "URL cleaners
and content blockers" (uBO with the privacy lists, Brave's built-in shields,
ClearURLs, etc.) is built to **strip everything that looks like noise** —
which is the right default for a general-purpose cleaner, but it also strips
affiliate parameters indiscriminately, because to a noise-detector they look
identical to tracking.

MUGA's design point is narrower and more opinionated:

1. **Remove the same noise parameters those tools remove** — `utm_*`,
   `fbclid`, `gclid`, `msclkid`, `mc_cid`, `igshid`, the rest of the usual
   set ([`src/lib/affiliates.js:33-100`](../src/lib/affiliates.js#L33-L100)).
2. **Preserve affiliate parameters that belong to a creator** — even on
   programs MUGA itself has no commercial relationship with (Booking,
   Vercel, DigitalOcean, etc.). The preservation table is sourced from
   MUGA's documented affiliate-program rules
   ([`src/lib/affiliates.js:852-861`](../src/lib/affiliates.js#L852-L861)).
3. **Be explicit about the one case where MUGA itself benefits** — affiliate
   injection — and gate it behind an opt-in checkbox during onboarding
   ([`src/lib/storage.js:84-86`](../src/lib/storage.js#L84-L86)).

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
([`src/lib/affiliates.js:33`](../src/lib/affiliates.js#L33)) and the
`AFFILIATE_PATTERNS` table
([`src/lib/affiliates.js:852`](../src/lib/affiliates.js#L852)) are
separate sources and are joined by the cleaner only at strip time.

### Q: What about parameters that are technically "noise" but live inside a redirect wrapper?

Those are stripped. MUGA categorises Awin / ShareASale / Admitad / Impact
Radius and similar redirect-based networks as "network-redirect" affiliates
and refuses to collaborate with them — the click is unwrapped to the
destination and the wrapper's noise is dropped. The architectural
rationale is in the README's *How it works* section; the implementation
lives in `src/lib/wrapper-engine.js` and is invoked from the cleaner.

### Q: How do I verify what MUGA does on my own machine?

- The full ruleset is in [`src/lib/affiliates.js`](../src/lib/affiliates.js).
- The cleaning pipeline is in [`src/lib/cleaner.js`](../src/lib/cleaner.js).
- The content-script bundle that runs in the page is committed at
  `src/content/cleaner-bundle.js` so reviewers can diff it against the
  ES module source it is generated from (noted explicitly in the privacy
  page at [`src/privacy/privacy.html:76`](../src/privacy/privacy.html#L76)).
- The unit tests under `tests/unit/` cover the cleaner's behaviour
  exhaustively. Run them locally with `npm test`.

---

## Affiliate model

### Q: Is MUGA monetised? How?

Yes. On a small set of supported stores, **if and only if the user opted in
during onboarding**, MUGA can inject its own affiliate tag into URLs that
arrive **without any affiliate tag at all**. The set of programs MUGA has
its own tag for is hardcoded in
[`src/lib/affiliates.js:790-814`](../src/lib/affiliates.js#L790-L814)
(Amazon and eBay marketplaces; a handful of programs pending account
approval; everything else is preservation-only).

### Q: Is injection on by default?

No. The default for `injectOwnAffiliate` is `false`:

```js
// src/lib/storage.js:86
injectOwnAffiliate: false,  // set to true only if user opts in during onboarding (#224)
```

The user is asked explicitly during onboarding via a checkbox that ships
unchecked unless the preference was already enabled on another device they
own ([`src/onboarding/onboarding.html:333`](../src/onboarding/onboarding.html#L333),
[`src/onboarding/onboarding.js:183-184`](../src/onboarding/onboarding.js#L183-L184)).
On a per-device basis, the user can decline even if a sibling device opted
in — the decline is stored as a local override and does not propagate back
to sync ([`src/onboarding/onboarding.js:170-176`](../src/onboarding/onboarding.js#L170-L176)).

### Q: Does MUGA ever overwrite an existing affiliate tag?

No. The injection branch in the cleaner is gated by
`!url.searchParams.has(pattern.param)` — if the URL already carries the
affiliate parameter for that program, injection is skipped entirely:

```js
// src/lib/cleaner.js:589-599
if (prefs.injectOwnAffiliate && !prefs.stripAllAffiliates && action !== "detected_foreign" && !blacklistRemovedAffiliate) {
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

That `!url.searchParams.has(pattern.param)` is the contract: if the
creator's tag is already there, MUGA does not touch it.

### Q: What happens if a creator's tag is on a program MUGA has no account on?

It is preserved anyway. The `ourTag` map is allowed to be empty for a
program — preservation does not require MUGA to have its own tag for that
program. The detection loop at
[`src/lib/cleaner.js:467-480`](../src/lib/cleaner.js#L467-L480) iterates
every pattern that matches the host, not just patterns where
`OUR_TAGS[prog.id]` is populated. Programs like Booking, Vercel,
DigitalOcean, Humble Bundle, and Lemon Squeezy ride this path
([`src/lib/affiliates.js:811-813`](../src/lib/affiliates.js#L811-L813),
and the comment block at lines 462-466 in `cleaner.js`).

### Q: Does my price change when MUGA injects its tag?

No. Affiliate programs pay a commission to the store, not the buyer. The
URL change only affects who the store credits with the referral. Your
checkout total is unchanged. This is the standard rebate-economy model
that Amazon Associates / eBay Partner Network / Bookshop / etc. all run.

---

## Network behavior

MUGA ships with two features that involve network requests. **Both are
opt-in, default-off, and both verify cryptographic signatures on every
response.** Without explicit opt-in, MUGA makes zero outbound network
requests.

### Q: What is the Privacy Proxy and when does it fire?

The Privacy Proxy is an opt-in feature for **opaque** affiliate-network
redirect URLs (Awin, ShareASale, Impact Radius, and similar) whose
destination cannot be extracted client-side. When enabled, MUGA sends the
opaque redirect URL to `unwrap.muga.app` (a Cloudflare Worker) and receives
back the resolved destination.

- Default: **off**. See
  [`src/lib/storage.js:169`](../src/lib/storage.js#L169):
  `privacyProxyEnabled: false`.
- Every response is verified with an **Ed25519 signature** before MUGA
  navigates anywhere. The verification entry point is in the service
  worker at
  [`src/background/service-worker.js:1042-1091`](../src/background/service-worker.js#L1042-L1091)
  and the actual signature check lives in
  [`src/lib/proxy-client.js:110-134`](../src/lib/proxy-client.js#L110-L134).
- If signature verification fails, the result is rejected with
  `reason: "signature"` and navigation does not proceed
  ([`src/lib/proxy-client.js:298-313`](../src/lib/proxy-client.js#L298-L313)).
- The Worker is only contacted for hostnames in a hardcoded
  `OPAQUE_NETWORKS` allowlist
  ([`src/background/service-worker.js:1083`](../src/background/service-worker.js#L1083));
  arbitrary URLs cannot be sent through it.

### Q: What are Remote Rules and how are they signed?

Remote Rules is an opt-in feature that lets MUGA periodically refresh its
noise-parameter list from a signed public endpoint, so users get
protection against new noise sources without waiting for an extension release.

- Default: **off**. See
  [`src/lib/storage.js:108`](../src/lib/storage.js#L108):
  `remoteRulesEnabled: false`.
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

The Privacy Proxy receives the **opaque redirect URL you would have visited
anyway** (e.g. an Awin redirect link). It does not receive your full
browsing history. It only receives a URL when you click an affiliate
network redirect and the feature is enabled.

Remote Rules sends no user data at all — it is a one-way `GET` of a
signed JSON file.

If you want zero network activity, leave both toggles off. Their defaults
already give you that.

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
[`src/lib/affiliates.js:790-814`](../src/lib/affiliates.js#L790-L814).
The cost base is intentionally low:

- The cleaner is a local computation; there is no per-user server cost.
- The Privacy Proxy runs on Cloudflare Workers, only fires when the user
  has opted in, and only fires on opaque redirect networks (a small subset
  of clicks).
- Remote Rules is a static signed JSON served from GitHub Pages.

If you want to support the project without enabling injection, the
[Ko-fi link in the README](../README.md#support) is the alternative.

### Q: What programs are NOT in MUGA, and why?

By design, MUGA refuses to participate in affiliate programs whose model
forces user clicks through external tracking servers (the "network-redirect"
class — Awin, ShareASale, Admitad, Impact Radius, and similar). The
extension still **strips** their noise parameters when encountered;
it just will not **inject** them on MUGA's behalf. The rationale is in
the onboarding copy
([`src/onboarding/onboarding.html:329-330`](../src/onboarding/onboarding.html#L329-L330))
and the comment at
[`src/lib/affiliates.js:815-825`](../src/lib/affiliates.js#L815-L825):
deprecated Booking / Humble Bundle entries are removed, and Apple's PHG
is intentionally not in `OUR_TAGS` because the program is closed to
small publishers.

### Q: What is the roadmap?

The roadmap lives in two places:

- [`OBJECTIVES.md`](../OBJECTIVES.md) — the high-level objectives and
  non-goals.
- [GitHub Issues](https://github.com/yocreoquesi/muga/issues) — the
  concrete work items.

Material changes to the privacy contract trigger a re-onboarding flow on
each device the next time the service worker wakes up
([`src/privacy/privacy.html:59`](../src/privacy/privacy.html#L59)), so
the user always has a chance to re-consent before behaviour changes.
