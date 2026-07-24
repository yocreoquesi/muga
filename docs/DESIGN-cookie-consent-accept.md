# Design: Cookie Consent Minimizer — ACCEPT-WHEN-NECESSARY slice (Slice 2)

> DESIGN + per-vendor VERIFICATION only. NO code in this slice.
> Supersedes the Slice 2 section of `sdd/cookie-consent-modes/design` (engram id 1305).
> Implements policy `architecture/cookie-consent-accept-policy` (engram id 1285).
> Corrected framing (2026-07-17): there is **no permanent never-accept guarantee**. Reject-only
> is **mode-scoped**, not absolute. `accept-when-necessary` is an agreed opt-in mode, deferred until
> now only because the accept path was never built. The `/allowall|accept/i` lexical guard on
> `cmp-adapters.js` is a **file-scoped** artifact (accept lives in a separate file), NOT an eternal
> behavioral invariant.

This is the highest-stakes change in the project: the first time MUGA takes a consent-granting action
on the user's behalf. Lead with the SAFETY MODEL (Part B), then vendor reality (Part A).

---

## PART B — SAFETY MODEL (the gate; read first)

Accept is STRUCTURALLY unreachable except when the user has explicitly and specifically asked for it.
Five independent layers, each one sufficient on its own to prevent an unwanted accept:

### L1 — File-scoped lexical purity (unchanged, absolute)
`src/lib/cmp-adapters.js` (the reject brain) and the reject regions of the two content scripts stay
FOREVER free of `/allowall|accept/i`. This is NOT relaxed. ALL accept logic physically lives in a NEW
file `src/lib/cmp-accept-adapters.js` and a NEW `@sync:cmp-accept` content-script region. The reject
brain literally cannot spell an accept action.

Resolves the id 1305 Part-1 contradiction (one row extended `ACTIONS` inside `cmp-adapters.js`, another
kept that file absolute) in favor of the absolute guarantee, per id 1311's recommendation:
`decideAction` stays fully accept-agnostic; `ACTIONS.ACCEPT_MINIMUM` and every mode-name comparison
exist ONLY in `cmp-accept-adapters.js`.

### L2 — Double-gate as a DATA invariant
Accept dispatch is unreachable unless BOTH hold:
- `cookieConsentMode === "accept-when-necessary"`, AND
- `cookieConsentAcceptConsented === true`.

Both prefs already exist (Slice 1). The gate is a pure function `computeAcceptGate(prefs, deps)` in the
accept module, returning `true` only when both are set AND `enabled` AND `onboardingDone` AND the site
is not exempt. Unit-tested with EACH of the two invariants absent → gate closed. The separate boolean
flag (not a 4th enum value) makes guarantee L2 robust against a corrupted/imported mode string.

### L3 — Reject-first ladder (accept only on a true hard wall)
`decideAction` (unchanged reject ladder) runs first in EVERY active mode. Accept is considered ONLY when
`decideAction` returns `reason: "no-reject-path"` (a genuine hard wall for a specific vendor). If reject
succeeds, or the page is `uncertain`, accept never runs. In `reject-only` mode the accept region's entry
guard (`computeAcceptGate`) returns false, so accept is dead-on-arrival regardless.

### L4 — Minimum enforcement + broad-accept DENYLIST
When accept fires it MUST pick the least-permissive control the vendor exposes:
- If a granular necessary-only construction exists (Didomi) → use it, NEVER accept-all.
- Only on a pure accept-all-only wall (no lesser control) does minimum == accept-all, and that is a
  DOCUMENTED last resort behind explicit per-decision safety (deferred past the pilot).

A structural test pins every accept call to its minimum literal and enforces a DENYLIST of broad-accept
methods anywhere in the accept module: `AllowAll`, `acceptAllConsents`, `acceptAllServices`,
`acceptAllAction`, `postAcceptAll`, `submitCustomConsent(true`, `respondAll(true)`,
`__cmp("setConsent", 1`, `performBannerAction("accept_all"`.

### L5 — Fail-toward-NOOP everywhere
Every failure mode resolves to no-accept: missing signal, corrupted pref, thrown page global, unknown
vendor, absent accept fn on a shared-function wall → all return NOOP. There is no code path where an
error or ambiguity produces an accept. Never hides the banner (no `opacity`/`display:none`); a
never-hide scan stays in force.

### Gate wiring reconciliation (open decision — see Part D)
`computeCookieGate` (reject gate, in `cmp-adapters.js`) currently opens only for `"reject-only"`. To let
the reject ladder run first in accept mode too, it must open for any active mode WITHOUT spelling
`"accept-when-necessary"` (L1). Adopt id 1311 recommendation #1: the `@sync:cookie-gate` fenced block
receives a pre-validated boolean `modeActive` (mode clamped to the closed enum in `settings-schema.js`,
which is lexically unrestricted), instead of comparing the mode string inside the fence. Fail-closed on
corruption moves to the clamp boundary. The accept double-gate stays entirely in the accept module.

### Residual risk (stated honestly)
The one irreducible risk is a **live-behavior** risk, not a structural one: that a vendor's minimum-accept
call does not actually dismiss the wall, or grants more than expected, on a real site. This is why NO
accept vendor ships without a live real-Chromium/real-Firefox probe (we have been burned by docs:
CookieYes `accept_necessary` did not exist; Iubenda `storeConsent` did not dismiss). Structural guards
prove "cannot accept when not asked"; the live probe proves "accepts the minimum and works."

---

## PART A — per-vendor minimum-accept VERIFICATION (all 10 adapters)

Key structural axis (from id 1311): does the vendor route reject AND accept through the SAME page global,
or through INDEPENDENTLY-NAMED functions?
- SHARED function → on a hard wall (reject fn absent) the accept fn is EQUALLY absent → accept dispatch
  is **dead code** under the current signal model. Building it fires never.
- INDEPENDENT functions → a hard wall for reject does NOT preclude an accept fn existing → these are the
  ONLY vendors where accept dispatch could ever actually fire.

| # | Vendor | Reject call | Accept path | Shared vs independent | Bucket |
|---|--------|-------------|-------------|-----------------------|--------|
| 1 | OneTrust | `RejectAll()` | `AllowAll()` (broad); `UpdateConsent("Cat","C000n:1")` granular but per-tenant IDs | INDEPENDENT | ACCEPT-ALL-LAST-RESORT-ONLY |
| 2 | Cookiebot | `submitCustomConsent(false,false,false)` | same fn `(…,true)` = accept | SHARED | DEAD-CODE-NO-HARDWALL |
| 3 | Didomi | `setUserDisagreeToAll()` | `setCurrentUserStatus({purposes,vendors})` granular, sync→bool; `getRequiredPurposeIds()` generic getter | INDEPENDENT | **MINIMUM-ACCEPT-AVAILABLE** |
| 4 | CookieYes | `performBannerAction("reject")` | same fn `("accept_all"/"accept_partial")`; `accept_necessary` DOES NOT EXIST | SHARED | DEAD-CODE-NO-HARDWALL |
| 5 | Sourcepoint | `__tcfapi("postRejectAll",2,cb)` | `__tcfapi("postCustomConsent",…)`; empty-array semantics UNDOCUMENTED | SHARED (`__tcfapi`) | DEAD-CODE-NO-HARDWALL |
| 6 | Usercentrics | `UC_UI.denyAllConsents()` | `UC_UI.acceptAllServices`/`updateServices` — legacy `UC_UI` vs new headless SDK CONFUSED in docs | INDEPENDENT (if legacy) | UNVERIFIED-NEEDS-PROBE |
| 7 | Cookie Information | `declineAllCategories()` | `submitConsent(...)` with fixed category names (`cookie_cat_necessary` etc., NOT per-tenant) | INDEPENDENT | UNVERIFIED-NEEDS-PROBE (granular plausible) |
| 8 | CookieScript | `instance.rejectAllAction()` | `instance.acceptAllAction()` (broad); no documented granular one-call | INDEPENDENT | ACCEPT-ALL-LAST-RESORT-ONLY |
| 9 | tarteaucitron | `userInterface.respondAll(false)` | same fn `(true)` = accept-all | SHARED (boolean arg) | DEAD-CODE-NO-HARDWALL |
| 10 | consentmanager | `__cmp("setConsent",0,cb,true)` | same fn `("setConsent",1,…)` = accept-all | SHARED (`__cmp`) | DEAD-CODE-NO-HARDWALL |

### Bucket summary
- **MINIMUM-ACCEPT-AVAILABLE (1):** Didomi. The only verified vendor with BOTH a real hard-wall scenario
  AND a generalizable granular necessary-only construction. Recommended pilot.
- **ACCEPT-ALL-LAST-RESORT-ONLY (2):** OneTrust (`AllowAll`), CookieScript (`acceptAllAction`).
  Independent accept fns, so accept COULD fire on a wall, but only broad accept-all is exposed — permitted
  only where NO lesser control exists, behind explicit per-decision safety. Defer past pilot.
- **DEAD-CODE-NO-HARDWALL (5):** Cookiebot, CookieYes, Sourcepoint, tarteaucitron, consentmanager. Reject
  and accept share one function, so accept dispatch can never fire on a hard wall. Do NOT build.
- **UNVERIFIED-NEEDS-PROBE (2):** Usercentrics (legacy `UC_UI` vs headless SDK product-confusion trap —
  disambiguate which product the site runs before building), Cookie Information (fixed-category granular
  minimum is plausible from docs but `submitConsent` signature + does-it-dismiss unverified).

### Flags for the product owner (do NOT green-light on docs)
- Didomi: pin the exact vendors-enumeration getter name (parallel to `getRequiredPurposeIds()`); live-probe
  that `setCurrentUserStatus` with all-non-essential-disabled actually dismisses a real hard-wall.
- Every non-Didomi vendor requires a live probe before it ships; two (Usercentrics, Cookie Information)
  need a probe even to be bucketed confidently.

---

## PART C — consent UX + prefs

- **Mode selector:** Slice 1 hid the 3rd option. Add `accept-when-necessary` to the Settings > Advanced
  radio/select (`COOKIE_CONSENT_MODE_OPTIONS` already contains it). Selecting it opens an explicit
  informed-consent step; it does NOT set `cookieConsentAcceptConsented` by itself.
- **Explicit consent gesture:** a dedicated in-UI confirmation (checkbox + explanatory copy) that, only on
  a real click, sets `cookieConsentAcceptConsented = true`. Copy states plainly: "On sites that block
  content until you answer a cookie banner and offer no reject option, MUGA will submit the MINIMUM choice
  — granting only strictly necessary cookies — so you can proceed. MUGA never grants tracking cookies."
  English default, no em-dashes, peninsular Spanish for `es`, 7 locales (en/es/fr/de/it/ja/pt) + onboarding
  + options.html.
- **Consent version:** bump `REQUIRED_CONSENT_VERSION` → `"1.3"` (currently staged/inactive) and add a
  `CONSENT_CLAUSES_BY_VERSION["1.3"]` clause disclosing the minimum-accept capability. This is a genuinely
  new capability class, so existing users get a SOFT re-onboard (delta review). The per-user gesture is a
  second, belt-and-suspenders gate on top of the version bump.
- **Import safety (unchanged):** `clampImportedCookieConsentMode` still collapses `accept-when-necessary`
  to `reject-only` and `cookieConsentAcceptConsented` stays `exportOnlyBoolean` — an imported blob can
  NEVER pre-seed the accept gate without a real in-app gesture. Keep this.

---

## PART D — decideAction, dispatch, slicing

### decideAction (pure, stays accept-agnostic)
One small accept-FREE enhancement: thread the real `adapterId` through the `no-reject-path` branches
(today they return `adapterId: null`) so the accept layer knows WHICH vendor hit the wall. No accept text
enters `cmp-adapters.js`.

### Accept decision + dispatch (new, accept module only)
`cmp-accept-adapters.js`:
- `ACTIONS_ACCEPT = Object.freeze({ ACCEPT_MINIMUM: "accept-minimum" })`
- `decideMinimumAccept(decision, mode, consented)` — pure. Returns `ACCEPT_MINIMUM` only when
  `mode === "accept-when-necessary"` AND `consented === true` AND `decision.reason === "no-reject-path"`
  AND `decision.adapterId` is in the accept-capable set; else NOOP.
- `computeAcceptGate(prefs, deps)` — the double-gate + enabled/onboarded/exemption.
- `didomiAcceptAdapter` — builds the minimum payload from `getRequiredPurposeIds()` (no hardcoded IDs, no
  accept-all).

New signals collected in both content scripts (accept-related, so their DISPATCH lives in the
`@sync:cmp-accept` region): `hasSetCurrentUserStatusFn`, `hasGetRequiredPurposeIdsFn` (+ vendors getter).

### Dispatch threading (@sync)
- Chrome: after the isolated-world reject flow yields `no-reject-path`, the `@sync:cmp-accept` region runs
  the accept dispatcher in the MAIN world (via the existing nonce-gated event), gated by `computeAcceptGate`.
- Firefox: the isolated-world `fxRunDispatcher` gets a mirror `@sync:cmp-accept` tail that, after the reject
  ladder returns `no-reject-path`, runs the accept call via `wrappedJSObject`, gated by `computeAcceptGate`.
- The content-script whole-file `/allowall|accept/i` scan RELAXES to POSITIONAL: accept tokens allowed ONLY
  inside `@sync:cmp-accept`; reject regions stay absolutely accept-free. `cmp-adapters.js` stays absolute.

### Testing strategy
| Layer | What | How |
|-------|------|-----|
| Unit | double-gate with each invariant absent → NOOP | pure `computeAcceptGate` matrix |
| Unit | reject-only mode + hard wall → NOOP (accept impossible) | `decideMinimumAccept` matrix |
| Unit | minimum enforcement: never accept-all when lesser exists | Didomi payload builder + DENYLIST scan |
| Adversarial | "make it accept in reject-only mode" / "accept more than minimum" must be impossible | structural + pure |
| Structural | `cmp-adapters.js` stays `/allowall|accept/i`-free; positional relax on content scripts | source scan |
| E2E / probe | Didomi minimum-accept dismisses a real hard-wall, grants zero non-essential | real-Chromium + real-Firefox |

### Slicing (recommended)
- **Slice 2a (RECOMMENDED FIRST — Didomi-only pilot):** gate refactor (`modeActive` boolean),
  `decideAction` adapterId threading, `cmp-accept-adapters.js` (ACTIONS_ACCEPT + `decideMinimumAccept` +
  `computeAcceptGate` + `didomiAcceptAdapter`), new signals, `@sync:cmp-accept` region in both content
  scripts (Didomi only), positional lexical relax, consent UX + gesture + `REQUIRED_CONSENT_VERSION` 1.3,
  full adversarial/structural test suite, Didomi live probe. Smallest safe first accept.
- **Slice 2b (later):** all-or-nothing last-resort vendors (OneTrust `AllowAll`, CookieScript
  `acceptAllAction`) behind explicit per-decision confirmation, each after a live probe.
- **Defer indefinitely:** the 5 dead-code vendors (never build accept dispatch); the 2 unverified vendors
  until a probe reclassifies them.

---

## Open decisions for the product owner
1. Consent disclosure: global soft re-onboard via 1.3 bump + per-user gesture (RECOMMENDED) vs gesture-only.
2. Gate wiring: `modeActive` boolean into the fenced block (RECOMMENDED, per id 1311) vs a second dedicated
   accept-only gate that also runs reject first.
3. First slice: Didomi-only pilot (RECOMMENDED) vs Didomi + last-resort vendors together.
4. Last-resort accept-all (OneTrust/CookieScript): ship in 2b behind per-decision confirmation vs never.
5. Didomi minimum semantics: confirm "all non-essential disabled" is the right minimum vs a narrower
   required-only payload — resolve at the live probe.

**Ready to build Slice 2a once decisions 1–3 and 5 are confirmed and the Didomi live probe passes.**
