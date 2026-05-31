# `tools/rule-ingestion/` — clean-room ingestion pipeline (EPIC B/C)

In-repo tooling that scales MUGA's `TRACKING_PARAMS` list **without depending on
active user reports**, while preserving the CAPS affiliate moat. Tracking issue:
[#785](https://github.com/yocreoquesi/muga/issues/785).

This directory is the **scaffold** (B1, [#772](https://github.com/yocreoquesi/muga/issues/772)).
Fetch/normalize adapters (B2, #773), provenance discipline (B3, #774) and the
gate stack (EPIC C) land on top of it.

## Core principle — signals, not copies

Upstream tracker lists are used as **signals only**. A candidate parameter is
*corroborated* by upstream presence, then **independently re-derived** against
MUGA's own data — it is never copied verbatim into the distributed ruleset.

**Legal posture (verified):** individual param facts are not copyrightable
(Feist v. Rural); the EU sui generis right is limited to *obtaining* data
(BHB v. William Hill). DuckDuckGo's list (CC BY-NC-SA, NonCommercial) is
**off-limits** and excluded from every adapter.

## Asymmetric risk → asymmetric automation

Stripping a tracker by mistake is cheap; stripping an affiliate/functional
param is catastrophic. The pipeline is **aggressive toward _preserve_** and
**conservative toward _strip_**. The human leaves the critical path, replaced by
deterministic gates — never by accepting affiliate-deletion risk.

## Quarantine zone — raw upstream NEVER lands in the repo or the bundle

```
tools/rule-ingestion/
├── README.md              # this file
├── verify-quarantine.mjs  # CI gate (see below)
├── candidate.mjs          # candidate format + mergeCandidates() (#773)
├── ingest.mjs             # entry: run adapters → quarantine raw → merge (#773)
├── adapters/
│   ├── index.mjs          # registry: ENABLED_ADAPTERS + EXCLUDED_SOURCES
│   └── adguard-tp.mjs     # AdGuard URL Tracking Protection (GPL-3.0)
└── quarantine/            # gitignored working dir, created at runtime
    └── …                  # raw upstream downloads — ephemeral, never committed
```

Raw upstream data (the literal bytes of an upstream list) lives ONLY in
`quarantine/`, which is:

1. **Gitignored** — `tools/rule-ingestion/quarantine/` is in `.gitignore`, so
   raw bytes are never committed.
2. **Outside `src/`** — the extension bundle is built exclusively from `src/`
   (`web-ext build --source-dir src/`), so quarantined raw data physically
   cannot reach `dist/`.
3. **Ephemeral in CI** — adapters `mkdir -p` it at runtime; the scheduled
   action discards it after deriving candidates.

What may be committed is the *derived, re-authored* candidate set with its
provenance metadata — never the raw source.

## Source adapters & candidate format (#773)

Each adapter fetches one upstream list, quarantines the raw bytes, and normalizes
them into a SET of **literal param-name facts** — never the curated compilation.
`ingest.mjs` folds every adapter's set into the shared candidate shape:

```js
{
  param:             "fbclid",       // normalized lowercase name
  signals:           ["adguard-tp"], // provenance: which adapters reported it
  entropy:           null,           // derived in EPIC C (no corpus here)
  crossSiteFrequency:null,           // derived in EPIC C (#776)
  firstSeenAt:       "<iso8601>"
}
```

`signals[]` is an array so a second source slots in without a contract change.
B2 ships a **single source** — AdGuard URL Tracking Protection (Filter 17,
GPL-3.0): a large, consolidated list. Cross-source **corroboration scoring is
deliberately deferred to #776**, where the corroboration gate actually adds a
second source and consumes the score — building it now would be machinery that
carries no weight and a false sense of safety. Real safety lives in the EPIC C
gates (affiliate-guard #775, canary #777), not in source agreement.

`entropy` / `crossSiteFrequency` are part of the contract but stay `null`: B2 has
no URL corpus to derive them honestly (#776 fills them — never fabricated here).

Run locally with `npm run ingest:rules` (writes `quarantine/candidates.json`).

### Excluded sources

`adapters/index.mjs` records sources excluded **on purpose**. DuckDuckGo
(tracker-radar / tracker-blocklists) is CC BY-NC-SA 4.0 — the **NonCommercial**
clause makes it off-limits for MUGA, a commercial extension. Do NOT add a DDG
adapter. Full ledger: `PROVENANCE.md` (#774).

## GATE 1 — affiliate-guard (#775)

`tools/rule-ingestion/gates/affiliate-guard.mjs`

**What it does:** Rejects any ingestion candidate whose bare `param` name collides
with a known affiliate-attribution or redirect-landing parameter. The gate NEVER
adds to or removes from `TRACKING_PARAMS` — it is a pure read-only check.

**Public exports:**
- `checkAffiliateGuard(candidate)` — returns `{ rejected: false }` or
  `{ rejected: true, reason: "affiliate-collision", collidingPrograms: [{ id, source }] }`.
- `partitionCandidates(candidates)` — batch helper; splits an array into
  `{ accepted, rejected }` in a single pass, order preserved.

**Asymmetric-risk rationale:** A false-accept (letting an affiliate param through
into `TRACKING_PARAMS`) causes unbounded revenue loss for creators whose attribution
cookies are silently stripped. A false-reject (blocking a new tracker that shares a
name with an affiliate param) is trivially recoverable — the candidate can be
reviewed and re-promoted manually. GATE 1 is therefore intentionally conservative.

**SURPRISING-BUT-CORRECT — `ref` and `at` are rejected globally:**
`ref` is the Vercel referral param; `at` is the Apple PHG affiliate tag. Both are
rejected at ingestion even though the runtime cleaner strips them per-domain via
`getAffiliateParamSetForHost`. GATE 1 is domain-agnostic by design — it has no
URL context at ingestion time, so global rejection is the only safe policy.

**Live-derived preserve set:** The 32-name preserve set is built at module load
from `AFFILIATE_PATTERNS[].param` (6 CAPS direct-injection programs) and
`REDIRECT_NETWORK_PATTERNS[].landingParams` (26 redirect-network params). No
edits to this gate are needed when a new program or network is added to those
source arrays (today hand-maintained in `src/lib/affiliates.js` and
`src/rules/manifest.data.js`) — the set expands automatically.

## GATE 3 — canary-gate (#777)

`tools/rule-ingestion/gates/canary-gate.mjs`

**What it does:** Replays the ingestion candidate via `remoteParams` against
all 16 `PRESERVE_CANARIES` (the affiliate-survival moat). For each canary it
calls the real `processUrl` with `{ remoteParams: [candidate.param] }` and
checks that every `mustSurvive` attribute still holds. Any canary break causes
REJECTION. The gate is pure — it never mutates `TRACKING_PARAMS`,
`TRACKING_PARAMS_SET`, or any module-level singleton.

**Public exports:**
- `checkCanaryGate(candidate, opts?)` — returns `{ rejected: false }` when the
  candidate param does not break any canary, or
  `{ rejected: true, reason: "canary-break", brokenCanaries: CanaryFailure[] }`
  when at least one canary breaks. `CanaryFailure = { name, kind: "preserve", reason }`.
  `brokenCanaries` is PARAM-LEVEL and collect-all (no short-circuit).
- `partitionCandidates(candidates, opts?)` — batch helper; returns
  `{ accepted: Candidate[], rejected: Array<{ candidate, reason, brokenCanaries }> }`,
  input order preserved in both arrays. `opts` is forwarded to each individual
  `checkCanaryGate` call (testability seam works at batch level too).

**Asymmetric-risk rationale:** A false-accept (failing to catch a param that
strips an affiliate attribution cookie at runtime) causes unbounded revenue loss
for creators. A false-reject (blocking a tracker whose name happens to match an
inert URL param in a canary) is recoverable by manual review. GATE 3 is
therefore intentionally conservative — it only promotes a candidate once it has
proved that injecting that param as a runtime strip rule leaves every canary
intact.

**GATE-1 complementarity (`tag` example):** GATE 1 rejects `{ param: "tag" }`
structurally (the name collides with the Amazon Associates tag param). GATE 3
returns `{ rejected: false }` for the same candidate — because `cleaner.js:303`
runs `if (affiliateParamSet.has(lower)) continue;` before `isTrackingParam`,
making affiliate-protected params like `tag` and `campid` immune to
`remoteParams` stripping at runtime. The two gates are COMPLEMENTARY (GATE 1 =
structural; GATE 3 = behavioral), not redundant. A candidate rejected by GATE 1
never reaches GATE 3.

**LANDING_CANARIES excluded — WHY:** `LANDING_CANARIES` exercise
`getLandingPolicy()`, an orthogonal code-path driven by referrer heuristics
rather than `remoteParams` stripping. Including them in GATE 3 would simulate a
wrong behavior. GATE 3 imports `PRESERVE_CANARIES` only.

**Affiliate-safety domain:** The canaries and the shared break-evaluator now
live in `tools/affiliate-safety/`:
- `canaries.mjs` — exports `PRESERVE_CANARIES` and `LANDING_CANARIES`
  (relocated from `tests/fixtures/` in #777, EPIC C).
- `evaluate.mjs` — exports `evaluateCanary(canary, processUrlFn, extraRemoteParams?)`
  — the shared break-evaluator used by BOTH the A4 runner
  (`tools/affiliate-safety/runner.mjs`) AND GATE 3. Single source of truth;
  zero drift.
- `runner.mjs` — exports `runAffiliateCanaries()` (relocated from
  `tests/fixtures/`; PRESERVE loop now delegates to `evaluateCanary`).

## GATE 4 — functional-bias (#778)

`tools/rule-ingestion/gates/functional-bias-gate.mjs`

**What it does:** Quarantines ingestion candidates whose bare `param` name is a
member of the universally-functional roster (search/query, pagination,
identity/product, locale/i18n, sort/filter/view). Such a param in
`TRACKING_PARAMS` would silently break search, pagination, and i18n across every
site MUGA touches — catastrophically and irreversibly. The gate NEVER auto-strips;
it routes to human review. Policy: **FAIL-SAFE TOWARD PRESERVATION** — no name =
no match possible → accepted.

**Global-denylist vs. domain-scoped rationale:** Functional params are
domain-scoped in MUGA's data model. For example, `s` is a tracker on some
affiliate networks; `k` is an affiliate alias in `domain-rules.json`. GATE 4
guards the GLOBAL `TRACKING_PARAMS` strip list, so the roster must be a
hardcoded global curated set — NOT derived from `domain-rules.json`. Deriving it
would incorrectly apply domain-local aliases universally. Domain-specific
functional-param protection belongs in `domain-rules.json` (per-host
`preserveParams`), NOT here.

**TRACKING_PARAMS-disjointness invariant:** No GATE 4 roster member may appear
in `TRACKING_PARAMS`. Enforced by a fail-closed test in
`tests/unit/functional-bias-gate.test.mjs` that imports the LIVE
`TRACKING_PARAMS` (not a frozen snapshot) — any drift that introduces an overlap
immediately breaks the build. When editing the roster, manually cross-check
against `domain-rules.json` preserveParams entries as well (the disjointness
test guards only the TRACKING_PARAMS axis).

**GATE 1/2/3/4 complementarity:**
- GATE 1 (`affiliate-guard`) — does this NAME collide with a known affiliate/redirect-landing attribution param?
- GATE 2 (`corroboration-gate`) — does this candidate have enough independent upstream signal?
- GATE 3 (`canary-gate`) — does injecting this param as a runtime strip rule break any affiliate-survival canary?
- GATE 4 (`functional-bias-gate`) — is this NAME universally load-bearing for search, pagination, or UX?

A candidate rejected by GATE 1 never reaches GATE 3. GATE 4 is orthogonal to
GATE 1/3 — it operates purely on the param NAME shape, not on attribution or
behavioral signals.

**Public exports:**
- `FUNCTIONAL_PARAM_NAMES` — frozen `Set<string>`, 43 members, exact-name match only (no regex).
- `checkFunctionalBiasGate(candidate, opts?)` — returns `{ rejected: false }` or
  `{ rejected: true, reason: "functional-param", detail: { param } }` (param is lowercased).
  `opts.functionalNames` replaces the production roster (testability seam).
- `partitionCandidates(candidates, opts?)` — batch helper; returns
  `{ accepted: Candidate[], rejected: Array<{ candidate, reason, detail }> }`,
  input order preserved. `opts` forwarded to each `checkFunctionalBiasGate` call.

## CI gate

`verify-quarantine.mjs` runs in CI ([`ci.yml`](../../.github/workflows/ci.yml))
and fails the build if the quarantine invariants are violated:

- no tracked files exist under `quarantine/`,
- the quarantine path is listed in `.gitignore`,
- the quarantine path lives outside `src/`.

Run it locally with `npm run verify:quarantine`.
