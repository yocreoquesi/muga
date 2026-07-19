# Design — Cookie Consent Minimizer Tier 2 (declarative deny-only click-rules)

Status: DESIGN (safety-critical). No runtime code in this artifact. This is the gate that
must be scrutinized BEFORE any click-simulation code exists.

Scope of this slice: Tier 2 engine + the 3-layer structural never-accept model +
Cookie Information single-click reject pilot + full test surface. Everything else
(multi-step save flows, more CMPs, Consent-O-Matic derivation at scale, `all_frames`/`scripting`)
is explicitly deferred.

Related artifacts: exploration `sdd/cookie-consent-tier2/explore`; existing Tier 1 code in
`src/lib/cmp-adapters.js`, `src/content/cookie-noise.js`, `src/content/cookie-noise-mainworld.js`;
guards in `tests/unit/cmp-adapters.test.mjs`, `tests/unit/cookie-noise-sync.test.mjs`.

Non-negotiable constraints (carried from proposal/exploration):
- Deny-only. NEVER accept-all. NEVER hide banners. Tier 1 (API) stays preferred. Tier 2 fires
  ONLY when no Tier 1 adapter matched. NOOP when no safe reject path.
- Top-frame only. Confirmed 3 ways (manifest `all_frames:false`, no `scripting` perm, runtime
  `if (window.self !== window.top) return;`). `all_frames`/`scripting` is OUT OF SCOPE and a
  separate future user decision.

---

## 1. The 3-layer structural never-accept model (THE core deliverable)

The design principle mirrors the Tier 1 ethical spine already shipped: **a false negative
(fail to reject → leave the banner → NOOP) is SAFE; a false positive (click accept) is the
catastrophe.** Every ambiguity resolves toward NOOP. The three layers are independent defenses;
each one alone is insufficient, and the design states honestly where each stops.

### Layer 1 — closed op vocabulary (schema forbids most accept paths by construction)

The Tier 2 rule grammar has EXACTLY three step ops. The interpreter is a closed `switch` over
these three strings; any other op value is (a) rejected by schema validation and (b) a runtime
no-op (fail-closed). There is no `accept`, `acceptAll`, `toggleOn`, `saveSelected`,
`submitAccept`, `grantAll` op in the grammar at all — mirroring `ACTIONS = {REJECT_ALL}` being
a 1-member enum today.

| op | semantics | args | why it cannot grant consent |
|----|-----------|------|-----------------------------|
| `waitFor` | Bounded wait until `selector` matches a **present & visible** element in the top frame, or `timeoutMs` elapses. Pure observation; no side effect. | `selector` (CSS, required), `timeoutMs` (int, optional; drawn from the rule `giveUpMs` budget) | Never touches an element. Cannot click, cannot toggle. |
| `clickIfPresent` | If `selector` matches a present & visible element, compute its accessible name and run the **Layer 3 veto** for the step's declared `role`; click via `element.click()` ONLY if the veto allows. Otherwise skip. Never throws. | `selector` (required), `role` (enum `reject`\|`open-settings`\|`save`, required), `optional` (bool, default false) | This is the ONLY op that clicks. It is selector-driven, so Layer 1 alone does NOT prove the target is a reject control — that guarantee comes from Layer 3. Layer 1's contribution here is only that no op exists whose *stated intent* is acceptance. |
| `toggleOff` | For an `input[type=checkbox]`/switch, force the **unchecked/false** state only: if `element.checked === true`, set it false (via a click or `.checked=false` + `input`/`change` dispatch); if already false, no-op. Never sets true. | `selector` (required), `optional` (bool, default false) | Monotone toward denial. There is no `toggleOn`. It can only REMOVE a consent, never add one. |

End-of-`steps` = done; no explicit `done` op is needed.

**What Layer 1 does and does NOT guarantee (be honest):**
- GUARANTEES: no toggle can be turned ON; no op can submit an "accept all"; the vocabulary is a
  whitelist, so a future PR cannot introduce a `toggleOn`/`acceptAll` op without editing the
  closed switch AND passing Layer 2's whitelist lint.
- Does NOT guarantee: that a `clickIfPresent` selector actually points at a reject control. A
  mistaken or malicious selector could target an accept button. That residual hole is exactly
  what Layer 3 closes. Stating this plainly is the point — Layer 1 is necessary, not sufficient.

### Layer 2 — CI lint (extends the existing STRUCTURAL guard)

Extends the `tests/unit/cmp-adapters.test.mjs` `readFileSync` + `/allowall|accept/i` pattern,
but with **precise scoping** so it has teeth without false-positiving on selector strings.

Scanned, and what is asserted:

1. **Engine source** (`src/lib/cmp-tier2-engine.js` and the Tier 2 section of
   `src/content/cookie-noise.js`): the existing `/allowall|accept/i` source scan must find
   NOTHING. This is only possible because the multi-locale accept-word DENYLIST does **not live
   in source** — it ships as DATA (see §3, `rules/cmp-tier2-veto-words.json`) and is
   dependency-injected into the pure veto function. If the denylist were inlined in source, the
   literal word "accept" would trip this very scan. Shipping it as data keeps the source scan
   valid AND follows the existing "rules as data" precedent.
2. **Op whitelist (positive assertion)**: scan the engine's op-dispatch and assert it handles
   ONLY `waitFor`, `clickIfPresent`, `toggleOff`. No `toggleOn`, no `.checked = true`, no
   `.checked=!`… assignment that could set true.
3. **Rules JSON** (`rules/cmp-tier2-rules.json`): parse it and walk to **`steps[].op` fields
   ONLY**:
   - every `op` ∈ `{waitFor, clickIfPresent, toggleOff}` (whitelist — stronger than a blacklist);
   - no `op` matches `/^(accept|allow|agree|grant|consent|toggleon|save.*accept|submit.*accept)/i`;
   - every `clickIfPresent` step has `role` ∈ `{reject, open-settings, save}`;
   - **`selector` string values are NEVER scanned for accept/allow words.** A selector like
     `.btn-accept-cookies` or `#accept-necessary-only` is a legitimate reject-context selector on
     some sites; scanning it would create an unmaintainable false-positive lint. A dedicated
     negative test fixture (a valid reject rule whose selector literally contains `accept`) proves
     the lint does NOT trip on selectors.
4. **Veto-words JSON** (`rules/cmp-tier2-veto-words.json`): parse and assert the SHAPE of the
   word lists (this file is *allowed and required* to contain the word "accept" — it is the
   denylist):
   - `denylist` is non-empty and contains accept-family words (teeth check — the denylist must
     actually deny);
   - `reject`/`settings`/`save` allowlists are each DISJOINT from `denylist` (no word is both a
     reject word and an accept word);
   - all entries are lowercase and diacritic-normalized consistently (see Layer 3).

This split is what gives Layer 2 teeth: the shipped ruleset is validated by a closed op
whitelist and cannot express an accept, while the word-list data is validated for internal
consistency — and neither scan false-positives on legitimate selectors.

### Layer 3 — runtime click-time text/aria veto (last line of defense)

Before the engine performs ANY `.click()`, it computes the target element's **accessible name**
and runs a pure veto that can refuse independent of what the rule says. This defends against BOTH
a bad/compromised rule author AND a CMP silently repurposing a selector.

**Accessible name computation** (`normalizeAccessibleName`, pure):
```
raw = [ el.innerText, el.getAttribute('aria-label'), el.value,
        el.getAttribute('title'), el.getAttribute('aria-description') ]
        .filter(Boolean).join(' ')
name = raw.toLowerCase().trim()          // primary form
folded = name with diacritics stripped   // secondary form (NFD + strip combining marks)
```
Both `name` and `folded` are matched, so `aceptar` and a de-accented variant both hit.

**The veto is role-aware. `computeClickVeto(name, role, wordLists)` → `{ allow, reason }`**,
a PURE string-in / decision-out function (this is the safety-critical unit and is exhaustively
unit-tested with adversarial inputs). Precedence, evaluated in order:

1. **Accept denylist is absolute and role-independent.** If `name` (or `folded`) matches any
   entry in `wordLists.denylist` → **VETO** (`reason: "accept-word"`). This wins over everything.
2. **Role-specific positive gate** (a reject/settings/save word must be PRESENT — this is what
   makes an unknown-language accept button fail closed):
   - `role: "reject"` → require a `wordLists.reject` match, else VETO (`reason: "no-reject-word"`).
   - `role: "open-settings"` → require a `wordLists.settings` match, else VETO.
   - `role: "save"` → require a `wordLists.save` match **AND** the engine's
     "all declared toggles are off" invariant (see below), else VETO.
3. **Ambiguity → fail closed.** Empty accessible name, or a name matching neither denylist nor
   the role's allowlist → VETO (`reason: "ambiguous"`).

So the engine only clicks when: (accept-word ABSENT) AND (the role's required positive word
PRESENT). Absence-of-signal always resolves to "do not click."

**Do we ALSO require a reject-word allowlist match?** YES — for `role: "reject"`. This is the
strongest part of the model: to accidentally click an accept button on a reject step, that button
would have to be labeled with a reject-family word AND not an accept-family word — i.e. a CMP that
labels its "grant all" control "Reject all." That is self-contradictory for a legitimate CMP,
would be caught in PR review and by the canary, and is not a realistic failure mode.

**i18n honesty.** The word lists are inherently incomplete — there are ~24 EU languages plus CJK,
Arabic, Cyrillic, etc. We do NOT claim to enumerate every accept/reject phrase. The design is
sound anyway because:
- Rules are **hand-curated per CMP**, not user-supplied, and PR-reviewed.
- The `reject`-role POSITIVE requirement means an accept button in a language we have not covered
  (whose text matches no reject word) is simply NOT clicked → fail-closed NOOP. Missing a language
  costs coverage, never safety.
- The accept denylist is belt-and-suspenders for the (rarer) `save`/`open-settings` roles where we
  do not require a reject word.

Seed word lists (illustrative, not exhaustive — curated as data):
- `denylist` (accept/allow, all locales we cover): accept, accept all, allow, allow all, agree,
  i agree, aceptar, aceptar todo/todas, akzeptieren, alle akzeptieren, zustimmen, accetta,
  accetta tutti, aceitar, aceitar tudo, accepter, tout accepter, godta, godta alle, acceptér,
  acceptér alle, tillad, tillad alle, 同意, 同意する, すべて同意, 모두 동의, принять, принять все …
- `reject` (reject/decline/necessary-only): reject, reject all, decline, decline all, refuse,
  only necessary, necessary only, rechazar, rechazar todo, solo necesarias, ablehnen,
  alle ablehnen, nur notwendige, rifiuta, solo necessari, recusar, refuser, tout refuser,
  avvis, avvis alle, afvis, afvis alle (Danish — required by the pilot), neka, 拒否, すべて拒否,
  모두 거부, отклонить …
- `settings` (open panel): settings, preferences, manage, manage options, customize, more options,
  ajustes, preferencias, gestionar, einstellungen, verwalten, impostazioni, gérer, personnaliser,
  indstillinger, tilpas …
- `save` (persist a chosen deny): save, save choices, confirm, confirm choices, confirm my choices,
  save and close, guardar, confirmar, speichern, bestätigen, salva, conferma, gem, bekræft …

### Residual risk with all 3 layers

- **Single-click `reject`-role pilot (what this slice ships):** an accidental accept requires the
  CMP to label its consent-granting control with a reject word and not an accept word — practically
  impossible for a real CMP, and detectable by PR review + canary + the pilot e2e adversarial case.
  **Residual risk: LOW. Acceptable.**
- **`save`/multi-step (DEFERRED, not shipped this slice):** materially higher, because the save
  button label is neutral ("Save", "Confirm") and the persisted state depends on toggle states we
  set — if the panel defaulted some category ON and the rule failed to `toggleOff` it, "Save" could
  persist a partial accept. This is gated behind an additional runtime invariant ("all declared
  category toggles are off before a `save` click, else VETO") and is intentionally excluded from
  this slice. See §6.

---

## 2. Deny-only rule schema (precise)

Two data files, both shipped as `web_accessible_resources` and fetched at runtime (§3). Rules are
NOT inlined/@sync'd.

### `rules/cmp-tier2-rules.json`
```jsonc
{
  "schemaVersion": 1,
  "rules": [ /* Rule[] */ ]
}
```

| field | type | notes |
|-------|------|-------|
| `schemaVersion` | int, required | Bumped on any breaking schema change; the validator REJECTS unknown versions (fail-closed — an unknown schema means the whole ruleset is inert, Tier 1 unaffected). |
| `rules[].id` | string, required, unique | `^[a-z0-9-]+$`. |
| `rules[].tier` | const `2` | |
| `rules[].topFrameOnly` | bool, const `true` this slice | Validator rejects `false` — MUGA has no `all_frames`/`scripting`, so a non-top-frame rule could never run and must not exist. |
| `rules[].detect` | `{ anyOf: string[] }`, required | Detection = any listed CSS selector matches a **present & visible** element in the top frame. |
| `rules[].giveUpMs` | int, default `10000`, max `15000` | Reuses the existing `GIVE_UP_AFTER_DOM_READY_MS = 10000` window discipline. |
| `rules[].steps` | `Step[]`, required, non-empty | Executed in order. |
| `Step.op` | enum `waitFor`\|`clickIfPresent`\|`toggleOff`, required | Closed vocabulary (Layer 1). |
| `Step.selector` | string (CSS), required | Resolved in top frame; open-shadow traversal is forward-compat (see §3 notes), not needed by the pilot. |
| `Step.role` | enum `reject`\|`open-settings`\|`save` | REQUIRED iff `op === clickIfPresent`; FORBIDDEN otherwise. Drives the Layer 3 veto. |
| `Step.timeoutMs` | int | `waitFor` only; defaults from the `giveUpMs` budget. |
| `Step.optional` | bool, default `false` | If a non-optional step's selector never resolves, the engine gives up (NOOP). Optional steps are skipped when absent. |

### Example A — Cookie Information pilot (single-click reject; what ships)
```json
{
  "id": "cookieinformation",
  "tier": 2,
  "topFrameOnly": true,
  "detect": { "anyOf": ["#coiOverlay", "#coiConsentBanner", "#coiSummery"] },
  "giveUpMs": 10000,
  "steps": [
    { "op": "waitFor", "selector": "#declineButton", "timeoutMs": 3000 },
    { "op": "clickIfPresent", "role": "reject", "selector": "#declineButton" }
  ]
}
```
Note: Consent-O-Matic's own `cookieinformation` rule expresses a reject-preferred / accept-fallback
chain (`#declineButton` → else `#updateButton` → else accept). The deny-only fork simply **drops
the accept-fallback branch**. `#updateButton` may be added as a second `role: "reject"` step only
after confirming its accessible name matches the reject allowlist (it often reads "Only necessary").

### Example B — generic single-click reject (CookieScript fallback pilot)
```json
{
  "id": "cookiescript",
  "tier": 2,
  "topFrameOnly": true,
  "detect": { "anyOf": ["#cookiescript_injected"] },
  "giveUpMs": 10000,
  "steps": [
    { "op": "clickIfPresent", "role": "reject", "selector": "#cookiescript_reject" }
  ]
}
```

### Example C — multi-step (open → toggleOff → save). SCHEMA-VALID BUT DEFERRED (not shipped)
```json
{
  "id": "example-multistep",
  "tier": 2,
  "topFrameOnly": true,
  "detect": { "anyOf": ["#example-banner"] },
  "giveUpMs": 12000,
  "steps": [
    { "op": "clickIfPresent", "role": "open-settings", "selector": "#example-manage" },
    { "op": "waitFor",        "selector": "#example-prefs-panel", "timeoutMs": 3000 },
    { "op": "toggleOff",      "selector": "#cat-analytics" },
    { "op": "toggleOff",      "selector": "#cat-marketing" },
    { "op": "clickIfPresent", "role": "save", "selector": "#example-save" }
  ]
}
```
The `save` step only fires if the "all declared toggles off" invariant holds (§6). Included here to
show the grammar is future-proof; the pilot does not use it.

### Versioning & validation
- `rules/cmp-tier2-rules.schema.json` — a draft-07 JSON Schema is the human-readable contract.
- A **validator UNIT TEST** (`tests/unit/cmp-tier2-schema.test.mjs`) is the enforcement: it
  validates the shipped rules file against the schema, asserts the closed op whitelist, asserts
  role-presence rules, and asserts `topFrameOnly === true` for every rule. Recommendation:
  hand-rolled validator (no new npm dep — consistent with the codebase's zero-dep structural
  tests). Adding `ajv` is an open decision (§6) — only if a schema grows beyond a small validator.

---

## 3. Engine architecture + integration

### Where the engine runs — isolated world ONLY (confirmed)
Tier 2 clicks real DOM elements. `element.click()` works identically from the **isolated-world**
content script on both Chrome and Firefox (isolated world shares the page DOM). This is the key
simplification the exploration surfaced and it holds:
- Tier 1 needs a 3-file cross-world split (`cmp-adapters.js` + `cookie-noise-mainworld.js` +
  `cookie-noise.js`) ONLY because it calls vendor-namespaced page globals — MAIN world on Chrome,
  `wrappedJSObject` on Firefox.
- **Tier 2 needs NO MAIN-world copy.** `src/content/cookie-noise-mainworld.js` gets ZERO Tier 2
  code. The engine lives in `src/content/cookie-noise.js` (isolated) only. Half the sync surface,
  no cross-world nonce handshake.

### Pure/impure split (mirrors Tier 1's `detect` vs `reject()` call-site separation)
- **PURE — `src/lib/cmp-tier2-engine.js`**, unit-tested directly, `@sync`'d into `cookie-noise.js`:
  - `TIER2_OPS` (frozen set), `TIER2_ROLES` (frozen set).
  - `validateRule(rule)` / `validateRuleset(json)` — schema + whitelist checks; never throws.
  - `selectTier2Rule(rules, detectSignals)` — given per-rule detect booleans, returns the first
    matching rule or null. (Pure counterpart of the Tier 1 dispatcher ladder.)
  - `normalizeAccessibleName(raw)` and `computeClickVeto(name, role, wordLists)` — the Layer 3
    veto (safety core). Word lists are **injected**, so this source contains no accept literal.
  - `validateVetoWords(json)` — Layer 2 shape check for the word-list data.
- **IMPURE — call site in `src/content/cookie-noise.js`** (thin, like Tier 1's `reject()` site;
  structurally guarded, not deeply synced):
  - `getAccessibleName(el)`, `isVisible(el)`, `queryTopFrame(selector)`.
  - `runStep(step)` — resolves selector; for `clickIfPresent`, computes the accessible name, calls
    `computeClickVeto`, clicks only if allowed; for `toggleOff`, forces false-only; for `waitFor`,
    waits within budget.
  - `runRule(rule)` — sequences steps, reuses the bounded give-up timer; sets `_acted = true` on a
    successful reject click and disconnects the observer.

`@sync` marker: new pair `@sync:tier2-engine:start` / `@sync:tier2-engine:end` around the pure
block in both `cmp-tier2-engine.js` and `cookie-noise.js`, guarded by a new section in
`tests/unit/cookie-noise-sync.test.mjs` (extract-normalize-diff, same as the existing blocks).
A companion assertion confirms `cookie-noise-mainworld.js` does NOT carry the tier2 block.

### How rules + word-list DATA ships (domain-rules.json pattern)
Two new `web_accessible_resources`, registered in BOTH `src/manifest.json` and `src/manifest.v2.json`:
- `rules/cmp-tier2-rules.json`
- `rules/cmp-tier2-veto-words.json`

Fetched at runtime from `cookie-noise.js` via `fetch(chrome.runtime.getURL("rules/…json"))`,
exactly like `cleaner.js` fetches `rules/domain-rules.json` / `rules/path-strip-rules.json` /
`rules/path-affiliate-rules.json`. NOT `@sync`-inlined — single source of truth, one file to lint,
independently updatable.

- **Caching:** cache the two fetches as closure-scoped promises (mirror `cleaner.js`'s
  `_domainRulesPending`). Kick them off at gate-open (or at script load), so the parsed data is
  ready before the banner appears.
- **Fetch timing vs the reject window:** these are LOCAL extension resources — near-instant, no
  network. The MutationObserver + 10s give-up window gives ample slack for a local fetch to resolve
  before a banner would be actioned. If the banner appears before the fetch resolves, the observer
  re-fires `runRule` once the promise settles.
- **Fail-closed:** if either fetch/parse fails, or `validateRuleset` rejects, Tier 2 stays INERT
  (NOOP). Tier 1 is completely unaffected.
- **Drift-guarding:** rules JSON validated by the schema/lint tests; veto-words JSON validated for
  shape/disjointness; a test asserts `cookie-noise.js` fetches both via `getURL` AND that both are
  present in `web_accessible_resources` of both manifests.

### Plugging into `decideAction` — Tier 1 stays BYTE-UNCHANGED
`decideAction` is a pure boolean-in/decision-out function and the constraint is that Tier 1 stays
byte-identical. The content scripts do NOT call `decideAction`; they replicate its ladder inline.
Tier 2 is therefore added as a **separate dispatch phase in `cookie-noise.js` AFTER the Tier 1
ladder yields no action**, which naturally satisfies "Tier 2 fires only when no Tier 1 adapter
matched":

```
runDispatcher():
  if (_acted || !gateOpen()) return
  signals = collectSignals()                 // Tier 1 signals — UNCHANGED
  if (canRejectOneTrust..Usercentrics) { …reject; _acted=true; stop; return }   // Tier 1 — UNCHANGED
  // Tier 2 phase (NEW): only reached because no Tier 1 adapter matched
  if (tier2Loaded) {
    rule = selectTier2Rule(rules, collectTier2DetectSignals())
    if (rule) { runRule(rule) }              // veto-gated; sets _acted on a real reject click
  }
```

`decideAction` and the `TIER2 = Object.freeze([])` array in `cmp-adapters.js` are left
**byte-unchanged** (the empty-loop scaffolding is harmless). The unit test
`TIER2.length === 0` stays green. The mild redundancy of two "Tier 2" concepts (the empty
`cmp-adapters.js` array vs the real engine module) is a documented cosmetic follow-up (§6),
deliberately NOT reconciled here to keep Tier 1's blast radius at zero.

The `{id, tier:2, detect, canReject, reject}` shape is honored by the engine module's split:
`detect`/`canReject` ↔ `selectTier2Rule` over DOM-derived detect signals; `reject` ↔ the
impure `runRule` step-runner — the same "pure decision, injected side-effect" separation Tier 1
uses between its synced `canRejectX` and the content-script `reject()` call site.

---

## 4. Pilot verification plan (Cookie Information)

The pilot pick currently rests on INFERENCE. Three assumptions must be CLOSED before locking it in.

**Assumption 1 — "no clean vendor JS reject API" (if there were one, it belongs in Tier 1).**
Cookie Information is a registered IAB TCF CMP, so `window.__tcfapi` **may be present**. If it is,
a `__tcfapi("postRejectAll", 2, cb)` path is a Tier 1 (TCF) candidate and is PREFERABLE (no
clicking). Verify by probing on a real page for: `__tcfapi`, and vendor globals
(`window.CookieInformation`, `window.CookieConsent`, `window.coi`, `cookieinformation`). **If
`__tcfapi` exists and drives a reject, the pilot moves to Tier 1 and the Tier 2 pilot becomes
CookieScript** (fallback).

**Assumption 2 — top-frame banner container.** Confirm `#coiOverlay` / `#coiConsentBanner` /
`#coiSummery` render in the TOP frame (not a cross-origin iframe like the heraldscotland Sourcepoint
case).

**Assumption 3 — stable reject control + its real accessible name.** Confirm `#declineButton` is
present, visible, and its accessible name matches the reject allowlist. Cookie Information is
Danish/Nordic, so the label is likely Danish ("Afvis alle") — this concretely REQUIRES the reject
allowlist to include `afvis`/`afvis alle`. This is the first real i18n requirement the pilot surfaces.

**How to verify given the EU-geo constraint** (our vantage cannot easily see EU banners):
1. **Byte-verify the rule** — raw-read Consent-O-Matic `Rules/cookieinformation.json` via `gh api` /
   `raw.githubusercontent.com` (NOT a WebFetch summary). Closes the exploration's "not byte-verified"
   flag; confirms `#declineButton` and the accept-fallback branch to drop.
2. **Probe a real page from an EU vantage** — a maintainer probe `tools/probe-cmp.mjs` (following the
   `tools/probe-shortener-redirect.mjs` precedent) that loads a known Cookie Information customer URL
   in Playwright from an EU-region context (or a saved/recorded real page DOM) and dumps: presence of
   `__tcfapi` + vendor globals, the top-frame banner container, and the reject button's accessible
   name (`innerText`/`aria-label`). A saved real page HTML is an acceptable offline substitute when a
   live EU vantage is unavailable.
3. **Pick a real customer URL** — a Nordic gov/news/e-commerce site running Cookie Information, for
   the canary entry.

**Fallback pilot — CookieScript** — selected if Cookie Information (a) exposes a usable `__tcfapi`
(→ Tier 1 instead) or (b) renders in an iframe. Criteria: top-frame `#cookiescript_injected`
container; stable `#cookiescript_reject` control; no clean vendor JS API; reject-button accessible
name matches the reject allowlist.

---

## 5. Testing strategy

**Unit (Node, no DOM) — the pure lib:**
- `tests/unit/cmp-tier2-engine.test.mjs`
  - `validateRule`/`validateRuleset`: valid rules pass; unknown op rejected; `clickIfPresent`
    without `role` rejected; `role` on a non-click op rejected; `topFrameOnly:false` rejected;
    unknown `schemaVersion` rejected; empty `steps` rejected; never throws on garbage.
  - `selectTier2Rule`: first matching detect wins; no match → null; malformed input → null.
  - `computeClickVeto` — SAFETY CORE, ADVERSARIAL "try to make it click accept":
    - reject role: "Reject all" → allow; "Accept all" → VETO; "Aceptar todo" → VETO;
      "Alle akzeptieren" → VETO; "Tout accepter" → VETO; "同意する" → VETO; "모두 동의" → VETO;
      "Afvis alle" → allow; "" → VETO; neutral "Save" → VETO (no reject word);
      "Accept only necessary" → VETO (accept denylist beats the "necessary" reject hint).
    - save role: "Save my choices" → allow (invariant true); "Save & accept all" → VETO;
      "Accept all" → VETO; save role with invariant false → VETO.
    - open-settings role: "Manage options" → allow; "Accept all" → VETO.
    - precedence: accept denylist ALWAYS beats any allowlist match, every role.
    - fail-closed: unknown role → VETO; null/garbage/empty name → VETO.
  - `normalizeAccessibleName`: diacritic folding (`aceptar`/`acceptér`), aria-label + value merge.
- `tests/unit/cmp-tier2-neveraccept.test.mjs` — Layer 2 lint WITH TEETH:
  - source scan `/allowall|accept/i` over `cmp-tier2-engine.js` + `cookie-noise.js` Tier 2 section
    → absent.
  - op whitelist closed in the engine source.
  - rules JSON: every `steps[].op` ∈ whitelist; no accept-family op; every `clickIfPresent` has a
    valid role; **negative test — a reject rule whose `selector` contains the substring `accept`
    passes** (selectors are not scanned).
  - veto-words JSON: `denylist` non-empty and contains accept words (teeth); allowlists disjoint
    from denylist; all lowercase.
- `tests/unit/cmp-tier2-schema.test.mjs` — the shipped rules file validates against the schema.
- `tests/unit/cookie-noise-sync.test.mjs` — new `@sync:tier2-engine` marker pair (lib ↔
  cookie-noise.js) extract-normalize-diff; assert mainworld.js does NOT carry the block.

**Pilot e2e (Chromium, Playwright — existing canary harness):**
- Stub Cookie Information banner (local HTML: `#coiOverlay` + a `#declineButton` labeled
  "Decline all" and a Danish "Afvis alle" variant): load with the extension → assert MUGA clicks
  `#declineButton` (reject fired) and NEVER clicks the accept button.
- Accept-only stub (no decline control) → assert NOOP (fail-closed).
- ADVERSARIAL stub: the "decline" selector actually points at an accept-labeled button → assert
  Layer 3 VETO → no click → NOOP. This is the e2e proof of the runtime veto.

**Firefox smoke:** a `web-ext` smoke entry loading the same stub, asserting the isolated-world
engine clicks decline (Firefox uses the SAME isolated-world path — no `wrappedJSObject` needed for
Tier 2, it is plain DOM).

**Canary / release-smoke:** add a `{ "cmp": "cookieinformation", "url": "<real EU customer>",
"bannerSelector": "#coiOverlay" }` entry to `tests/canary/cmp-sites.json` and a section in
`docs/qa/cookie-consent-release-smoke.md` following the existing 6-adapter template; note the
EU-geo requirement for the real-site run (same documented caveat as the heraldscotland case).

---

## 6. Slicing + open decisions

**This slice (ship):** `src/lib/cmp-tier2-engine.js` (pure) + `cookie-noise.js` isolated-world
runner + 3-layer never-accept + `rules/cmp-tier2-rules.json` + `rules/cmp-tier2-veto-words.json` +
`rules/cmp-tier2-rules.schema.json` + WAR registration in both manifests + Cookie Information
**single-click reject** pilot + all unit tests + pilot e2e + Firefox smoke + canary/smoke entry.

**Explicitly NOT in this slice:**
- Multi-step `open-settings → toggleOff → save` flows (deferred behind the "all declared toggles
  off before `save`" runtime invariant; higher residual risk).
- Additional CMPs beyond the pilot (each is ~0.5 day behind the same lint + canary gate).
- Deriving a deny-only subset from Consent-O-Matic's MIT ruleset at scale (needs a NOTICE/attribution
  file; MIT is GPLv3-compatible, so legally fine — but a maintenance-model decision).
- `all_frames` / `scripting` expansion (separate, explicit future user decision — no crawl data yet
  justifies the privacy-posture change).

**Open decisions needing the user:**
1. **Veto word-list maintenance model** — in-repo PR-reviewed JSON (recommended this slice) vs
   remote-signed distribution (like remote-params v7). Who curates the multi-locale lists, review
   process, update cadence.
2. **Rule-set maintenance model** — hand-author per CMP (recommended for the pilot) vs derive a
   deny-only subset from Consent-O-Matic's MIT ruleset with attribution. Decide before expanding
   beyond the pilot.
3. **Pilot outcome branch** — if verification finds Cookie Information exposes a usable `__tcfapi`,
   it becomes a Tier 1 (TCF) candidate and the Tier 2 pilot switches to CookieScript. NEEDS the
   §4 verification result before locking.
4. **Ever enable `save`/multi-step?** — product/risk call on the higher-residual-risk save path.
5. **Validator dependency** — hand-rolled validator (recommended, zero-dep) vs adding `ajv`.
6. **Reconcile the empty `TIER2` array / `decideAction` scaffolding** with the new engine module —
   cosmetic; defer.

### Residual-risk verdict
With all three layers and the single-click `reject`-role pilot, an accidental accept-click requires
a CMP to label its consent-granting control with a reject word and no accept word — practically
impossible for a legitimate CMP and caught by PR review + canary + the adversarial e2e. **Residual
risk: LOW and ACCEPTABLE for the pilot.** The `save`/multi-step path carries materially higher risk
and is intentionally excluded until its extra runtime invariant lands.

### Ready to build?
**YES — conditional on the §4 pilot verification.** Concrete first build tasks (TDD, tests first,
matching the existing pattern):
1. Byte-verify Consent-O-Matic `cookieinformation.json` (`gh`/raw) + probe a real page for
   `__tcfapi`/vendor globals, top-frame container, and the reject button's real (Danish) accessible
   name. Decide Cookie Information vs CookieScript.
2. Write `computeClickVeto` + its adversarial unit tests FIRST (safety core), then
   `normalizeAccessibleName`, `validateRule`/`validateRuleset`, `validateVetoWords`,
   `selectTier2Rule` in `src/lib/cmp-tier2-engine.js`.
3. Author `rules/cmp-tier2-veto-words.json` (incl. Danish reject words) + `rules/cmp-tier2-rules.json`
   (pilot) + `rules/cmp-tier2-rules.schema.json`; write the Layer 2 lint + schema tests.
4. Implement the isolated-world runner in `cookie-noise.js` behind the new `@sync:tier2-engine`
   markers; register both JSON files as `web_accessible_resources` in both manifests; extend the
   sync test.
5. Pilot e2e (Chromium stub incl. the adversarial veto case) + Firefox smoke + canary/smoke entry.
```
