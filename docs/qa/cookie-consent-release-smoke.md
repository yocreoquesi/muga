# Cookie-consent release smoke battery

## Why this exists

The 10 Tier 1 cookie-consent adapters in `src/lib/cmp-adapters.js` (OneTrust,
Cookiebot, Didomi, CookieYes, Sourcepoint, Usercentrics, Cookie Information,
CookieScript, tarteaucitron, consentmanager.net) are unit-green:
every detection truth table, every reject call shape, and every
never-auto-accept structural guard is covered by `npm test`. Unit-green is
not the same thing as real-env-green. Every adapter's merge PR shipped with
an explicit, unchecked "Pre-ship gate" item asking for a real-browser smoke
test against a live vendor page before the adapter goes into a store
release, and none of those checkboxes have been closed yet.

This document turns those scattered PR checkboxes into one runnable gate:
a per-adapter human QA checklist (Chrome + Firefox) plus an automated
Chrome-only report (`npm run smoke:release`) that reuses the existing
nightly CMP canary's results.

**When to run:** before every `develop -> main` release PR that ships a
build containing the cookie-consent minimizer. All rows in every adapter
section below, and every cell in the final sign-off table, must be PASS
before the release PR opens. A single unresolved FAIL blocks the release
for that build.

## Automated Chrome portion

The nightly CMP canary (`.github/workflows/cmp-canary.yml`,
`tests/canary/cmp-canary.spec.mjs`) already loads the real built extension
against the real-site candidates in `tests/canary/cmp-sites.json` and
records `{cmp, url, status: pass|fail|inconclusive, detail}` results to
`test-results/canary-results.json`. This release-smoke report
(`tools/release-smoke-report.mjs`) does not run a second copy of that
suite - it reduces the same results file into a release-readiness verdict
per adapter.

To run it as part of a release:

1. Trigger the canary workflow on demand: `gh workflow run cmp-canary.yml`
   (or use the Actions tab's "Run workflow" button on `cmp-canary.yml`).
2. Wait for the run to finish, then download its results artifact
   (`cmp-canary-results`): `gh run download <run-id> -n cmp-canary-results -D test-results/`.
3. Run `npm run smoke:release`. It prints a per-adapter table with verdict
   `READY` / `BLOCKED` / `UNVERIFIED`, and exits non-zero if any adapter is
   `BLOCKED` (so this can be wired into a release-gate script). `UNVERIFIED`
   only prints a warning - it never fails the run, because real sites are
   flaky, geo-variant, or already-consented on a given run.

**Geo limitation:** consent banners render based on the visitor's inferred
geography, so the automated canary's vantage point matters. From a non-EU
vantage - including the US-based GitHub Actions runners this workflow runs
on - most EU-gated CMP banners never appear at all, and those runs land as
`inconclusive` rather than pass or fail (see the GEO LIMITATION note in
`tests/canary/cmp-canary.spec.mjs`, #1135). A first real-site calibration
run confirmed this: 9 of 12 candidate sites came back inconclusive from US
CI. This means the automated Chrome portion is a coarse, US-CI-biased
signal, not a release gate on its own - the manual Chrome + Firefox
checklist below, run from a correct (EU) geo vantage, remains the real
release gate.

**What this covers, and what it does not:** the automated Chrome portion
confirms the Chrome MAIN-world detection signals fire and the reject call
executes without the banner staying visible, on real vendor pages, in
Chrome. It does **not** cover: the Firefox `wrappedJSObject` path (Chrome
and Firefox use different content-script worlds - see
`src/content/cookie-noise-mainworld.js` vs `src/content/cookie-noise.js`),
visual confirmation that no cookie was actually set after reject, or any
geography-gated banner variant the canary's candidate site didn't happen
to show that run. Those require the manual Chrome + Firefox steps below.

## Automated reject-API surface drift check (any vantage)

`tools/probe-cmp-surface.mjs` covers the drift the geo-gated canary can't
reach: a vendor RENAMING or REMOVING the reject method our adapter calls
(e.g. Cookiebot dropping `submitCustomConsent`). Unlike the banner, the vendor
SDK loads and exposes its globals regardless of the consent-banner geo gate,
so this yields a real signal from ANY vantage (including non-EU CI):

    node tools/probe-cmp-surface.mjs          # table + per-adapter verdict
    node tools/probe-cmp-surface.mjs --json    # machine-readable

It navigates each adapter's real customer sites (from `tests/canary/cmp-sites.json`)
and reports CONFIRMED (reject method present as a function), GLOBAL_ONLY
(possible partial drift), or UNCONFIRMED (SDK never loaded — site down /
bot-protected / not on that CMP). A 2026-07 run confirmed ALL 10 adapters'
reject-API surface live from a non-EU vantage, after curating a better
Usercentrics site (paulandshark.com; dish.com/conrad.de did not expose `UC_UI`
from that vantage — the UC_UI surface is scarcer in the wild than assumed, see
#1121). Only the banner-dismiss step below still needs an EU vantage.

This does NOT replace the banner-dismiss smoke below — it proves the method
still EXISTS to call, not that calling it dismisses the live banner. It is a
maintainer probe, not a CI gate (real sites are flaky). Gap A's runtime
`confirmRejectDismissal` console warning is the complementary live safety net:
if a reject fires but its banner never clears on a real user's page, it warns.

## Per-adapter checklist

Each section lists the exact reject call and detection signals as
extracted from `src/lib/cmp-adapters.js` and the content-script call
sites (`src/content/cookie-noise-mainworld.js` for Chrome MAIN world,
`src/content/cookie-noise.js` for the isolated world / Firefox
`wrappedJSObject` path). Candidate live sites are reused verbatim from
`tests/canary/cmp-sites.json` - do not test against a different site
without first adding it there.

General Chrome steps (same shape for all 10 adapters unless noted):

1. `npm run build:content` then load the unpacked extension from `src/`
   in `chrome://extensions` (Developer mode > Load unpacked).
2. Open the extension's Settings and enable the cookie-consent minimizer
   toggle (default OFF - must be turned on for this smoke).
3. Visit the candidate site in a fresh profile / incognito window (no
   prior consent cookie) so the banner actually renders.
4. Confirm the banner disappears (or the page reports a rejected/necessary
   -only state) within a few seconds, with no "Accept all" click ever
   fired by the extension.
5. Open DevTools > Application > Cookies and/or the vendor's own consent
   inspector (where available) to confirm the resulting consent state is
   reject / necessary-only, not accept.

General Firefox steps (same shape for all 10 adapters unless noted):
manual only, automation is tracked separately in #1128.

1. `bash scripts/with-firefox-manifest.sh npm run build:content` then load
   the extension via `about:debugging#/runtime/this-firefox` > Load
   Temporary Add-on (or `npm run dev:firefox`).
2. Repeat Chrome steps 2-5 above in Firefox. The reject call itself is
   reached through `window.wrappedJSObject.<Vendor>...` in Firefox
   (`src/content/cookie-noise.js`) instead of the Chrome MAIN-world direct
   call (`src/content/cookie-noise-mainworld.js`) - this is the one path
   that has never been exercised against a live vendor script, only
   structurally tested, so treat any Firefox FAIL here as high-signal.

### 1. OneTrust

- **Reject call:** `window.OneTrust.RejectAll()` (Chrome MAIN world);
  `window.wrappedJSObject.OneTrust.RejectAll()` (Firefox). Synchronous,
  zero-argument, void return.
- **Detection signals:** mandatory `hasOneTrustGlobal`
  (`typeof window.OneTrust === "object"`) + `hasRejectAllFn`
  (`typeof window.OneTrust.RejectAll === "function"`); corroborating (>=1
  required): `hasBannerDom` (`#onetrust-banner-sdk` or
  `#onetrust-consent-sdk`), `hasActiveGroupsGlobal`
  (`typeof window.OnetrustActiveGroups === "string"`),
  `hasRejectHandlerDom` (`#onetrust-reject-all-handler`).
- **Candidate live site(s):** `https://www.aircanada.com`,
  `https://www.bertelsmann.com` (banner selector `#onetrust-banner-sdk`).
- **Specific risk to verify (PR #1117):** the Firefox
  `wrappedJSObject.OneTrust.RejectAll()` path and the bounded
  MutationObserver give-up are structurally tested only - this is the
  first adapter, so it also validates the give-up timeout doesn't fire
  early on a real page's load timing.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 2. Cookiebot

- **Reject call:** `window.Cookiebot.submitCustomConsent(false, false, false)`
  (Chrome MAIN world); `window.wrappedJSObject.Cookiebot.submitCustomConsent(false, false, false)`
  (Firefox). Synchronous. The three literal `false` positional args are
  preferences / statistics / marketing; necessary cookies are
  implicit/always-on in Cookiebot's model and are not one of the three
  booleans.
- **Detection signals:** mandatory `hasCookiebotGlobal`
  (`typeof window.Cookiebot === "object"`) + `hasSubmitCustomConsentFn`
  (`typeof window.Cookiebot.submitCustomConsent === "function"`);
  corroborating (>=1 required): `hasCybotDialogDom`
  (`#CybotCookiebotDialog`), `hasConsentObjectGlobal`
  (`typeof window.Cookiebot.consent === "object"`),
  `hasResponseBooleanGlobal` (`typeof window.Cookiebot.hasResponse === "boolean"`).
- **Candidate live site(s):** `https://www.clece.es`,
  `https://www.cookiebot.com` (lower confidence - vendor's own site;
  banner selector `#CybotCookiebotDialog`).
- **Specific risk to verify (PR #1122):** Firefox `wrappedJSObject` reject
  path and live-Cookiebot compatibility are structurally tested only
  (the Chromium e2e fixture is a regression oracle, not a real-vendor
  test) - confirm the literal `(false, false, false)` call actually
  clears the banner on a live site, not just in the fixture.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 3. Didomi

- **Reject call:** `window.Didomi.setUserDisagreeToAll()` (Chrome MAIN
  world); `window.wrappedJSObject.Didomi.setUserDisagreeToAll()`
  (Firefox). Synchronous, zero-argument, void return - no consent-granting
  parameter exists on this call at all.
- **Detection signals:** mandatory `hasDidomiGlobal`
  (`typeof window.Didomi === "object"`) + `hasSetUserDisagreeToAllFn`
  (`typeof window.Didomi.setUserDisagreeToAll === "function"`);
  corroborating (>=1 required): `hasDidomiHostDom` (`#didomi-host`),
  `hasGetCurrentUserStatusFn` (`typeof window.Didomi.getCurrentUserStatus === "function"`,
  typeof-checked only, never invoked).
- **Candidate live site(s):** `https://www.orange.fr`,
  `https://www.europcar.com` (banner selector `#didomi-host`).
- **Specific risk to verify (PR #1124):** Firefox `wrappedJSObject` path
  and live-Didomi compatibility are structurally tested only; this
  adapter also fixed a Firefox-dispatcher symmetry bug (missing `return`)
  in the same PR - confirm the reject call actually fires exactly once
  per page load in Firefox, not zero or twice.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

#### RETIRED: Didomi accept-when-necessary pilot (minimum-grant)

The Didomi `setCurrentUserStatus` minimum-consent construction described
in this subsection (cookie-consent-accept Slice 2a) was proven non-viable
before ever shipping to real users (engram id 1331,
"DIDOMI-ACCEPT-NOT-VIABLE"): no real Didomi hard wall ever lacks
`setUserDisagreeToAll`, the vendor's "required" getters mean
"consent-gated" not "necessary/exempt", and the `setCurrentUserStatus`
call silently no-ops on real deployments. This entire code path
(`decideMinimumAccept`, `canAttemptDidomiMinimumAccept`,
`buildMinimumPayload`, `resolveDidomiMinimumStatus`, the Didomi getters,
and the Chrome MAIN-world accept dispatch fork) is deleted. See the
"consent-or-pay-wall accept-click" gate below for the real,
cookie-consent-paywall-accept mechanism that replaced it.

#### Consent-or-pay-wall accept-click (cookie-consent-paywall-accept) — BLOCKING real-EU item

The "Accept cookies to read for free" mode's real mechanism: when the user
selects it in Settings AND completes the dedicated informed-consent
gesture, MUGA can click a consent-or-pay wall's own free "Accept all &
continue" button (a plain DOM `element.click()`, isolated world, no page
global) — but ONLY when the wall offers NO free reject option. On a true
consent-or-pay wall this GRANTS the site's advertising/tracking cookies —
the honest tradeoff of the only free path through such a wall, not a
"minimum" construction.

**This item is a HARD PRE-ENABLE GATE, not an optional nice-to-have.** The
synthetic e2e fixture (`tests/e2e/cookie-consent-paywall-accept.spec.mjs`)
only proves the MECHANICS against a fixture built from the real-site
probes' documented shape (engram id 1333, id 1335): it clicks ONLY the
free-accept button, never the pay button (even alone, with no ambiguity),
never when a free reject exists, and never outside the mode+gesture double
-gate. A synthetic fixture CANNOT prove that a real Sourcepoint (or other
CMP) deployment's button markup/labels actually match the DE+EN word lists
this slice ships, or that clicking a real wall's button actually dismisses
it in-extension (the throwaway probe that proved the mechanism viable, id
1333, ran outside the extension).

**PARTIAL VALIDATION DONE (2026-07-20, non-EU-vantage probe + hardening):**
- The DISCRIMINATION was run against LIVE DE production markup captured from
  real walls (`tools`-style Playwright probe, no accept-click): on `zeit.de`
  and `spiegel.de` the buttons classified correctly — `[11] "Zustimmen/Einwilligen und weiter"` -> accept, `[9] "...abonnieren"` -> pay, `[12] "Einstellungen"` -> settings.
- IMPORTANT correction: `zeit.de`/`spiegel.de` expose a Settings choice
  (`sp_choice_type_12`), so the accept-click CORRECTLY VETOES on them (a free
  reject is reachable). They are the VETO cross-check, NOT the firing case. The
  wall that actually FIRES (a true hard wall: accept + pay only, no
  settings/reject) is `faz.net` / `sueddeutsche.de` (the "einverstanden"
  free-accept walls the DE smoke originally passed).
- A final visibility guard was added (`isAcceptTargetVisible`): the click now
  never targets an accept hidden via `visibility:hidden`/`opacity:0`. Confirm
  the real firing wall's accept button is normally visible so the guard does
  not suppress a legitimate fire.
- FR/ES/IT walls could NOT be probed: they are geo-gated and did not render at
  all from a non-EU vantage (0 sp_choice controls on lemonde/lefigaro/elpais/
  elmundo/corriere/repubblica). The FR/ES/IT tokens therefore remain unverified
  against real markup — each locale needs its own EU-vantage capture below.

- [ ] **BLOCKING (firing + dismissal):** run a real headed-Chromium smoke from
  a genuine EU vantage point (VPN/proxy or an EU-hosted CI runner) against a
  TRUE HARD wall — `faz.net` / `sueddeutsche.de` (German "einverstanden"
  free-accept, accept + pay only, no Settings). Load MUGA from `src/`,
  onboarded, mode = accept-when-necessary, gesture confirmed. This is the case
  that GRANTS consent, so it is the one that must actually dismiss.
- [ ] **BLOCKING (veto cross-check):** against `zeit.de` / `spiegel.de` (which
  DO expose a Settings choice) confirm the accept-click CORRECTLY ABSTAINS —
  the wall is left for the user, nothing is clicked.
- [ ] **BLOCKING per locale (FR/ES/IT):** before enabling on any FR/ES/IT wall,
  capture a real EU-vantage hard wall in that locale and confirm the shipped
  FR/ES/IT tokens classify its accept as accept and its pay as pay (they are
  currently DATA-only, unverified — see cmp-accept-adapters.js docblock).
- [ ] Confirm the click actually DISMISSES the wall — **verify by
  screenshot, not by an overlay/overflow-CSS heuristic** (id 1333's own
  false-positive lesson: a residual bottom banner + normal
  `overflow-y:auto` can look like "still blocked" to a naive DOM check
  even after the wall is genuinely gone).
- [ ] Confirm the PAY/subscribe button ("...abonnieren" / "Jetzt
  abonnieren" / "Werbefrei-Abo") is NEVER clicked, on either site.
- [ ] Confirm the checkbox gesture in Settings actually gates this: with
  the mode selected but the gesture NOT confirmed, the wall must stay
  untouched (same manual check as the automated adversarial suite,
  repeated against the real vendor as a sanity cross-check).
- [ ] Confirm a paused top-frame site (per-site exemption) is honored even
  though the click fires from inside the cross-origin consent iframe —
  pause one of the two candidate sites in Settings and confirm the wall
  is left alone.

**Until every box above is checked, "Accept cookies to read for free" must
NOT be enabled/released to real users** — ship it dormant (the mode
selectable in Settings is fine; the underlying capability working
correctly on real consent-or-pay infrastructure is not yet proven). Track
this as its own line in the sign-off table below.

### 4. CookieYes

- **Reject call:** `window.performBannerAction("reject")` (Chrome MAIN
  world); `window.wrappedJSObject.performBannerAction("reject")`
  (Firefox). Synchronous; the argument is always the literal string
  `"reject"`.
- **Detection signals:** DUAL-MANDATORY bare globals (both required
  together, since neither is a vendor-namespaced anchor):
  `hasGetCkyConsentFn` (`typeof window.getCkyConsent === "function"`) and
  `hasPerformBannerActionFn` (`typeof window.performBannerAction === "function"`);
  corroborating (>=1 required): `hasCkyConsentContainerDom`
  (`.cky-consent-container`), `hasCkyOverlayDom` (`.cky-overlay`),
  `hasCkyConsentBarDom` (`.cky-consent-bar`).
- **Candidate live site(s):** `https://ahrefs.com`,
  `https://www.dominos.gr` (banner selector
  `.cky-consent-container, .cky-consent-bar`).
- **Specific risk to verify (PR #1125):** Firefox `wrappedJSObject` path
  AND `performBannerAction`'s load-timing (undocumented upstream - is
  the function defined before the banner mounts, and does calling it too
  early no-op safely?) are structurally tested only.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 5. Sourcepoint

- **Reject call:** `window.__tcfapi("postRejectAll", 2, callback)` (Chrome
  MAIN world); `window.wrappedJSObject.__tcfapi("postRejectAll", 2, callback)`
  (Firefox). Fire-and-forget: the callback is async/log-only and never
  gates control flow - `_acted`/`stopObserver()` fire synchronously right
  after the call returns.
- **Detection signals:** DUAL-MANDATORY: `hasTcfApiFn`
  (`typeof window.__tcfapi === "function"` - generic to every TCF CMP,
  including Didomi, so never a sole anchor) AND `hasSpMessageContainerDom`
  (`div[id^="sp_message_container"]` - the Sourcepoint-specific anchor);
  corroborating (>=1 required): `hasSpPrivacyMgmtIframeDom`
  (`iframe[src*="privacy-mgmt.com"]`), `hasSpProdIframeDom`
  (`iframe[src*="sp-prod.net"]`), `hasSpProdScriptDom`
  (`script[src*="sp-prod.net"]`).
- **Candidate live site(s):** `https://9gag.com`,
  `https://www.heraldscotland.com` (lower confidence - masthead-level
  citation only; banner selector `div[id^="sp_message_container"]`).
- **Specific risk to verify (PR #1126):** TCF-vs-Didomi discrimination -
  confirm on a real Sourcepoint page that `postRejectAll` fires (not a
  Didomi-shaped misfire), and separately confirm on a real Didomi-only
  page (if convenient) that Sourcepoint does NOT fire. Also verify the
  Firefox `wrappedJSObject.__tcfapi` path, which is structurally tested
  only. Known accepted gap (not part of this smoke): a self-hosted/proxied
  Sourcepoint loader lacking the `privacy-mgmt.com`/`sp-prod.net`
  secondary signals yields confidence 0.4 and is deliberately missed
  (fail-closed, never misfires) - do not treat that as a FAIL here.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 5b. Sourcepoint - multi-layer reject (Options panel -> Reject all) (#1123)

Covers the multi-layer follow-up (`findSpOpenSettingsTarget` +
`runSpRejectClickDispatcher` in `src/content/cookie-noise.js`). Some
Sourcepoint walls expose ONLY a "12" ("Options"/"Manage") control at the top
layer, with the real "Reject all" ("13") one layer deeper inside the
privacy-manager panel that "12" opens.

- **Reject flow:** with no directly actionable "13" present, MUGA clicks the
  single actionable `sp_choice_type_12` control ONCE to open the panel, then
  the MutationObserver re-enters and clicks the panel's revealed single
  `sp_choice_type_13` ("Reject all"). Both are plain isolated-world
  `element.click()` calls, so Chrome and Firefox use the SAME path here (no
  MAIN-world / `wrappedJSObject` fork, unlike the `postRejectAll` API call).
- **Options-only scope (the key guard to verify):** the "12" is opened ONLY
  when NO other actionable `sp_choice` decision control (a broad-consent "11",
  a pay "9", a direct "13", ...) is present at the top layer. On a wall that
  also shows accept/pay, MUGA must NOT open the Options panel.
- **Candidate live site(s):** needs a real Sourcepoint deployment whose FIRST
  layer offers only "Options"/"Manage" (no direct "Reject all") - curation
  tracked with the other canary-site work in #1135. The single-click SP
  candidates in section 5 (9gag, pinknews) expose a direct "13" and exercise
  the non-multi-layer path, not this one.
- **Specific risk to verify (#1123):**
  1. On a real "12-only" SP wall: MUGA opens the Options panel and the
     revealed "Reject all" is clicked and the wall is dismissed (before/after
     screenshot; confirm via Sourcepoint's `onMessageChoiceSelect` log
     reporting choice type 12 then 13, if available).
  2. NEVER-ACCEPT: if the opened panel does not surface a reachable "Reject
     all", MUGA clicks nothing further and the wall is left intact (no consent
     granted) - a fail-closed NOOP, never an accept.
  3. OPTIONS-ONLY SCOPE: on a consent-or-pay wall showing [Accept][Options]
     [Pay], MUGA does NOT auto-open the Options panel (the reject engine
     leaves it to the direct-"13" path and the separate accept feature).
  4. Verify the Firefox path (same isolated-world DOM clicks; no Firefox-
     specific fork, but confirm the panel-open + revealed-"13" click fire in
     Gecko).
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 6. Usercentrics

- **Reject call:** `window.UC_UI.denyAllConsents()` (Chrome MAIN world);
  `window.wrappedJSObject.UC_UI.denyAllConsents()` (Firefox). Returns a
  **Promise** (the only adapter of the 6 that does) - the call site
  chains `.catch(() => {})` to swallow a floating rejection and never
  awaits it; `_acted`/`stopObserver()` fire synchronously right after the
  call, not after the promise settles.
- **Detection signals:** mandatory `hasUcUiGlobal`
  (`typeof window.UC_UI === "object"`) + `hasDenyAllConsentsFn`
  (`typeof window.UC_UI.denyAllConsents === "function"`); corroborating
  (>=1 required): `hasUsercentricsRootDom` (`#usercentrics-root`, the
  Shadow DOM host element - the shadow root itself is never queried),
  `hasIsInitializedFn` (`typeof window.UC_UI.isInitialized === "function"`,
  typeof-checked only, never invoked as a runtime gate).
- **Candidate live site(s):** `https://www.dish.com`,
  `https://www.conrad.de` (banner selector `#usercentrics-root`).
- **Specific risk to verify (PR #1127) - see the dedicated callout below.**
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

#### Usercentrics callout: third-party-corroborated API, reinforced gate

Usercentrics' own canonical API docs were unreachable during adapter
research - the `denyAllConsents()` / `isInitialized()` shape was
corroborated only via third-party integration docs, not Usercentrics'
first-party reference. This smoke test therefore validates the API shape
itself, not just real-env compatibility, and this gate carries more
weight than the other five. On a real drop-in Usercentrics site
(`https://www.dish.com` or `https://www.conrad.de`), confirm ALL of the
following before marking this adapter PASS:

- [ ] `window.UC_UI.denyAllConsents` exists and is a function.
- [ ] Calling it actually denies consent (check the resulting consent
      state via DevTools / the vendor's own consent inspector, not just
      "the banner went away").
- [ ] It returns a Promise (log `window.UC_UI.denyAllConsents()` in the
      console and confirm `instanceof Promise`). If it returns `undefined`
      instead, confirm the adapter still fails safe (no page break, no
      thrown error surfaced to the user) - the `.catch()` chain would
      throw a `TypeError` on `undefined.catch`, but that throw is caught
      by the enclosing `try/catch` in `cookie-noise-mainworld.js` /
      `cookie-noise.js`.
- [ ] Calling `denyAllConsents()` again on an already-consented page (i.e.
      the user already went through the banner once) is inert - no error,
      no unexpected UI state, no duplicate network call storm.
- [ ] `window.UC_UI.isInitialized` exists as a function (the adapter only
      `typeof`-checks it as a corroborating signal, never invokes it as a
      gate - confirm that remains a safe assumption on a live site: does
      calling `isInitialized()` manually in the console return a stable
      boolean before/after the reject call?).
- [ ] If the site uses TCF-2.2-addon mode, confirm whether `window.UC_UI`
      is still exposed or swapped for a different surface (ambiguous
      across third-party sources per PR #1127 - note the finding either
      way, do not silently assume).

### 7. Cookie Information

- **Reject call:** `window.CookieInformation.declineAllCategories()` (Chrome
  MAIN world); `window.wrappedJSObject.CookieInformation.declineAllCategories()`
  (Firefox). Synchronous, zero-argument, void return — same call shape as
  `Didomi.setUserDisagreeToAll()`; there is no consent-granting parameter on
  this call at all.
- **Detection signals:** mandatory `hasCookieInformationGlobal`
  (`typeof window.CookieInformation === "object"`) + `hasDeclineAllCategoriesFn`
  (`typeof window.CookieInformation.declineAllCategories === "function"`);
  corroborating (>=1 required): `hasCoiOverlayDom` (`#coiOverlay`),
  `hasCoiConsentBannerDom` (`#coiConsentBanner`), `hasCoiSummeryDom`
  (`#coiSummery`), `hasCoiBannerWrapperDom` (`#coi-banner-wrapper`),
  `hasCoiConsentSummaryDom` (`.coi-consent-summary`).
- **Candidate live site(s):** `https://cookieinformation.com` (PLACEHOLDER —
  UNVERIFIED, needs curation; vendor's own site, banner selector
  `#coiOverlay, #coiConsentBanner, #coiSummery, #coi-banner-wrapper,
  .coi-consent-summary`). Replace with an independently-confirmed customer
  deployment before treating this as a release gate.
- **Specific risk to verify:** Firefox `wrappedJSObject` reject path and
  live-Cookie-Information compatibility are structurally tested only (the
  Chromium e2e fixture is a regression oracle, not a real-vendor test) —
  confirm `declineAllCategories()` actually clears the banner on a live
  site, not just in the fixture. Also confirm the discrimination note
  holds: this vendor can additionally expose the generic `__tcfapi` surface
  (opt-in per site) without this adapter or the Sourcepoint adapter
  misfiring on each other.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 8. CookieScript

- **Reject call:** `window.CookieScript.instance.rejectAllAction()` (Chrome
  MAIN world); `window.wrappedJSObject.CookieScript.instance.rejectAllAction()`
  (Firefox). Synchronous, zero-argument, void return — "rejects all cookies
  except strictly necessary" per the vendor's own documentation.
- **Detection signals:** TRIPLE-mandatory (all three required together,
  since the reject call lives on `.instance`, not directly on the vendor
  global): `hasCookieScriptGlobal` (`typeof window.CookieScript === "object"`),
  `hasCookieScriptInstance` (`typeof window.CookieScript.instance === "object"`),
  and `hasRejectAllActionFn`
  (`typeof window.CookieScript.instance.rejectAllAction === "function"`);
  corroborating (>=1 required): `hasCookiescriptInjectedDom`
  (`#cookiescript_injected`), `hasCookiescriptDescriptionDom`
  (`#cookiescript_description`).
- **Candidate live site(s):** `https://cookie-script.com` (PLACEHOLDER —
  UNVERIFIED, needs curation; vendor's own site, banner selector
  `#cookiescript_injected, #cookiescript_description`). Replace with an
  independently-confirmed customer deployment before treating this as a
  release gate.
- **Specific risk to verify:** Firefox `wrappedJSObject` reject path and
  live-CookieScript compatibility are structurally tested only (the
  Chromium e2e fixture is a regression oracle, not a real-vendor test) —
  confirm `instance.rejectAllAction()` actually clears the banner on a live
  site, not just in the fixture. Also confirm `.instance` is reliably
  populated by the time the dispatcher's MutationObserver fires (the vendor
  SDK may attach `.instance` asynchronously after the global itself
  appears) — a real-site smoke is the only way to observe this timing.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 9. tarteaucitron

- **Reject call:** `window.tarteaucitron.userInterface.respondAll(false)`
  (Chrome MAIN world); `window.wrappedJSObject.tarteaucitron.userInterface.respondAll(false)`
  (Firefox). Synchronous (a plain `for` loop over `tarteaucitron.job`, no
  Promise/callback) — the literal `false` status argument denies every
  registered service; this is the exact function/argument the vendor's own
  "tout refuser" (reject all) UI button calls.
- **Detection signals:** TRIPLE-mandatory (all three required together,
  since the reject call lives on `.userInterface`, not directly on the
  vendor global): `hasTarteaucitronGlobal` (`typeof window.tarteaucitron === "object"`),
  `hasTarteaucitronUserInterface` (`typeof window.tarteaucitron.userInterface === "object"`),
  and `hasRespondAllFn`
  (`typeof window.tarteaucitron.userInterface.respondAll === "function"`);
  corroborating (>=1 required): `hasTarteaucitronRootDom`
  (`#tarteaucitronRoot`), `hasTarteaucitronAlertBigDom`
  (`#tarteaucitronAlertBig`), `hasTarteaucitronBackDom`
  (`#tarteaucitronBack`), `hasTarteaucitronModalOpenDom`
  (`.tarteaucitron-modal-open` on `document.body`).
- **Candidate live site(s):** `https://tarteaucitron.io` (PLACEHOLDER —
  UNVERIFIED, needs curation; the project's own site, banner selector
  `#tarteaucitronRoot, #tarteaucitronAlertBig`). Replace with an
  independently-confirmed customer deployment (strong France/gov-sector
  presence) before treating this as a release gate.
- **Specific risk to verify:** Firefox `wrappedJSObject` reject path and
  live-tarteaucitron compatibility are structurally tested only (the
  Chromium e2e fixture is a regression oracle, not a real-vendor test) —
  confirm `userInterface.respondAll(false)` actually clears the banner on a
  live site, not just in the fixture. Also confirm `.userInterface` is
  reliably populated by the time the dispatcher's MutationObserver fires,
  and that the literal `false` argument (not `true`, not omitted) is the
  one that actually denies consent on a live deployment — `respondAll`'s
  second and third arguments (`type`, `allowSafeAnalytics`) are never
  passed by this adapter.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

### 10. consentmanager.net

- **Reject call:** `window.__cmp("setConsent", 0, callback, true)` (Chrome
  MAIN world); `window.wrappedJSObject.__cmp("setConsent", 0, callback, true)`
  (Firefox). Fire-and-forget: the callback fires in practice but is
  optional-log-only and never gates control flow — `_acted`/`stopObserver()`
  fire synchronously right after the call returns. The literal `0`
  consent-value argument denies all (reject-all); `1` would grant broad
  consent, so this call site never passes a variable there — confirmed
  behaviorally on 3 live customer deployments (see the specific-risk note
  below).
- **Detection signals:** TRIPLE-mandatory (all three required together, since
  `window.__cmp` is the legacy IAB TCF v1.1 generic surface every v1.1-era
  CMP can expose and can never be a sole anchor): `hasCmpMngrGlobal`
  (`typeof window.cmpmngr === "object"`, the vendor-specific global),
  `hasCmpFn` (`typeof window.__cmp === "function"`, the reject surface), and
  `hasCmpBoxDom` (`#cmpbox`, the vendor-specific DOM anchor); corroborating
  (>=1 required): `hasCmpWelcomeBtnYesDom` (`#cmpwelcomebtnyes`),
  `hasCmpWelcomeBtnNoDom` (`#cmpwelcomebtnno`), `hasCmpBoxBtnDom`
  (`#cmpbox .cmpboxbtn`).
- **Candidate live site(s):** `https://www.hoerzu.de` (banner selector
  `#cmpbox`) — PLACEHOLDER, needs independent curation/confirmation before
  relying on this entry for release gating. This is one of the real customer
  deployments (alongside adac.de, blic.rs, hrt.hr) where a live headless-
  Chromium behavioral probe confirmed `window.cmpmngr`/`window.__cmp`
  present, `#cmpbox` visible, and `__cmp("setConsent", 0, callback, true)`
  dismissing the banner with parity to the native reject button (engram
  `sdd/cookie-consent-coverage/tier1-live-probe`) — but that probe was a
  one-off verification run, not the same repeatable canary-site curation
  process used for the other 9 adapters' entries.
- **Specific risk to verify:** Firefox `wrappedJSObject` reject path is
  structurally tested only — confirm `__cmp("setConsent", 0, callback, true)`
  actually clears the banner on a live site in Firefox, not just via the
  Chrome probe evidence above. Also confirm the dual-anchor discrimination
  holds: this vendor's `__cmp` is the shared/generic legacy TCF v1.1 surface,
  so verify on a real consentmanager.net page that the adapter fires (not a
  misfire from some other bare-`__cmp`-exposing v1.1 CMP), and that a
  non-consentmanager.net page exposing only a bare `__cmp` never triggers
  this adapter. consentmanager.net's banner is geo-gated per-deployment
  (confirmed during the live probe — 2 of 5 real customer sites did not
  render from a non-EU vantage), so a single failed manual check from a
  non-EU location is not evidence of drift; retry from an EU vantage or a
  different candidate site before treating a no-show as a FAIL.
- **Chrome:** PASS / FAIL / N/A ____  Notes: ______________________
- **Firefox:** PASS / FAIL / N/A ____  Notes: ______________________

## Sign-off table

All 20 reject-adapter cells (10 adapters x Chrome/Firefox), PLUS the
Sourcepoint multi-layer row and the consent-or-pay-wall accept-click row
below, must be green before the `develop -> main` release PR opens. The accept-click row is a HARD
PRE-ENABLE GATE (see the "Consent-or-pay-wall accept-click" subsection
above) — a release may ship with the mode dormant (unchecked) but must NOT
enable it for real users while that row is unchecked.

| Adapter | Chrome | Firefox |
| --- | --- | --- |
| OneTrust | ____ | ____ |
| Cookiebot | ____ | ____ |
| Didomi (reject) | ____ | ____ |
| CookieYes | ____ | ____ |
| Sourcepoint | ____ | ____ |
| Sourcepoint multi-layer (Options -> Reject, "12"-only wall) - real-EU vantage | ____ | ____ |
| Usercentrics | ____ | ____ |
| Cookie Information | ____ | ____ |
| CookieScript | ____ | ____ |
| tarteaucitron | ____ | ____ |
| consentmanager.net | ____ | ____ |
| **Consent-or-pay-wall accept-click (zeit.de / spiegel.de) - real-EU vantage required** | ____ | N/A (isolated-world only, no Firefox/Chrome fork) |

Reviewer: ______________________  Date: ______________________
