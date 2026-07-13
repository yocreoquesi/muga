# MUGA: Store Listings

> Version: 2.6.0
> Last updated: 2026-07-05
> Status: Consumer-first rewrite with an honesty pass. Positioning is a friendly, non-technical URL cleaner: URLs became long, noisy and hard to read, and MUGA gives them back clean. Headlines lead with what is verifiable (cleans tracking noise, does not break pages, no analytics, no telemetry, open source). The bare claims "private" and "fair" were deliberately removed from the short description and manifest: network-touching features exist but are opt-in/off by default, and creator-referral preservation is a best-effort intention the user can override (there is a "strip all third-party affiliates" control), so it is framed as intention plus user control, never as a guarantee. Affiliate injection is disclosed honestly as on by default: on a few supported stores, MUGA adds its own referral to links that carry no affiliate tag at all, at no change to your price, and it can be turned off during onboarding or any time in Settings. The "Remember when a link was just a link?" hook opens the detailed description only. IMPORTANT copy rules baked in: no enumeration of retailer/brand names anywhere (this triggered the Chrome Web Store keyword-spam rejection, routing ID FZSL, 2026-05); heavy parameter dumps and per-store brand lists from prior drafts are intentionally removed. Technical detail (full param list, permission internals, affiliate mechanics) is deferred to GitHub and the website. Permission justifications live in the CWS "Privacy practices" tab and the privacy policy, NOT in this marketing body. No em-dashes and no "--" per house copy rules.

---

## Chrome Web Store

### Extension name

MUGA: The URL denoise extension for the web

### Short description (132 chars max)

Clean the tracking noise from your URLs without breaking them. No analytics, no telemetry. Open source.

*(103 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, URLs got heavy. Copy one today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. None of that clutter is there for you.

MUGA cleans it up. It quietly removes the tracking noise from the links you visit, copy and share, so your URLs stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA also has a simple way to stay sustainable. On a few supported stores, when a link carries no affiliate tag at all, MUGA adds its own, at no extra cost to you and with your price unchanged. This is on by default and disclosed during setup, and you can turn it off during onboarding or any time in Settings, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never sends your browsing anywhere. The only thing it fetches on its own is an updated tracking-param list: a small signed file, with nothing about you in the request, which you can turn off. Other network features, like following a short link to see where it leads, are optional and stay off until you enable them.

Yours to control
Turn cleaning on or off per site, add your own rules, and back up your settings whenever you like. It is your browser. MUGA just tidies up after the trackers.

Open source, and proud of it
Every line is public on GitHub under the GPL v3 license. Want the technical detail, or just want to check we do what we say? Read it, audit it, fork it.

https://github.com/yocreoquesi/muga

---

### Keywords (Chrome Web Store, max 5)

denoise, URL cleaner, creator-friendly, noise remover, UTM

---

## Firefox Add-ons (AMO)

### Extension name

MUGA: The URL denoise extension for the web

### Summary (250 chars max)

Clean the tracking noise from your URLs without breaking the pages. No analytics, no telemetry, no account. By default MUGA tries to keep the referral of whoever recommended you the link, and you stay in control. Open source, GPL v3.

*(233 chars)*

---

### Detailed description

Remember when a link was just a link?

Somewhere along the way, URLs got heavy. Copy one today and half of it is tracking: campaign codes, click IDs, tags that follow you around. Links became long, unreadable, awkward to share, and sometimes they barely work at all. None of that clutter is there for you.

MUGA cleans it up. It quietly removes the tracking noise from the links you visit, copy and share, so your URLs stay short, clear and readable, the way they were meant to be.

What it does
. Removes tracking parameters (utm tags, click IDs, campaign codes and hundreds more) from links across the web
. Keeps the parts that actually matter, so pages never break: search terms, filters and page navigation stay intact
. Cleans links when you copy or right-click them, and shows you a clear before and after
. Runs automatically in the background, no setup required

We try not to cut off who recommended you
Most cleaners strip everything, including the referral of whoever recommended you the link: the reviewer, the creator, the newsletter that shared it. By default, MUGA tries to leave that credit alone, and tells you when it does. It is a best-effort intention, not a guarantee, and you stay in control: keep it, or strip every third-party referral if you prefer. Cleaning your links shouldn't mean quietly cutting off the people who make the web worth reading.

MUGA also has a simple way to stay sustainable. On a few supported stores, when a link carries no affiliate tag at all, MUGA adds its own, at no extra cost to you and with your price unchanged. This is on by default and disclosed during setup, and you can turn it off during onboarding or any time in Settings, with cleaning and every protection working just the same.

No analytics, no telemetry
MUGA processes your URLs locally, inside your browser. No analytics, no telemetry, no account, no sign-in, and it never sends your browsing anywhere. The only thing it fetches on its own is an updated tracking-param list: a small signed file, with nothing about you in the request, which you can turn off. Other network features, like following a short link to see where it leads, are optional and stay off until you enable them.

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
- Tags: denoise, noise, url-cleaner, affiliate, creator-friendly
- Website: https://github.com/yocreoquesi/muga
