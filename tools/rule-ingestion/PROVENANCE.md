# Provenance & license ledger — rule ingestion (#774)

How MUGA scales `TRACKING_PARAMS` from upstream lists **without infringing** the
work of the projects that maintain them. This is the legal and ethical contract
behind `tools/rule-ingestion/`. Read it before adding any source adapter.

Part of the Self-scaling ruleset initiative (#785). Companion to the
[README](./README.md) (mechanics) and the EPIC C gates (safety).

## The clean-room discipline

**A fact is not copyrightable. A curated compilation is.** That single
distinction is the whole posture.

- "`fbclid` is a tracking parameter" is a **fact**. Facts carry no copyright
  (US: *Feist Publications v. Rural Telephone*, 1991 — the "sweat of the brow"
  doctrine is dead; only original *selection/arrangement* is protected, thinly).
- A maintained list (AdGuard's Filter 17, ClearURLs' rules DB) is a **curated
  compilation**. Its *selection and arrangement* is protected. Copying the file
  — even lightly edited — is infringement.
- The EU adds a **sui generis database right** (Directive 96/9/EC, Art. 7)
  against extracting a *substantial part* of a database. But *BHB v. William
  Hill* (C-203/02) limits it to investment in **obtaining** data, not in
  **creating** it — and it does not reach individual facts.

**Therefore:** we use upstream lists as **signals** that point at candidate
param-name facts, then **independently re-derive and justify** each one through
MUGA's own gates. We never lift, mirror, or light-edit a compilation.

### What this means in code

| Allowed (facts / signals) | Forbidden (compilation) |
|---|---|
| Extract individual literal param **names**, or a **`(param, host)` pair** naming the site where the param was observed ([ADR-0008](../../docs/adr/0008-host-scoped-facts.md), Path A) | Copy a source's file into the repo |
| Treat a name or pair as a *candidate* to be re-verified | Ship a name because the source ships it |
| Skip regex/patterns, keep atomic facts only | Reproduce a source's curated regex set |
| Quarantine raw bytes, derive, discard | Commit or bundle raw upstream bytes |

A `(param, host)` pair leaves quarantine on the SAME terms a bare name always
has: it is a candidate, not a compilation, re-derived through the gates before
it can land anywhere. [ADR-0008](../../docs/adr/0008-host-scoped-facts.md)
(accepted, Path A) is the sui-generis analysis behind that reading; it amends
only this extraction boundary, not the gates or the risk posture below.

The pipeline enforces this structurally:

1. **Signal** — an adapter fetches a list (`adapters/*.mjs`).
2. **Quarantine** — raw bytes land in the gitignored, outside-`src/` `quarantine/`
   dir and never reach the repo or `dist/` (`verify-quarantine.mjs`, CI-gated).
3. **Extract facts** — literal param names are kept, now optionally paired with
   the host they were anchored to; curated patterns are always dropped
   (`candidate.mjs`, ADR-0008 Path A).
4. **Re-derive** — EPIC C gates (affiliate-guard #775, cross-corroboration #776,
   canary #777, functional-bias #778) independently justify each candidate
   against MUGA's own data before it can land: a global candidate in
   `TRACKING_PARAMS`, a host-scoped one in the normalized store's
   `scopedFacts[]` (`tools/rules-store.mjs`) via the manual, reviewed
   `land-scoped.mjs` — never the unattended weekly path.

A gate-admitted `(param, host)` pair is recorded in the ingestion run's
`quarantine-report.json` (`scopedAutoMerge`). That report is unsigned and
gitignored (`.gitignore:54`), the weekly workflow uploads no artifact, and
`report-formatter.mjs` does not render the field — so on the unattended weekly
run the pair is not visible to anyone. Reading it today means running ingestion
locally.

Landing a pair into the committed store is a separate, manual step run through
`land-scoped.mjs`, and deliberately so:
`.github/workflows/auto-ingest-rules.yml` squash-auto-merges its own PR with no
one in the loop. Until the weekly run surfaces `scopedAutoMerge`, that CLI has
no input reachable from CI. Closing that gap is a prerequisite for the slice
that lets the corroboration gate admit scoped facts, not for this one, where
nothing is admitted.

A param that survives the gates is justified by MUGA's verification, not by the
upstream list's say-so. That is the clean room.

## License ledger

Verified against each project's actual `LICENSE` file. Status reflects use as a
**signal source** under the discipline above.

| Source | Data license | Status | Notes |
|---|---|---|---|
| **AdGuard URL Tracking Protection (Filter 17)** | GPL-3.0 | ✅ **Enabled** (B2) | Strong copyleft, compatible with MUGA's GPL v3. Large, consolidated, actively maintained. Sole source in B2. |
| **ClearURLs Rules** | LGPL-3.0 | ✅ **Enabled** (#776) | Library copyleft — ships alongside MUGA without relicensing the extension. Per-provider JSON; `rules` (tracking) only, **never** `referralMarketing` (affiliate — MUGA's preserve set). Second independent source enabling cross-source corroboration via GATE 2. |
| **Brave adblock-lists** (`clean-urls.json`, `debounce.json`) | MPL-2.0 | ⏸️ Candidate | File-level copyleft, friendliest for commercial use. Not yet wired. |
| **uBlock Origin / uAssets** | GPL-3.0 | ⏸️ Candidate | Strong copyleft, compatible. Overlaps heavily with AdGuard. |
| **Neat URL** | GPL-2.0-or-later | ⏸️ Candidate | Compatible. Small list. |
| **DuckDuckGo** (tracker-radar / tracker-blocklists) | **CC BY-NC-SA 4.0** | ⛔ **Excluded** | **NonCommercial** clause — off-limits for MUGA, a commercial extension, without a separately negotiated license. See below. |

"Candidate" = license-compatible and eligible to be wired as a future signal
source; not yet enabled. Only **Enabled** sources run today.

## DuckDuckGo — recorded exclusion

DuckDuckGo's tracker data (Tracker Radar and the derived tracker-blocklists) is
licensed **CC BY-NC-SA 4.0**. The **NonCommercial (NC)** term forbids use in a
commercial product. MUGA is a commercial browser extension, so DuckDuckGo data
is **off-limits** absent a separately negotiated license.

This exclusion is enforced in code, not just documented:
`adapters/index.mjs` lists `duckduckgo` in `EXCLUDED_SOURCES` with the license
and reason, and there is **no** DuckDuckGo adapter. **Do not add one.**

The clean-room "facts are not copyrightable" argument does **not** rescue this:
the issue is the NC *license term* a commercial user would be accepting by
extracting from the database, plus the reputational and good-faith cost of
ignoring a maintainer's clearly stated NonCommercial intent. We respect it.

## Heuristic arms — analytical scores, not signal sources (#798)

The `entropy` and `crossSiteFrequency` fields on ingestion candidates are
**analytical aggregates**, not corroboration signals. Understanding the
distinction is essential before adding any new source or extending the gate.

**What they are:**

- `entropy` — the arithmetic mean of `value_entropy` values found in verified
  `discovered/` artifact files (populated by `enrich-candidates.mjs`).
  `value_entropy` is the mean Shannon entropy (bits) of observed URL parameter
  VALUES in a caps-crawler run. It measures how randomised/opaque the values are.
- `crossSiteFrequency` — the count of DISTINCT `first_seen_on` hostnames for
  a param across all verified `discovered/` artifact files. It measures how
  broadly a param was observed across different sites.

Both fields are derived from caps-crawler crawl metadata stored in `discovered/`.
They are set by `enrich-candidates.mjs` between ingest and orchestration and are
`null` when no artifact data is available for a param.

**What they are NOT:**

- They are **NOT** entries in `signals[]`. The `signals[]` array records which
  independent upstream **adapter** (AdGuard, ClearURLs, …) reported a param.
  Each signal entry must come from a DISTINCT, SEPARATELY MAINTAINED upstream
  source per the independence invariant (#821).
- caps-crawler is **NOT** a corroboration source. It does not produce a signal
  entry. Adding caps-crawler to `ENABLED_ADAPTERS` or `signals[]` would violate
  the independence invariant and must never be done.
- The heuristic arms do not change `signals[]` semantics. Two params can share
  identical `signals[]` contents yet differ in `entropy`/`crossSiteFrequency`
  depending on observed value patterns and site breadth.

**Why this matters for PROVENANCE:**

GATE 2 now accepts a candidate via three arms: signal count, entropy, or CSF
(see `corroboration-gate.mjs` and ADR-0005 amendment). A reader might assume
that passing via the entropy or CSF arm implies a new corroboration source was
added. It was not. The heuristic arms use MUGA's own analytical pipeline over
existing caps-crawler artifact metadata — they are a _scoring_ deepening of the
same corroboration concept, not a new upstream fact source.

---

---

## Moat-expansion pipeline — ClearURLs `referralMarketing` (#793)

The `tools/moat-expansion/` pipeline is a SEPARATE consumer of ClearURLs data
that accesses the **exact field that rule-ingestion permanently excludes**.
This section documents the legal and intentional basis for that inversion.

### Why this is intentional, not a mistake

The rule-ingestion ClearURLs adapter (`tools/rule-ingestion/adapters/clearurls.mjs`)
contains a **SAFETY-CRITICAL two-pass exclusion** that ensures `referralMarketing`
entries are **NEVER** treated as tracking candidates (#773). The comment in that
file reads: *"these are affiliate attribution parameters that belong to MUGA's
preserve set"*. Ingesting them as strip candidates would cause catastrophic
revenue loss for creators.

The moat-expansion pipeline is the **intended consumer** of exactly those same
signals — not to strip them, but to **discover new affiliate params** that
belong in MUGA's moat (`AFFILIATE_PATTERNS`, `AFFILIATE_PARAM_GUARD`). The
exclusion in #773 was the right decision for rule-ingestion; moat-expansion is
the pipeline the referralMarketing data was always meant for.

### License & clean-room posture

| Field | Value |
|---|---|
| Source | ClearURLs `data.min.json` — `providers[*].referralMarketing[]` only |
| Data license | **LGPL-3.0** |
| Usage model | **Signals-not-copies** — referralMarketing tuples are extracted facts; raw file is quarantined and never committed |
| Quarantine path | `tools/moat-expansion/quarantine/` (gitignored; see `.gitignore`) |
| What leaves quarantine | `{ provider, urlPattern, referralMarketing[] }` tuples only — no raw bytes, no curated patterns |
| Output | Human-review Markdown report + JSON sidecar; committed to bot-branch only via weekly PR |
| Writes to `src/`? | **Never.** Pipeline is report-only; no `manifest.data.js` or `affiliates.js` edits |

### #773 inversion — explicit note for future maintainers

The rule-ingestion adapter's permanent `referralMarketing` exclusion and the
moat-expansion pipeline are **two sides of the same invariant**:

- **Rule-ingestion**: `referralMarketing` is an affiliate signal → MUST NOT reach
  `TRACKING_PARAMS`. The exclusion is safety-critical and must never be removed.
- **Moat-expansion**: `referralMarketing` is an affiliate signal → IS the input
  for affiliate-moat gap discovery. This is why the exclusion was recorded as
  "affiliate — MUGA's preserve set" rather than simply dropped.

Removing the #773 exclusion in rule-ingestion would be catastrophic. Adding
`referralMarketing` to the moat-expansion pipeline is correct and intended.
These two statements are NOT contradictory — they are complementary.

### Structural test

`tests/unit/moat-expansion-workflow.test.mjs` (T3.3) reads this file at test
time and asserts that the section referencing `ClearURLs`, `referralMarketing`,
`LGPL-3.0`, and `quarantine` is present. Do not move or rename this section
without updating that test.

---

## Adding a new source — checklist

1. Verify the **data** license (not the addon's) against its `LICENSE` file.
2. Confirm it is **not** NonCommercial and is compatible with GPL-3.0.
3. Add a row to the ledger above with the verified license.
4. Extract **literal facts only** — never reproduce curated patterns/regex.
5. Quarantine raw bytes; let the EPIC C gates do the re-derivation.
6. If excluded, record it in `EXCLUDED_SOURCES` **and** the ledger.
