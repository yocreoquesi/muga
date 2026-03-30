# MUGA: Store Listings

> Version: 1.8.0
> Last updated: 2026-03-29
> Status: Final listing for Chrome Web Store submission. 452 tracking params, 120 domain rules, 13 prefix patterns, 18 stores, MV3 native.

---

## Chrome Web Store

### Extension name

MUGA: Clean URLs, Fair to Every Click

### Short description (132 chars max)

URL cleaner: strips utm, fbclid, gclid and 452 tracking params automatically. Respects creator affiliates. Open source, MV3 native.

*(130 chars)*

---

### Detailed description

MUGA is a URL cleaner and tracking remover. It strips utm_source, utm_medium, utm_campaign, fbclid, gclid, msclkid, and 449 more tracking parameters from every URL you visit, automatically, before the page loads. No buttons. No setup. No permission popups. Built natively for Manifest V3. Works on Chrome and Firefox.

By default, MUGA never touches what isn't ours. If a link already has a creator's affiliate tag, we leave it alone. That is the "fair to every click" part, and what makes MUGA different from every other URL cleaner out there.


======================================
BEFORE / AFTER
======================================

Amazon link from a video review:

Before: amazon.es/dp/B00EXAMPLE?tag=reviewer-21&linkCode=ll1&linkId=abc123&pd_rd_r=xyz&pf_rd_p=def&utm_source=youtube&utm_medium=video
After:  amazon.es/dp/B00EXAMPLE?tag=reviewer-21

The reviewer's affiliate tag stays. The 7 tracking params are gone.

YouTube link shared from mobile:

Before: youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789
After:  youtube.com/watch?v=dQw4w9WgXcQ

Generic newsletter link:

Before: example.com/product?utm_source=newsletter&utm_medium=email&utm_campaign=spring&gclid=EAIaIQ&fbclid=abc123
After:  example.com/product

Five tracking params removed. The actual page URL is untouched.


======================================
WHAT GETS STRIPPED
======================================

452 tracking parameters across 13 pattern families:

. UTM parameters (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Facebook (fbclid), Google (gclid, dclid, gbraid, wbraid), Microsoft (msclkid)
. TikTok (ttclid), Twitter (twclid), Snapchat (sclid, sc_channel)
. YouTube share tokens (si)
. Pinterest (epik, pin_unauth), Reddit, LinkedIn
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. Amazon session noise (pd_rd_r, pf_rd_p, linkCode, linkId, and 30+ more)
. eBay click tracking (mkevt, mkcid, mkrid)
. AliExpress tokens (aff_trace_key, algo_expid, algo_pvid)
. Generic click IDs and campaign identifiers

120 domain-specific rulesets ensure functional params (search queries, pagination, filters) are always preserved. MUGA only removes tracking. It never breaks a page.


======================================
MORE THAN PARAM STRIPPING
======================================

. AMP redirect: Google AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background tracking requests on click
. Redirect unwrapping: strips intermediary wrappers (Reddit, Steam, generic redirect URLs)
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


======================================
THE AFFILIATE MODEL: OPT-IN, HONEST, AUDITABLE
======================================

MUGA has an affiliate feature. Here is exactly how it works.

Affiliate injection is off by default. You choose to enable it during onboarding, or manually in Settings at any time.

When enabled: if you navigate to one of 18 supported stores and the link has no affiliate tag at all, MUGA adds ours. The price you pay is exactly the same. The store just knows you arrived via MUGA. That is how you support an independent developer at zero cost to you.

What MUGA does NOT do by default:
. It never replaces an existing affiliate tag. If someone's tag is already in the link, MUGA leaves it alone.
. Replacing requires a separate, deliberate opt-in that is disabled by default.
. You can turn affiliate injection off at any time in Settings, globally or per domain.

This is disclosed during setup, in the privacy policy, and in the source code. You can read every line.


======================================
PRIVATE. REALLY.
======================================

Every URL is processed entirely inside your browser. MUGA never sends data anywhere.

. Zero analytics, zero telemetry, zero data collection
. No account, no sign-in, no cloud
. Minimal permissions: storage, tabs, contextMenus, declarativeNetRequest, clipboardWrite
. Nothing else. Ever.


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

18 stores: Amazon (ES, DE, FR, IT, UK, US), Booking.com, AliExpress, PcComponentes, El Corte Ingles, eBay, Zalando (ES, DE), SHEIN, Fnac (ES, FR), MediaMarkt (ES, DE).

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

### Summary (250 chars max)

URL cleaner and tracking remover. Strips utm, fbclid, gclid and 452 tracking params automatically. AMP redirect, ping blocking, redirect unwrapping. Respects creator affiliates by default. Open source, GPL v3.

*(211 chars)*

---

### Description

Same as Chrome detailed description above. AMO accepts the same copy. Paste verbatim.

AMO-specific notes:
- License: GPL v3
- Listed under: Privacy & Security
- Tags: privacy, tracking, url-cleaner, affiliate

---

### AMO Categories

- Primary: Privacy & Security
- Secondary: Shopping
