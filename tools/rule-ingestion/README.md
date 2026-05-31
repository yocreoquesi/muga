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

## CI gate

`verify-quarantine.mjs` runs in CI ([`ci.yml`](../../.github/workflows/ci.yml))
and fails the build if the quarantine invariants are violated:

- no tracked files exist under `quarantine/`,
- the quarantine path is listed in `.gitignore`,
- the quarantine path lives outside `src/`.

Run it locally with `npm run verify:quarantine`.
