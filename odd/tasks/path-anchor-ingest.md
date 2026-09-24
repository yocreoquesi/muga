# Path-anchor ingest (#1326 slice 3)

## Objective

Land path-anchored upstream facts (AdGuard Filter 17 `||host/path...$removeparam=x`)
into MUGA's `pathStrips` mechanism (ADR-0010, slices 1+2, already merged to
main), instead of discarding them at `pathAnchorSkipped`. Build a reproducible,
deterministic, reviewable importer — not hand-curation, not full weekly-bot
automation — that a maintainer runs and commits after reviewing the diff.

## Problem

`tools/import-upstream.mjs`'s `parseRemoveparamRules` classifies every
`||host/path...`/`||host&query=...` line as `pathAnchorSkipped` and discards
it: no smaller landing spot existed before ADR-0010. ADR-0010 (accepted)
added the `pathStrips`/`pathPrefixes` schema to `domain-rules.json` and the
DNR projection (`tools/generate-rules.mjs`, `src/lib/dnr-ids.js`,
`src/lib/cleaner.js`'s `getDomainParamSets`), proven with ONE real use
(google.com's `ved`/`sca_esv`/`gs_lcp`). ADR-0010 explicitly left "slice 3 —
ingesting the other 322 of the measured 325" unstarted.

## Why not the existing automated weekly pipeline

`tools/rule-ingestion/` (EPIC B/C: adapters → gates → orchestrate → land-scoped
→ promote → sign) exists to produce the SIGNED weekly remote payload
(`tools/rules-source/params.json`'s `scoped[]`). ADR-0010 Decision 5 says path
predicates stay OUT of that channel — "a BUNDLED-only mechanism... they change
on a release cadence, not a weekly fetch." Wiring path-anchor ingestion into
that automated cron would make the bundled `domain-rules.json` mutate weekly
outside release review, which contradicts Decision 5's framing. So this slice
builds a separate, manually-invoked CLI (`tools/import-path-anchors.mjs`) that
produces a report by default and only writes with `--apply`, for a human to
review and commit as an ordinary PR — not automation.

## Scope

1. Extend `parseRemoveparamRules` (additive, non-breaking) to also capture the
   literal `(param, host, pathPrefix)` triple for a `||host/path...` line that
   names a real literal host (no wildcard/TLD-family) and a real literal path
   (`tools/rules-store.mjs`'s exported `PATH_PREFIX_RE`, no regex/wildcard).
   `pathAnchorSkipped`'s existing count/meaning is UNCHANGED — `pathAnchored`
   is a strict, additive subset.
2. New `tools/import-path-anchors.mjs`: pure grouping/filtering functions +
   a CLI. Filters landable facts through the same absolute guards
   `land-scoped.mjs` already uses (`AFFILIATE_PARAM_GUARD`,
   `REMOTE_PARAM_DENYLIST`, `hostPreservesParam`), plus "already in the global
   `TRACKING_PARAMS` list" (no need to path-scope something already global).
   Groups by `(host, pathPrefix)` → one `pathStrips` group per prefix (the
   store's own `emitDomainRules` grouping already consolidates identical
   `pathPrefixes` arrays, so no separate consolidation step is needed). Caps
   total NEW `(host, prefix)` rules so the grand total (existing + new) never
   exceeds `DNR_PATH_SCOPED_MAX_RULES` (100); reports any overflow rather than
   raising the cap (a separate, larger decision this slice does not make).
   Default = dry-run report; `--apply` writes via `withDomainRules`/`writeAll`
   (`tools/build-rules-store.mjs`).
3. Run the importer against real upstream (today, 2026-09-24) and commit the
   generated result (updated `tools/rules-source/rules.json`,
   `src/rules/domain-rules.json`, `tools/rules-source/params.json`,
   regenerated DNR/content/web bundles).
4. Update `tests/unit/config-integrity.test.mjs`: the "preserve or strip"
   check must also accept a pathStrips-only entry (a new host landed purely
   for a path-scoped strip has no preserve/strip list of its own — same shape
   #1328 already fixed for host-anchored strip-only entries); bump the pinned
   `domainRules.length` to the new real count.
5. Extend `docs/adr/0010-path-scoped-param-rules.md`'s "Consequences" /
   "Neutral" section noting slice 3 landed (not required by ADR-0010 itself,
   but keeps the ADR's own "slice 3 unstarted" statement from going stale).

## Constraints

- Never weaken `pathAnchorSkipped`'s existing count or semantics.
- No regex/wildcard path predicate ever reaches `domain-rules.json` (ADR-0010
  Decision 2) — reuse `PATH_PREFIX_RE`, don't re-derive it.
- Path facts never enter `scopedFacts[]`/the signed remote payload (ADR-0010
  Decision 5) — `withDomainRules` only touches host-scoped entries in the
  store, never `globalParams`/`scopedFacts`.
- Every guard/denylist/preserve check `land-scoped.mjs` applies to host-scoped
  facts applies identically here (never weaker for a narrower, path-scoped
  claim).
- TDD: off by project config; runner `npm test` (`node --test`). RED observed
  before GREEN for all new parsing/filtering logic (see Progress).
- Do not push/open a PR. Conventional Commits, no AI/session attribution.

## Checklist

- [x] T1 — `odd/tasks/path-anchor-ingest.md` created and committed alone.
- [x] T2 — Real-upstream measurement (today's AdGuard Filter 17): confirms
      DNR rule count added stays well under `DNR_PATH_SCOPED_MAX_RULES` (100),
      so no cap-raising decision is needed this slice.
- [x] T3 — Extend `parseRemoveparamRules` with `pathAnchored` (RED → GREEN),
      export `PATH_PREFIX_RE` from `tools/rules-store.mjs`, export
      `fetchAdGuardFilter17` from `tools/import-upstream.mjs`.
- [x] T4 — `tools/import-path-anchors.mjs`: pure grouping/filter/apply
      functions + CLI (dry-run default, `--apply` writes), with tests
      (RED → GREEN, 22 tests).
- [x] T5 — Run `--apply` against real upstream; regenerate all projections
      and bundles; update `config-integrity.test.mjs` and
      `domain-rules.test.mjs`'s pinned count and preserve-or-strip checks;
      update CONTEXT.md/README domain counts. Bug found and fixed during this
      step: a bare root-path anchor (`||host/?query=v`) computed to a `/`
      prefix that would have over-claimed the whole host — excluded at the
      source instead (own commit, own test).
- [x] T6 — Full check suite green: `npm test` (8137/8138, 1 pre-existing
      skip), `npm run lint:js`, `npm run typecheck`, `npm run compile:rules`,
      `npm run build:dnr`, `npm run build:content`, `npm run build:web`,
      `npm run fpfn` (0 false positives, unchanged). CRLF-only noise in
      `src/rules/wrapper-dnr-rules.json` reverted (unrelated to this change).
- [x] T7 — ADR-0010 "slice 3" status updated from "out of scope" to shipped,
      with the real measured numbers.
- [x] T8 — Final report delivered to the requester.

## Acceptance criteria

- New landable path-anchored facts appear in `src/rules/domain-rules.json`'s
  `pathStrips` for real hosts, guard/denylist/preserve-filtered, capped at the
  DNR rule limit, with a dry-run report before any write.
- `pathAnchorSkipped`'s value for a fixed input is unchanged from before this
  change (regression-pinned by existing + new tests).
- No affiliate/denylist/preserved param is ever landed (tested).
- Re-running the importer against unchanged upstream data is a no-op (byte
  identical store).
- `npm test` green; `rules-store-roundtrip.test.mjs` still proves lossless
  round-trip.

## Checks

- `npm test`, `npm run lint:js`, `npm run typecheck`
- `npm run compile:rules`, `npm run build:dnr`, `npm run build:content`,
  `npm run build:web` (commit regenerated artifacts; revert CRLF-only noise
  via `git diff --ignore-cr-at-eol`)
- `npm run fpfn` (rules/cleaner.js changed)
- Known flake: `sign-rules.test.mjs` under full-suite load (not blocking).
- Real Chromium DNR behaviour (priority disjointness, `urlFilter` matching)
  cannot be validated by unit tests alone — only the CI e2e
  (`tests/e2e/scoped-dnr-rules.spec.mjs`-style) proves it live; noted as a
  residual gap, not fixed in this slice.

TDD: off by project config; runner `npm test` (node --test). RED observed
before GREEN for parsing/filtering logic added in this slice.

## Progress

- 2026-09-24: T1 done (this file). T2 done — fetched today's AdGuard Filter
  17 live and measured with a throwaway script reusing the real guard/deny
  sets: 463 path/query-anchored lines (matches issue's own count exactly);
  after excluding query-anchors/wildcard hosts (211) and non-literal path
  shapes (64), 187 raw (host,path,param) facts / 155 distinct params / 56
  distinct hosts; after excluding already-global (3) and
  guard/denylist/preserve (mostly denylist: from, hl, id, locale, origin, p,
  q, query, s, state, t, time, timezone, uid, url, userid; guard: aff,
  clickref, sid, u): 149 landable facts / 130 distinct params / 45 distinct
  hosts / 50 distinct (host,pathPrefix) DNR-rule groups. 50 + google.com's
  existing 2 = 52, well under the 100-rule cap — no cap-raising decision
  needed. T3 done: `pathAnchored` field added to `parseRemoveparamRules`,
  RED observed (reverted implementation, 9 new tests failed as expected),
  then GREEN (45/45 passing). `PATH_PREFIX_RE` exported from
  `tools/rules-store.mjs`; `fetchAdGuardFilter17` exported from
  `tools/import-upstream.mjs` for reuse.
- 2026-09-24 (continued): T4 done — `tools/import-path-anchors.mjs` (pure
  filter/group/select/apply functions + dry-run/`--apply` CLI), RED observed
  (module missing, 1 failing suite), then GREEN (22/22 passing). T5 done —
  first dry run matched the earlier measurement (50 groups); the real
  `--apply` run then surfaced a real bug the earlier throwaway script had
  not modeled: `||game-i.daa.jp/?cmd=ad_mode$removeparam=cmd` computes an
  empty path token, i.e. a "/" prefix, which matches every path on the host
  — fixed at the source (own commit + regression test), re-measured. Final
  real numbers: 177 raw path-anchored facts parsed; excluded — alreadyGlobal
  3, AFFILIATE_PARAM_GUARD 4 (`aff`, `clickref`, `sid`, `u`), REMOTE_PARAM_
  DENYLIST 25 (`from`, `hl`, `id`, `locale`, `origin`, `p`, `q`, `query`,
  `s`, `state`, `t`, `time`, `timezone`, `uid`, `url`, `userid`, …), host
  preserve 2; landed 46 new `(host, pathPrefix)` groups across 37 new
  `domain-rules.json` hosts (252 → 289 entries). DNR path-scoped rule count:
  48/100 (`DNR_PATH_SCOPED_MAX_RULES`) — no cap-raising decision needed.
  `tools/rules-source/params.json` (signed remote channel) untouched, per
  ADR-0010 decision 5. config-integrity.test.mjs and domain-rules.test.mjs's
  preserve-or-strip checks extended to accept pathStrips-only entries;
  CONTEXT.md/README counts updated. T6: full suite green (8137/8138 pass, 1
  pre-existing skip), lint:js clean, typecheck clean, fpfn 0 false
  positives (unchanged). T7: ADR-0010 status updated to shipped. Idempotency
  verified: a second `--apply` run against unchanged upstream wrote nothing
  ("0 new group(s)").
