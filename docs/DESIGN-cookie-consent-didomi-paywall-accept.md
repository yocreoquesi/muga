# Design: Didomi consent-or-pay ACCEPT-CLICK (cookie-consent-didomi-paywall-accept)

> DESIGN only. NO code in this artifact. Extends the shipped Sourcepoint
> consent-or-pay accept-click (docs/DESIGN-cookie-consent-paywall-accept.md,
> src/lib/cmp-accept-adapters.js) to Didomi walls, which dominate the ES/FR/IT
> publisher market (Sourcepoint dominates DE/UK/US). Same policy: opt-in
> `accept-when-necessary` mode + explicit gesture, minimum/last-resort, never
> hide, never in default reject-only mode, NEVER click pay/subscribe.

## Why Didomi

A 2026-07 live headed probe of Spanish newspapers found 9/10 on Didomi, 0 on
Sourcepoint (elmundo/abc/lavanguardia/larazon/elconfidencial/20minutos/expansion/
marca = Didomi). The SP accept-click therefore covers ES/FR/IT publishers ~0.
The reject engine (Didomi adapter #1119) already handles the DEFAULT
reject/necessary-only on these sites; this design adds only the opt-in
consent-or-pay ACCEPT-click for them.

Reused verbatim (no change): the whole PART A token machinery
(classifyConsentButton, ACCEPT/PAY_DENY/CURRENCY/PERIOD/SETTINGS/REJECT tokens,
deny-precedence, word-boundary matching), computeAcceptGate (the double-gate),
the 5 safety layers, and isAcceptTargetVisible (the visibility guard). The ES/
FR/IT tokens already ship. Net-new = Didomi-specific DETECTION + decision-button
SCOPING (the analog of Sourcepoint's sp_choice_type_* scoping).

## Real captured structure (2026-07, headed EU probe — NO click)

Standard Didomi decision buttons carry stable ids (confirmed across publishers):
| id | role | example label |
|----|------|---------------|
| `didomi-notice-agree-button` | accept-all (the FREE-accept, the ONLY click target) | "Aceptar y continuar" / "Aceptar" |
| `didomi-notice-disagree-button` | on a consent-or-pay wall = "reject and pay" (NOT a free reject); on a normal banner = a free reject | "Rechazar y suscribirse" / "Rechazar y pagar" / "Rechazar" |
| `didomi-notice-learn-more-button` | open settings / manage (a reachable free reject sits behind it) | "Configurar" / "Más información" |

Per-publisher variance:
- **lavanguardia (Godó), abc (Vocento):** pure standard `didomi-notice-*` ids.
- **elmundo (Unidad Editorial):** ADDS custom `ue-accept-notice-button` /
  `ue-disagree-notice-button` on top of the standard `didomi-notice-*` (so its
  accept appears twice: the ue one + the didomi one).
- **lavanguardia / elmundo:** expose a learn-more (settings) -> a reachable free
  reject -> MUST abstain (like SP zeit/spiegel).
- **abc:** captured with NO learn-more (only accept + "Rechazar y pagar") -> a
  candidate TRUE HARD wall where the accept-click would fire. NEEDS
  verification (below).

## Detection (net-new vs SP)

Didomi renders in the TOP frame under `#didomi-host` (NOT a cross-origin child
iframe like Sourcepoint), so `isPaywallFrame` (subframe + SP URL shape) does NOT
apply. A new `isDidomiPaywallContext(env)` predicate:
- `#didomi-host` present in the document (the Didomi SDK mount) AND
- at least one scoped decision button classifies `pay` (the positive
  consent-or-pay signal — a plain Didomi banner with only accept/reject and no
  pay path is NOT a consent-or-pay wall; the reject engine owns it).
- Runs in the TOP frame (Didomi's banner is top-frame), unlike SP which is
  subframe-only. Fail-closed on an undeterminable context.

## Decision-button scoping (net-new vs SP)

Analog of `findSpFreeAcceptTarget`, keyed on Didomi structure instead of
`sp_choice_type_*`. A new `findDidomiFreeAcceptTarget(candidates)`:

Scope = elements whose id starts with `didomi-notice-` (the stable decision-
button prefix). Incidental links ("Iniciar sesión", "Ver nuestros N socios",
"Política de cookies") carry no such id -> ignored, so they never false-veto
(the exact incidental-link problem SP hit).

Structural roles (fail-closed, each alone VETOES -> ambiguous/noop):
1. `didomi-notice-learn-more-button` present + actionable -> SETTINGS -> a free
   reject is reachable -> ABSTAIN. **By ID, not by token** — the label
   ("Más información") does NOT match SETTINGS_TOKENS, so token classification
   alone would fail-open here (the key finding). This mirrors SP treating
   choice-type 12 as settings structurally.
2. `didomi-notice-disagree-button` -> classify BY TOKEN: "Rechazar y
   suscribirse/pagar" -> pay (deny-precedence) = the pay alternative, NOT a free
   reject; a bare "Rechazar"/"No acepto" -> reject = a FREE reject -> ABSTAIN.
   (Token, not ID, because the disagree button's meaning flips between
   consent-or-pay and a normal banner.)
3. `didomi-notice-agree-button` -> the accept candidate; if it classifies `pay`
   (deny-precedence) -> ABSTAIN; else if `accept` + actionable -> collect.
4. EXACTLY ONE actionable accept candidate; zero or >1 -> noop/ambiguous.
5. At least one non-accept decision alternative present (the pay path) -> else
   not a consent-or-pay wall -> noop.

The resolved target then passes the shared `isAcceptTargetVisible` guard before
the click (never click an invisible accept), same as SP.

Duplicate-accept handling (elmundo's ue-* + didomi-*): scope to
`didomi-notice-agree-button` (a stable single id) as THE accept target, so a
publisher's extra `ue-accept-notice-button` does not create a second accept in
scope. If a publisher ships TWO didomi-notice-agree buttons (responsive
breakpoints), the exactly-one rule + the visibility guard resolve it (one is
typically hidden); genuinely two visible -> ambiguous -> abstain (safe).

## Dispatcher wiring

A new isolated-world dispatcher branch (or a generalized one) mirroring
`runAcceptClickDispatcher`, but: TOP-frame (not subframe), `isDidomiPaywallContext`
instead of `isPaywallFrame`, `findDidomiFreeAcceptTarget` instead of the SP one.
Same order: gate open -> context match -> collect candidates ->
`hasFreeRejectControl` over ALL (incl. anchors) -> single accept -> visibility
guard -> click -> mark acted. Same `@sync` mirroring into cookie-noise.js.

## Open questions / to verify before build

1. **abc hard-wall confirmation**: capture abc headed and confirm it genuinely
   exposes NO free reject/settings (accept-or-pay only) — the firing case. If it
   secretly has a settings link, the firing case needs another candidate.
2. **"Settings still forces pay" nuance**: on some consent-or-pay walls the
   learn-more/settings pane may itself offer only accept-or-pay (no free reject
   inside). Treating learn-more as ABSTAIN is fail-SAFE regardless (we never
   accept; the user sees the wall), so this is acceptable — but note it means
   MUGA covers fewer Didomi walls than exist (only the ones with NO settings
   button at all fire). Product call: is that coverage worth the slice?
3. **Publisher ue-* customization**: how common beyond elmundo? If a hard-wall
   publisher customizes so the ONLY accept is a `ue-*` id (no `didomi-notice-
   agree-button`), the didomi-notice scope would miss it -> noop (safe, no
   coverage). Widen scope to known custom prefixes only after per-publisher
   verification, never speculatively.
4. **FR/IT captures**: lefigaro/repubblica did not render a Didomi wall to the
   probe (different mechanism or timing). Capture real FR/IT Didomi consent-or-
   pay walls headed to confirm the same `didomi-notice-*` structure + token
   coverage before enabling those locales.
5. **Token additions**: add "más información" / "learn more" / "more information"
   / "en savoir plus" / "mehr erfahren" / "gestire"/"gestisci" to SETTINGS_TOKENS
   as belt-and-suspenders (the learn-more-button is already handled by ID, so
   this is defense-in-depth, not the primary guard).

## Testing strategy (same shape as the SP slice)

- Unit: `findDidomiFreeAcceptTarget` matrix over the captured real structures
  (elmundo/lavanguardia/abc labels + ids): abstain-on-learn-more, pay-precedence
  on disagree, exactly-one accept, incidental-link-never-vetoes, malformed
  input. Reuse the cross-product deny-precedence property.
- e2e (real Chromium, synthetic fixture built from the captured structure):
  fires only on a hard-wall fixture (accept + reject-and-pay, no learn-more);
  abstains when a learn-more button is present; never clicks the disagree/pay
  button; opacity:0 accept never clicked (visibility guard); mode/gesture gates.
- HARD PRE-ENABLE GATE (human, headed EU): a real Didomi hard wall (abc or a
  verified equivalent) — accept clicked + wall dismissed by screenshot, pay
  NEVER clicked, per-locale (ES first, then FR/IT). Headless is bot-blocked on
  these sites; the smoke MUST be headed.

## Residual risk

Same honest tradeoff as SP: when it fires it grants broad tracking (the only
free path). Never clicks pay (deny-precedence + never targets the disagree/pay
button). Fail-closed everywhere. Extra Didomi-specific risk: publisher
customization variance is higher than SP's stable sp_choice scheme, so coverage
is best-effort per publisher and each firing publisher must be headed-verified
before enable. Ship dormant until the ES headed smoke passes.

## Post-implementation adversarial review (2026-07) — outcomes

A fresh-context adversarial review of the implemented diff hunted for fail-open
paths. No unconditional fail-open found; the gate/top-frame/deny-precedence/
exactly-one/visibility layers all held. Three findings:

- **F1 (HIGH) — FIXED.** Negated-accept labels ("No acepto", "Nicht
  akzeptieren", "Non acconsento") embed an ACCEPT_TOKENS substring and
  classified ACCEPT; bare soft-declines ("No, gracias", "Non merci") classified
  UNKNOWN. Neither tripped `hasFreeRejectControl`, so on a >=3-control
  dark-pattern wall (agree + reject-and-pay + a low-prominence free "No acepto"
  link) the L3 last-resort reject veto was silently defeated -> the accept-click
  could fire with a free reject present. Fixed DATA-only: negated-accept +
  soft-decline tokens added to REJECT_TOKENS across DE/EN/FR/ES/IT (checked
  before ACCEPT, so they classify reject). Locks: F1 unit group + a 3-control
  hasFreeRejectControl test; full suite green (7311 unit / 20 e2e). Also hardens
  the shipped SP path's free-reject detection.
- **F2 (MEDIUM) — DEFERRED to the headed pre-enable gate.** A publisher whose
  settings/manage control uses a CUSTOM element id (not
  `didomi-notice-learn-more-button`) AND a non-token label ("Más información")
  bypasses both the id veto and the SETTINGS_TOKENS veto -> the
  settings-implies-reachable-reject guarantee could break for that publisher.
  Holds on all captured publishers; mitigated by the dormant ship + mandatory
  per-publisher headed verification. The open-Q #5 SETTINGS_TOKENS widening
  ("más información"/"learn more"/etc.) is the belt-and-suspenders fix, to be
  applied and validated against a real elmundo/ue-* capture during that headed
  gate (not added blindly now, to avoid regressing the shipped SP oracles).
- **F3 (LOW/INFO) — mitigated.** A currency-free premium upsell
  ("Continuar con premium") classifies accept, but the click target is
  id-scoped to `didomi-notice-agree-button`, so a publisher would not label the
  free-accept button as a paid upsell. Noted; no action.
