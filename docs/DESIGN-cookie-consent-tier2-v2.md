# Design v2 — Cookie Consent Minimizer Tier 2 (broad DOM-click reject, incl. MULTI-STEP)

Status: DESIGN + safety-hardening. NO runtime code in this artifact. Supersedes the single-click-only
scope of `docs/DESIGN-cookie-consent-tier2.md` (engram `sdd/cookie-consent-tier2/design`, id 1302) and
REUSES its 3-layer click-veto model verbatim, reframed as a MODE-SCOPED reject-only veto (see §0). This
is the gate that must be scrutinized BEFORE any multi-step click-simulation code exists.

**Mode-policy framing (product owner, engram `architecture/cookie-consent-accept-policy`, id 1285):**
there is NO permanent "never-accept guarantee." Cookie handling is a 3-state policy —
`reject-only` (default), `accept-when-necessary` (opt-in, explicit consent; AGREED but deferred/unbuilt),
and `off`. Tier 2 is built REJECT-ONLY BY SCOPE this slice (mirroring how Tier 1 shipped reject-only in
its Slice 1 and deferred accept-minimum), NOT because accept is forbidden forever. The guards below are
therefore designed MODE-AWARE-READY: a future consented `accept-when-necessary` DOM path can be added
behind a mode+consent double-gate WITHOUT tearing out the reject-only guards.

**Scope change (product owner, 2026-07-17):** "More consolidated coverage NOW beats waiting for perfect
API resolution. Resolve cookies by ANY method that takes a REAL decision. The ONLY prohibitions: (1)
never hide the banner via CSS/removal without a decision; (2) never click Accept while in the default
reject-only mode. Everything else — API, single-click DOM, MULTI-STEP DOM (open settings → toggle
categories off → save) — is fair game." Multi-step, DEFERRED in id 1302 §6, is now IN SCOPE — because
the field triage (engram `sdd/cookie-consent-coverage/consent-o-matic-triage`, id 1314) byte-verified
that ALL 19 top-prevalence remaining CMPs are multi-step. Single-click reject candidates among generic
CMPs are exhausted (the two that existed, Cookie Information + CookieScript, are already Tier 1).

Related code (ground truth, read this pass): `src/lib/cmp-adapters.js` (10 Tier 1 adapters,
`ACTIONS = {REJECT_ALL}` closed enum, `computeCookieGate` reject-only gate, `TIER2 = Object.freeze([])`,
`@sync` markers, `decideAction` byte-frozen); content shells `src/content/cookie-noise.js` (isolated) +
`src/content/cookie-noise-mainworld.js`; guards `tests/unit/cmp-adapters.test.mjs`,
`tests/unit/cookie-noise-sync.test.mjs`.

---

## 0. The two hard rules for THIS reject-only slice (mode-scoped, mode-aware-ready)

Both rules below are scoped to the DEFAULT `reject-only` mode and to what this slice actually builds.
They are strongly guaranteed FOR THIS SLICE, but the architecture stays mode-aware-ready — none of them
bakes in "accept can never exist anywhere ever" (that would repeat the Tier 1 Slice-1→Slice-2 rework
where absolute guards had to be retrofitted mode-aware). A future consented `accept-when-necessary` mode
adds a minimum-accept DOM path behind a mode+consent double-gate, reusing — not deleting — these guards.

### Rule A — NEVER-HIDE-WITHOUT-A-DECISION (new in v2)

The engine must never apply `display:none` / `visibility:hidden` / `opacity` / the `hidden` attribute /
DOM removal to a banner, and must never mark itself "acted/succeeded" without an actual reject decision
having been taken. Hiding a banner without deciding breaks navigation and fakes success.

Structural guards (three, mirroring the reject-only click-veto spine):

1. **Closed op vocabulary forbids it by construction.** The interpreter is a closed `switch` over exactly
   `{waitFor, clickIfPresent, toggleOff}` (unchanged from v1 §1). No `hide`, `remove`, `setStyle`,
   `addClass`, `setAttribute` op exists. A rule physically cannot express a hide. (This op set is
   deny-only BY SCOPE — a later `accept-when-necessary` mode would ADD ops like `toggleOn`/`save-accept`
   behind the mode+consent gate; the hide-family ops remain forbidden in every mode.)
2. **CI source + rule scan (extends Layer 2).** A new lint assertion scans the engine source
   (`src/lib/cmp-tier2-engine.js` + the Tier 2 section of `cookie-noise.js`) and the rules JSON for
   hide-family mutations — `/\.style\.(display|visibility|opacity)|\.hidden\s*=|\.remove\(\)|removeChild|display\s*:\s*none|visibility\s*:\s*hidden/i`
   and any op value outside the whitelist — and asserts ABSENT. Note: unlike accept-words (which ship as
   injected data), hide-mutations have NO legitimate reason to appear in engine source, so this scan is a
   pure source denylist with no data-injection carve-out.
3. **Success is decision-gated.** `_acted = true` (and observer disconnect) may be set at EXACTLY ONE
   place: immediately after a `computeClickVeto` returns `allow` for a `reject` click or a veto-passed
   `save` click. Never on a `waitFor` timeout, never on a give-up, never on a `toggleOff`. A unit test
   asserts the engine source sets the success flag only inside the post-veto click branch. Timeouts /
   no-match / veto-fail all resolve to NOOP with the banner left intact.

### Rule B — DON'T-CLICK-ACCEPT-IN-REJECT-ONLY-MODE (mode-scoped; carried from id 1302, reconfirmed for multi-step)

This is NOT a permanent never-accept guarantee — it is the correct behavior of the DEFAULT `reject-only`
mode, which is the only mode this slice builds. The de facto reject-only behavior today exists because no
accept path has been BUILT yet, not because of an eternal principle. The 3-layer click-veto holds FOR
reject-only mode: Layer 1 closed op vocabulary (no `toggleOn`/`acceptAll` op ships this slice), Layer 2
scoped CI lint (accept denylist ships as injected DATA so the source scan stays clean; op whitelist;
selectors never scanned), Layer 3 runtime `computeClickVeto` text/aria veto (accept-denylist absolute +
role-positive-word requirement). §1 below extends Layer 3 to make the veto hold for the neutral-label
`save` click, which the positive-reject-word requirement does NOT protect.

**Mode-aware-ready:** `computeClickVeto` takes the active mode as input. In `reject-only` it applies the
accept denylist absolutely (this slice's behavior). The signature and the injected-word-list structure
are shaped so a future `accept-when-necessary` mode can, behind an explicit-consent gate, permit a
minimum-accept click path WITHOUT rewriting the reject-only veto — the reject-only branch stays intact
and default. Do NOT hardcode "accept impossible" into the function; scope it to the mode.

**A false negative (fail to reject → leave banner → NOOP) is SAFE. A false positive (granting consent
while in reject-only mode) is the catastrophe this slice must prevent.** Every ambiguity resolves toward
NOOP.

---

## 1. THE CORE NEW WORK — multi-step `save` safety (the gate; lead here)

The risky click is `save` on a multi-step flow. Save buttons carry NEUTRAL labels ("Save", "Confirm",
"Save choices") — the Layer 3 positive-reject-word requirement gives them ZERO protection. The design
below is the runtime invariant that does.

### 1.1 The all-toggles-off invariant (precise)

**A `save` click fires ONLY IF, in strict precedence, ALL THREE hold:**

1. **accept-word ABSENT** on the button's accessible name (Layer 3 denylist — absolute, role-independent);
2. **save-family word PRESENT** on the button ("save", "confirm", "guardar", "bestätigen", …);
3. **all-toggles-off invariant TRUE** (defined below).

Any ambiguity, any unreadable state, any missing selector → **VETO → NOOP → leave the banner** (safe).

The invariant is computed by a PURE, unit-tested function so the safety decision is not buried in DOM
code:

```
computeSaveInvariant(toggleReadout, backstopCheckedCount) -> { satisfied, reason }
  satisfied === true  IFF
    (every non-locked toggle in toggleReadout is readable AND reads OFF/false)
    AND backstopCheckedCount === 0
  else { satisfied:false, reason }   // reason ∈ unreadable-toggle | toggle-still-on | backstop-checked | empty-scope
```

The runner then calls `computeClickVeto(name, "save", wordLists, { saveInvariantSatisfied })`, which
allows the click only if (accept absent) AND (save word present) AND (`saveInvariantSatisfied === true`).

### 1.2 How the engine verifies EVERY declared toggle reads off (not just "we clicked it")

`toggleOff` is force-off-only (never sets true; monotone toward denial — unchanged from v1). But clicking
off is not proof. Before `save`, the runner RE-READS each declared `toggleOff` target's live state
(`el.checked === false`, or `aria-checked !== "true"` for ARIA switches). A declared toggle that clicks
but reads back ON (site JS re-checked it, animation lag, disabled control) → invariant FALSE → VETO.

### 1.3 Generic enumeration + the fail-closed answer to "a toggle we didn't know about"

The honest hazard: a category toggle the rule did NOT enumerate that DEFAULTED ON would be persisted by
`save`. We do NOT hardcode per-tenant IDs. Two mechanisms:

**(a) Per-rule generic `toggleScope` (declares, does not enumerate individual IDs):**
```jsonc
"toggleScope": {
  "container": "#osano-cm-preferences",              // the preferences panel root
  "toggle": "input[type=checkbox]",                  // matches EVERY category control in the panel
  "lockedOn": "[disabled],[aria-disabled='true']"    // strictly-necessary categories legitimately locked ON
}
```
The runner enumerates ALL elements matching `toggle` within `container` (every category, named or not),
force-offs each non-locked one, then RE-reads. `lockedOn` matches the strictly-necessary category
(regulatorily non-consent, usually a checked+disabled box) and is EXCLUDED from both toggling and the
violation count.

**(b) Generic backstop scan (CMP-selector-independent — this is what makes the failure mode fail-closed
for standard controls):** independent of the per-CMP `toggle` selector, the runner scans the whole
`container` for ANY still-checked standard consent control:
```
container.querySelectorAll("input[type=checkbox]:checked, [role='switch'][aria-checked='true'], [role='checkbox'][aria-checked='true']")
  minus elements matching lockedOn  ->  backstopCheckedCount
```
If `backstopCheckedCount > 0` at save time → VETO. This catches a defaulted-ON category EVEN IF the
per-CMP `toggle` selector missed it, as long as it is a standard checkbox / ARIA switch (which
accessibility law effectively forces GDPR CMPs to use).

**Fail-closed extras (all → VETO the save):** `container` not found; `toggle` matches zero elements while
the rule declared a multi-step flow (panel structure changed under us); any enumerated toggle's checked
state is unreadable; the save selector's accessible name is empty.

### 1.4 The honest residual limit (stated plainly)

The ONE hole the backstop cannot close: a consent category rendered with a **fully non-standard,
non-ARIA, machine-unreadable widget** (e.g. a styled `<div>` with no `checked`/`aria-checked`). Such a
widget is unreadable in BOTH directions — the engine can neither detect it ON nor reliably force it off.

- **Failure mode:** `save` could persist THAT ONE category as accepted. It is **bounded (a single
  mis-detected category, never blanket accept-all — every standard toggle is still denied), detectable
  (canary + per-CMP adversarial e2e), and gated (the per-CMP `toggle` selector is byte-verified + probed
  to cover every category before that CMP ships).** It is NOT "accidental accept-all."
- This is strictly riskier than single-click reject (whose failure mode is a clean fail-closed NOOP).
  That extra risk is the acknowledged price of multi-step coverage, contained per-CMP behind the lint +
  veto + adversarial-e2e gate. Where a CMP is known to use non-standard widgets, we do NOT ship a
  multi-step rule for it — we leave the banner (NOOP).

**Precedence summary:** `save` fires iff `(!acceptWord) AND (saveWord) AND (allDeclaredTogglesReadOff)
AND (backstopCheckedCount===0) AND (scope resolved)`. Anything else → VETO → NOOP. The failure mode is
always "no reject / banner stays" for standard controls; the one non-standard-widget edge is a bounded,
detectable partial-accept, never an accept-all.

---

## 2. Grammar deltas from v1 (everything else in id 1302 §2 unchanged)

| Change | Detail |
|--------|--------|
| `toggleScope` rule field | Object `{container, toggle, lockedOn?}`. REQUIRED iff any step has `role:"save"`. Validator rejects a `save` step without it. |
| `computeClickVeto` signature | Adds a `context` arg carrying the active `mode` and `saveInvariantSatisfied`. In `reject-only` mode: accept denylist absolute, and `role:"save"` requires `saveInvariantSatisfied === true`. Mode is an input (not hardcoded) so a future `accept-when-necessary` branch slots in without rewriting reject-only. Still PURE. |
| New pure helper | `computeSaveInvariant(readout, backstopCount)` (§1.1) — safety-critical unit. |
| New impure runner helpers | `enumerateToggles(scope)`, `countCheckedControls(container, lockedOn)`, `readToggleState(el)`. |
| Runner flow | `open-settings` (veto: settings word) → `waitFor` panel → declared `toggleOff` sweep → generic `toggleScope` sweep → re-read + backstop → compute invariant → veto-gated `save`. |

Op vocabulary stays EXACTLY `{waitFor, clickIfPresent, toggleOff}`. No new op. No `hide`. No `toggleOn`.

---

## 3. Rule sourcing — deny-only FORK of Consent-O-Matic generic-platform rules

Import ONLY C-o-M's **generic CMP-platform** rules (Osano, Complianz, Cookie Notice, TermsFeed, Moove,
CookieConsent-OSS, CookieFirst, Borlabs, CookieHub …). Do NOT import the ~300 single-site bespoke rules
(amazon.json, bbc_fc.json …) — a rounding error per `sdd/cookie-consent-coverage/coverage-quantification`
(id 1320).

**Deny-only fork process (per rule, applied by hand, PR-reviewed):**
1. Map C-o-M's action grammar to our closed op vocabulary: `OPEN_OPTIONS` → `clickIfPresent role:open-settings`;
   the per-category consent actions (`consent[].toggleAction` / `DO_CONSENT`) → `toggleOff` only (drop the
   "on" path entirely); `SAVE_CONSENT` → `clickIfPresent role:save` + a `toggleScope`.
2. **STRIP** every accept-fallback branch, every consent-true / opt-in action, and every `HIDE_CMP`
   method (`HIDE_CMP` violates Invariant A — never ported).
3. Derive `toggleScope.container` / `toggle` / `lockedOn` from the C-o-M rule's own container + toggle
   matchers; byte-verify they cover every category the CMP renders.
4. The Layer 3 veto RE-CHECKS every click at runtime regardless of what the imported rule says — an
   imported rule is untrusted input, not authority.

**Attribution:** add `THIRD-PARTY-NOTICES.md` crediting Consent-O-Matic (cavi-au/Consent-O-Matic, MIT),
listing which rules were derived. MIT is GPLv3-compatible; attribution is the only obligation.

**Maintenance model — RECOMMEND frozen one-time import per CMP (not track-upstream).**

| Model | Pro | Con | Verdict |
|-------|-----|-----|---------|
| Frozen per-CMP fork | No automated sync can EVER reintroduce an accept/hide branch; every rule is PR-reviewed + byte-verified once | Selector rot when a vendor changes markup — but a stale selector fails CLOSED (NOOP), and canary flags it | **RECOMMENDED** |
| Track-upstream sync | Auto-catches vendor markup churn | Re-imports whatever accept/hide branches upstream adds → a stripper bug silently ships an accept path (the exact catastrophe) | Rejected for now |

Selector rot is bounded and fail-closed; an automated importer that must re-strip accept/hide on every
sync is a standing catastrophe risk. Freeze wins until a tested, adversarially-verified stripper exists.

---

## 4. Pilot selection — RECOMMEND **Osano**, fallback **Complianz**

| CMP | Share (Nouwens CHI'25) | Tier-1 API? | C-o-M rule shape | Markup stability | Verdict |
|-----|------------------------|-------------|------------------|------------------|---------|
| **Osano** | **7.10%** (biggest remaining) | NO — official API is consent-READ-only, no reject method (id 1314, HIGH confidence) | multi-step, namespaced `.osano-cm-*` toggles + `.osano-cm-save` | SaaS, centrally-hosted → low per-install drift | **PILOT** |
| Complianz | 5.69% | none found | multi-step (byte-verified id 1314) | WordPress plugin → per-install/version variance | Fallback |
| Cookie Notice | 4.49% | none found | multi-step | WordPress plugin → higher drift | Later |

Osano is the clear pilot: biggest share, genuinely Tier-2-only (vendor deliberately exposes no write
API — not a research gap), cleanly namespaced selectors (`.osano-cm-*` covers every category by
construction — ideal for the §1.3 generic `toggle` selector), and SaaS-hosted so markup is
vendor-controlled and stable (WordPress-plugin CMPs vary across sites/versions — worse Tier 2 targets).

**UNVERIFIED — build gate before locking Osano:** I did NOT byte-read the C-o-M `osano.json` rule in THIS
session (no `gh`/raw fetch tool available here). The cleanliness judgment rests on id 1314's prior
byte-verification. Slice 1 task #1 MUST raw-read `Rules/osano.json` (`gh api` / `raw.githubusercontent.com`,
not a WebFetch summary) + probe a live Osano page for: top-frame render (not iframe), the exact toggle /
container / save selectors, `lockedOn` necessary-category shape, and the save button's real accessible
name (confirm a save-family word, no accept word). If Osano renders in a cross-origin iframe → it is
UNREACHABLE top-frame-only → switch pilot to Complianz.

---

## 5. Permissions / iframes — top-frame-only, NO new permissions

**Confirmed no new permissions:** the content script is already `<all_urls>`, `document_start`, isolated
world, DOM access, NO `scripting` permission. Tier 2 multi-step clicks + toggle reads all happen via
plain isolated-world DOM (`element.click()`, `el.checked`) which works identically on Chrome and Firefox
(id 1302 §3). Nothing new is requested.

**What top-frame-only MISSES:** CMPs that render the banner/panel inside a **cross-origin iframe** —
Sourcepoint (`sp_message_container` iframe), AppConsent (`.frame-root`, France-specific), some TrustArc
`_frame` variants, some Quantcast. Same-origin policy blocks the top-frame script from querying toggles
or clicking inside them. These are simply NOT addressable this slice → NOOP.

**What `all_frames:true` would add (SEPARATE deferred lever, NOT this slice):** injection into every child
frame lets the engine run inside the CMP iframe's own origin. Cost: the content script then runs in EVERY
ad/tracker/embed iframe on every page (perf + attack surface), heavier Chrome/AMO store review of
`all_frames` + broad host perms, and frame-aware `_acted`/gate logic. No crawl data yet justifies the
privacy-posture and store-scrutiny cost. Deferred (matches id 1302 §6 open decision 7).

---

## 6. Coverage estimate (caveated)

Baseline: ~48% of CMP-detected sites via the 10 Tier 1 adapters (id 1320: 45–52%, central ~48%; EU/EEA+UK
Nouwens CHI'25, n=254,148, Aug 2024).

Remaining generic CMP platforms NOT already Tier-1'd and (mostly) not iframe-based sum to ~28% of CMP
detections (id 1320): Osano 7.1 + Complianz 5.69 + Cookie Notice 4.49 + TermsFeed 3.68 + Moove 2.64 +
CookieConsent-OSS 1.39 + CookieFirst 1.05 + Borlabs 0.94 + CookieHub 0.94. Not all will prove Tier-2
addressable (some may be iframe-based or use non-standard widgets → NOOP).

**Realistic ADD from Tier 2** (shipping Osano + ~top-6 generic platforms, top-frame, standard toggles,
stable selectors): **+12 to +22 percentage points of CMP-detected sites (central ~+17)**, reaching
roughly **~60–68% of CMP-detected sites**. Assumptions: prevalence figures hold; each platform is
top-frame + standard-checkbox-semantics + stable selectors (unverified per platform until byte-read +
probe); real-world success < detection rate because multi-step selector rot degrades over time.

**Explicit non-goal:** the bespoke-banner segment (22.3% of ALL sites, no CMP — id 1320) is the largest
untapped population, but C-o-M has almost no reusable rules there (single-site) and no vendor API exists
by definition. Tier 2 as designed does NOT meaningfully address bespoke banners — that is a separate
future frontier.

---

## 7. Testing strategy (extends id 1302 §5)

| Layer | What to test | Approach |
|-------|-------------|----------|
| Unit — safety core | `computeSaveInvariant`: all-off → satisfied; one declared toggle reads ON → false; backstopCount>0 → false; unreadable toggle → false; empty scope → false. `computeClickVeto(save)`: "Save choices" + invariant true → allow; "Save & accept all" → VETO (accept denylist); "Save" + invariant false → VETO; neutral "Save" + invariant true + no accept word → allow. | Pure, adversarial battery |
| Unit — never-hide | Source scan (engine + Tier 2 section) for hide-family mutations → ABSENT; op whitelist closed; success flag set ONLY in post-veto click branch (source assertion). | Structural lint with teeth |
| Unit — reject-only veto | Carried from id 1302 §5 + reconfirm save role IN reject-only mode; accept denylist absolute in reject-only; selector-not-scanned negative test; veto-words disjointness; assert `mode` is a live input (a stub non-reject mode does NOT crash the reject-only path). | Structural + adversarial |
| Unit — schema | `toggleScope` required iff a `save` step exists; rejects `save` without scope; closed op whitelist; `topFrameOnly===true`. | Hand-rolled validator (zero-dep) |
| E2E (Chromium) — Osano pilot | Stub Osano panel: MUGA opens settings → toggles all categories off → saves → asserts reject persisted, accept NEVER clicked, banner NOT hidden. | Playwright canary harness |
| E2E — ADVERSARIAL (the multi-step proof) | (a) save selector points at an accept-labeled button → VETO → NOOP. (b) one category defaults ON and the rule's `toggle` selector misses it, but it is a standard checkbox → backstop catches it → VETO → NOOP. (c) a category reads back ON after toggleOff → VETO → NOOP. (d) engine attempts no hide (structurally impossible; assert banner still visible on NOOP). | Playwright, fail-closed assertions |
| Firefox smoke | Same Osano stub via `web-ext`, isolated-world path. | web-ext |
| Canary / release-smoke | Real Osano EU customer URL entry in `tests/canary/cmp-sites.json` + section in `docs/qa/cookie-consent-release-smoke.md`. | Documented EU-geo caveat |

---

## 8. Slicing — RECOMMENDED first slice

- **Slice 1 (build first):** pure engine (`src/lib/cmp-tier2-engine.js`) with `computeClickVeto` +
  `computeSaveInvariant` + validators (tests FIRST) + the never-hide + reject-only-mode click-veto guards
  (mode-aware-ready) + the multi-step
  all-toggles-off invariant + isolated-world runner in `cookie-noise.js` behind new `@sync:tier2-engine`
  markers + `rules/cmp-tier2-rules.json` (ONE pilot rule: Osano) + `rules/cmp-tier2-veto-words.json` +
  `rules/cmp-tier2-rules.schema.json` + WAR registration in BOTH manifests + `THIRD-PARTY-NOTICES.md` +
  full unit suite + the adversarial e2e battery (§7) + Firefox smoke + canary entry. Tier 1 stays
  byte-unchanged; Tier 2 runs as a separate dispatch phase after the Tier 1 ladder yields nothing
  (id 1302 §3).
- **Slice 2+:** add one CMP per PR (Complianz, Cookie Notice, TermsFeed, …) via the §3 deny-only fork,
  behind the SAME lint + veto + adversarial-e2e gate. Each ~0.5–1 day.
- **Deferred:** `all_frames`/iframe reach; bespoke-banner frontier; automated upstream tracking.

---

## 9. Open decisions for the PRODUCT OWNER

1. **Non-standard-widget policy (§1.4).** Accept the bounded per-category partial-accept residual risk for
   CMPs that mix in non-standard widgets, OR require every category to be a standard checkbox/ARIA switch
   (VETO/NOOP otherwise, costing coverage)? Recommend the latter (fail-closed) for the pilot.
2. **Maintenance model (§3).** Confirm frozen per-CMP fork (recommended) vs track-upstream.
3. **Pilot lock (§4).** Osano vs Complianz — pending the Slice 1 byte-read + live probe (iframe / selector
   / accessible-name verification).
4. **`all_frames` future lever (§5).** When (if ever) to pay the store-scrutiny + footprint cost for
   iframe-based CMPs.
5. **Veto word-list + rule maintenance governance** (in-repo PR vs remote-signed) — carried from id 1302
   open decisions 1–2, now spanning save-family + settings-family words too.

## 10. Unverified assumptions (flagged)

- Osano `osano.json` selectors + top-frame render + save accessible name — NOT byte-read this session
  (build gate, §4).
- Per-platform Tier-2 addressability (top-frame, standard toggles, stable selectors) — inferred from
  id 1314/1320, not per-platform probed.
- Coverage range (§6) rests on EU-only Nouwens data; US-weighted audiences skew differently.
- The generic backstop assumes GDPR CMPs use standard checkbox/ARIA-switch semantics (accessibility-driven,
  strong but not guaranteed for every vendor).

---

## Verdict

The multi-step `save` path is made safe by a PURE, unit-tested all-toggles-off invariant plus a
CMP-selector-independent backstop scan, gated so the failure mode for standard controls is always
"leave the banner" (NOOP), never accept-all. For THIS reject-only slice, the two mode-scoped rules are
strongly guaranteed — never hide without a decision, and never click accept in reject-only mode — via
closed op vocabulary + CI lint + decision-gated success + runtime veto, structured MODE-AWARE-READY so a
future consented `accept-when-necessary` mode extends rather than tears out these guards. The one honest
residual (non-standard-widget partial-accept) is bounded, detectable, and gated per-CMP.

**Ready to build the pilot? YES — conditional on the Slice 1 Osano byte-read + live probe (§4).** Build
order: veto + save-invariant + guards with adversarial tests FIRST, then the Osano rule + fork, then the
runner, then e2e/smoke/canary.
