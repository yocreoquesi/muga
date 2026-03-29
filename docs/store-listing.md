# MUGA: Store Listings

> Version: 1.8.0
> Last updated: 2026-03-25
> Status: Updated for v1.8.0. 452 tracking params, 120 domain rules, 13 prefix patterns, MV3 native, "Clean URLs, Fair to Every Click"

---

## Chrome Web Store

### Short description (132 chars max)

Fair to every click. 452 trackers stripped from URLs automatically. Never replaces a creator's tag by default. Open source. MV3 native.

*(131 chars)*

---

### Detailed description

Every URL you click is pre-loaded with trackers. MUGA strips 452 of them automatically, before the page loads. No clicks. No setup. Built natively for Manifest V3, works on Chrome and Firefox today.

By default, MUGA never touches what isn't ours. If a link already has an affiliate tag, we leave it alone. Replacing requires a separate, deliberate opt-in.

──────────────────────────────────────
CLEAN LINKS. AUTOMATICALLY. ALWAYS.
──────────────────────────────────────

MUGA strips the tracking garbage from every URL you visit, before the page even loads. No button to press. No setup. No permission popups. It just works.

Before:
https://www.amazon.es/dp/B09B8YWXDF?tag=youtuber-21&linkCode=ll1&linkId=abc123&pd_rd_r=xyz&pf_rd_p=def&utm_source=youtube&utm_medium=video&utm_campaign=review2026

After:
https://www.amazon.es/dp/B09B8YWXDF?tag=youtuber-21

Before:
https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123trackingtoken456789

After:
https://www.youtube.com/watch?v=dQw4w9WgXcQ

Before:
https://example.com/product?utm_source=google&utm_medium=cpc&utm_campaign=spring_sale&gclid=EAIaIQ...

After:
https://example.com/product

──────────────────────────────────────
WHAT GETS STRIPPED
──────────────────────────────────────

MUGA recognizes 452 tracking parameters across 13 pattern families: UTMs, fbclid, gclid, Amazon session noise, YouTube share tokens, TikTok click IDs, Pinterest tags, email marketing beacons, and more. Applied across 120 domain-specific rulesets so functional params (search queries, pagination, filters) are always preserved.

What you get: shorter URLs, no tracking attached, and a browser that stops broadcasting your origin story to every site you visit.

──────────────────────────────────────
MORE THAN JUST PARAM STRIPPING
──────────────────────────────────────

• AMP redirect: Google AMP pages are silently redirected to the canonical article URL
• Block <a ping> beacons: background tracking requests on click are suppressed
• Redirect unwrapping: Reddit, Steam, and generic ?redirect=/?url= intermediaries are unwrapped automatically
• Right-click any link → Copy clean link (no need to visit the page)
• Alt+Shift+C: copy the clean URL of the current tab to clipboard
• Export / Import settings as JSON: move your config across devices or back it up

──────────────────────────────────────
THE AFFILIATE MODEL: OPT-IN, HONEST, AUDITABLE
──────────────────────────────────────

Affiliate injection is off by default. You enable it during the onboarding consent flow, or manually at any time via Settings → Affiliate settings.

When enabled: if you navigate to one of 18 supported stores and your link has no affiliate tag, MUGA quietly adds ours. You pay the exact same price. The store just knows you arrived via MUGA. That's how you support an independent developer at zero cost to you.

• Off by default. Enabled during onboarding or manually in Settings at any time
• Only fires when there is no existing affiliate tag. By default, we never touch someone else's
• Turn it off any time in Settings, globally or per domain
• Disclosed during setup, in the privacy policy, and in the source code

We never touch what isn't ours. If a link has someone else's tag, we leave it alone. Replacing requires a separate, deliberate opt-in that is disabled by default.

──────────────────────────────────────
YOUR RULES
──────────────────────────────────────

Blacklist a domain: strip everything on that site, no affiliate injection, minimal URL.

Whitelist a tag: protect a specific creator's affiliate link so MUGA never touches it.

Affiliate notifications: enable a toast when a third-party affiliate is detected. Default action is always "keep original". Replacing it with ours requires a separate, deliberate opt-in.

Custom tracking params: add your own parameter names to strip on any site.

Export / Import settings: back up or transfer your full config as JSON.

Language: switch between English and Español any time in settings.

Settings sync across all your Chrome devices automatically.

──────────────────────────────────────
PRIVATE. REALLY.
──────────────────────────────────────

Every URL is processed inside your browser. MUGA never acts behind your back. Nothing happens without your action. No analytics. No telemetry. No account. No sign-in. Your browsing data is never collected, sold, or shared.

──────────────────────────────────────
SUPPORTED STORES (affiliate features, opt-in)
──────────────────────────────────────

18 stores: Amazon (ES, DE, FR, IT, UK, US), Booking.com, AliExpress, PcComponentes, El Corte Inglés, eBay, Zalando (ES, DE), SHEIN, Fnac (ES, FR), MediaMarkt (ES, DE).

Tracking removal works on every site on the web, no exceptions. If you ever find one, open an issue on GitHub. We fix them.

──────────────────────────────────────
OPEN SOURCE. GPL v3.
──────────────────────────────────────

The entire codebase is public on GitHub. Read it. Audit it. Fork it. If anything looks wrong, open an issue. Transparency is the point. It always was.

https://github.com/yocreoquesi/muga

---

### Keywords (Chrome Web Store, max 5)

privacy, URL cleaner, tracking protection, affiliate, UTM

---

## Firefox Add-ons (AMO)

### Summary (250 chars max)

Fair to every click. 452 trackers stripped from every URL. AMP redirect, ping blocking, redirect unwrapping. By default, never touches what isn't ours. Open source, GPL v3.

*(205 chars)*

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
