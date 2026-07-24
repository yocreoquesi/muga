# Design: Tier 2 consent-or-pay-wall ACCEPT-CLICK (cookie-consent-paywall-accept)

> DESIGN only. NO code in this artifact.
> Change name: `cookie-consent-paywall-accept`.
> Supersedes the delivery mechanism of `sdd/cookie-consent-accept/design` (engram id 1323):
> the Didomi Tier-1 JS-API accept (`setCurrentUserStatus`) is PROVEN NON-VIABLE (engram id 1331)
> and is retired here. The accept ACTION is now a DOM click on the free "Accept & continue" button
> of a consent-or-pay wall, reachable now that `all_frames:true` runs cookie-noise in the
> cross-origin Sourcepoint (SP) consent iframe (branch `feat/cookie-consent-all-frames`, id 1335).
> Implements policy `architecture/cookie-consent-accept-policy` (id 1285): accept is MODE-SCOPED
> (opt-in `accept-when-necessary` + explicit gesture), minimum/last-resort, never-hide, never in
> default reject-only mode.

This is the highest-stakes action MUGA has ever taken: clicking a consent-GRANTING button on the
user's behalf. Read Part A (button discrimination) and Part B (last-resort gating) first.

---

## HONEST FRAMING CHANGE — read before anything else

The retired Didomi path promised "submit the MINIMUM (strictly-necessary only), never grant
tracking." **That guarantee does NOT survive the move to a consent-or-pay wall.** On a true
consent-or-pay hard wall the only free path is **"Accept all & continue"** — there is NO
necessary-only option to click. So when this feature fires, **it grants BROAD tracking consent.**
The safety model therefore INVERTS from the old one:

| Old (Didomi, retired) | New (consent-or-pay click) |
|---|---|
| Enforce a *minimum* payload; DENYLIST forbids accept-all | Accept-all IS the action; the DENYLIST forbids the *pay/subscribe* button |
| "Never grants tracking" | Grants broad tracking — as the last-resort free path only |
| Safety = build the least-permissive payload | Safety = positively identify the FREE-ACCEPT button, NEVER the pay button |

The user-facing consent copy and the meaning of `accept-when-necessary` MUST be rewritten to say
this plainly (Part E). This is a product-owner decision, not a wording tweak.

---

## PART A — SAFETY MODEL: button discrimination (the crux)

The wall presents (at least) two primary CTAs: FREE = "Accept all & continue (free)", PAID =
"Subscribe / Pay". MUGA must click the FREE-ACCEPT button and **never** the pay button. Because
this is a consent-GRANTING click it is the INVERSE of the reject veto and is held to a STRICTER
bar: an element is clickable only when ALL of the following hold.

1. **DENYLIST precedence (pay wins).** If the element's accessible name matches ANY pay/deny token
   → VETO immediately, regardless of anything else. Deny tokens (multi-locale, data-shipped):
   `abo`, `abonnieren`, `abonnement`, `pur`, `pur-abo`, `subscribe`, `subscription`, `subscribe now`,
   `pay`, `paid`, `kaufen`, `bezahlen`, `zahlungspflichtig`, `werbefrei`, `suscri…`, `suscríbete`,
   `pagar`, `s'abonner`, `abbonati`, `€`, `$`, `£`, `/monat`, `pro monat`, `per month`, `/mois`,
   `al mes`, `/mo`.
2. **Positive accept token required (allowlist).** The accessible name MUST contain a free-accept
   token: `zustimmen`, `einwilligen`, `akzeptieren`, `alle akzeptieren`, `und weiter`,
   `zustimmen und weiter`, `einwilligen und weiter`, `accept`, `accept all`, `accept & continue`,
   `accept and continue`, `continue`, `aceptar`, `aceptar y continuar`, `accepter`, `j'accepte`,
   `accetta`, `accetta e continua`, `同意`. (No accept token → NOOP.)
3. **Settings/manage exclusion.** The name must NOT match a settings token:
   `einstellungen`, `settings`, `manage`, `optionen`, `options`, `preferences`, `einzeln`,
   `purposes`, `customize`, `personalize`, `mehr`, `more options`, `configurar`, `gérer`.
   A "manage consent settings" link is not the primary free CTA.
4. **Primary-CTA & actionability.** The element must be a real, visible, actionable control
   (`button`, `[role=button]`, or `a` styled as a button), not hidden (`display:none`,
   `visibility:hidden`, `hidden`, zero-size, `aria-hidden`), not `disabled`.
5. **Exactly one match.** Collect ALL candidates surviving (1)–(4). If the count is **> 1**
   (two plausible free-accept buttons) → **ambiguity → VETO (NOOP)**. If **0** → NOOP. Only a
   **single** surviving candidate is clicked.

Net rule (inverse of, and stricter than, the reject veto): click **iff** exactly one element has
`(accept-token present) AND (zero deny-tokens) AND (zero settings-tokens) AND (visible/actionable)`.
Ambiguity of any kind resolves to NOOP — leave the wall, never guess.

### Last-resort gating (the accept-click must be the ONLY free path)
Before clicking, scan the SAME wall for any FREE reject / necessary-only control. Reject tokens
(data-shipped): `ablehnen`, `alle ablehnen`, `nur notwendige`, `nur erforderliche`, `essenziell`,
`reject`, `reject all`, `decline`, `necessary only`, `only necessary`, `continue without accepting`,
`weiter ohne`, `rechazar`, `solo necesarias`, `refuser`, `continuer sans accepter`, `rifiuta`.
If ANY candidate matches a reject token → a free reject exists → **accept-click NEVER fires**
(that is the reject engine's job). Accept-click fires ONLY on a confirmed true consent-or-pay hard
wall with **no** free reject/necessary control present. If reject-presence is uncertain, be
conservative → NOOP (do not accept).

Double-gate + never-hide (reused, unchanged from id 1323):
- Reuse `computeAcceptGate(prefs, deps)` verbatim: opens only when
  `cookieConsentMode === "accept-when-necessary"` AND `cookieConsentAcceptConsented === true` AND
  `enabled` AND `onboardingDone` AND not site-exempt. Never fires in `reject-only`/`off`.
- Never hides the wall (no `opacity`/`display:none`/removal). The never-hide scan stays in force.
- Fail-toward-NOOP everywhere: missing prefs, throwing DOM, unrecognized locale, zero/many matches,
  a throwing `.click()` → all NOOP.

---

## PART B — Detecting a consent-or-pay wall

The isolated-world `cookie-noise.js` runs per-frame (`all_frames:true`). Detection runs INSIDE the
SP message iframe, keyed on iframe-local facts (top-frame reasoning kept explicit):

- **It is a subframe**: `window.top !== window.self` (accept-click never acts in the top frame —
  the top-frame reject scripts own that; the wall's buttons live in the child iframe).
- **SP message-iframe URL shape** (from id 1333/1335, the detection gotcha): the frame's own
  `location.href` matches `hasCsp=true` AND `consent/tcfv2` (and/or `message_id=`), served from a
  first-party subdomain (`sp-spiegel-de.spiegel.de`, `consent-cdn.zeit.de`, `consent.faz.net`).
  Do NOT filter on `sp-prod.net`/`sourcepoint.com` — that MISSES the real iframe. Corroborate with
  `host !== topHostRelayed` (top host relayed from the background — see Part C).
- **Modal/blocking + no free reject**: the last-resort gate (Part A) already requires "no free
  reject present." Lean on button/structure discrimination, NOT overlay-CSS heuristics — id 1333
  proved `[class*=consent]`/overflow heuristics FALSE-POSITIVE on residual banners.
- **A single free-accept button present** per Part A.

Detection is independent of the Tier-1 reject brain (`decideAction`): inside the SP iframe there is
no `__tcfapi` global, so `decideAction` returns `"uncertain"`, never `"no-reject-path"`. Tier 2
accept-click is DOM-driven and self-detecting; it does not consume `decision.adapterId`.

---

## PART C — Architecture, placement, data flow

### Decision: one isolated-world implementation, no MAIN world
**Choice:** Put the entire accept-click (detection + discrimination + `element.click()`) in the
isolated-world `content/cookie-noise.js` `@sync:cmp-accept-dispatch` region ONLY.
**Alternatives:** keep the Chrome MAIN-world / Firefox `wrappedJSObject` split the Didomi path used.
**Rationale:** a DOM click needs neither a page global nor the MAIN world; the isolated world has
full DOM access in every frame. This deletes the MAIN-world accept dispatch region, the
`didomiMinimumGateOpen` field on the `muga:cookie-gate` nonce event, and the Chrome/Firefox
dispatch fork for accept — one code path, both browsers.

### Decision: pure discrimination in the accept module, dispatch inlined
**Choice:** New pure functions in `src/lib/cmp-accept-adapters.js` — `classifyConsentButton(name)`,
`findFreeAcceptTarget(candidates)` (returns the single target or a NOOP/ambiguous verdict),
`hasFreeRejectControl(candidates)`, `isPaywallFrame(frameFacts)`. Word lists ship as frozen DATA
arrays (`ACCEPT_TOKENS`, `PAY_DENY_TOKENS`, `SETTINGS_TOKENS`, `REJECT_TOKENS`).
**Alternatives:** inline literals in the content script.
**Rationale:** the reject brain (`cmp-adapters.js`) and the reject content-script regions stay
lexically `/allowall|accept/i`-free (L1). Accept tokens live only in the accept module + the
`@sync:cmp-accept`/`@sync:cmp-accept-dispatch` regions (positional relax already established).
Shipping the lists as data keeps them auditable and keeps source scans clean, per the existing
DENYLIST-as-data pattern. The pure functions are Node-unit-testable; the content-script copy is
hand-mirrored and pinned by `tests/unit/cookie-noise-sync.test.mjs`.

### Decision: top-host exemption resolved in the background (cross-origin dependency)
**Choice:** The accept gate's per-site exemption MUST key on the TOP-frame host, not the iframe
host. Resolve `modeActive` + `isSiteFullyExempt(topHost)` in the background (it knows
`sender.tab.url`) and relay the final accept-gate boolean + top host into the frame with the prefs.
**Alternatives:** read `window.top.location.hostname` in the iframe (THROWS cross-origin);
per-iframe-host exemption (wrong host — would pause the wrong site).
**Rationale:** this is the "per-site exemption fix (top-frame host pause)" parallel work; the
accept-click depends on it. `computeAcceptGate` keeps its `deps.isSiteFullyExempt` shape but the
call site feeds the background-resolved top-host verdict.

### Data flow
```
background (getPrefs, knows sender.tab top URL)
   │  resolves modeActive + isSiteFullyExempt(TOP host) → acceptGateOpen (bool) + topHost
   ▼
cookie-noise.js (isolated world, EVERY frame, all_frames:true)
   │  computeAcceptGate(prefs, {topHost, isSiteFullyExempt-resolved})  ── L2/L3 double-gate
   │  Tier-1 reject dispatch runs FIRST (unchanged); on _acted → return
   ▼  (only if gate open AND not _acted AND window.top !== self)
@sync:cmp-accept-dispatch  (isolated world)
   │  isPaywallFrame(location.href, topHost)                    ── Part B
   │  candidates = queryClickable(document)
   │  if hasFreeRejectControl(candidates) → NOOP                ── last-resort gate
   │  target = findFreeAcceptTarget(candidates)                 ── Part A (exactly-one)
   ▼  if single target → target.click(); _acted = true; stopObserver()
```

### File changes
| File | Action | Description |
|------|--------|-------------|
| `src/lib/cmp-accept-adapters.js` | Modify | RETIRE Didomi JS-API path (`decideMinimumAccept`, `canAttemptDidomiMinimumAccept`, `buildMinimumPayload`, `resolveDidomiMinimumStatus`, `extract*Ids`, `didomiAcceptAdapter`, `ACCEPT_CAPABLE_ADAPTER_IDS`). ADD word-list DATA + `classifyConsentButton`/`findFreeAcceptTarget`/`hasFreeRejectControl`/`isPaywallFrame`. KEEP `computeAcceptGate`. |
| `src/content/cookie-noise.js` | Modify | Replace `@sync:cmp-accept` + `@sync:cmp-accept-dispatch` bodies with the click discrimination + `element.click()`; add subframe + paywall detection; keep isolated-world gate relay. |
| `src/content/cookie-noise-mainworld.js` | Modify | DELETE the `@sync:cmp-accept*` regions and the Didomi accept signals; drop `_didomiMinimumGateOpen` + the `didomiMinimumGateOpen` event field. MAIN world no longer participates in accept. |
| `src/lib/cmp-adapters.js` | Modify | (Optional) revert the `adapterId` threading on `no-reject-path` if now unused, OR leave as-is. Stays lexically accept-free. |
| `src/lib/consent-clauses.js`, `consent-version-manifest.js` | Modify | Rewrite the accept clause to disclose ACCEPT-ALL-on-hard-paywall (not "minimum"); bump/replace version (Part E). |
| `src/options/*`, locales (`en/es/fr/de/it/ja/pt`), onboarding | Modify | Mode-selector + gesture + rewritten disclosure copy. |
| `tests/unit/cmp-accept-adapters.test.mjs`, `cookie-noise-sync.test.mjs` | Modify | Discrimination matrix, DENYLIST/lexical scans, sync-parity, adversarial cases. |
| `tests/e2e/cookie-consent-paywall-accept.spec.mjs` | Create | Synthetic cross-origin-iframe consent-or-pay fixture (Part F). |
| `docs/qa/cookie-consent-release-smoke.md` | Modify | Replace Didomi smoke with the real-EU zeit/spiegel headed accept-click smoke gate. |

---

## PART D — Retiring the dead Didomi Tier-1 accept, cleanly

- DELETE the Didomi JS-API accept surface listed above from BOTH content scripts and the accept
  module. Remove the Didomi accept-only signals (`hasSetCurrentUserStatusFn`,
  `hasGetRequiredPurposeIdsFn`, `hasGetRequiredVendorIdsFn`, `hasGetPurposesFn`, `hasGetVendorsFn`)
  from `collectSignals`/`fxCollectSignals`.
- KEEP intact: `computeAcceptGate` (double-gate), the mode selector, the explicit-consent gesture,
  `cookieConsentMode` + `cookieConsentAcceptConsented` prefs, `clampImportedCookieConsentMode`,
  `exportOnlyBoolean`, and the `modeActive` clamp boundary.
- The Didomi Tier-1 REJECT adapter (`setUserDisagreeToAll`) is UNTOUCHED — only the Didomi ACCEPT
  path dies.
- Update sync/structural tests so the `@sync` region hashes track the new bodies (they will fail
  loudly until updated — intended).

---

## PART E — Consent UX + prefs (meaning CHANGED)

- **Mode selector:** expose `accept-when-necessary` in Settings > Advanced; selecting it opens the
  explicit informed-consent step (does not by itself set the gesture flag).
- **Rewritten disclosure copy (product-owner sign-off required):** the old "MUGA submits the
  minimum, never grants tracking" copy is now FALSE for this mechanism. New copy must say plainly:
  "On sites that block all content behind a cookie wall whose only free choice is *Accept all*
  (a 'consent or pay' wall) and that offer NO free reject option, MUGA will click *Accept all &
  continue* so you can read the page. On these specific walls that DOES grant advertising/tracking
  consent — it is the only free way through. MUGA never clicks Subscribe/Pay, never acts on sites
  that offer a free reject, and never does this unless you turn this mode on and confirm."
  English default, no em-dashes, peninsular `es`, 7 locales + onboarding + options.html.
- **Consent version:** because the meaning changed from "minimum/no-tracking" to
  "accept-all-on-hard-paywall", the staged `1.3` clause must be REPLACED (not reused) — recommend
  advancing `REQUIRED_CONSENT_VERSION` and adding a clause that discloses broad-consent-on-paywall.
  Existing users get a soft re-onboard delta. The per-user gesture stays a second belt.
- **Import safety (unchanged):** `clampImportedCookieConsentMode` collapses `accept-when-necessary`
  → `reject-only`; `cookieConsentAcceptConsented` stays `exportOnlyBoolean`. An imported blob can
  never pre-seed the accept gate.

---

## PART F — Testing strategy

| Layer | What to test | Approach |
|-------|--------------|----------|
| Unit | `classifyConsentButton` over accept/deny/settings/both/multi-locale names | pure matrix; deny-wins precedence, settings exclusion |
| Unit | `findFreeAcceptTarget`: 0 matches→NOOP, 1→target, >1→ambiguous NOOP | pure candidate-list matrix |
| Unit | `hasFreeRejectControl`: reject token present → true (blocks accept) | pure |
| Unit | `computeAcceptGate` with each invariant absent → closed | reuse existing matrix |
| Adversarial | pay button labelled "Accept subscription" → deny wins → VETO; two free-accept buttons → VETO; hidden/`display:none` accept decoy → excluded; "accept cookies settings" link → settings VETO; unknown-locale accept label → NOOP | pure + fixture |
| Structural | `cmp-adapters.js` + reject regions stay `/allowall|accept/i`-free; accept tokens only inside `@sync:cmp-accept*`; sync-parity of hand-copied region | source scan + hash |
| E2E (synthetic) | cross-origin-ish iframe (separate origin/port in harness) with a consent-or-pay wall | Playwright, extension loaded from `src/`, `accept-when-necessary` + gesture |
| E2E — Variant B (hard wall, no free reject) | MUGA clicks ONLY the free-accept button, NEVER the pay button, wall dismisses | assert click target + wall gone |
| E2E — Variant A (free reject present) | MUGA clicks NOTHING (reject engine's job); accept-click vetoed | assert no accept click |
| E2E — mode/gesture gates | `reject-only` mode → never clicks; no gesture → never clicks | assert NOOP |
| Real-site (HARD PRE-ENABLE GATE) | zeit.de / spiegel.de headed, EU egress, MUGA-loaded: free-accept clicked, wall dismissed by SCREENSHOT (not overflow heuristic — id 1333), pay button never clicked | manual/CI EU headed; mode must not ship enabled until this passes |

---

## PART G — Slicing + residual risk

### Recommended first slice (Slice 1 — SP consent-or-pay, DE+EN)
Retire the dead Didomi accept + build the isolated-world SP consent-or-pay accept-click: paywall
frame detection, button discrimination (pure fns + DATA lists, DE+EN tokens only), last-resort
reject-presence gate, `computeAcceptGate` reuse, background top-host exemption relay (depends on the
parallel per-site pause fix), rewritten consent copy + gesture + consent-version bump, full
unit/adversarial/structural/synthetic-e2e suite, and the real-EU headed smoke GATE before enabling
for users. Smallest safe first accept; proven sites (zeit/spiegel are DE).

### Later slices
- Slice 2: widen locale token lists (ES/FR/IT/…) per verified site, each behind a headed smoke.
- Slice 3 (if ever): non-SP consent-or-pay CMPs, same discrimination engine.

### Residual risk (stated honestly)
1. **It grants broad tracking.** When it fires it clicks Accept-all — the opposite of denoise.
   Justified ONLY as the last-resort free path on a true consent-or-pay hard wall, behind opt-in
   mode + explicit gesture, never in default mode, never hiding. Product-owner + disclosure gated.
2. **Mis-click a pay button** = charging/committing the user. Mitigated by deny-precedence,
   exactly-one, settings-exclusion, actionability — but locale coverage is the weak point: an
   unlisted pay-word locale could let a pay button slip the DENYLIST. Mitigation: ship only verified
   locales; DENYLIST includes currency/period symbols as a locale-agnostic backstop.
3. **False consent-or-pay detection** on a normal SP site that DOES have a free reject → we might
   accept when the user could have rejected free. Mitigated by the hard "no free reject present"
   gate; reject-detection reliability is the crux — conservative NOOP on uncertainty.
4. **Live behavior** (does the isolated-world click on the cross-origin iframe button actually
   dismiss the wall in the MUGA extension context) — DOM-click proven in a probe (id 1333), but not
   yet in-extension; the real-EU headed smoke is the gate.

---

## Open decisions for the product owner
1. **Mode meaning change** (accept-when-necessary now grants tracking on hard pay-walls) — approve
   the semantics and the rewritten disclosure copy? Keep the pref key or rename the mode?
2. **Consent version** — replace the staged `1.3` clause with a broad-consent-on-paywall clause and
   advance `REQUIRED_CONSENT_VERSION`? (RECOMMEND yes — the old meaning is gone.)
3. **Locale coverage at launch** — DE+EN only (proven zeit/spiegel) vs DE+EN+ES/FR/IT?
   (RECOMMEND DE+EN first; narrower = safer.)
4. **Ambiguity policy** — VETO on >1 free-accept match (RECOMMEND) vs pick "most primary".
5. **Top-host exemption relay** — background-resolved gate + top host (RECOMMEND) vs per-frame.
6. **Extra modal/blocking precondition** beyond "SP iframe + no free reject + one accept button"?
   (RECOMMEND rely on structure/buttons, NOT overlay-CSS heuristics — id 1333 false-positive.)

## Unverified assumptions (do NOT green-light on docs)
- The free-accept button is reliably discriminable by accessible name across SP deployments (proven
  DE zeit/spiegel; unproven other locales/sites).
- `element.click()` from the isolated world on the cross-origin iframe button dismisses the wall in
  the real extension context (probe-proven via DOM-click; not yet in-extension).
- "No free reject" holds on these walls and reject-detection does not false-negative and cause an
  unwanted accept.
- The SP iframe URL shape (`hasCsp=true`+`consent/tcfv2`) discriminates consent-or-pay walls from
  ordinary SP consent (which HAS a free reject) — the last-resort gate is the real safeguard.

**Ready to build Slice 1 once decisions 1–3 and 5 are confirmed and the synthetic-e2e suite is
green — with the real-EU headed smoke as a hard gate before the mode is enabled for real users.**
