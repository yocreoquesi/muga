# Design: Cookie Consent Minimizer — 3-State Consent Modes

**Status**: DESIGN + AUDIT only (no implementation). Supersedes the strict
never-accept Tier 2 design (`docs/DESIGN-cookie-consent-tier2.md`, engram
`sdd/cookie-consent-tier2/design` id 1302 — marked superseded).
**Authoritative policy**: engram `architecture/cookie-consent-accept-policy` (id 1285).

**The change in one line**: the module's absolute "never accept" invariant
becomes **mode-aware**. Reject-only mode keeps the absolute structural
never-accept guarantee; a new opt-in accept-when-necessary mode may perform a
**gated minimum-accept of last resort** — never a broad accept when a lesser
control exists, and only because the user explicitly consented.

---

## PART 1 — AUDIT: current never-accept enforcement (inventory → what each becomes)

The current guarantee is **absolute and source-lexical**: the strings
`allowall|accept` (case-insensitive) must not appear ANYWHERE in the three
feature source files, and every reject call is pinned to a literal argument.
That is what must evolve, because Slice 2's accept-minimum calls
(`performBannerAction("accept_necessary")`, TCF `postCustomConsent`, etc.)
contain the forbidden token by construction.

The evolution is **partition, not deletion**: split the code into a reject
core that keeps the absolute guarantee forever, and a *separately-marked,
mode-gated* accept region with its own inverted guards.

| Enforcement point (today) | What it is | Under 3-state model |
|---|---|---|
| `cmp-adapters.js` — `ACTIONS` closed enum, 1 member `REJECT_ALL` | Closed action vocabulary | **Extend** to `{REJECT_ALL, ACCEPT_MINIMUM}`. Structural test changes from "exactly 1 member" to "REJECT_ALL always present; ACCEPT_MINIMUM only emitted when `mode==='accept-when-necessary'`". |
| `cmp-adapters.js` — `decideAction(signals)` hard-wall branches returning `{action:null, reason:'no-reject-path'}` (NOOP) | Pure decision fn | **Add `mode` param** → `decideAction(signals, mode)`. In `reject-only`, hard walls stay NOOP (byte-equivalent behavior). In `accept-when-necessary`, a hard wall maps to `{action:ACCEPT_MINIMUM, reason:'accept-minimum', adapterId}`. Accept branches are **structurally unreachable** unless `mode` says so. |
| `cmp-adapters.js` — `@sync:cmp-adapters` block (detect/canReject) | Vendor detection | **Unchanged.** Detection is mode-independent and accept-free. Stays absolute-accept-free. |
| `cmp-adapters.js` — whole-file `/allowall|accept/i` source scan | Absolute lexical guard | **Stays absolute on this file.** The reject brain never names accept. All accept logic goes in a NEW file `cmp-accept-adapters.js` (see Part 2). Strongest possible guarantee: the reject decision core structurally cannot even spell accept. |
| `cmp-adapters.test.mjs` — STRUCTURAL guard (source scan, `ACTIONS` size, adapter method-name scan) | Reject-only structural spine | **Split into two guards.** (a) *Reject-core guard*: keeps absolute accept-free scan on `cmp-adapters.js` + reject regions. (b) NEW *mode guard*: `decideAction(everySignalSet, 'reject-only')` → action ∈ {`reject-all`, `null`}, never accept — adversarial, exhaustive. |
| `cookie-noise-sync.test.mjs` — whole-file `/allowall|accept/i` scan on both content scripts | Absolute lexical guard | **Relax to POSITIONAL guard.** Accept tokens allowed ONLY inside a new `@sync:cmp-accept` region; the reject regions + everything else stay absolute-accept-free. |
| `cookie-noise-sync.test.mjs` — per-adapter literal-arg guards (`submitCustomConsent(false,false,false)`, `performBannerAction("reject")`, `__tcfapi("postRejectAll")`, `setUserDisagreeToAll()`, `denyAllConsents()`, OneTrust-only-`RejectAll`) | Pin each reject call to its safe literal | **Unchanged for reject.** ADD a mirror-image set of **inverted accept guards** for the accept region: each accept call pinned to its *minimum* literal, and an explicit denylist of the broad-accept methods/args (`AllowAll`, `acceptAllConsents`, `submitCustomConsent(true,…)`, `postAcceptAll`, `performBannerAction("accept")`). |
| `cookie-noise.js` / `cookie-noise-mainworld.js` — `fxRunDispatcher`/main dispatch (inlined `canRejectX` + literal vendor reject call) | Runtime reject dispatch | **Gate on mode.** Reject dispatch runs in both active modes. A NEW accept dispatch region runs ONLY when `mode==='accept-when-necessary'` AND the consent flag is set AND the reject ladder yielded nothing (hard wall). Top-frame-only + give-up constraints unchanged. |

**Critical-question answer** — how to keep a structural guarantee that
reject-only CANNOT accept while allowing gated minimum-accept in consented
mode: **three independent, layered guarantees** (detailed in Part 3):
1. *Lexical partition* — the reject brain (`cmp-adapters.js`) and all reject
   regions stay absolutely accept-free (source scan). Accept lives in a
   separate file + a single positionally-fenced content-script region.
2. *Decision-function proof* — `decideAction(_, 'reject-only')` can only emit
   `reject-all`/`null`; proven exhaustively by an adversarial test that feeds
   every CMP's every signal permutation in reject-only mode.
3. *Runtime double-gate* — the accept dispatch is unreachable unless
   `mode==='accept-when-necessary'` **and** the explicit consent flag is true;
   both are required args, tested with each absent.

---

## PART 3 — SAFETY MODEL (the gate — read before building)

The NEW safety model replaces "one absolute lexical scan" with a **partitioned,
three-layer, mode-aware** model. Reject-only's guarantee is *stronger than
before* (the reject brain can no longer even name accept, and a positive
decision-function proof is added on top of the lexical scan).

**Guarantee (a) — reject-only can never accept.**
- L1 lexical: `cmp-adapters.js` + reject regions pass absolute `/allowall|accept/i` scan.
- L2 decision: `decideAction(signals, 'reject-only')` → `action ∈ {reject-all, null}` for EVERY signal permutation of EVERY adapter (exhaustive adversarial matrix).
- L3 runtime: the content-script accept region is guarded by `if (mode !== ACCEPT_WHEN_NECESSARY) return;` as its first statement; a structural test asserts that guard is the region's entry.

**Guarantee (b) — consented mode only ever minimum-accepts, never hides.**
- Each accept call is pinned to its vendor *minimum-accept literal* (inverted literal-arg guard); a denylist test fails on any broad-accept method/arg.
- "Minimum" precedence is enforced in `decideAction`: ACCEPT_MINIMUM is emitted ONLY when the reject ladder AND the necessary-only ladder both yielded nothing — i.e. only on a true hard wall. On a pure Accept-all-only wall, minimum==accept-all is the *documented last resort* and is tested to fire ONLY when no lesser control exists.
- never-hide: no CSS/opacity/`display:none` on the banner anywhere; a structural test scans the accept + reject regions for banner-hiding patterns and fails on any. A decision is always taken before the banner leaves.

**Guarantee (c) — accept can't fire without the consent flag.**
- The accept dispatch requires BOTH `mode==='accept-when-necessary'` AND `cookieConsentAcceptConsented===true` (a distinct pref, Part 2). Unit tests: with either absent, accept is never invoked even when signals + hard wall are present.

**Adversarial test cases (required):**
1. reject-only mode + every "hard wall" signal set → NOOP, never accept (per adapter).
2. accept-when-necessary mode + consent flag FALSE + hard wall → NOOP (double-gate).
3. accept-when-necessary + consent flag TRUE + wall that exposes necessary-only → picks necessary-only, NOT accept-all.
4. accept-when-necessary + consent flag TRUE + pure accept-all-only wall → accept-all fires (last resort), and a test proves it does NOT fire when any lesser control was detectable.
5. Source-lexical: reject brain + reject regions accept-free; accept tokens confined to the `@sync:cmp-accept` region.
6. Method/arg denylist: `AllowAll`/`acceptAllConsents`/`postAcceptAll`/`submitCustomConsent(true,…)`/`performBannerAction("accept")` never appear in dispatch code.
7. Migration: legacy `cookieConsentMinimizerEnabled` bool → correct 3-state value (Part 2), never lands in accept-when-necessary.

**Testing strategy — mode matrix**: `{off, reject-only, accept-when-necessary} × {6 CMPs} × {reject-available, necessary-only-available, hard-wall}` in pure unit tests against `decideAction`, plus the structural guards above, plus per-vendor real-browser smoke before any accept path ships.

---

## PART 2 — the 3-state design

### Mode representation (pref shape + migration)

**Recommendation**: replace the single `cookieConsentMinimizerEnabled: false`
bool with a **string enum + a separate accept-consent flag**:

```
cookieConsentMode: "off" | "reject-only" | "accept-when-necessary"   // default "reject-only" for NEW installs only (option B', user-confirmed); existing users are NOT forced (see below)
cookieConsentAcceptConsented: false                                   // hard gate for mode 3; set true only via explicit UI consent
```

Rationale: a single enum cleanly represents the 3 states and round-trips
through settings export/import (extend `settings-schema.js` with an
`enum`/clamp kind, mirroring the `toastDuration` clamp precedent). The SEPARATE
`cookieConsentAcceptConsented` flag makes Guarantee (c) a data invariant, not a
UI convention — accept cannot fire on a stored-mode value alone; the explicit
consent must also be present. This defends against a corrupted/imported
`cookieConsentMode` string.

**Migration** (new `migrateCookieConsentMode()` in `storage-migrations.js`,
mirroring `migrateLegacyProxyPref`, idempotent, safe every startup). Keys off the
EXISTING onboarding-completed state to distinguish existing users from fresh
installs:
- old `cookieConsentMinimizerEnabled === true` → `cookieConsentMode: "reject-only"`, `cookieConsentAcceptConsented: false` (preserve the user's opt-in as the safe mode; NEVER auto-upgrade to accept).
- old `=== false` or absent AND onboarding ALREADY completed (existing user) → `cookieConsentMode: "off"` — existing users are NOT forced on; no re-consent, no capability granted silently. They can enable it from settings.
- fresh install (onboarding not yet completed) → the pref default `"reject-only"` applies, disclosed by onboarding itself.
- delete the legacy key after migrating.

**Default reconciliation — RESOLVED (user-confirmed: option B′, default-on for NEW installs only).**
Today the feature is default-OFF and gated by consent 1.2 (the "MUGA may call a
page global" disclosure). The user chose to make the feature **default-ON in
`reject-only` for new installs only — existing users are NOT forced**. This is the
cleanest consent story: no existing user is granted a new capability without an
action of their own.
- **New users**: reject-only is the disclosed default within onboarding → fresh consent, no forced flip on anyone.
- **Existing users (feature OFF)**: stay OFF; migration pins them to `off`. No re-consent event, no forced upgrade. They opt in via settings whenever they want (optional: a non-intrusive, dismissible settings nudge — NOT a forced modal).
- **Existing users (had opted in)**: preserved as `reject-only`.
Because no existing user's capability changes, **no forced re-consent / soft
re-onboard is required**. Onboarding copy for new users must disclose the
cookie-minimizer (reject-only default). accept-when-necessary remains a genuinely
NEW, HIGHER capability for everyone → it stays opt-in, requiring its OWN explicit
in-UI consent (the `cookieConsentAcceptConsented` gesture).
*Consent-version note*: a consent-version entry **1.3** still marks "onboarding
now includes the cookie-minimizer disclosure + accept opt-in exists," but it is
shown through the normal new-user onboarding flow, NOT pushed to existing users.

### Mode-aware never-accept (`ACTIONS` + guards)
Extend `ACTIONS = {REJECT_ALL, ACCEPT_MINIMUM}`. Do NOT add per-vendor accept
members. The unreachability of `ACCEPT_MINIMUM` in reject-only mode is proven by
Guarantee (a) L2, not by omission.

### `decideAction` changes
`decideAction(signals, mode)`, still pure. Reject ladder first (unchanged, both
active modes). Then necessary-only ladder. Then, ONLY if `mode ===
'accept-when-necessary'`, the hard-wall branch returns `ACCEPT_MINIMUM`;
otherwise it stays NOOP (`no-reject-path`). Mode is a required input — the
content dispatch threads the pref through.

### Tier 1 per-adapter accept-minimum audit (what "minimum" is, per vendor)

| Adapter | Reject call (today) | Minimum-accept path (consented mode) | Availability |
|---|---|---|---|
| **Cookiebot** | `submitCustomConsent(false,false,false)` | necessary is implicit/always-on → reject **already IS** necessary-only. No new call. | ✅ Trivial — no hard wall in practice. |
| **OneTrust** | `RejectAll()` | No clean single "necessary-only" call; `AllowAll()` is broad (forbidden as minimum unless it's the only control). Necessary-only requires group-level `UpdateConsent`/`OnConsentChanged` — complex, per-tenant. | ⚠️ HARD. Minimum likely = accept-all-only-as-last-resort, or defer. VERIFY. |
| **Didomi** | `setUserDisagreeToAll()` | `setUserStatus(...)` granular necessary-only, or TCF `postCustomConsent`. `setUserAgreeToAll()` is broad. | ⚠️ Available via granular API; VERIFY minimum shape. |
| **CookieYes** | `performBannerAction("reject")` | `performBannerAction("accept_necessary")` if present, else `"accept"` (broad, last resort). | ⚠️ VERIFY `"accept_necessary"` exists. |
| **Sourcepoint** | `__tcfapi("postRejectAll",2,cb)` | TCF `postCustomConsent` (necessary-only), or `postAcceptAll` (broad, last resort). | ✅ TCF spec path exists; VERIFY. |
| **Usercentrics** | `denyAllConsents()` | `updateServicesConsents([])` / `saveConsents(...)` necessary-only; `acceptAllConsents()` is broad. | ⚠️ Available; VERIFY minimum shape. |

**Finding**: "minimum-accept" is NOT uniformly available or clean. Slice 2
should ship accept-minimum ONLY for adapters with a *verified* necessary-only
call (Cookiebot trivially; likely Sourcepoint/CookieYes/Didomi via granular/TCF)
and DEFER OneTrust until a safe necessary-only path is confirmed. Each vendor's
minimum path is an explicit pre-ship verification item.

### Tier 2 engine on the 3-state basis
The old Tier 2 design (deny-only click-rules, id 1302) becomes **Slice 3,
rebased**: its runtime veto evolves from "never click accept" to
"never hide + reject-only: never click accept + accept-when-necessary: click
ONLY the minimum-accept control, never a broad accept-all if a lesser control
exists". Keep top-frame-only + isolated-world-only. The `computeClickVeto`
model gains a `mode` param and a "minimum-accept positive-word gate" mirroring
its reject positive-word gate; accept-word denylist still ships as DATA.

**Rules-corpus reuse (primary vs frozen seed):**
- **Primary — Consent-O-Matic** (github.com/cavi-au/Consent-O-Matic, MIT, still
  maintained). Its mechanism is **decision-taking** (click the reject / API),
  which matches our hard rule #1. This is our ongoing ruleset model. Attribution:
  retain the MIT notice (Janus Bager Kristensen & Rolf Bagge, CAVI).
- **Frozen seed only — Cookie Dialog Monster** (github.com/wanhose/cookie-dialog-monster,
  MIT). **ARCHIVED 2025-06-09, read-only, support ended 2025-05-31** → its
  `database.json` is a FROZEN snapshot that will decay; NOT a maintained source.
  **Do NOT adopt CDM's core mechanism**: it HIDES/removes the dialog DOM node
  *without taking a decision* — the exact anti-pattern our hard rule #1 forbids.
  Two things ARE worth mining from CDM strictly **as DATA, one-time, with MIT
  attribution**: (1) its curated list of "sites that require acceptance to
  function" → a useful *seed* for accept-when-necessary mode's site targeting;
  (2) its `database.json` selectors → candidate **detection / click-target**
  selectors ONLY, **never as hide-selectors**. Any CDM-derived selector enters
  our pipeline as a detect/click target and is subject to the same Layer-3
  click-time veto as every other rule. Attribution: retain the MIT notice
  (wanhose / Cookie Dialog Monster) alongside the C-o-M notice.
- **Rule of thumb**: prefer Consent-O-Matic for the maintained corpus; treat CDM
  as a one-time frozen seed for site-targeting + detection selectors, never for
  its hide mechanism.

### Onboarding + settings UI
- 3-option control (radio/segmented): **Reject only (recommended)** / **Reject, and accept the minimum when there's no reject option** / **Off**.
- Selecting option 3 triggers an explicit consent step (checkbox + plain copy explaining MUGA will grant the minimum tracking on your behalf on hard walls) → sets `cookieConsentAcceptConsented`.
- Consent-version bump **1.3** (additive) for the accept capability; soft re-onboard.
- Copy: English default, no em-dashes, URL-cleaner DNA. i18n footprint = **7 locales** (`src/lib/locales/{en,es,fr,de,it,ja,pt}.mjs`, es = peninsular) + `options.html`; new keys for 3 mode labels, hints, and accept-consent copy. Onboarding currently has no cookie step — adding the mode choice there is optional (recommend settings-first; onboarding mention only via the 1.3 delta review).

---

## PART 4 — Slicing (safe-by-construction, independently shippable)

| Slice | Scope | Accept capability | Effort |
|---|---|---|---|
| **Slice 1** | 3-state pref + `cookieConsentAcceptConsented` + migration (bool→enum; default-on reject-only for NEW installs, existing users pinned OFF via onboarding-completed check) + onboarding cookie-minimizer disclosure for new users (consent-version 1.3, new-user flow only — NOT pushed to existing users) + `computeCookieGate` reads new pref (off → closed; reject-only/accept-when-necessary → open) + settings UI (reject-only/off; accept option hidden) + i18n (7 locales) + updated migration/gate/sync tests. **The never-accept spine (`ACTIONS = {REJECT_ALL}`, `decideAction`, the `/allowall|accept/i` scan, the exactly-1-member assertion) is left BYTE-UNCHANGED** — not extended, not relaxed. | **NONE — nothing can accept; the never-accept guard is untouched, not weakened.** Default-on reject-only for new installs; existing users untouched (no forced re-consent). Fully shippable & safe. | M |
| **Slice 2** | **All never-accept spine rework happens HERE, alongside the actual accept code**: extend `ACTIONS` → `{REJECT_ALL, ACCEPT_MINIMUM}`, thread `mode` into `decideAction`, split guards (reject-core stays absolute + NEW mode/positional/inverted-literal accept guards) + NEW `cmp-accept-adapters.js` + `@sync:cmp-accept` content regions + per-adapter minimum-accept (ONLY verified vendors) + double-gate runtime + enable accept option in UI + in-UI explicit-consent step sets `cookieConsentAcceptConsented` (consent-version 1.3 already shipped in Slice 1) | Gated minimum-accept, consented vendors only | L |
| **Slice 3** | Tier 2 deny-only click-rule engine (rebased id 1302) + mode-aware `computeClickVeto` + pilot CMP | reject-only click-deny; consented minimum-accept click step (deferred within slice if risky) | XL |
| **Slice 4** (optional) | Extend accept-minimum coverage to remaining Tier 1 vendors (OneTrust) + Tier 2 accept-minimum step, as each vendor path is verified | Broader consented coverage | M–L per vendor |

Order rationale: Slice 1 lands the entire mode skeleton with **zero accept
surface** — safe by construction and shippable on its own. Slice 2 introduces
accept behind the full three-layer safety model. Slice 3 is the long-tail
engine, independent of Slice 2. Each slice is a chained PR (all exceed trivial;
**400-line budget risk: High** for Slices 2 and 3 → chained/stacked PRs).

---

## Open decisions requiring the user
1. **Default reconciliation** — RESOLVED: user chose option (B′) feature-default-on reject-only for NEW installs only; existing users are NOT forced (migration pins them OFF via the onboarding-completed check). No forced re-consent. accept-when-necessary stays opt-in on top. (Open sub-detail, non-blocking: whether to show existing OFF users a dismissible settings nudge — recommend yes, non-intrusive.)
2. **Pref shape** — enum + separate consent flag (recommended) vs single 4-value enum folding consent into the mode.
3. **OneTrust minimum-accept** — defer (recommended) until a safe necessary-only path is verified, or ship accept-all-as-last-resort in Slice 2.
4. **Onboarding placement** — settings-first + 1.3 delta review (recommended) vs a dedicated onboarding mode step.
5. **Consent model for mode 3** — new consent-version 1.3 + in-UI checkbox (recommended) vs in-UI checkbox only.
6. Carried from id 1302: veto-word maintenance, rule-set sourcing, pilot CMP, save/multi-step scope (all defer to Slice 3).

## Unverified assumptions (flagged)
- Per-vendor minimum-accept API names/shapes in Part 1 table (OneTrust group API, CookieYes `"accept_necessary"`, Usercentrics `updateServicesConsents`/`saveConsents`, Sourcepoint/Didomi TCF `postCustomConsent`) are from prior knowledge, **not verified against live SDKs** — each is a Slice 2 pre-ship verification item.
- `decideAction` is the pure spec but the content scripts inline their own dispatch (`fxRunDispatcher` + main-world twin); the accept path must be added to BOTH inlined dispatchers + synced, same as the reject path today.

---

## Recommendation
**Slice 1 is ready to build** — it is safe by construction (no accept surface),
independently shippable, and lands the migration + mode skeleton + the stronger
reject-only structural guarantee. Slices 2–3 are gated on the Part 3 safety
model and the per-vendor verification items.

**Ready to build Slice 1?**
