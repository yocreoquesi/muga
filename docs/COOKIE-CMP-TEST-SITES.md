# Cookie-Consent CMP Manual Test Sites

Maintainer reference catalog of real, live websites for MANUALLY validating MUGA's cookie-consent
handling, per CMP and per behavior.

**This is NOT the automated test battery.** It does not replace `tests/unit/cmp-adapters.test.mjs`,
`tests/unit/cmp-tier2-*.test.mjs`, or the e2e/canary suites — those exercise pure functions and
fixtures. This catalog exists for the maintainer step those tests cannot cover: loading the real
extension against a real production page and watching what actually happens, the same way
`steuck-aachen.de` (Complianz) and `osano.com` (the toggle-reject spike) were used previously.

## Verification method (read this first)

Every row below was checked by fetching the site's **raw HTML** and grepping the bytes for the exact
loader/DOM signature our detection code keys on. The command shape:

```
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -sS -L --max-time 25 -A "$UA" "https://SITE/" | grep -ioE 'SIGNATURE_ALTERNATION' | sort -u
```

**Why not WebFetch.** A previous pass used `WebFetch`, which converts HTML to Markdown before an LLM
reads it. That conversion **strips `<script src>`, `id`, `class`, and inline handlers** — precisely
the tokens every CMP detection signal keys on (`cdn.cookielaw.org`, `otSDKStub`,
`#onetrust-banner-sdk`, `.cmplz-deny`, `CybotCookiebotDialog`, `UC_UI`, …). Only visible text and
`href`s survive, so `WebFetch` "found nothing" for almost every CMP even when the loader was plainly
in the page. Raw-HTML `curl` + `grep` sees the actual bytes and does not have this blind spot. Every
`VERIFIED` row records the literal matched string as evidence.

**Geo-gating caveat (important for the human tester).** A `VERIFIED` here means the CMP's **loader
script tag is present in the static HTML** — that is what our detection reads. It does NOT mean a
consent **banner** was rendered. Many EU-focused CMPs geo-gate the UI: the loader ships to everyone,
then decides at runtime (by IP geo) whether to draw the banner. This sweep ran from a **non-EU
vantage**, so the loader confirms the CMP even where a browser here would show no banner. To watch
the actual reject UI and MUGA's click behavior, the maintainer still needs a **real headed browser
with EU egress (VPN)** — exactly as `docs/DESIGN-cookie-consent-paywall-accept.md` requires for its
Sourcepoint paywall gate (screenshot-based, headed, EU egress — not a static fetch).

**Labels:**

- **VERIFIED** — signature bytes actually appeared in the fetched HTML (matched string recorded).
- **UNVERIFIED** — HTML returned `200` but no signature matched (CMP likely fully JS-injected at
  runtime, or the site uses a different/no CMP). Absence of evidence, not evidence of absence.
- **BLOCKED** — curl could not reach the page (`403`/`429` bot wall, timeout, or redirect loop).
  This is a tooling/network outcome, **not** a statement about the CMP.

This pass was run via `curl` on the raw HTML on the date it was executed. CMPs change over time and
per-installation (WordPress plugins especially) — re-verify before trusting an entry that is more
than a few months old.

---

## Table per CMP

### Tier 1 — API adapters (`src/lib/cmp-adapters.js`)

Signatures used (the oracle, mirroring our code): OneTrust
`cdn.cookielaw.org|otSDKStub|onetrust-banner-sdk|onetrust-consent-sdk|OnetrustActiveGroups|Optanon`;
Cookiebot `consent.cookiebot.com|CybotCookiebotDialog|Cybot`; Usercentrics
`usercentrics|uc.usercentrics|usercentrics-root|UC_UI`; Didomi
`didomi|didomi-host|api.privacy-center.org|sdk.privacy-center.org`; Sourcepoint
`sourcepoint|sp-prod.net|_sp_|sp_message_container`; CookieYes `cookieyes|cky-|cdn-cookieyes`;
CookieScript `cookie-script.com|cookiescript`; Cookie Information
`cookieinformation|policy.app.cookieinformation.com|CookieConsent`; tarteaucitron `tarteaucitron`;
consentmanager `consentmanager|delivery.consentmanager`.

| Site | CMP | Verified? (matched signature) | Reject path | EU-geo-gated? | Notes |
|---|---|---|---|---|---|
| `accenture.com` | OneTrust | **VERIFIED** — `Optanon`, `cdn.cookielaw.org`, `otSDKStub` (all three) | One-click (Tier 1 API `OneTrust.RejectAll()`) | Commonly | Strongest OneTrust evidence in the sweep — full triple signature in static HTML. Best OneTrust test site. |
| `salesforce.com` | OneTrust | **VERIFIED** — `otSDKStub` | One-click (Tier 1 API) | Commonly | Loader stub present; large SPA (~590 KB). |
| `dell.com` | OneTrust | **VERIFIED** — `cdn.cookielaw.org` | One-click (Tier 1 API) | Commonly | CDN loader host present. |
| `ibm.com`, `hp.com` | OneTrust | UNVERIFIED | One-click (Tier 1 API) | Commonly | HTML returned, no signature in static bytes (likely late JS injection). Use `accenture.com` instead. |
| `adobe.com`, `cisco.com`, `oracle.com`, `sap.com`, `marriott.com` | OneTrust | BLOCKED (403 / redirect timeout) | — | — | Bot walls. Not a CMP conclusion. |
| — | Cookiebot | **ZERO VERIFIED** — `cookiebot.com`, `jysk.com`, `visitdenmark.com`, `lush.com`, `coop.se`, `zooplus.de`, `rituals.com` all UNVERIFIED; `tesco.com` BLOCKED (403) | One-click (Tier 1 API) | Yes, very commonly | Cookiebot loads `consent.cookiebot.com/uc.js` via runtime-injected script on all candidates tried; nothing in static HTML. Needs a maintainer-supplied URL or a real-browser DOM check. See Coverage gaps. |
| `usercentrics.com` | Usercentrics | **VERIFIED** — `UC_UI`, `Usercentrics`, `usercentrics` | One-click (Tier 1 API) | Yes, commonly | Vendor's own site; strong multi-token match. |
| `aboutyou.de` | Usercentrics | **VERIFIED** — `UC_UI`, `usercentrics` | One-click (Tier 1 API) | Yes | Independent customer install — better diversity than the vendor site. |
| `check24.de`, `mediamarkt.de`, `telekom.de`, `otto.de` | Usercentrics | UNVERIFIED | One-click (Tier 1 API) | Yes | HTML returned, no signature; likely runtime-injected. |
| `zalando.de` | Usercentrics | BLOCKED (302 timeout) | — | — | Redirect loop / bot handling. |
| `eurostar.com` | Didomi | **VERIFIED** — `Didomi`, `didomi`, `sdk.privacy-center.org` | One-click (Tier 1 API `Didomi.setUserDisagreeToAll()`) | Likely (UK/EU rail) | Loader + SDK host present. Best Didomi test site. |
| `lemonde.fr`, `decathlon.com`, `orange.fr` | Didomi | UNVERIFIED | One-click (Tier 1 API) | Likely | `orange.fr` returned a near-empty (~1 KB) shell — likely a JS bootstrap/interstitial; not a CMP conclusion. |
| `zeit.de` | Sourcepoint | **VERIFIED** — `sourcepoint`, `sp_message_container` | Consent-or-pay — see paywall row | Yes | Named in `docs/DESIGN-cookie-consent-paywall-accept.md` as a paywall gate target. |
| `spiegel.de` | Sourcepoint | **VERIFIED** — `Sourcepoint`, `sp_message_container` | Consent-or-pay — see paywall row | Yes | Second named paywall target. |
| `bild.de` | Sourcepoint | **VERIFIED** — `_sp_` | Consent-or-pay | Yes | DE tabloid; Sourcepoint wall. |
| `theguardian.com` | Sourcepoint | **VERIFIED** — `sourcepoint` | Reject available (not a hard paywall) | Yes | Guardian offers reject; use as the non-paywall Sourcepoint reference. |
| `welt.de`, `faz.net`, `forbes.com` | Sourcepoint | UNVERIFIED | — | Yes | HTML returned, no signature in static bytes. |
| `cookieyes.com` | CookieYes | **VERIFIED** — `CookieYes`, `cdn-cookieyes`, `cookieyes` | One-click (dual-mandatory bare globals) | Sometimes | Vendor site; strong match. |
| `ahrefs.com` | CookieYes | **VERIFIED** — `cdn-cookieyes`, `cky-`, `cookieyes` | One-click | Sometimes | Independent customer; includes the `.cky-` DOM-class token. Best CookieYes test site (real install + selector token). |
| `hugedomains.com` | CookieYes | **VERIFIED** — `cdn-cookieyes`, `cookieyes` | One-click | Sometimes | Second independent install. |
| `wpbeginner.com` | CookieYes | UNVERIFIED | One-click | Sometimes | No signature in static bytes. |
| `cookie-script.com` | CookieScript | **VERIFIED** — `CookieScript`, `cookie-script.com`, `cookiescript` | One-click (Tier 1 API, triple-mandatory gate) | Yes (EU vendor) | Confirms the 2026-07-17 in-code note (`src/lib/cmp-adapters.js`) with live raw-HTML bytes this pass. Low diversity (vendor's own site); a customer install would strengthen it. |
| `cookieinformation.com` | Cookie Information | **VERIFIED** — `CookieConsent`, `cookieconsent`, `cookieinformation`, `policy.app.cookieinformation.com` | One-click (Tier 1 API) | Yes (Nordic-focused) | Vendor site; strongest match (includes the CDN policy host). |
| `bilia.se` | Cookie Information | **VERIFIED (weak)** — only `cookieconsent` | One-click (Tier 1 API) | Yes | CAUTION: `cookieconsent` alone is ambiguous (also the name of the generic Osano/Insites `cookieconsent.js` library). Confirm the `policy.app.cookieinformation.com` host in a browser before trusting this as a Cookie Information install. `cookieinformation.com` is the stronger reference. |
| `dr.dk`, `jyskebank.dk` | Cookie Information | UNVERIFIED | One-click (Tier 1 API) | Yes | No signature in static bytes. |
| `elgiganten.se` | Cookie Information | BLOCKED (429) | — | — | Rate-limited. |
| `cnil.fr` | tarteaucitron | **VERIFIED** — `tarteaucitron` | One-click (Tier 1 API `tarteaucitron.userInterface.respondAll(false)`) | No (FR-focused, not geo-gated by design) | The French DPA runs the library it recommends — good canonical reference. |
| `ademe.fr` | tarteaucitron | **VERIFIED** — `tarteaucitron` | One-click (Tier 1 API) | No | French public agency install. |
| `education.gouv.fr` | tarteaucitron | **VERIFIED** — `tarteaucitron` | One-click (Tier 1 API) | No | French ministry (.gouv.fr) install. |
| `service-public.fr`, `impots.gouv.fr` | tarteaucitron | UNVERIFIED | One-click (Tier 1 API) | No | No signature in static bytes (may use a different setup). |
| `consentmanager.net` | consentmanager | **VERIFIED** — `consentmanager`, `delivery.consentmanager` | One-click (Tier 1 API, triple-mandatory gate) | Yes | Vendor site; includes the `delivery.consentmanager.*` CDN host. Only confirmed install found — low diversity. |
| `finanzen.net` | consentmanager | BLOCKED (403) | — | — | Bot wall. |
| `chip.de`, `wetter.com`, `t-online.de`, `n-tv.de` | consentmanager | UNVERIFIED | One-click (Tier 1 API) | Yes | German ad-heavy publishers; loaders runtime-injected, nothing static. Needs a real-browser check for a customer install. |

### Tier 2 — bundled declarative click rules (`src/lib/cmp-tier2-rules.js`)

Signatures: Complianz `cmplz-cookiebanner|complianz|cmplz-`; Cookie Notice
`cookie-notice|cn-refuse-cookie|cookie-notice-info`.

| Site | CMP | Verified? (matched signature) | Reject path | EU-geo-gated? | Notes |
|---|---|---|---|---|---|
| `steuck-aachen.de` | Complianz (cmplz) | **VERIFIED** — `Complianz`, `cmplz-`, `cmplz-cookiebanner`, `complianz` | One-click (`.cmplz-deny` inside `#cmplz-cookiebanner-container`) | No (WP plugin, install-dependent) | Now byte-confirmed via raw HTML (previously only a text-pattern match). The `.cmplz-` selector prefix our Tier 2 rule keys on is present. Best Complianz test site. |
| `doaj.org` | Complianz (cmplz) | **UNVERIFIED (changed!)** — `200`, no `cmplz`/`complianz` in static bytes this pass | One-click (`.cmplz-deny`) | No | NON-OBVIOUS: `src/lib/cmp-tier2-rules.js` cites this exact site as the 2026-07 byte-verification for `.cmplz-deny`. Its homepage no longer serves the `cmplz` marker in static HTML — the site may have switched CMP, moved the banner to runtime injection, or restructured. `steuck-aachen.de` is now the reliable Complianz reference; re-check `doaj.org` in a browser before citing it. |
| — | Cookie Notice (dFactory) | **ZERO VERIFIED** — no live install surfaced (`wordpress.org` UNVERIFIED) | One-click (`#cn-refuse-cookie`, when enabled) | No | Low-adoption WP plugin; its refuse button is admin-optional so many installs won't show it. Needs a maintainer-supplied real URL. |

### Toggle-reject targets — Osano pilot + design-doc follow-ups (in-flight PR)

Highest manual-validation value for the toggle-reject work in progress
(`docs/DESIGN-cookie-consent-tier2-v2.md`, ADR-6). None has a bundled rule shipped in
`src/lib/cmp-tier2-rules.js` yet.

| Site | CMP | Verified? (matched signature) | Reject path | EU-geo-gated? | Notes |
|---|---|---|---|---|---|
| `osano.com` | Osano (pilot) | **VERIFIED** — `osano-cm` | Multi-step: open settings → toggle categories off → Save (`.osano-cm-save`) | Plausible (US vendor, global consent) | The `osano-cm` class prefix (the anchor the pilot toggle-reject selectors build on) is present in static HTML. Confirm in a real browser: (1) that the banner renders in the TOP frame, not a cross-origin iframe (if iframe → Osano unreachable, design doc says fall back to Complianz); (2) the exact toggle/container/save selectors; (3) the Save button's accessible name is save-family, not accept-family. |
| `mooveagency.com` | Moove ("GDPR Cookie Compliance", WP) | **VERIFIED** — `gdpr-cookie-compliance`, `gdpr_cookie_modal`, `Moove`, `moove` | **One-click** ("Reject All" on banner) + a toggle-then-save panel ("Enable All" / "Save Changes") | Not observed to gate | Strong evidence: `gdpr_cookie_modal` and `gdpr-cookie-compliance` are actual plugin selectors, not just a brand mention. Vendor dogfoods its own plugin. Find an independent third-party install to confirm the plugin's typical default toggle state. |
| `termsfeed.com` | TermsFeed | **VERIFIED (weak — vendor brand only)** — `termsfeed`, `TermsFeed` | Design-doc estimate: multi-step | Unknown | The match is the vendor's own brand name on its own marketing site — NOT proof of a live consent-banner install with reject selectors. Treat as a lead; a real customer install is still needed. |
| `cookiefirst.com` | CookieFirst | **VERIFIED (weak — vendor brand only)** — `cookiefirst` | Design-doc estimate: multi-step | Unknown | Same caveat: brand token on the vendor's own domain, not a confirmed banner install. |
| `borlabs.io` | Borlabs Cookie (DE WP) | **VERIFIED (weak — vendor brand only)** — `Borlabs`, `borlabs` | Design-doc estimate: multi-step | No (DE market, not geo-gated by design) | Same caveat. Borlabs is a self-hosted WP plugin; the vendor marketing site may not run the plugin itself. Needs a customer install. |
| `cookiehub.com` | CookieHub | **VERIFIED (weak — vendor brand only)** — `CookieHub`, `cookiehub` | Design-doc estimate: multi-step | Unknown | Same caveat: brand token on the vendor's own domain. |

---

## By behavior

- **One-click reject (best site): `accenture.com`** (OneTrust, full `Optanon` + `cdn.cookielaw.org`
  + `otSDKStub` signature). OneTrust is the largest Tier 1 adapter by market share and the reject is
  a single API call. Runners-up across other Tier 1 APIs: `eurostar.com` (Didomi), `usercentrics.com`
  / `aboutyou.de` (Usercentrics), `ahrefs.com` (CookieYes), `cnil.fr` (tarteaucitron). For a bundled
  Tier 2 one-click, use `steuck-aachen.de` (Complianz `.cmplz-deny`).
- **Pre-checked toggles → uncheck then Save (highest value for the in-flight toggle-reject PR):
  `osano.com`** — the project's designated Osano pilot; `osano-cm` confirmed in static HTML this
  pass. Still verify top-frame render, exact `.osano-cm-*` selectors, and default toggle state in a
  real browser before locking the selectors (the design doc flags them UNVERIFIED). Second candidate
  exposing the same behavior class: `mooveagency.com` (Moove settings panel: "Enable All" /
  "Save Changes").
- **Paywall / "no deny" wall: `zeit.de` or `spiegel.de`** (Sourcepoint consent-or-pay, DE) — both
  VERIFIED this pass (`sp_message_container` present) and both named by
  `docs/DESIGN-cookie-consent-paywall-accept.md` as the real-site pre-enable gate. The banner itself
  needs a headed browser with EU egress (the loader is present here but the wall renders by geo);
  that design doc uses screenshot-based confirmation, not a DOM heuristic, because the wall's
  dismissal is otherwise unreliable to detect. For a Sourcepoint site that DOES offer reject (not a
  hard paywall), use `theguardian.com`.
- **Known closed-shadow-DOM / unreachable example: Axeptio** — documented in
  `src/lib/cmp-tier2-rules.js` as DROPPED from the Tier 2 seed: its banner renders inside a CLOSED
  Shadow DOM behind a randomized custom-element host name per page load, so no stable selector can
  reach it. No specific live Axeptio URL is pinned here (the point is a regression check that MUGA
  correctly does nothing on such a site); a maintainer wanting a live example should supply a current
  Axeptio site and confirm the closed-shadow-DOM behavior still holds before relying on it.

---

## Coverage gaps (honest)

CMPs with **zero VERIFIED live site** after this raw-HTML pass — a maintainer must supply a URL from
a real browser (ideally EU-egress, DevTools open):

- **Cookiebot** — 0/7 candidates matched (`cookiebot.com`, `jysk.com`, `visitdenmark.com`,
  `lush.com`, `coop.se`, `zooplus.de`, `rituals.com` all UNVERIFIED; `tesco.com` BLOCKED). Cookiebot
  injects `consent.cookiebot.com/uc.js` at runtime on every candidate tried, so nothing lands in
  static HTML. This is the biggest remaining Tier 1 gap. Open a known Cookiebot site in a browser and
  read the live DOM for `#CybotCookiebotDialog`.
- **Cookie Notice (dFactory)** — no live install surfaced at all. Low-adoption WP plugin with an
  admin-optional refuse button; needs a specific customer URL.

Weak/low-diversity confirmations worth strengthening (VERIFIED but not ideal):

- **CookieScript** and **consentmanager.net** — only the vendor's OWN site verified; find an
  independent customer install.
- **Cookie Information** `bilia.se` — matched only the ambiguous `cookieconsent` token; confirm the
  `policy.app.cookieinformation.com` host in a browser (use `cookieinformation.com` as the strong
  reference meanwhile).
- **TermsFeed / CookieFirst / Borlabs / CookieHub** — "VERIFIED" only via the vendor's own brand
  name on the vendor's own marketing domain, which is NOT proof of a live consent banner with reject
  selectors. `mooveagency.com` is the exception (matched real plugin selectors `gdpr_cookie_modal` /
  `gdpr-cookie-compliance`). Find third-party customer installs for the other four before treating
  them as representative.

Watch-item:

- **`doaj.org` (Complianz)** appears to have changed — the site cited in `src/lib/cmp-tier2-rules.js`
  as the byte-verification for `.cmplz-deny` no longer serves the `cmplz` marker in static HTML.
  Re-check in a browser; `steuck-aachen.de` is the reliable Complianz reference now.
