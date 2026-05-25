# MUGA: Store Listings

> Version: 2.1.0
> Last updated: 2026-05-25
> Status: Listing for Chrome Web Store and Firefox AMO under the 2.1 denoise pivot (creator-agnostic positioning — see ADR-0002). Lead headline: "Shorter, cleaner URLs — fair to every creator". The 2.0-era anti-redirect framing has been removed; MUGA no longer takes a stance against affiliate-redirect networks (their click IS the attribution event and MUGA respects it). Third-party retailer brand names previously enumerated were removed after Chrome Web Store flagged the list as keyword spam (rejection routing ID FZSL, 2026-05). URL Unwrapper section rewritten with honest scope: generic shorteners only (bit.ly, t.co, tinyurl.com, etc.); affiliate redirects pass through unchanged. Privacy claims (no telemetry / no analytics) remain firm but are no longer in the headline.

---

## Chrome Web Store

### Extension name

MUGA: The denoise extension for the web

### Short description (132 chars max)

Shorter, cleaner URLs — fair to every creator. 450+ tracking patterns removed automatically. No analytics. Open source.

*(121 chars)*

---

### Detailed description

MUGA cleans every URL while respecting whoever recommended you the link.

Every other URL cleaner removes utm_source, fbclid, gclid, and the rest. So does MUGA. But every other URL cleaner also strips the affiliate path of the YouTuber whose video you came from, the newsletter that shared the link, the reviewer who took the time to write the comparison. That path is how independent creators get paid for the recommendation — whether it lives as a tag on the merchant's URL or as a redirect through an affiliate network. MUGA leaves it alone, whichever shape it takes. We don't take credit from people who earned it.

When MUGA preserves a creator's referral on the current page, the popup tells you so: a small green badge ("Creator referral preserved") appears with the tag or network that was kept. No other URL cleaner does this. None of them can without contradicting their own pitch.


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
WHAT GETS QUIETED
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

. Visible feedback: when MUGA cleans a URL, the popup shows "MUGA removed N bits of noise from this URL". When MUGA preserves a creator's affiliate tag, the popup says so. You see the value, every time.
. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background ping requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


======================================
THE AFFILIATE MODEL: OPT-IN, HONEST, AUDITABLE
======================================

MUGA preserves creator affiliate paths on every site where it recognises one — tag-based programs (Amazon, eBay, Vercel, DigitalOcean, Lemon Squeezy, Apple Performance Partners) and redirect-based affiliate networks alike. We don't pick winners by attribution model; whoever earned the click keeps it.

MUGA's own affiliate injection is OFF by default. You choose to enable it during onboarding, or manually in Settings at any time.

When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds its own on Amazon (ES, DE, FR, IT, UK, US) and eBay (US, ES, DE, UK, FR, IT). The price you pay is exactly the same. The store just knows you arrived via MUGA. That is how you support an independent developer at zero cost to you.

What MUGA does NOT do by default:
. It never replaces an existing affiliate tag on compatible stores. If someone's tag is already in the link, MUGA leaves it alone.
. Replacing requires a separate, deliberate opt-in that is disabled by default.
. You can turn affiliate injection off at any time in Settings, globally or per domain.

This is disclosed during setup, in the privacy policy, and in the source code. Every line is public.


======================================
HONEST ABOUT WHAT GOES OVER THE WIRE
======================================

By default, MUGA processes URLs locally inside your browser. We don't run analytics, we don't run telemetry, and we have no plans to.

. No analytics, no telemetry, no account, no sign-in
. Core permissions: storage, activeTab, contextMenus, declarativeNetRequestWithHostAccess, clipboardWrite
. Optional host permission rules.muga.app/*: granted only when you enable "Remote rule updates" in Settings. Used to fetch a signed noise-param payload over HTTPS: a single GET check at most once per 7 days, piggybacked on natural service-worker wake events (no chrome.alarms permission). Credentials-omit, no user data transmitted, Ed25519-signed payload verified against a public key shipped with the extension. Off by default. Revocable at any time via browser settings.
. Optional host permission unwrap.muga.app/*: granted only when you enable "URL Unwrapper" in Settings. Used ONLY to resolve generic URL shorteners (bit.ly, tinyurl.com, t.co, link.medium.com, lnkd.in, fb.me, ebay.to) so you can see where a short link actually leads before clicking. Affiliate redirect networks are NEVER sent to this endpoint — they pass through unchanged to honour the creator's commission. Off by default.


======================================
YOUR RULES
======================================

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link so MUGA never touches it
. Custom tracking params: add your own parameter names to strip on any site
. Affiliate notifications: enable a toast when a third-party affiliate is detected
. Strip all third-party affiliates: removes affiliate tags placed by other creators or networks. MUGA's own tag is preserved only when you also have affiliate injection enabled on this device, symmetric with your stated preference.
. Per-domain disable: opt entire domains out of MUGA
. Export / Import settings as JSON: back up or move your config across devices
. Languages: English and Spanish (officially maintained), Portuguese and German (community-contributed; missing entries fall back to English). Switchable any time.
. Behavioural preferences sync across your Chrome devices automatically. Acceptance of these terms is recorded per device: installing on a new device asks you to read and accept again (privacy decision, not a bug). See the privacy policy.


======================================
OPEN SOURCE. GPL v3.
======================================

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. Transparency is the point.

https://github.com/yocreoquesi/muga


---

### Keywords (Chrome Web Store, max 5)

denoise, URL cleaner, creator-friendly, noise remover, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: The denoise extension for the web

### Summary (250 chars max)

Shorter, cleaner URLs — fair to every creator who recommended you, whatever affiliate model they chose. 450+ tracking patterns removed automatically. No analytics, no telemetry. Open source, GPL v3.

*(200 chars)*

---

### Detailed description

MUGA cleans every URL while respecting whoever recommended you the link.

Every other URL cleaner removes utm_source, fbclid, gclid, and the rest. So does MUGA. But every other URL cleaner also strips the affiliate path of the YouTuber whose video you came from, the newsletter that shared the link, the reviewer who took the time to write the comparison. That path is how independent creators get paid for the recommendation — whether it lives as a tag on the merchant's URL or as a redirect through an affiliate network. MUGA leaves it alone, whichever shape it takes. We don't take credit from people who earned it.

When MUGA preserves a creator's referral on the current page, the popup tells you so: a green badge appears with the tag or network that was kept. No other URL cleaner does this. None of them can without contradicting their own pitch.


One example, the whole pitch:

Before: amazon.es/dp/B00EXAMPLE?tag=reviewer-21&linkCode=ll1&pd_rd_r=xyz&utm_source=youtube&utm_medium=video

After:  amazon.es/dp/B00EXAMPLE?tag=reviewer-21

The reviewer's affiliate tag stays. The tracking params are gone. The creator gets paid. The tracking platforms get nothing.


450+ noise patterns. 150+ domain-specific rulesets. No analytics, no telemetry.

MUGA removes tracking from every site on the web. Domain-specific rules ensure functional parameters (search queries, pagination, filters) are always preserved. We only remove tracking. We never break a page.

What gets stripped:
. UTM family (utm_source, utm_medium, utm_campaign, utm_content, utm_term, and more)
. Click IDs: fbclid, gclid, dclid, gbraid, wbraid, msclkid, ttclid, twclid, sclid, sc_channel
. Share and discovery tokens (si, epik, pin_unauth)
. Email marketing (mc_cid, _hsenc, mkt_tok, _mkto_trk, _kx)
. E-commerce session noise (pd_rd_r, pf_rd_p, linkCode, linkId, mkevt, mkcid, mkrid, aff_trace_key, algo_expid, algo_pvid, and 30+ more)
. Generic click IDs and campaign identifiers


More than param stripping

. Visible feedback: when MUGA cleans a URL, the popup shows "MUGA removed N bits of noise". When MUGA preserves a creator's tag, the popup says so. You see the value, every time.
. AMP redirect: AMP pages redirect to the canonical article URL
. Block <a ping> beacons: suppresses background ping requests on click
. Redirect unwrapping: detects and bypasses intermediary redirect wrappers so you land on the real URL
. Right-click any link: "Copy clean link" without visiting the page
. Alt+Shift+C: copy the clean URL of the current tab to clipboard
. Badge counter: see how many params were stripped on the current tab
. Popup preview: before/after view for the current page


Fair to creators · nice to you · honest about both

By default, MUGA never touches what is not ours. If a link already carries a creator's affiliate path — a tag on the merchant's URL or a redirect through an affiliate network — we leave it alone. A reviewer linked to a product with their tag, it stays. A YouTuber linked through an affiliate network, the redirect stays.

MUGA preserves creator affiliate paths on every site where it recognises one: tag-based programs (Amazon, eBay, Vercel, DigitalOcean, Lemon Squeezy, Apple Performance Partners) and redirect-based affiliate networks alike. We don't pick winners by attribution model.

MUGA has its own optional affiliate feature (off by default). When enabled: if you navigate to a supported store and the link has no affiliate tag at all, MUGA adds ours on Amazon (ES, DE, FR, IT, UK, US) and eBay (US, ES, DE, UK, FR, IT). The price you pay is exactly the same. You can turn it off any time, globally or per domain.


Honest about what goes over the wire

By default, MUGA processes URLs locally inside your browser. We don't run analytics, we don't run telemetry, and we have no plans to.
. No analytics, no telemetry, no account, no sign-in
. Core permissions: storage, activeTab, contextMenus, declarativeNetRequest, clipboardWrite
. Optional permission rules.muga.app/*: granted only when you enable "Remote rule updates". Used to fetch a signed noise-param payload: a single HTTPS GET check at most once per 7 days, piggybacked on natural browser activity (no chrome.alarms permission). Credentials-omit, no user data transmitted, Ed25519-signed payload verified against a public key shipped with the extension. Off by default. Revocable at any time.
. Optional permission unwrap.muga.app/*: granted only when you enable "URL Unwrapper". Used ONLY to resolve generic URL shorteners (bit.ly, tinyurl.com, t.co, link.medium.com, lnkd.in, fb.me, ebay.to) so you can see where a short link actually leads before clicking. Affiliate redirect networks are NEVER sent to this endpoint — they pass through unchanged to honour the creator's commission. Off by default.


Your rules

. Blacklist a domain: strip everything on that site, no affiliate injection
. Whitelist a tag: protect a specific creator's affiliate link
. Custom tracking params: add your own parameter names to strip
. Strip all third-party affiliates: removes affiliate tags placed by other creators or networks. MUGA's own tag is preserved only when you also have affiliate injection enabled on this device, symmetric with your stated preference.
. Per-domain disable: opt entire domains out of MUGA
. Export/Import settings as JSON
. Languages: English and Spanish (officially maintained), Portuguese and German (community-contributed; missing entries fall back to English). Switchable any time.
. Behavioural preferences sync across your Firefox account. Acceptance of these terms is recorded per device: installing on a new device asks you to read and accept again. See the privacy policy.


Open source. GPL v3. Read every line.

The entire codebase is public on GitHub under the GPL v3 license. Read it. Audit it. Fork it. If anything looks wrong, open an issue. We built MUGA to be the URL cleaner we wanted to use ourselves: transparent, honest, built to last, and fair to the creators who keep the open web running.

https://github.com/yocreoquesi/muga


---

### AMO metadata

- Extension name: MUGA: The denoise extension for the web
- License: GPL v3
- Primary category: Privacy & Security
- Secondary category: Shopping
- Tags: denoise, noise, url-cleaner, affiliate, creator-friendly
- Website: https://github.com/yocreoquesi/muga

