# MUGA: Store Listings

> Version: 2.6.0
> Last updated: 2026-07-29
> NOTE: version tracks package.json (version-consistency.test.mjs). If the short description below changes, sync src/manifest.json "description" to match.
> Status: Consumer-first, honesty pass. Same friendly, non-technical voice as prior versions. MUGA is a URL cleaner: it removes tracking parameters, unwraps redirect chains, reveals what a shortened link actually points to, and by default tries to preserve the referral of whoever recommended you (a best-effort intention, not a guarantee, and always user-controllable). MUGA adds no affiliate tag of its own, so there is no injection to disclose: the copy states plainly that it never monetizes your clicks. IMPORTANT copy rules kept from prior versions: NO enumeration of retailer/brand names anywhere (this triggered the Chrome Web Store keyword-spam rejection, routing ID FZSL, 2026-05). Technical detail (full param list, permission internals, affiliate mechanics) is deferred to GitHub and the website. Permission justifications live in the CWS "Privacy practices" tab and the privacy policy, NOT in this marketing body. No em-dashes and no "--" per house copy rules.

---

## Chrome Web Store

### Extension name

MUGA: The URL denoise extension for the web

### Short description (132 chars max)

Clean the tracking noise from your URLs: strip trackers, unwrap redirects, reveal short links, keep creator referrals. Open source.

*(131 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, the web got noisy. Copy a URL today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. None of that clutter is there for you.

MUGA cleans the tracking noise out of your URLs. It quietly removes the tracking from the links you visit, copy and share, unwraps redirect chains and reveals what a shortened link actually points to, so links stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Unwraps redirect chains and reveals the real destination behind shortened links
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA never adds an affiliate tag of its own. It doesn't monetize your clicks, on any store: there is no hidden tag, nothing added on your behalf, and your price is never touched. MUGA stays free and open source, kept going by people who choose to chip in, not by your purchases, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never reports your browsing to us or to anyone else. Two things do reach the network, and both are listed right here. MUGA fetches an updated tracking-param list on its own: a small signed file, with nothing about you in the request, which you can turn off. And when you open a shortened link, MUGA follows that link to find out where it really goes, so you land on a clean address instead of a tracking hop. That request goes to the short link itself, never to us, and it happens only on links you actually open. You can turn it off in settings. Looking up a link you are only hovering over is a separate option, and it stays off unless you switch it on.

Yours to control
Turn cleaning on or off per site, add your own rules, and back up your settings whenever you like. It is your browser. MUGA just tidies up after the trackers.

Open source, and proud of it
Every line is public on GitHub under the GPL v3 license. Want the technical detail, or just want to check we do what we say? Read it, audit it, fork it.

https://github.com/yocreoquesi/muga

---

### Keywords (Chrome Web Store, max 5)

denoise, URL cleaner, tracking params, creator-friendly, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: The URL denoise extension for the web

### Summary (250 chars max)

Clean the tracking noise from your URLs without breaking pages: strip trackers, unwrap redirect chains, reveal short links, and keep the referral of whoever recommended you. No analytics, no telemetry, no account. Open source, GPL v3.

*(234 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, the web got noisy. Copy a URL today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. None of that clutter is there for you.

MUGA cleans the tracking noise out of your URLs. It quietly removes the tracking from the links you visit, copy and share, unwraps redirect chains and reveals what a shortened link actually points to, so links stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Unwraps redirect chains and reveals the real destination behind shortened links
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA never adds an affiliate tag of its own. It doesn't monetize your clicks, on any store: there is no hidden tag, nothing added on your behalf, and your price is never touched. MUGA stays free and open source, kept going by people who choose to chip in, not by your purchases, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never reports your browsing to us or to anyone else. Two things do reach the network, and both are listed right here. MUGA fetches an updated tracking-param list on its own: a small signed file, with nothing about you in the request, which you can turn off. And when you open a shortened link, MUGA follows that link to find out where it really goes, so you land on a clean address instead of a tracking hop. On Firefox it asks for your permission for those short-link domains first. That request goes to the short link itself, never to us, and it happens only on links you actually open. You can turn it off in settings. Looking up a link you are only hovering over is a separate option, and it stays off unless you switch it on.

Yours to control
Turn cleaning on or off per site, add your own rules, and back up your settings whenever you like. It is your browser. MUGA just tidies up after the trackers.

Open source, and proud of it
Every line is public on GitHub under the GPL v3 license. We built MUGA to be the URL cleaner we wanted to use ourselves: honest about what it does, and respectful of the people who keep the open web worth reading. Want the technical detail, or just want to check we do what we say? Read it, audit it, fork it.

https://github.com/yocreoquesi/muga

---

### AMO metadata

- Extension name: MUGA: The URL denoise extension for the web
- License: GPL v3
- Primary category: Privacy & Security
- Secondary category: Shopping
- Tags: denoise, noise, url-cleaner, tracking-params, creator-friendly
- Website: https://github.com/yocreoquesi/muga
