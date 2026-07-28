# MUGA: Store Listings

> Version: 2.6.0
> Last updated: 2026-07-20
> NOTE: version tracks package.json (version-consistency.test.mjs). This copy is the DRAFT for the 2.7.0 cookie-consent release; the "Version" line above bumps to 2.7.0 together with package.json/manifests/README/CHANGELOG as part of the coordinated release version bump, not before.
> Status: Consumer-first, honesty pass. Same friendly, non-technical voice as 2.6.0, now widened from a pure URL cleaner to a broader "denoiser for the web": this version adds the cookie-consent minimizer. Positioning of the new feature stays honest and conservative: on SUPPORTED banners MUGA rejects the tracking cookies and keeps only the necessary ones (necessary-only), works by default and is opt-out in Settings, NEVER grants broad tracking, and NEVER just hides the banner to fake a choice; when it cannot act safely it leaves the banner for you. RELEASE DECISION (2026-07-20, product owner): MUGA never accepts cookies on the user's behalf to get past a wall — the paywall accept-click mode is NOT shipped in 2.7.0 (deferred to demand-driven revival; preserved at git ref parked/cookie-paywall-accept). If a site forces consent or a banner is unsupported, MUGA leaves it and the user decides. So this copy must NOT describe any accept-on-paywall behaviour. Avoid an absolute "never accepts any cookie" claim (necessary-only IS accepting the minimum needed to load the page); frame it precisely as rejecting tracking / keeping only necessary. The URL-cleaning DNA stays front and centre (the name and the lead are still about clean links); cookies are framed as "the other noise", not a pivot away from URLs. Headlines still lead with what is verifiable. The bare claims "private" and "fair" remain out of the short description and manifest. MUGA adds no affiliate tag of its own, so there is no injection to disclose: the copy states plainly that it never monetizes your clicks and, by default, respects the referral a link already carries (stripping third-party referrals stays an explicit, off-by-default opt-in). IMPORTANT copy rules kept from 2.6.0: NO enumeration of retailer/brand names anywhere (this triggered the Chrome Web Store keyword-spam rejection, routing ID FZSL, 2026-05) and, extended for this version, NO enumeration of cookie-consent vendor/CMP names either (same spam risk, and too technical for the body). Technical detail (full param list, supported-CMP list, permission internals, affiliate mechanics) is deferred to GitHub and the website. Permission justifications live in the CWS "Privacy practices" tab and the privacy policy, NOT in this marketing body. No em-dashes and no "--" per house copy rules. NOTE: if the short description below changes, sync src/manifest.json "description" to match.

---

## Chrome Web Store

### Extension name

MUGA: The URL denoise extension for the web

### Short description (132 chars max)

Clean the tracking noise from your URLs and quietly reject cookie-consent banners. No analytics, no telemetry. Open source.

*(122 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, the web got noisy. Copy a URL today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. And before you can even read a page, a cookie pop-up asks you to accept being tracked. None of that clutter is there for you.

MUGA is a denoiser for the web. It starts where the noise started, in your links: it quietly removes the tracking from the URLs you visit, copy and share, so they stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

The noise isn't only in your links
Cookie-consent banners are the other tax on a quiet web: the same pop-up, on every site, every visit, nudging you toward accepting tracking. On supported banners, MUGA handles it for you the same way it handles your URLs. By default it goes for the minimum: it rejects the tracking cookies and keeps only the necessary ones, quietly and automatically. It never grants broad tracking on your behalf, and it never just hides the banner to pretend you chose. When it cannot do it safely, it leaves the banner for you. You can turn it off any time in Settings.
We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA never adds an affiliate tag of its own. It doesn't monetize your clicks, on any store: there is no hidden tag, nothing added on your behalf, and your price is never touched. MUGA stays free and open source, kept going by people who choose to chip in, not by your purchases, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs and handles cookie banners locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never sends your browsing anywhere. The only thing it fetches on its own is an updated tracking-param list: a small signed file, with nothing about you in the request, which you can turn off. Other network features, like following a short link to see where it leads, are optional and stay off until you enable them.

Yours to control
Turn cleaning on or off per site, quiet the cookie banners or leave them be, add your own rules, and back up your settings whenever you like. It is your browser. MUGA just tidies up after the trackers.

Open source, and proud of it
Every line is public on GitHub under the GPL v3 license. Want the technical detail, or just want to check we do what we say? Read it, audit it, fork it.

https://github.com/yocreoquesi/muga

---

### Keywords (Chrome Web Store, max 5)

denoise, URL cleaner, cookie consent, creator-friendly, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: The URL denoise extension for the web

### Summary (250 chars max)

Clean the tracking noise from your URLs without breaking pages, and quietly reject cookie-consent banners on supported sites. No analytics, no telemetry, no account. By default MUGA keeps the referral of whoever recommended you. Open source, GPL v3.

*(249 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, the web got noisy. Copy a URL today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. And before you can even read a page, a cookie pop-up asks you to accept being tracked. None of that clutter is there for you.

MUGA is a denoiser for the web. It starts where the noise started, in your links: it quietly removes the tracking from the URLs you visit, copy and share, so they stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

The noise isn't only in your links
Cookie-consent banners are the other tax on a quiet web: the same pop-up, on every site, every visit, nudging you toward accepting tracking. On supported banners, MUGA handles it for you the same way it handles your URLs. By default it goes for the minimum: it rejects the tracking cookies and keeps only the necessary ones, quietly and automatically. It never grants broad tracking on your behalf, and it never just hides the banner to pretend you chose. When it cannot do it safely, it leaves the banner for you. You can turn it off any time in Settings.
We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA never adds an affiliate tag of its own. It doesn't monetize your clicks, on any store: there is no hidden tag, nothing added on your behalf, and your price is never touched. MUGA stays free and open source, kept going by people who choose to chip in, not by your purchases, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs and handles cookie banners locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never sends your browsing anywhere. The only thing it fetches on its own is an updated tracking-param list: a small signed file, with nothing about you in the request, which you can turn off. Other network features, like following a short link to see where it leads, are optional and stay off until you enable them.

Yours to control
Turn cleaning on or off per site, quiet the cookie banners or leave them be, add your own rules, and back up your settings whenever you like. It is your browser. MUGA just tidies up after the trackers.

Open source, and proud of it
Every line is public on GitHub under the GPL v3 license. We built MUGA to be the denoiser we wanted to use ourselves: honest about what it does, and respectful of the people who keep the open web worth reading. Want the technical detail, or just want to check we do what we say? Read it, audit it, fork it.

https://github.com/yocreoquesi/muga

---

### AMO metadata

- Extension name: MUGA: The URL denoise extension for the web
- License: GPL v3
- Primary category: Privacy & Security
- Secondary category: Shopping
- Tags: denoise, noise, url-cleaner, cookie-consent, creator-friendly
- Website: https://github.com/yocreoquesi/muga
