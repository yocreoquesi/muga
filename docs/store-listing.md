# MUGA: Store Listings

> Version: 1.13.0
> Last updated: 2026-05-04
> Status: Final listing for Chrome Web Store and Firefox AMO. Lead headline rewritten to surface the "fair to creators" wedge per the 2026-04-26 strategic review (consensus across three independent analyses). Aligned with the post-grill privacy-policy and ToS rollout (#399, #400) — per-device consent, local cleaning architecture, and #353 conditional preservation of MUGA's own tag.

---

## Chrome Web Store

### Extension name

MUGA: Privacy Without Breaking Creator Links

### Short description (132 chars max)

Strip tracking. Keep creator referrals. 450+ params removed automatically. Open source, MV3 native, zero data sent.

*(118 chars)*

---

### Detailed description

MUGA strips tracking from every URL — without breaking the affiliate links of the creators who recommended you.

That sentence is the whole pitch. Every other URL cleaner removes utm_source, fbclid, gclid, and the rest. So does MUGA. But every other URL cleaner also strips the affiliate tag of the YouTuber whose video you came from, the newsletter that shared the link, the reviewer who took the time to write the comparison. That tag is how independent creators get paid for the recommendation. MUGA leaves it alone.

When MUGA preserves a creator's referral on the current page, the popup tells you so — a small green badge ("Creator referral preserved") appears with the tag that was kept. No other URL cleaner does this. None of them can without contradicting their own pitch.


======================================
WHAT MUGA DOES, IN ONE EXAMPLE
======================================

A friend sends you a product link from a YouTube reviewer:

Before: amazon.es/dp/B00EXAMPLE?tag=reviewer-21&linkCode=ll1&linkId=abc123&pd_rd_r=xyz&pf_rd_p=def&utm_source=youtube&utm_medium=video

After:  amazon.es/dp/B00EXAMPLE?tag=reviewer-21

The reviewer's affiliate tag stays. The 7 tracking params are gone. You support the creator. The tracking platforms get nothing.


======================================
MORE BEFORE/AFTER
======================================

Video link from mobile share:

Before: youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789
After:  youtube.com/watch?v=dQw4w9WgXcQ

Generic newsletter link:

Before: example.com/product?utm_source=newsletter&utm_medium=email&utm_campaign=spring&gclid=EAIaIQ&fbclid=abc123
After:  example.com/product

Five tracking params removed. The actual page URL is untouched.


======================================
WHAT GETS STRIPPED
======================================

450+ tracking parameters across 6 categories:

. UTM family (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Click IDs: fbclid, gclid, dclid, gbraid, wbraid, msclkid, ttclid, twclid, sclid, sc_channel
. Share and discovery tokens (si, epik, pin_unauth)
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. E-commerce session noise (pd_rd_r, pf_rd_p, linkCode, linkId, mkevt, mkcid, mkrid, aff_trace_key, algo_expid, algo_pvid, and 30+ more)
. Generic click IDs and campaign identifiers

150+ domain-specific rulesets ensure functional params (search queries, pagination, filters) are always preserved. MUGA only removes tracking. It never breaks a page.


======================================
MORE THAN PARAM STRIPPING
======================================

. Visible feedback: when MUGA cleans a URL, the popup shows "MUGA removed N trackers from this URL". When MUGA preserves a creator's affiliate tag, the popup says so. You see the value, every time.
. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background tracking requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


======================================
WHY "FAIR TO CREATORS" IS NOT MARKETING TALK
======================================

We evaluated 10+ affiliate programs from major retailers (Zalando, SHEIN, MediaMarkt, Walmart, Target, AliExpress, and others) and rejected every one of them. They all require redirect-based tracking — your click passes through an external server before reaching the store. We refuse to route your clicks through external surveillance just to earn a commission.

So when MUGA gives credit to a creator, it is to a creator who chose a clean affiliate model that does not redirect or track you. When you enable MUGA's optional affiliate injection, you are doing the same. The price you pay is the same. No redirects. No surveillance. No middleman.

Two active programs across multiple markets: Amazon (ES, DE, FR, IT, UK, US), eBay (US, ES, DE, UK, FR, IT). Programs that meet the privacy bar — direct parameter injection, no redirect through external servers.


======================================
THE AFFILIATE MODEL: OPT-IN, HONEST, AUDITABLE
======================================

Affiliate injection is OFF by default. You choose to enable it during onboarding, or manually in Settings at any time.

When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds ours. The price you pay is exactly the same. The store just knows you arrived via MUGA. That is how you support an independent developer at zero cost to you.

What MUGA does NOT do by default:
. It never replaces an existing affiliate tag on compatible stores. If someone's tag is already in the link, MUGA leaves it alone.
. Replacing requires a separate, deliberate opt-in that is disabled by default.
. You can turn affiliate injection off at any time in Settings, globally or per domain.
. On stores with redirect-based affiliate models, MUGA strips their tracking parameters and unwraps redirect URLs when possible.

This is disclosed during setup, in the privacy policy, and in the source code. Every line is public.


======================================
PRIVATE. REALLY.
======================================

Every URL is processed entirely inside your browser. MUGA never sends data anywhere on a default install.

. Zero analytics, zero telemetry, zero data collection
. No account, no sign-in, no cloud
. Core permissions: storage, activeTab, contextMenus, declarativeNetRequestWithHostAccess, clipboardWrite
. Optional host permission yocreoquesi.github.io/*: granted only when you enable "Remote rule updates" in Settings. Used to fetch a signed tracking-parameter payload over HTTPS — a single GET check at most once per 7 days, piggybacked on natural service-worker wake events (no chrome.alarms permission). Credentials-omit, no user data transmitted, Ed25519-signed payload verified against a public key shipped with the extension. Off by default. Revocable at any time via browser settings.

We rejected 10+ affiliate networks because they require redirect-based tracking. On those stores, MUGA actively strips the affiliate tracking parameters that redirect networks leave behind, and unwraps redirect URLs when possible so you go straight to the store.


======================================
YOUR RULES
======================================

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link so MUGA never touches it
. Custom tracking params: add your own parameter names to strip on any site
. Affiliate notifications: enable a toast when a third-party affiliate is detected
. Strip all third-party affiliates: removes affiliate tags placed by other creators or networks. MUGA's own tag is preserved only when you also have affiliate injection enabled on this device — symmetric with your stated preference.
. Per-domain disable: opt entire domains out of MUGA
. Export / Import settings as JSON: back up or move your config across devices
. Languages: English and Spanish (officially maintained), Portuguese and German (community-contributed; missing entries fall back to English) — switchable any time
. Behavioural preferences sync across your Chrome devices automatically. Acceptance of these terms is recorded per device — installing on a new device asks you to read and accept again (privacy decision, not a bug). See the privacy policy.


======================================
OPEN SOURCE. GPL v3.
======================================

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. Transparency is the point.

https://github.com/yocreoquesi/muga

Compare against other URL cleaners (ClearURLs, Brave built-in, uBlock, Neat URL): https://yocreoquesi.github.io/muga/comparison.html

---

### Keywords (Chrome Web Store, max 5)

privacy, URL cleaner, creator-friendly, tracking remover, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: Privacy Without Breaking Creator Links

### Summary (250 chars max)

Strip tracking from every URL while preserving the affiliate referrals of creators who recommended you. 450+ params removed automatically. 100% local. Zero data sent. Open source, GPL v3. The only URL cleaner that respects creators.

*(238 chars)*

---

### Detailed description

MUGA strips tracking from every URL — without breaking the affiliate links of the creators who recommended you.

Every other URL cleaner removes utm_source, fbclid, gclid, and the rest. So does MUGA. But every other URL cleaner also strips the affiliate tag of the YouTuber whose video you came from, the newsletter that shared the link, the reviewer who took the time to write the comparison. That tag is how independent creators get paid for the recommendation. MUGA leaves it alone.

When MUGA preserves a creator's referral on the current page, the popup tells you so — a green badge appears with the tag that was kept. No other URL cleaner does this. None of them can without contradicting their own pitch.


One example, the whole pitch:

Before: amazon.es/dp/B00EXAMPLE?tag=reviewer-21&linkCode=ll1&pd_rd_r=xyz&utm_source=youtube&utm_medium=video

After:  amazon.es/dp/B00EXAMPLE?tag=reviewer-21

The reviewer's affiliate tag stays. The tracking params are gone. The creator gets paid. The tracking platforms get nothing.


450+ tracking parameters. 150+ domain-specific rulesets. Zero data collection.

MUGA removes tracking from every site on the web. Domain-specific rules ensure functional parameters (search queries, pagination, filters) are always preserved. We only remove tracking. We never break a page.

What gets stripped:
. UTM family (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Click IDs: fbclid, gclid, dclid, gbraid, wbraid, msclkid, ttclid, twclid, sclid, sc_channel
. Share and discovery tokens (si, epik, pin_unauth)
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. E-commerce session noise (pd_rd_r, pf_rd_p, linkCode, linkId, mkevt, mkcid, mkrid, aff_trace_key, algo_expid, algo_pvid, and 30+ more)
. Generic click IDs and campaign identifiers


More than param stripping

. Visible feedback: when MUGA cleans a URL, the popup shows "MUGA removed N trackers". When MUGA preserves a creator's tag, the popup says so. You see the value, every time.
. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background tracking requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


Why "fair to creators" is not marketing talk

We evaluated 10+ affiliate programs from major retailers (Zalando, SHEIN, MediaMarkt, Walmart, Target, AliExpress, and others) and rejected every one of them. They all require redirect-based tracking — your click passes through an external server before reaching the store. We refuse to route your clicks through external surveillance just to earn a commission.

So when MUGA gives credit to a creator, it is to a creator who chose a clean affiliate model that does not redirect or track you. When you enable MUGA's optional affiliate injection, you are doing the same. No redirects. No surveillance. No middleman.

Two active programs across multiple markets: Amazon (ES, DE, FR, IT, UK, US), eBay (US, ES, DE, UK, FR, IT).


Fair to every click

By default, MUGA never touches what is not ours. If a link already has a creator's affiliate tag, we leave it alone. A reviewer links to a product with their tag — it stays.

MUGA has an optional affiliate feature (off by default). When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds ours. The price you pay is exactly the same. You can turn it off any time, globally or per domain.


Private by design

Every URL is processed entirely inside your browser. MUGA never sends data anywhere on a default install.
. Zero analytics, zero telemetry, zero data collection
. No account, no sign-in, no cloud
. Core permissions: storage, activeTab, contextMenus, declarativeNetRequest, clipboardWrite
. Optional permission yocreoquesi.github.io/*: granted only when you enable "Remote rule updates". Used to fetch a signed tracking-parameter payload — a single HTTPS GET check at most once per 7 days, piggybacked on natural browser activity (no chrome.alarms permission). Credentials-omit, no user data transmitted, Ed25519-signed payload verified against a public key shipped with the extension. Off by default. Revocable at any time.


Your rules

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link
. Custom tracking params: add your own parameter names to strip
. Strip all third-party affiliates: removes affiliate tags placed by other creators or networks. MUGA's own tag is preserved only when you also have affiliate injection enabled on this device — symmetric with your stated preference.
. Per-domain disable: opt entire domains out of MUGA
. Export/Import settings as JSON
. Languages: English and Spanish (officially maintained), Portuguese and German (community-contributed; missing entries fall back to English) — switchable any time
. Behavioural preferences sync across your Firefox account. Acceptance of these terms is recorded per device — installing on a new device asks you to read and accept again. See the privacy policy.


Open source. GPL v3. Read every line.

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. We built MUGA to be the URL cleaner we wanted to use ourselves — transparent, honest, built to last, and fair to the creators who keep the open web running.

https://github.com/yocreoquesi/muga

Compare against other URL cleaners (ClearURLs, Brave built-in, uBlock, Neat URL): https://yocreoquesi.github.io/muga/comparison.html

---

### AMO metadata

- Extension name: MUGA: Privacy Without Breaking Creator Links
- License: GPL v3
- Primary category: Privacy & Security
- Secondary category: Shopping
- Tags: privacy, tracking, url-cleaner, affiliate, creator-friendly
- Website: https://github.com/yocreoquesi/muga

Compare against other URL cleaners (ClearURLs, Brave built-in, uBlock, Neat URL): https://yocreoquesi.github.io/muga/comparison.html
