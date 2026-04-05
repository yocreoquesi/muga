# MUGA: Store Listings

> Version: 1.9.7
> Last updated: 2026-04-01
> Status: Final listing for Chrome Web Store and Firefox AMO. 459 tracking params, 167 domain rules, 13 prefix patterns, 3 active affiliate programs, MV3 native.

---

## Chrome Web Store

### Extension name

MUGA: Clean URLs, Fair to Every Click

### Short description (132 chars max)

URL cleaner: strips utm, fbclid, gclid and 459 tracking params automatically. Respects creator affiliates. Open source, MV3 native.

*(130 chars)*

---

### Detailed description

MUGA is a URL cleaner and tracking remover. It strips utm_source, utm_medium, utm_campaign, fbclid, gclid, msclkid, and 449 more tracking parameters from every URL you visit, automatically, before the page loads. No buttons. No setup. No permission popups. Built natively for Manifest V3. Works on Chrome and Firefox.

By default, MUGA never touches what isn't ours. If a link already has a creator's affiliate tag, we leave it alone. That is the "fair to every click" part, and what makes MUGA different from every other URL cleaner out there.


======================================
BEFORE / AFTER
======================================

Store link from a video review:

Before: amazon.es/dp/B00EXAMPLE?tag=reviewer-21&linkCode=ll1&linkId=abc123&pd_rd_r=xyz&pf_rd_p=def&utm_source=youtube&utm_medium=video
After:  amazon.es/dp/B00EXAMPLE?tag=reviewer-21

The reviewer's affiliate tag stays. The 7 tracking params are gone.

Video link shared from mobile:

Before: youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789
After:  youtube.com/watch?v=dQw4w9WgXcQ

Generic newsletter link:

Before: example.com/product?utm_source=newsletter&utm_medium=email&utm_campaign=spring&gclid=EAIaIQ&fbclid=abc123
After:  example.com/product

Five tracking params removed. The actual page URL is untouched.


======================================
WHAT GETS STRIPPED
======================================

459 tracking parameters across 13 pattern families:

. UTM family (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Click IDs: fbclid, gclid, dclid, gbraid, wbraid, msclkid, ttclid, twclid, sclid, sc_channel
. Share and discovery tokens (si, epik, pin_unauth)
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. E-commerce session noise (pd_rd_r, pf_rd_p, linkCode, linkId, mkevt, mkcid, mkrid, aff_trace_key, algo_expid, algo_pvid, and 30+ more)
. Generic click IDs and campaign identifiers

167 domain-specific rulesets ensure functional params (search queries, pagination, filters) are always preserved. MUGA only removes tracking. It never breaks a page.


======================================
MORE THAN PARAM STRIPPING
======================================

. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background tracking requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


======================================
THE AFFILIATE MODEL: OPT-IN, HONEST, AUDITABLE
======================================

MUGA has an affiliate feature. Here is exactly how it works.

Affiliate injection is off by default. You choose to enable it during onboarding, or manually in Settings at any time.

When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds ours. The price you pay is exactly the same. The store just knows you arrived via MUGA. That is how you support an independent developer at zero cost to you.

Not every store is compatible. We evaluated 10 stores and rejected all of them because they require redirect-based tracking that forces your clicks through external servers. We do not believe that is necessary or fair. We chose to give up that revenue rather than compromise your privacy.

What MUGA does NOT do by default:
. It never replaces an existing affiliate tag on compatible stores. If someone's tag is already in the link, MUGA leaves it alone.
. Replacing requires a separate, deliberate opt-in that is disabled by default.
. You can turn affiliate injection off at any time in Settings, globally or per domain.
. On stores with redirect-based affiliate models, MUGA strips their tracking parameters and unwraps redirect URLs when possible.

This is disclosed during setup, in the privacy policy, and in the source code. You can read every line.


======================================
PRIVATE. REALLY.
======================================

Every URL is processed entirely inside your browser. MUGA never sends data anywhere.

. Zero analytics, zero telemetry, zero data collection
. No account, no sign-in, no cloud
. Minimal permissions: storage, activeTab, contextMenus, declarativeNetRequestWithHostAccess, clipboardWrite
. Nothing else. Ever.

We evaluated 10+ affiliate programs from major retailers and marketplaces. All of them require redirect-based tracking that routes your clicks through external servers before reaching the store. We rejected every one of them and gave up that revenue rather than compromise your privacy. On those stores, MUGA actively strips the affiliate tracking parameters that redirect networks leave behind, and unwraps redirect URLs when possible so you go straight to the store.


======================================
YOUR RULES
======================================

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link so MUGA never touches it
. Custom tracking params: add your own parameter names to strip on any site
. Affiliate notifications: enable a toast when a third-party affiliate is detected
. Per-domain disable: opt entire domains out of MUGA
. Export / Import settings as JSON: back up or move your config across devices
. Language: English and Espanol, switchable any time
. Settings sync across Chrome devices automatically


======================================
SUPPORTED STORES (affiliate features, opt-in only)
======================================

Active: Amazon (ES, DE, FR, IT, UK, US), eBay (US, ES, DE, UK, FR, IT), Booking.com.

Only stores that support direct URL parameter injection are compatible with MUGA. We evaluated and rejected 10+ stores whose affiliate programs require redirect-based tracking, because routing your clicks through external servers would violate our privacy policy.

Tracking removal works on every site on the web, not just these stores. If you find a tracker MUGA misses, open an issue on GitHub. We fix them.


======================================
OPEN SOURCE. GPL v3.
======================================

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. Transparency is the point.

https://github.com/yocreoquesi/muga

---

### Keywords (Chrome Web Store, max 5)

privacy, URL cleaner, tracking remover, affiliate, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: Clean URLs, Fair to Every Click

### Summary (250 chars max)

URL cleaner and tracking remover. Strips 459 tracking params (utm, fbclid, gclid) before the page loads. Respects creator affiliates. Rejects redirect-based tracking. 100% local, open source, GPL v3. Nothing leaves your browser.

*(243 chars)*

---

### Detailed description

MUGA is a URL cleaner built for people who care about what happens to their clicks.

Every URL you visit arrives loaded with tracking parameters -- utm_source, fbclid, gclid, msclkid, share tokens, e-commerce session noise, and hundreds more. MUGA strips them automatically, before the page renders. No buttons to press. No configuration needed. No data leaves your browser. Ever.


459 tracking parameters. 167 domain-specific rulesets. Zero data collection.

MUGA removes tracking from every site on the web. Domain-specific rules ensure functional parameters (search queries, pagination, filters) are always preserved. We only remove tracking. We never break a page.

What gets stripped:
. UTM family (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Click IDs: fbclid, gclid, dclid, gbraid, wbraid, msclkid, ttclid, twclid, sclid, sc_channel
. Share and discovery tokens (si, epik, pin_unauth)
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. E-commerce session noise (pd_rd_r, pf_rd_p, linkCode, linkId, mkevt, mkcid, mkrid, aff_trace_key, algo_expid, algo_pvid, and 30+ more)
. Generic click IDs and campaign identifiers


More than param stripping

. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background tracking requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


Fair to every click

By default, MUGA never touches what is not ours. If a link already has a creator's affiliate tag, we leave it alone. A reviewer links to a product with their tag -- it stays. That is what "fair to every click" means.

MUGA has an optional affiliate feature (off by default). When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds ours. The price you pay is exactly the same. You can turn it off any time, globally or per domain.


We rejected 10+ stores to protect your privacy

We evaluated 10+ affiliate programs from major retailers and marketplaces. Every one of them requires redirect-based tracking -- your click passes through an external server before reaching the store. We do not believe forcing users through external tracking servers is necessary or fair. We rejected all of them and gave up that revenue.

On those stores, MUGA actively strips the affiliate tracking parameters that redirect networks leave behind, and unwraps redirect URLs when possible so you go straight to the store.

Supported stores (affiliate features, opt-in only):
3 active programs across multiple markets (ES, DE, FR, IT, UK, US).


Private by design

Every URL is processed entirely inside your browser. MUGA never sends data anywhere.
. Zero analytics, zero telemetry, zero data collection
. No account, no sign-in, no cloud
. Minimal permissions: storage, activeTab, contextMenus, declarativeNetRequest, clipboardWrite
. Nothing else. Ever.


Your rules

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link
. Custom tracking params: add your own parameter names to strip
. Per-domain disable: opt entire domains out of MUGA
. Export/Import settings as JSON
. English and Spanish, switchable any time


Open source. GPL v3. Read every line.

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. We built MUGA to be the URL cleaner we wanted to use ourselves -- transparent, honest, and built to last.

https://github.com/yocreoquesi/muga

---

### AMO metadata

- Extension name: MUGA: Clean URLs, Fair to Every Click
- License: GPL v3
- Primary category: Privacy & Security
- Secondary category: Shopping
- Tags: privacy, tracking, url-cleaner, affiliate
- Website: https://github.com/yocreoquesi/muga
