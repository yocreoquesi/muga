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
| Extract individual literal param **names** from a source | Copy a source's file into the repo |
| Treat a name as a *candidate* to be re-verified | Ship a name because the source ships it |
| Skip regex/patterns, keep atomic facts only | Reproduce a source's curated regex set |
| Quarantine raw bytes, derive, discard | Commit or bundle raw upstream bytes |

The pipeline enforces this structurally:

1. **Signal** — an adapter fetches a list (`adapters/*.mjs`).
2. **Quarantine** — raw bytes land in the gitignored, outside-`src/` `quarantine/`
   dir and never reach the repo or `dist/` (`verify-quarantine.mjs`, CI-gated).
3. **Extract facts** — only literal param names are kept; curated patterns are
   dropped (`candidate.mjs`).
4. **Re-derive** — EPIC C gates (affiliate-guard #775, cross-corroboration #776,
   canary #777, functional-bias #778) independently justify each candidate
   against MUGA's own data before it can land in `TRACKING_PARAMS`.

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

## Adding a new source — checklist

1. Verify the **data** license (not the addon's) against its `LICENSE` file.
2. Confirm it is **not** NonCommercial and is compatible with GPL-3.0.
3. Add a row to the ledger above with the verified license.
4. Extract **literal facts only** — never reproduce curated patterns/regex.
5. Quarantine raw bytes; let the EPIC C gates do the re-derivation.
6. If excluded, record it in `EXCLUDED_SOURCES` **and** the ledger.
