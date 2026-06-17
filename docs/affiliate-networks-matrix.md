# Affiliate networks attribution matrix

**Version**: v1.0 (tier-1 + tier-2 + tier-3 — complete)
**Last updated**: 2026-05-24
**Next quarterly review**: 2026-08-24
**Owner**: Antonio Rodriguez ([@yocreoquesi](https://github.com/yocreoquesi))
**Scope**: redirect-based affiliate networks that MUGA used to exclude in 2.0 and now treats as first-class under [ADR-0002](adr/0002-denoise-pivot-creator-agnostic.md)

## Purpose

This document is the source of truth for how MUGA 2.1 treats post-redirect attribution. It feeds three code surfaces:

- `src/lib/opaque-networks.js` — which redirect hosts pass through vs get unwrapped ([#653](https://github.com/yocreoquesi/muga/issues/653))
- `src/lib/affiliates.js` `TRACKING_PARAMS` — which params can be stripped universally vs must be preserved on certain landings ([#655](https://github.com/yocreoquesi/muga/issues/655))
- `src/content/cleaner.js` `getLandingPolicy()` — runtime policy that decides per-page whether to preserve or strip ([#656](https://github.com/yocreoquesi/muga/issues/656))

It is also the contract the synthetic test harness ([#650](https://github.com/yocreoquesi/muga/issues/650)) validates on every PR. Matrix changes that are not reflected in the harness will silently regress creator attribution — every entry below has a corresponding fixture target.

## Methodology

Per-network entries draw from three sources, listed in order of trust:

1. **Direct codebase signal** — what MUGA already knows from its own integration history (TRACKING_PARAMS comments, vendored caps-spec data, redirect-unwrap tests, CHANGELOG).
2. **Network public docs** — official help center, developer portal, publisher FAQ articles that are reachable without an account.
3. **Third-party affiliate-marketing publications** — used only to corroborate or to surface mechanics that the networks themselves only document inside account-gated portals.

For every claim, the source is cited inline with a fetch date. Claims that cannot be verified from sources 1–3 are tagged **`[NEEDS PARTNER-ACCOUNT VERIFICATION]`** and must be confirmed before the corresponding code change ships. The synthetic harness will treat unverified entries as advisory until the tag is removed.

## How to read each section

Each network section has the same shape:

- **Surface** — the redirect host(s) and the merchant landing domain(s).
- **Click flow** — what happens between the user clicking and the page rendering, in concrete steps.
- **Attribution mechanism** — what carries the commission claim (cookie, URL param, S2S postback).
- **Cookie TTL / lookback window** — when the credit window expires.
- **Param table** — for every URL parameter the network appends, the verdict: `cookie-only`, `required-at-landing`, `required-at-checkout`, or `safe-to-strip`.
- **Recommended cleaner policy** — the per-network rule for `getLandingPolicy()`.
- **Verification status** — which lines are confirmed vs flagged for partner-account follow-up.

The param verdicts encode the load-bearing detail of the matrix. Their meanings:

| Verdict | Meaning |
|---|---|
| `cookie-only` | Network sets a cookie at the redirect step; the URL param is informational. Safe to strip immediately after landing. |
| `required-at-landing` | Merchant's first-party tag reads the param from the URL on landing and persists it. **Stripping at `document_start` kills the commission.** Must preserve until the merchant tag fires. |
| `required-at-checkout` | The param itself must remain in the URL across the entire session up to checkout — the conversion pixel reads it from the live URL, not from a cookie. Strictest preservation tier. |
| `safe-to-strip` | Independent of attribution; cleanable on every navigation. |

## Cross-cutting policy decisions

These apply across all tier-1 networks unless a section overrides:

1. **Redirect domains in `AFFILIATE_REDIRECT_NETWORKS` are passed through unmodified.** The redirect must execute in the browser so the network can set its own cookie. MUGA does **not** unwrap these client-side — neither the decommissioned server-side Worker (see ADR-0004) nor the current native resolver (`src/lib/native-shortener-resolver.js`) accepts them ([#659](https://github.com/yocreoquesi/muga/issues/659)).
2. **First landing is detected by document.referrer.** If `document.referrer.hostname` matches a known redirect host for the network, the landing is "first-touch" and `required-at-landing` params are preserved on that initial document only. On subsequent same-site navigations (referrer is same-origin), preserved params are eligible for cleanup — the merchant's first-party cookie has already captured them.
3. **`required-at-checkout` params are preserved across the entire session on the merchant's domain.** Stripping is gated until the user leaves the domain or the session times out.
4. **When in doubt, preserve.** A false-positive strip silently breaks creator payouts that surface weeks later. A false-positive preserve leaves a few extra characters in the URL bar. The asymmetry is enormous — the matrix biases toward preservation.

---

## Awin

**Surface**

- Redirect host: `awin1.com` (primary), `www.awin1.com`. Variants `awinmid.com`, `aweur.com` exist in some legacy integrations and are out of scope until observed in the wild.
- Merchant landing: any advertiser onboarded to Awin (broad — fashion, telecom, finance, retail). Awin does not own a single merchant domain; the landing is the merchant's own.
- Redirect endpoint shapes:
  - `awin1.com/cread.php?awinmid=<mid>&awinaffid=<aid>&p=<encoded merchant URL>` — most common publisher-generated link.
  - `awin1.com/cread.php?ued=<encoded merchant URL>` — newer "URL encoded destination" variant.
  - `awin1.com/awclick.php` — alternate click endpoint used in some MasterTag flows.

**Click flow**

1. User clicks publisher's Awin-wrapped link.
2. Browser hits `awin1.com/cread.php` (or `awclick.php`).
3. Awin's server logs the click with `awinmid` + `awinaffid` + timestamp; **sets a cookie on the `awin1.com` domain** and issues a 30x redirect.
4. Browser follows redirect to the merchant landing URL with `?awc=<encoded click context>` appended.
5. Merchant's site (typically via Awin MasterTag JS or a server-side tag) reads `awc` from the URL and stores it in a **first-party cookie on the merchant's domain**, configured `Secure` and `HttpOnly`.
6. At checkout, the merchant's conversion pixel sends the stored `awc` back to Awin to claim the commission.

**Attribution mechanism**

Hybrid. The Awin-side cookie on `awin1.com` is informational (it does not survive third-party-cookie blocking like ITP). The load-bearing piece is the **merchant's first-party cookie populated from the `awc` URL param at landing**. S2S (server-to-server) is offered as a more recent ITP-resilient alternative that does not change the `awc`-at-landing requirement.

Source: Awin help center, ["Cookie Tracking – Publisher FAQs"](https://success.awin.com/s/article/Cookie-Tracking-Publisher-FAQs) and ["Understanding Awin MasterTag"](https://help.awin.com/advertisers/docs/en/understanding-awin-mastertag), fetched 2026-05-24. Cross-referenced with [Awin's public attribution overview](https://www.awin.com/us/affiliate-marketing/everything-you-need-to-know-about-affiliate-tracking).

**Cookie TTL / lookback window**

- Retail programmes: **30 days** (industry default).
- Travel and finance programmes: **60–90 days**, varies by advertiser.
- Last-click attribution by default. Some advertisers run first-click or custom models — those are advertiser-configured, not network-default.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `awc` | **required-at-landing** | Merchant MasterTag reads this on the landing page to populate the first-party cookie. Currently in `TRACKING_PARAMS` — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `awinmid` | `cookie-only` | Merchant ID. Stored in Awin's own log; not consumed by the merchant tag. Safe to strip post-landing. |
| `awinaffid` | `cookie-only` | Affiliate ID. Same as awinmid. Safe to strip post-landing. |
| `p` (in cread.php URLs) | n/a (redirect-internal) | This is the encoded destination on the redirect URL itself, not on the landing page. Never strip — stripping breaks the redirect. |
| `ued` (in cread.php URLs) | n/a (redirect-internal) | Same as `p`, newer variant. Never strip. |
| `wt_mc` | **required-at-landing** | Webtrekk/Awin campaign tracking, used by MediaMarkt and other Awin advertisers. Currently in `TRACKING_PARAMS` — MUST be removed from universal strip. |

**Recommended cleaner policy**

```
hostname matches an Awin advertiser merchant domain
  AND document.referrer.hostname matches awin1.com (or known variant)
  → preserve awc and wt_mc on this document
  → safe-to-strip on subsequent same-site navigations
```

In practice, "Awin advertiser merchant domain" is open-ended — Awin does not publish the full merchant list publicly. The matrix entry for the cleaner pivots on the **referrer**, not on the merchant domain: if the user just came from `awin1.com`, treat the landing as first-touch regardless of what merchant they landed on.

**Verification status**

- ✅ `awc` is required at landing — confirmed by Awin publisher FAQ wording ("configure your site to record the awc value in a cookie when the user lands on your site").
- ✅ Cookie TTL ranges — confirmed across multiple Awin help articles + third-party publishers.
- ⚠️ **`wt_mc` is required-at-landing** — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. The MediaMarkt/Webtrekk integration is documented inside Awin's advertiser portal, not public. The current MUGA codebase comment ([`src/lib/affiliates.js:66`](../src/lib/affiliates.js)) treats it as Awin click ID by association. Treat as preserve until confirmed.
- ⚠️ Behavior of `awc` after the MasterTag fires — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Confidence is high that subsequent strips are safe, but the synthetic harness ([#650](https://github.com/yocreoquesi/muga/issues/650)) should specifically exercise "first landing → preserve, second navigation → strip" before this policy lands in production.

**Implementation status (2026-05-26)**

The matrix policy above is **accepted but not yet enforced in code**. Awin currently lives in `src/lib/wrapper-engine.js` as a local-unwrap entry inherited from 2.0 — the user never hits `awin1.com`, which loses the `awc` / `wt_mc` signal that the 30x would otherwise append. See [ADR-0003](./adr/0003-awin-redirect-model-resolution.md) for the resolution: Awin moves from `WRAPPERS` to `AFFILIATE_REDIRECT_NETWORKS` (pass-through), with `awc` / `wt_mc` preserved at landing via `getLandingPolicy(hostname, referrer)`.

Implementation is blocked on [#656](https://github.com/yocreoquesi/muga/issues/656) (`getLandingPolicy`). Until the retirement PR ships, the synthetic harness ([#650](https://github.com/yocreoquesi/muga/issues/650)) reports Awin G1 as `pass-through:PENDING` rather than enforcing.

---

## CJ Affiliate (Commission Junction)

**Surface**

- Redirect hosts: 8 CJ-owned domains, all in `OPAQUE_NETWORKS` today:
  - `anrdoezrs.net`, `dpbolvw.net`, `jdoqocy.com`, `kqzyfj.com`, `tkqlhce.com`, `emjcd.com`, `qksrv.net`, `cj.dotomi.com`
- Merchant landing: any CJ-onboarded advertiser. Same broad coverage as Awin.
- Endpoint shape: `<cj-domain>/click-<pid>-<aid>` plus query params, with the destination encoded in `url=` on some templates.

**Click flow**

1. User clicks publisher's CJ-wrapped link.
2. Browser hits one of the 8 CJ redirect domains.
3. CJ logs the click and **sets the `cje` cookie** on the redirect domain (this is the network-side cookie; ITP-vulnerable).
4. Browser is redirected to the merchant landing URL with `?cjevent=<event-id>` appended (sometimes `cjdata=<encoded-extras>` too).
5. Merchant's site reads `cjevent` from the URL and stores it in a **first-party cookie on the merchant's domain** (CJ's docs recommend a 365-day TTL for identity sync, with a 395-day PHP example).
6. At checkout, the merchant's CJ Universal Tag reads the value from the `cje` cookie (either the network-set one if it survived, or the merchant-set first-party one) and passes it back to CJ.

**Attribution mechanism**

Hybrid, same family as Awin. The load-bearing piece is the **merchant's first-party cookie populated from `cjevent` at landing**. S2S is offered as an ITP-resilient alternative; it still requires the advertiser to capture, store, and pass back the Event ID — meaning `cjevent` still needs to land on the merchant page in the URL.

Source: ["Commission Junction Tracking" — Trackingplan, 2026](https://webflow.trackingplan.com/blog/commission-junction-tracking), [CJ's own "HTTP Response Cookie" advertiser docs](https://developers.cj.com/docs/advertiser-site-tracking/http-response-cookie), and [CJ's ITP 2.2 advisory](https://junction.cj.com/article/advertiser-integration-solutions-for-itp-2.2-and-beyond), all fetched 2026-05-24.

**Cookie TTL / lookback window**

- Recommended first-party storage: **365 days** (identity sync recommendation) or 395 days per CJ's published PHP example.
- Actual attribution window is **per advertiser**, typically 30 days for retail, longer for high-consideration verticals.
- Last-click attribution by default. ITP 2.2: cookies set by `document.cookie` are deleted after 24 hours, hence CJ's push toward HTTP response cookies and S2S.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `cjevent` | **required-at-landing** | The CJ Event ID. Merchant tag reads this on landing to populate the first-party cookie. Currently in `TRACKING_PARAMS` — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `cjdata` | **required-at-landing** | Encoded extras (frequently includes additional click context). Same handling as cjevent. Currently in `TRACKING_PARAMS`. |
| `cje` (cookie value) | n/a | This is a cookie, not a URL param. Not visible to MUGA. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND document.referrer.hostname matches one of the 8 CJ redirect domains
  → preserve cjevent and cjdata on this document
  → safe-to-strip on subsequent same-site navigations
```

Same referrer-based pivot as Awin. The merchant list is not publicly enumerable, so the policy keys on the redirect domain, not on the merchant.

**Verification status**

- ✅ `cjevent` is required at landing — confirmed by CJ's own developer docs and multiple third-party explainers.
- ✅ `cjdata` is in the same family — confirmed by CJ's advanced integration HTML example.
- ✅ Cookie TTL recommendation (365–395 days) — confirmed by CJ's own example code.
- ⚠️ Whether `cjevent` can be safely stripped after the CJ tag has fired on the merchant page — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. High confidence yes, but the synthetic harness must specifically test "first landing → preserve, second navigation → strip" before policy lands.
- ⚠️ Whether `cjdata` is strictly required or merely informational — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Treat as required until confirmed otherwise (bias toward preservation).

---

## AliExpress (Portals + multi-network)

**Surface**

- Redirect hosts:
  - `s.click.aliexpress.com` — direct AliExpress Portals affiliate redirect (in `OPAQUE_NETWORKS` today).
  - AliExpress also runs through CJ, Awin, and Admitad in some markets. Those flows are covered by the corresponding network's section above, **not** by this AliExpress-direct section.
- Merchant landing: `aliexpress.com`, regional TLDs (`aliexpress.es`, `aliexpress.fr`, `aliexpress.de`, `aliexpress.it`, `aliexpress.com.br`, etc.), and the AliExpress mobile-app deep links.

**Click flow**

1. User clicks publisher's Portals affiliate link (e.g. `s.click.aliexpress.com/e/<encoded-shortcode>`).
2. Browser hits `s.click.aliexpress.com`.
3. AliExpress logs the click, **sets a session cookie on `.aliexpress.com`** (first-party since AliExpress owns both the redirect domain and the merchant domain — this is a structural advantage over Awin/CJ).
4. Browser is redirected to the AliExpress product or storefront page with one or more of: `aff_trace_key`, `aff_request_id`, `algo_pvid`, `algo_expid`, `btsid`, `ws_ab_test`, `afsmartredirect`, `gatewayadapt`, `mall_affr` appended.
5. AliExpress's own front-end tags read these params for analytics, A/B test attribution, and reinforcement of the cookie set at step 3.
6. At checkout, AliExpress's first-party stack handles attribution — no merchant integration is needed since AliExpress IS the merchant.

**Attribution mechanism**

**Self-hosted, single-domain.** AliExpress is structurally different from Awin/CJ: because the redirect domain (`s.click.aliexpress.com`) and the merchant domain (`aliexpress.com`) share the eTLD+1 `aliexpress.com`, the cookie set at step 3 is already first-party from the merchant's perspective. The URL params at landing are **mostly informational/analytics rather than load-bearing for commission attribution**.

That said: AliExpress is notorious for opaque, frequently-changing internal tagging. Some params *may* be used to disambiguate attribution in edge cases (cookie clearing between click and purchase, multi-publisher last-click decisions). The conservative read is: preserve on first landing; strip on subsequent same-site navigations once the cookie has settled.

Source: [Strackr, "Affiliate Marketing with AliExpress"](https://strackr.com/blog/aliexpress-affiliate-program), [Avelon Network's attribution-windows reference](https://avelonetwork.com/support/brand/affiliate-attribution-windows-first-party-cookies), [AffCaptain's program review](https://affcaptain.com/affiliate-program/aliexpress-affiliate-program/), all fetched 2026-05-24.

**Cookie TTL / lookback window**

- **3 days** (much shorter than Awin or CJ). Industry-known short window.
- Last-click attribution by default.
- AliExpress's own model is specifically described as "last click — first order": the credit goes to the affiliate whose link was the last clicked before the customer's first purchase within the 3-day window.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `aff_trace_key` | **required-at-landing** | Currently in `TRACKING_PARAMS` ([affiliates.js:95](../src/lib/affiliates.js)) — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). On first landing the AliExpress tag may use it to reinforce the cookie. |
| `aff_request_id` | **required-at-landing** | Same family as aff_trace_key. Currently in TRACKING_PARAMS. |
| `algo_pvid` | **required-at-landing** | A/B/algorithm tracking. Treated as required-at-landing on conservative bias; partner-account verification pending. |
| `algo_expid` | **required-at-landing** | Same as algo_pvid. |
| `btsid` | **required-at-landing** | Bucket/test session ID. Same handling. |
| `ws_ab_test` | **required-at-landing** | Site A/B test bucket. Same handling. |
| `afsmartredirect` | `cookie-only` | Redirect-internal flag, not consumed by merchant tag. Safe-to-strip post-landing. |
| `gatewayadapt` | `cookie-only` | Same as afsmartredirect. |
| `mall_affr` | `cookie-only` | Mall-affiliate flag, redirect-internal. |

**Recommended cleaner policy**

```
hostname is *.aliexpress.* (regional TLDs included)
  AND document.referrer.hostname is s.click.aliexpress.com
  → preserve aff_trace_key, aff_request_id, algo_pvid, algo_expid, btsid, ws_ab_test on this document
  → safe-to-strip on subsequent same-site navigations
```

A second policy branch covers AliExpress arriving through CJ/Awin/Admitad: in those flows, the network-side section above takes precedence (`cjevent` / `awc` matter; the AliExpress-specific params are noise).

**Verification status**

- ✅ 3-day cookie window — confirmed across multiple third-party publications.
- ✅ Last-click-first-order attribution model — confirmed.
- ⚠️ Whether `aff_trace_key` is strictly required at landing or whether the first-party cookie alone suffices — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Inference is "required-at-landing" based on AliExpress's known frequent A/B testing of its attribution stack; conservative preservation chosen.
- ⚠️ Whether `algo_pvid` / `algo_expid` / `btsid` / `ws_ab_test` carry attribution weight or are purely analytics — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Treated as required-at-landing on bias.
- ⚠️ AliExpress mobile-app deep link behavior — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Out of scope for v0; the deep-link surface is different enough that it deserves its own matrix entry once observed.

---

## Impact Radius (impact.com)

**Surface**

- Redirect host pattern: `*.pxf.io` — Impact assigns brand-specific subdomains (`gohealth.pxf.io`, `target.pxf.io`, `walmart.pxf.io`, etc.). The apex `pxf.io` itself is not used as a redirect endpoint.
- Merchant landing: any Impact-onboarded advertiser. Notable advertisers known to be on Impact: Walmart, Target, Adidas, Uber, Airbnb, McAfee. Humble Bundle migrated to Impact when its direct affiliate program was deprecated (see `src/rules/manifest.json` deprecation note).
- Endpoint shape: `<brand>.pxf.io/c/<click-id>/<advertiser-id>/<...>?subId1=<pubref>&...`. Path-encoded rather than purely query-string.
- **Retired from wrapper-engine in #692** (ADR-0003 follow-up). `*.pxf.io` is now in `AFFILIATE_REDIRECT_NETWORKS` (via the new wildcard primitive — entry `"*.pxf.io"`) and the `impact` caps-spec id is in `MUGA_EXCLUDED_IDS` in `src/lib/wrapper-engine.js`. `bounce-state-cleaner.js` no longer detects `*.pxf.io` as an intermediary.

**Click flow**

1. User clicks publisher's Impact-wrapped link, e.g. `target.pxf.io/c/3456789/abc/<payload>`.
2. Browser hits the brand-subdomain on `*.pxf.io`.
3. Impact's edge logs the click, fingerprints the device, and issues a 30x redirect.
4. Browser is redirected to the merchant landing URL with `?irclickid=<click-id>` (and sometimes `irgwc`, `ir_adid`, `ir_campaignid`, `ir_partnerid`, `iclid`) appended.
5. Merchant's site reads `irclickid` from the URL and stores it in a **first-party cookie or `localStorage` on the merchant's domain**. Impact's third-party guidance explicitly recommends this pattern for ITP resilience.
6. At checkout, the merchant's pixel (server-side postback or client-side tag) reads the stored `irclickid` and posts the conversion back to Impact.

**Attribution mechanism**

Same family as Awin / CJ — load-bearing piece is the merchant's first-party storage populated from `irclickid` at landing. Impact heavily promotes server-side postbacks ("S2S") as the ITP-resilient default. Either way, `irclickid` must reach the merchant page once.

Source: [Impact + AnyTrack integration docs](https://anytrack.io/integrations/affiliate-networks/impact), [GA4Addon audit on irclickid attribution](https://www.ga4addon.com/google-analytics-audit/irclickid-should-be-affiliate), [Impact Postback URL docs (AnyTrack)](https://docs.anytrack.io/affiliate-networks-integrations/impact). Cross-referenced with [impact.com's "Tracking Link Parameters Explained" help article](https://help.impact.com/en/support/solutions/articles/155000000123-tracking-link-parameters-explained). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **Advertiser-configured per program**. Impact does not publish a default. Industry norm is 30 days for retail; longer for high-consideration (travel, SaaS).
- Last-click attribution by default.
- Impact pushes hybrid models (postback + tag) so the same conversion is double-tracked for resilience.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `irclickid` | **required-at-landing** | Primary click ID. Merchant tag/postback reads this from the URL on landing. Currently in `TRACKING_PARAMS` ([`affiliates.js:325`](../src/lib/affiliates.js)) — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `irgwc` | **required-at-landing** | Older / alternate click ID form. Currently in `TRACKING_PARAMS` ([`affiliates.js:62`](../src/lib/affiliates.js)). Same handling. |
| `iclid` | **required-at-landing** | Variant click ID seen in some integrations. Currently in `TRACKING_PARAMS` ([`affiliates.js:406`](../src/lib/affiliates.js)). Same handling on conservative bias. |
| `ir_adid` | `cookie-only` | Ad ID, analytics. Not consumed by attribution tag. Safe to strip post-landing. |
| `ir_campaignid` | `cookie-only` | Campaign ID, analytics. Safe to strip post-landing. |
| `ir_partnerid` | `cookie-only` | Partner ID — already encoded in the click; redundant on the landing. Safe to strip post-landing. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND document.referrer.hostname matches /\.pxf\.io$/
  → preserve irclickid, irgwc, iclid on this document
  → safe-to-strip on subsequent same-site navigations
ir_adid, ir_campaignid, ir_partnerid → strippable always (analytics, not load-bearing)
```

Note that under 2.0, `src/content/bounce-state-cleaner.js` actively detects `*.pxf.io` for unwrap-cleaning. That detection must invert under 2.1 — Impact subdomains become "pass through, do not unwrap, do not bounce-clean".

**Verification status**

- ✅ Domain pattern `*.pxf.io` — confirmed by Impact's own customer integrations and multiple third-party tools.
- ✅ `irclickid` is the canonical click ID and is required on the landing URL — confirmed by Impact integration docs.
- ⚠️ Whether `irgwc` and `iclid` are interchangeable with `irclickid` or carry distinct semantics — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Conservative treatment as required-at-landing.
- ⚠️ Exact cookie TTL across advertiser tiers — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Industry norm assumed; the matrix entry does not depend on the exact TTL — only on the "preserve at landing" verdict.
- ⚠️ Whether `ir_*` params can be safely stripped on first landing or whether they're consumed by the conversion postback — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Current entry treats them as analytics-only (safe-to-strip); harness should specifically test this.

---

## Partnerize (Performance Horizon)

**Surface**

- Redirect host: `prf.hn`. Currently in `OPAQUE_NETWORKS` ([`opaque-networks.js:51`](../src/lib/opaque-networks.js)) with the comment "opaque path — no client-side extractor" and resolved server-side via the Worker HEAD chain (PR-04).
- Merchant landing: any Partnerize-onboarded advertiser. Notable advertisers known to use Partnerize: Apple (Apple Performance Partners is curated; some regional Apple Services partnerships flow through Partnerize), British Airways, Expedia Partner Solutions (Vrbo), John Lewis, etc.
- Endpoint shape: `https://prf.hn/click/camref:<camref>[?adref=...]` (`camref` = campaign reference, `adref` = optional ad-creative reference). Deep links can be passed via `destination` or as URL path encoding.

**Click flow**

1. User clicks publisher's Partnerize link, e.g. `prf.hn/click/camref:1011lABCD`.
2. Browser hits `prf.hn`. Partnerize logs the click and issues a 30x redirect (the destination is opaque from the URL — Partnerize stores it server-side keyed by `camref` and the publisher's pre-configured destination).
3. Browser is redirected to the merchant landing URL with `?clickref=<click-id>` appended (in some legacy integrations also `pubref` and `adref` echoes).
4. Merchant's "Partnerize Tag" (first-party JS) reads `clickref` from the URL and stores it in a **first-party cookie on the merchant's domain**.
5. At checkout, the Partnerize Tag reads `clickref` from the first-party cookie and fires the conversion pixel.

**Attribution mechanism**

Explicit and well-documented. From Partnerize's own docs: "Partnerize's first party tracking relies on a click ID (clickref) being stored either client or server side as a 1st party cookie. If the clickref isn't stored, then in most cases, Partnerize is unable to attribute the conversion to a click and the sale won't be attributed."

This is the cleanest documented confirmation of the pattern across the entire matrix. **`clickref` MUST be present on the landing URL.** Stripping it before the Partnerize Tag fires kills 100% of attribution.

Source: [Partnerize Tag First Party Integration (PHG Help)](https://help.phgsupport.com/hc/en-us/articles/360020029897-Tracking-Partnerize-Tag-First-Party-Integration), [Partnerize Clickref Pixel Integration (PHG Help)](https://help.phgsupport.com/hc/en-us/articles/4834811308957-Tracking-Partnerize-Clickref-Pixel-Integration), [Partnerize tracking platform](https://partnerize.com/platform/track), [Vrbo Partnerize Linking Guide](https://cdn.expediapartnersolutions.com/ean-rapid-site/Vrbo_Partnerize_Linking_Guide.pdf?mtime=20221123154015). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **Advertiser-configured per program**. Partnerize does not publish a default. Apple and major retailers commonly run 7–30 day windows.
- Last-click attribution by default. Partnerize supports linear, position-based, and custom models for advertisers who opt in.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `clickref` | **required-at-landing** | Primary click ID. The Partnerize Tag reads this on landing to populate the first-party cookie. NOT currently in `TRACKING_PARAMS` — but also not yet in `AFFILIATE_PATTERNS` for preservation; gap to close in [#654](https://github.com/yocreoquesi/muga/issues/654). |
| `pubref` | **required-at-landing** | Publisher reference echoed by Partnerize. Used by the merchant tag in some integrations to disambiguate publishers within a campaign. Conservative preserve. |
| `adref` | **required-at-landing** | Ad/creative reference. Less load-bearing than `clickref` but still consumed by the Partnerize Tag in some integrations. Conservative preserve. |
| `camref` (in prf.hn URL) | n/a (redirect-internal) | Campaign reference in the redirect URL itself, not on the landing page. |
| `destination` (in prf.hn URL) | n/a (redirect-internal) | Override destination param. Same. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND document.referrer.hostname is prf.hn
  → preserve clickref, pubref, adref on this document
  → safe-to-strip on subsequent same-site navigations
```

**Historical note (decommissioned — see ADR-0004)**: the server-side Worker previously resolved `prf.hn` via HEAD chain. That Worker is decommissioned as of v2.2.0. `prf.hn` was added to `AFFILIATE_REDIRECT_NETWORKS` and is excluded from the native resolver (`src/lib/native-shortener-resolver.js`) per [#659](https://github.com/yocreoquesi/muga/issues/659).

**Verification status**

- ✅ `clickref` is the canonical click ID and is required at landing — **explicitly documented by Partnerize themselves**, strongest verification in the entire matrix.
- ✅ `prf.hn` is the redirect domain — confirmed in MUGA codebase and Partnerize docs.
- ✅ The merchant tag pattern (first-party cookie populated from `clickref`) — confirmed by Partnerize first-party tracking guide.
- ⚠️ Strictness of `pubref` / `adref` requirement — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Conservative treatment as required-at-landing.
- ⚠️ Default cookie TTL per advertiser tier — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Does not affect the strip policy.

---

## Admitad

**Surface**

- Redirect host: `ad.admitad.com`. Currently in `OPAQUE_NETWORKS` ([`opaque-networks.js:44`](../src/lib/opaque-networks.js)) and **actively unwrapped** today via `?ulp=<encoded URL>` in `src/content/cleaner.js:906` and the redirect-unwrap tests.
- Admitad also operates `alitems.com` (specifically routes AliExpress affiliate links — Admitad has historical depth in CIS-market AliExpress affiliate flows). Today MUGA unwraps `alitems.com?ulp=` too.
- Merchant landing: any Admitad-onboarded advertiser. Admitad's core market is CIS (Russia, Belarus, Kazakhstan, Ukraine pre-2022) plus broader Eastern Europe and increasing global coverage. Many AliExpress / GearBest / large-Chinese-marketplace flows route through Admitad.
- Endpoint shape: `https://ad.admitad.com/g/<promo-id>/?ulp=<encoded merchant URL>[&subid=...]`. Destination is in `ulp`.

**Click flow**

1. User clicks publisher's Admitad-wrapped link.
2. Browser hits `ad.admitad.com/g/<promo-id>/?ulp=<destination>`.
3. Admitad's edge logs the click and issues a 30x redirect.
4. Browser is redirected to the merchant landing URL with `?admitad_uid=<click-id>` (and sometimes `tagtag_uid`, `htag`, `iom_publisher_id` echoes) appended.
5. Merchant's site (Admitad-provided integration JS or server-side script) reads `admitad_uid` from the URL and stores it in a **first-party cookie on the merchant's domain**.
6. At conversion, the advertiser's order-confirmation tag checks for `admitad_uid` in the cookie. If present, the conversion is attributed to the click; the advertiser pings Admitad's S2S endpoint with the order details + `admitad_uid`.

**Attribution mechanism**

Explicit from Admitad's own academy: "admitad_uid is a unique click identifier... When a user clicks a publisher's affiliate link and goes to the advertiser's website, a cookie with admitad_uid value is recorded in their browser... When the user performs an action and goes to the thank you page, the advertiser system checks if the user's browser has admitad_uid."

**`admitad_uid` MUST be present on the landing URL** for the merchant integration to capture it into the cookie. Stripping it kills attribution.

Source: [Admitad Partner Network glossary (Mitgo support)](https://support.admitad.com/hc/en-us/articles/4403304880529-Admitad-Affiliate-glossary), [Admitad Academy — Attribution model and cookies (publishers)](https://academy.affiliate.admitad.com/en/publishers/attribution-and-cookies), [Admitad Academy — Order tracking and attribution (advertisers)](https://academy.affiliate.admitad.com/en/advertisers/tracking). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **Advertiser-configured per program**, range **1 to 365 days** (officially documented).
- Last-click / "last paid click" attribution by default.
- Cookie can be invalidated by: expiration, a subsequent click through another affiliate link, or completion of a target action.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `admitad_uid` | **required-at-landing** | Primary click ID. Merchant integration reads this on landing to populate the first-party cookie. Currently in `TRACKING_PARAMS` ([`affiliates.js:365`](../src/lib/affiliates.js)) — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `tagtag_uid` | **required-at-landing** | Alternate ID used in some Admitad integrations (CIS-region in particular). Conservative preserve. |
| `htag` | `cookie-only` | Publisher hash-tag, analytics. Safe to strip post-landing. |
| `iom_publisher_id` | `cookie-only` | Publisher ID echoed from redirect. Analytics-only. |
| `ulp` (in ad.admitad.com URL) | n/a (redirect-internal) | Destination encoded in the redirect URL itself. |
| `subid` (in ad.admitad.com URL) | n/a (redirect-internal) | Sub-publisher ID encoded in the redirect URL. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND (document.referrer.hostname is ad.admitad.com
       OR document.referrer.hostname is alitems.com)
  → preserve admitad_uid and tagtag_uid on this document
  → safe-to-strip on subsequent same-site navigations
htag, iom_publisher_id → strippable always (analytics, not load-bearing)
```

**Server-side and client-side implication**: under 2.0 MUGA actively unwraps `ad.admitad.com` and `alitems.com` via `?ulp=` (both `src/content/cleaner.js:906` and `tests/unit/redirect-unwrap.test.mjs:587-594`). Under 2.1 this MUST flip — both hosts join `AFFILIATE_REDIRECT_NETWORKS`, the `?ulp=` unwrap path is removed for these domains, and the redirect-unwrap tests are updated to assert pass-through behavior instead.

**Verification status**

- ✅ `admitad_uid` is the canonical click ID and is required at landing — **explicitly documented by Admitad's own academy**, strong verification.
- ✅ Cookie window 1-365 days advertiser-configured — confirmed by Admitad academy.
- ✅ Last-click attribution model — confirmed.
- ✅ The merchant tag pattern (first-party cookie populated from `admitad_uid`) — confirmed by Admitad advertiser tracking docs.
- ⚠️ Whether `tagtag_uid` carries attribution weight or is analytics-only — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Conservative preserve.
- ⚠️ `alitems.com` exact landing-param shape (likely same as `ad.admitad.com` since both are Admitad infrastructure) — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**.

---

## A8.net (Japan)

**Surface**

- Redirect host: `px.a8.net`. Currently in `OPAQUE_NETWORKS` ([`opaque-networks.js:54`](../src/lib/opaque-networks.js)) confirmed via T00 STANDARD redirect probe. The decommissioned server-side Worker (see ADR-0004) previously held `px.a8.net` in its allowlist for server-side resolution (PR-05, CHANGELOG.md:88); resolution is now native via `src/lib/native-shortener-resolver.js`.
- Merchant landing: Japanese e-commerce sites — Rakuten Ichiba, Yahoo Shopping Japan, large Japanese retailers and SaaS. A8.net is the largest ASP (affiliate service provider) in Japan with ~3.6M publishers.
- Endpoint shape: standard server-side 30x with `Location` header. Payload encoded into the redirect URL itself, not query-string visible.

**Click flow**

1. User clicks A8.net-wrapped link, e.g. `https://px.a8.net/svt/ejp?a8mat=<encoded payload>&a8ejpredirect=<dest>`.
2. Browser hits `px.a8.net`.
3. A8.net logs the click and issues a 30x to the merchant landing URL.
4. Browser is redirected to the merchant page with A8.net's tracking parameters appended (`a8` is the click-context family of params).
5. Merchant's A8.net SDK (integrated via their standard tracking tag) reads the params on landing and stores them in **a first-party cookie on the merchant's domain**.
6. At checkout, the merchant's tag reads the cookie and posts the conversion back to A8.net.

**Attribution mechanism**

Inferred same family as the other 5 networks researched (cookie populated from URL param at landing). A8.net's public marketing materials describe "compatible with all major shopping carts and tag management software" — strongly suggests the same merchant-tag pattern. A8.net does NOT publish the specific param shape on landing in English; verification beyond this point requires partner-account access.

Source: [A8.net About page](https://www.a8.net/en/about/), [A8.net Advertiser overview](https://www.a8.net/en/whya8/), [Halfmoon ASP comparison guide](https://www.halfmoon.co.jp/en/news/japan-asp-platform-comparison). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **[NEEDS PARTNER-ACCOUNT VERIFICATION]** for the default; Japanese ASP industry norm is 30–90 days per advertiser configuration.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `a8` | **required-at-landing** | A8.net click context param (already in MUGA's [`affiliates.js:436`](../src/lib/affiliates.js) under "various ad/analytics platforms"). Conservative preserve on landing per the pattern of the 5 other networks. |
| `a8mat` (in px.a8.net URL) | n/a (redirect-internal) | Payload encoded in the redirect URL. Never strip — stripping breaks the redirect. |
| `a8ejpredirect` (in px.a8.net URL) | n/a (redirect-internal) | Destination override in the redirect URL. |

**Recommended cleaner policy**

```
hostname is a Japanese e-commerce merchant domain (broad — no fixed list)
  AND document.referrer.hostname is px.a8.net
  → preserve a8 (and any a8.net-prefixed params we observe) on this document
  → safe-to-strip on subsequent same-site navigations
```

A8.net's merchant list is not publicly enumerable. Policy keys on the referrer (`px.a8.net`), same approach as Awin / CJ.

**Verification status**

- ✅ `px.a8.net` is the canonical redirect host — confirmed by MUGA T00 STANDARD probe (`r.a8.net` does NOT resolve and must NOT be added).
- ✅ A8.net follows the standard merchant-tag pattern — strongly inferred from public marketing materials describing broad shopping-cart compatibility.
- ⚠️ **All param verdicts** — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Public docs in English are marketing-grade only. Japanese-language partner-account docs would have the specifics. The matrix bias toward conservative preserve applies fully here.
- ⚠️ Cookie TTL default — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Does not affect the strip policy itself.
- ⚠️ Whether A8.net uses additional click-tracking params beyond the `a8` family (e.g. `a8mat` echoed onto the landing, partner subID echoes) — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**.

---

## Rakuten Advertising (LinkShare)

**Surface**

- Redirect host: `click.linksynergy.com`. **Retired from wrapper-engine in #692** (ADR-0003 follow-up). Now in `AFFILIATE_REDIRECT_NETWORKS` (pass-through); `rakuten` caps-spec id is in `MUGA_EXCLUDED_IDS`; DNR wrapper rule removed (6 → 5 rules); bounce-state-cleaner no longer targets it.
- Merchant landing: large US/global retailers — Macy's, Walmart (some regions), Lego, Sephora, Nordstrom, plus the entire Rakuten Ichiba ecosystem and many travel brands.
- Endpoint shape: `https://click.linksynergy.com/deeplink?id=<11-char-pub-id>&mid=<merchant-id>&murl=<encoded merchant URL>[&subid=...]` or `/fs-bin/click?id=<...>&offerid=<...>&type=3&subid=...`.

**Click flow**

1. User clicks Rakuten/LinkShare-wrapped link.
2. Browser hits `click.linksynergy.com`. The publisher's 11-char `id=` is what Rakuten reads to identify the affiliate.
3. Rakuten logs the click and issues a 30x to the merchant landing URL.
4. Browser is redirected with `ranMID=<merchant-id>` and `ranSiteID=<site-id>` appended (Rakuten echoes the merchant ID for the merchant's tag to consume; `ranEAID` is the encrypted account/affiliate ID).
5. Merchant's Rakuten Advertising tag reads the `ran*` params on landing and stores them in a **first-party cookie on the merchant's domain**.
6. At checkout, the merchant's conversion tag reads the cookie and posts the conversion back to Rakuten.

**Attribution mechanism**

Standard merchant-tag pattern. The `id=` in the redirect URL is the publisher identifier (load-bearing for attribution but lives in the redirect URL, not on the landing). The `ranMID` / `ranSiteID` / `ranEAID` params on the landing page are how the merchant's tag knows it came from Rakuten and which publisher to credit. Rakuten pushes S2S as the ITP-resilient alternative.

Source: [LinkShare overview (Rakuten Advertising)](https://rakutenadvertising.com/content/linkshare/), [Tracking Links and Landing Page URLs (Rakuten Publisher Help)](https://pubhelp.rakutenadvertising.com/hc/en-us/articles/6890984802189-Tracking-Links-and-Landing-Page-URLs), [Understand Tracking Technology (Rakuten Publisher Help)](https://pubhelp.rakutenadvertising.com/hc/en-us/articles/14927247605517-Understand-Tracking-Technology), [Rakuten server-to-server tracking guide (Stape)](https://stape.io/blog/rakuten-server-to-server-tracking). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **Advertiser-configured per program**. Rakuten retail merchants typically run 7–45 day windows. Travel merchants commonly longer (60–90 days).
- Last-click attribution by default.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `ranMID` (case-insensitive) | **required-at-landing** | Rakuten merchant ID echoed for the merchant tag. Currently in MUGA's [`affiliates.js:108`](../src/lib/affiliates.js) as `"ranmid"` (lowercase) — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `ranSiteID` (case-insensitive) | **required-at-landing** | Rakuten site ID. Currently in `affiliates.js:108` as `"ransiteid"`. Same handling. |
| `ranEAID` (case-insensitive) | **required-at-landing** | Encrypted account/affiliate ID. Currently in `affiliates.js:108` as `"raneaid"`. Same handling. |
| `murl` (in click.linksynergy.com URL) | n/a (redirect-internal) | Destination encoded in the redirect URL itself. |
| `id` (in click.linksynergy.com URL) | n/a (redirect-internal) | Publisher's 11-char ID in the redirect URL. |
| `mid`, `offerid`, `subid` (in redirect URL) | n/a (redirect-internal) | Redirect-only context. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND document.referrer.hostname is click.linksynergy.com
  → preserve ranMID, ranSiteID, ranEAID (case-insensitive match) on this document
  → safe-to-strip on subsequent same-site navigations
```

**Surface inversions required**:
- `click.linksynergy.com` must move OUT of the wrapper engine (which extracts `murl=` and unwraps client-side) and INTO `AFFILIATE_REDIRECT_NETWORKS` as a pass-through. The DNR wrapper rule (`tests/e2e/dnr-wrapper-rules.spec.mjs:90-92`) must be retired or inverted.
- The bounce-state-cleaner detection at [`bounce-state-cleaner.js:68`](../src/content/bounce-state-cleaner.js) must invert (no bounce cleaning for linksynergy).

**Verification status**

- ✅ `click.linksynergy.com` redirect host shape — confirmed by MUGA codebase + Rakuten's own help docs.
- ✅ `ranMID` / `ranSiteID` / `ranEAID` are the canonical landing-page tracking family — confirmed by Rakuten publisher help.
- ✅ 11-char `id=` is the publisher identifier in the redirect URL — confirmed.
- ⚠️ Strict requirement of all three `ran*` params at landing vs. only `ranMID` — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Conservative preserve.
- ⚠️ Case-sensitivity of the merchant tag's URL parsing — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Rakuten's docs show `ranMID` (camelCase); MUGA's `TRACKING_PARAMS` uses `ranmid` (lowercase) and applies `param.toLowerCase()` comparison. Safe by inspection but worth a harness test.

---

## TradeTracker

**Surface**

- Redirect host: `tc.tradetracker.net` (Tracker Cluster). **Retired from wrapper-engine in #692** (ADR-0003 follow-up). Now in `AFFILIATE_REDIRECT_NETWORKS` (pass-through); `tradetracker` caps-spec id is in `MUGA_EXCLUDED_IDS`; bounce-state-cleaner no longer targets it.
- TradeTracker is Europe-only. Merchants tend to be European retailers and SaaS: Lyca Mobile, Bol.com (NL), Just Eat (regional), various European travel/finance.
- Endpoint shape: `https://tc.tradetracker.net/?c=<campaign>&m=<merchant>&a=<affiliate-id>&u=<encoded dest>[&r=<reference>]`.

**Click flow**

1. User clicks TradeTracker-wrapped link.
2. Browser hits `tc.tradetracker.net`. TradeTracker logs the click, sets a cookie on the tradetracker.net domain (ITP-vulnerable), and issues a 30x to the merchant landing.
3. Browser is redirected with TradeTracker's tracking params appended (`ttaid`, `ttrk`, `ttcid` family).
4. Merchant's TradeTracker integration reads the params on landing and stores them in a **first-party cookie on the merchant's domain**.
5. At conversion, merchant's conversion pixel reads the cookie and posts back to TradeTracker.

**Attribution mechanism**

Standard merchant-tag pattern. TradeTracker also offers "Real Attribution" as an alternative model that rewards all touchpoints in the conversion path (linear/position-based) rather than last-click. The underlying landing-param mechanism is the same; only the attribution accounting differs.

Source: [TradeTracker GB homepage](https://tradetracker.com/gb/), [TradeTracker Cookie Policy](https://tradetracker.com/gb/cookie-policy/), [Real Attribution Insights](https://tradetracker.com/us/real-attribution-insights-attribution-window/), [TradeTracker via Lightspeed eCom integration docs](https://ecom-support.lightspeedhq.com/hc/en-us/articles/360014464674-TradeTracker). All fetched 2026-05-24.

**Cookie TTL / lookback window**

- **Advertiser-configured per program**. Public docs do not state a default. Regional norm for European networks is 30 days for retail.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `ttaid` | **required-at-landing** | TradeTracker affiliate ID echoed for merchant tag. Currently in [`affiliates.js:111`](../src/lib/affiliates.js) — MUST be removed from universal strip in [#655](https://github.com/yocreoquesi/muga/issues/655). |
| `ttrk` | **required-at-landing** | TradeTracker reference/click. Currently in `affiliates.js:111`. Same handling. |
| `ttcid` | **required-at-landing** | TradeTracker campaign/click ID. Currently in `affiliates.js:111`. Same handling. |
| `c`, `m`, `a`, `u`, `r` (in tc.tradetracker.net URL) | n/a (redirect-internal) | Redirect-only context. |

**Recommended cleaner policy**

```
hostname is any merchant domain
  AND document.referrer.hostname is tc.tradetracker.net
  → preserve ttaid, ttrk, ttcid on this document
  → safe-to-strip on subsequent same-site navigations
```

**Surface inversion**: same as Rakuten — `tc.tradetracker.net` moves out of the wrapper engine and INTO `AFFILIATE_REDIRECT_NETWORKS` as pass-through; bounce-state-cleaner detection inverts.

**Verification status**

- ✅ `tc.tradetracker.net` redirect host — confirmed by MUGA codebase (bounce-state + caps-spec wrapper entry).
- ⚠️ All param verdicts — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. TradeTracker's public docs are marketing-grade. Conservative preserve applies.
- ⚠️ Real Attribution model interaction with the matrix policy — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Likely no impact (the landing-param mechanism is unchanged), but worth confirming.

---

## Tradedoubler

**Surface**

- Redirect host: `clk.tradedoubler.com`. **Promoted from known-unknowns in #695** alongside the content-script legacy-unwrap retirement. Now in `AFFILIATE_REDIRECT_NETWORKS` (pass-through) and `REDIRECT_NETWORK_PATTERNS` (with `tduid` as `landingParams`).
- Merchant landing: any Tradedoubler-onboarded advertiser. Tradedoubler runs in Europe with notable retail / travel coverage.
- Endpoint shape: `https://clk.tradedoubler.com/click?p=<programId>&a=<affiliateId>[&epi=<pub-ref>]&url=<encoded merchant URL>`.

**Click flow (inferred — public docs only, no partner-account verification yet)**

1. User clicks Tradedoubler-wrapped link.
2. Browser hits `clk.tradedoubler.com/click`.
3. Tradedoubler logs the click and issues a 30x redirect.
4. Browser is redirected to the merchant with `?tduid=<click-id>` appended.
5. Merchant's Tradedoubler tag reads `tduid` from the URL and stores it in a **first-party cookie on the merchant's domain**.
6. At conversion, the merchant's tag reads the cookie and posts the conversion back to Tradedoubler.

**Param table**

| Param | Verdict | Notes |
|---|---|---|
| `tduid` | **required-at-landing** | Canonical click identifier. Promoted from `TRACKING_PARAMS` to `REDIRECT_NETWORK_PATTERNS.tradedoubler.landingParams` in #695. |
| `p`, `a`, `epi`, `url` (in clk.tradedoubler.com URL) | n/a (redirect-internal) | Program / affiliate / publisher-ref / destination in the redirect URL itself. |

**Verification status**

- ✅ `clk.tradedoubler.com` is the redirect host — confirmed by MUGA codebase + Tradedoubler publisher docs.
- ✅ `tduid` is the canonical click ID — confirmed by Tradedoubler advertiser tag integration docs.
- ⚠️ Cookie TTL — **[NEEDS PARTNER-ACCOUNT VERIFICATION]**. Tradedoubler does not publish defaults; European retail norm is 30 days.
- ⚠️ Surface-inversion impact on prior `clk.tradedoubler.com/?url=` unwrap — covered: legacy content-script unwrap retired in #695; full-pipeline tests pass.

---

## Known-unknowns flagged for follow-up

These networks are referenced in MUGA's codebase but do not have full matrix sections in v1.0. They become follow-up issues if observed in the wild:

- **`alitems.com`** — Admitad's deep-link variant. Moved into `AFFILIATE_REDIRECT_NETWORKS` in #695 (pass-through, alongside the existing `ad.admitad.com` entry) per the matrix's bias toward preservation. Full per-network entry pending the next quarterly review.
- **`redirect.viglink.com`** — VigLink wrapper used by some publishers. Moved into `AFFILIATE_REDIRECT_NETWORKS` in #695 (pass-through) under the same bias-toward-preservation rule. Full per-network entry pending.
- **ShareASale** — `shareasale.com/?urllink=` wrapper. Genuine local-unwrap target (caps-spec recipe + DNR rule); NOT in `AFFILIATE_REDIRECT_NETWORKS`. Treated as the standard wrapper pattern until observed otherwise.

`alitems.com` and `redirect.viglink.com` should get full matrix sections in the next quarterly review. Their pass-through status today is the safe default — the merchant's first-party tag (whichever it is) gets to run on the URL it expects.

---

## Quarterly review checklist

To run at the **2026-08-24** review (and every quarter after):

1. Re-fetch the citation URLs above and diff against the snapshot version in this doc. Network help-center pages change without notice — silently outdated citations are the failure mode this checklist exists to catch.
2. Pull the synthetic harness results for the prior quarter ([#650](https://github.com/yocreoquesi/muga/issues/650)). Any test that flipped from green to red is a matrix-update trigger.
3. Audit `src/lib/affiliates.js` `TRACKING_PARAMS` diffs against this matrix — any new param added by `npm run add-rule` since the last review must be cross-checked against the per-network tables above.
4. Spot-check 5 random creator-affiliate flows in real browsers (one per tier-1 network, one through an aggregator like CJ-AliExpress, one fresh-discovery). Documented in the next QA report under `docs/qa/`.
5. Update **Last updated** and **Next quarterly review** at the top of this file. Commit the diff as `docs: q3 review of affiliate networks matrix (#<issue>)`.

## Out of scope for v1.0

- **The non-redirect direct-injection programs** (Amazon Associates, eBay Partner Network, Vercel, DigitalOcean, Lemon Squeezy, Apple Performance Partners) — these use simple `?tag=` injection, are already handled correctly by `AFFILIATE_PATTERNS`, and are not affected by the 2.1 pivot.
- **Tradedoubler, ShareASale, VigLink** — flagged in the "Known-unknowns" section above. Become matrix entries in the next quarterly review or on first observed payout regression.
- **MUGA's own affiliate partnerships** with redirect networks — explicitly out of scope per ADR-0002. The matrix describes how to preserve **creator** attribution; MUGA opening its own AliExpress / CJ / Awin accounts is a 2.2+ roadmap question.

## References

Fetched 2026-05-24 unless otherwise noted.

**Awin**
- [Cookie Tracking — Publisher FAQs (Awin Success)](https://success.awin.com/s/article/Cookie-Tracking-Publisher-FAQs)
- [Understanding Awin MasterTag (Awin Help)](https://help.awin.com/advertisers/docs/en/understanding-awin-mastertag)
- [Everything you need to know about affiliate tracking (Awin)](https://www.awin.com/us/affiliate-marketing/everything-you-need-to-know-about-affiliate-tracking)
- [Awin cookie types and attribution hierarchy (Awin Help)](https://help.awin.com/docs/awin-cookie-types-and-attribution-hierarchy)
- [Tracking FAQs (Awin)](https://help.awin.com/advertisers/docs/en/tracking-faqs)

**CJ Affiliate**
- [Commission Junction Tracking (Trackingplan blog, 2026)](https://webflow.trackingplan.com/blog/commission-junction-tracking)
- [HTTP Response Cookie (CJ Developer Portal)](https://developers.cj.com/docs/advertiser-site-tracking/http-response-cookie)
- [Advertiser Integration Solutions for ITP 2.2 and Beyond (Junction by CJ)](https://junction.cj.com/article/advertiser-integration-solutions-for-itp-2.2-and-beyond)
- [CJ's Approach to In-App, Cookieless, and Cross-Device Tracking (Junction by CJ)](https://junction.cj.com/article/cjs-approach-app-cookieless-and-cross-device-tracking)
- [Advanced Conversion Tracking Integration HTML Example (CJ)](https://developers.cj.com/docs/advertiser-site-tracking/advanced-integration)

**AliExpress**
- [Affiliate Marketing with AliExpress: A Comprehensive Guide (Strackr)](https://strackr.com/blog/aliexpress-affiliate-program)
- [Understanding Affiliate Attribution Windows (Avelon Network)](https://avelonetwork.com/support/brand/affiliate-attribution-windows-first-party-cookies)
- [AliExpress Affiliate Program Review & Details (AFFCaptain)](https://affcaptain.com/affiliate-program/aliexpress-affiliate-program/)
- [How to Start AliExpress Affiliate Marketing 2026 (Afflow)](https://afflow.co/blog/start-aliexpress-affiliate)

**Impact Radius (impact.com)**
- [Impact + AnyTrack integration docs](https://anytrack.io/integrations/affiliate-networks/impact)
- [GA4Addon audit on irclickid attribution](https://www.ga4addon.com/google-analytics-audit/irclickid-should-be-affiliate)
- [Impact Postback URL docs (AnyTrack)](https://docs.anytrack.io/affiliate-networks-integrations/impact)
- [Tracking Link Parameters Explained (impact.com help)](https://help.impact.com/en/support/solutions/articles/155000000123-tracking-link-parameters-explained)
- [impact.com Cookies Explained](https://help.impact.com/en/support/solutions/articles/48001235676-impact-com-cookies-explained)

**Partnerize (Performance Horizon)**
- [Tracking : Partnerize Tag First Party Integration (PHG Help)](https://help.phgsupport.com/hc/en-us/articles/360020029897-Tracking-Partnerize-Tag-First-Party-Integration)
- [Tracking : Partnerize Clickref Pixel Integration (PHG Help)](https://help.phgsupport.com/hc/en-us/articles/4834811308957-Tracking-Partnerize-Clickref-Pixel-Integration)
- [Partnerize Track platform](https://partnerize.com/platform/track)
- [Vrbo Partnerize Linking Guide (PDF)](https://cdn.expediapartnersolutions.com/ean-rapid-site/Vrbo_Partnerize_Linking_Guide.pdf?mtime=20221123154015)
- [Partnerize API (Apiary)](https://performancehorizon.docs.apiary.io/)

**Admitad**
- [Admitad Partner Network glossary (Mitgo support)](https://support.admitad.com/hc/en-us/articles/4403304880529-Admitad-Affiliate-glossary)
- [Admitad Academy — Attribution model and cookies (publishers)](https://academy.affiliate.admitad.com/en/publishers/attribution-and-cookies)
- [Admitad Academy — Order tracking and attribution (advertisers)](https://academy.affiliate.admitad.com/en/advertisers/tracking)

**A8.net (Japan)**
- [A8.net About page](https://www.a8.net/en/about/)
- [A8.net Advertiser overview](https://www.a8.net/en/whya8/)
- [Halfmoon Japan ASP comparison guide](https://www.halfmoon.co.jp/en/news/japan-asp-platform-comparison)

**Rakuten Advertising (LinkShare)**
- [LinkShare overview (Rakuten Advertising)](https://rakutenadvertising.com/content/linkshare/)
- [Tracking Links and Landing Page URLs (Publisher Help)](https://pubhelp.rakutenadvertising.com/hc/en-us/articles/6890984802189-Tracking-Links-and-Landing-Page-URLs)
- [Understand Tracking Technology (Publisher Help)](https://pubhelp.rakutenadvertising.com/hc/en-us/articles/14927247605517-Understand-Tracking-Technology)
- [Rakuten server-to-server tracking (Stape)](https://stape.io/blog/rakuten-server-to-server-tracking)
- [Rakuten LinkShare tracker profile (WhoTracks.Me / Ghostery)](https://whotracks.me/trackers/linksynergy.com.html)

**TradeTracker**
- [TradeTracker GB homepage](https://tradetracker.com/gb/)
- [TradeTracker Cookie Policy](https://tradetracker.com/gb/cookie-policy/)
- [Real Attribution Insights](https://tradetracker.com/us/real-attribution-insights-attribution-window/)
- [TradeTracker via Lightspeed eCom integration docs](https://ecom-support.lightspeedhq.com/hc/en-us/articles/360014464674-TradeTracker)

**Internal codebase signals**
- [`src/lib/opaque-networks.js`](../src/lib/opaque-networks.js) — current redirect host list and per-host source comments
- [`src/lib/affiliates.js`](../src/lib/affiliates.js) — TRACKING_PARAMS with per-param notes
- [`src/rules/wrappers.json`](../src/rules/wrappers.json) — Awin wrapper rule
- [`src/rules/manifest.json`](../src/rules/manifest.json) — CJ Affiliate and Impact Radius network entries; Humble Bundle deprecation note documents the Impact migration
- [`src/rules/wrappers.json`](../src/rules/wrappers.json) — Awin and Impact Radius (`*.pxf.io`) wrapper regex patterns
- [`src/content/cleaner.js:906`](../src/content/cleaner.js) — current `ad.admitad.com` `?ulp=` unwrap mapping (MUST be removed for 2.1)
- [`src/content/bounce-state-cleaner.js:80`](../src/content/bounce-state-cleaner.js) — current `*.pxf.io` bounce-state cleaning (MUST invert for 2.1)
- [`tests/e2e/redirect-unwrap-merged.spec.mjs`](../tests/e2e/redirect-unwrap-merged.spec.mjs) — existing Awin/ShareASale unwrap tests (to be repurposed or retired under [#658](https://github.com/yocreoquesi/muga/issues/658))
- [`tests/unit/redirect-unwrap.test.mjs:587-594`](../tests/unit/redirect-unwrap.test.mjs) — current Admitad/alitems.com unwrap tests (MUST be inverted to assert pass-through under 2.1)
- [`src/content/bounce-state-cleaner.js:68-69`](../src/content/bounce-state-cleaner.js) — current `click.linksynergy.com` and `tc.tradetracker.net` bounce-state targets (MUST invert under 2.1)
- [`tests/e2e/dnr-wrapper-rules.spec.mjs:90-92`](../tests/e2e/dnr-wrapper-rules.spec.mjs) — current Rakuten LinkSynergy DNR wrapper-unwrap test (MUST be retired or inverted under 2.1)
- [`src/content/cleaner.js:909`](../src/content/cleaner.js) — current `clk.tradedoubler.com` `?url=` unwrap mapping (Tradedoubler — known-unknown; same surface-inversion category)
