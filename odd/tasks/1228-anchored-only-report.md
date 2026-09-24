# #1228 — automate anchored-only-global detection

## Objective

Close issue #1228 ("params in the global strip rule are only ever
host-anchored upstream") structurally: stop re-deriving the candidate list by
hand every few weeks (#1322/#1323/#1324/#1338/#1228-next-batch) and instead
ship a monthly automated report that finds them and surfaces a single
deduplicated tracking issue, per the maintainer's plan recorded in the
issue's final comment (2026-09-24).

## Problem

Every prior pass at this class used a throwaway measurement script (never
committed) to find `TRACKING_PARAMS` entries that AdGuard Filter 17 and
ClearURLs only ever anchor to a host or path, never strip globally. That
made each pass expensive and non-reproducible. The detection logic itself is
mechanical and testable; only the removal decision needs a human.

## Scope

1. Extend `parseRemoveparamRules` (`tools/import-upstream.mjs`) to also
   expose `bareNames`: names seen on at least one truly unanchored AdGuard
   line (neither a `||host^` anchor nor a `,domain=` modifier with at least
   one positive host). `params` keeps unioning bare + anchored names exactly
   as before (existing design, unchanged) — `bareNames` is additive.
2. Extend `tools/rule-ingestion/adapters/clearurls.mjs` with a function that
   splits ClearURLs facts by scope: the top-level `globalRules` (`.*`)
   provider's `rules[]` as compiled regex patterns (global evidence, tested
   full-match case-insensitive) versus every other provider's literal
   `rules[]` names (anchored evidence, provider key as the scope label).
3. New pure module `tools/anchored-only-globals.mjs` exporting
   `findAnchoredOnlyGlobals(trackingParams, adguard, clearurls, exclusions)`:
   a candidate is a current `TRACKING_PARAMS` entry with >=1 anchored
   mention and ZERO global mentions across both sources. Excludes
   `AFFILIATE_PARAM_GUARD`, `REMOTE_PARAM_DENYLIST`
   (`src/lib/remote-rules.js`) and `PATH_ANCHORED_STAY_GLOBAL` members.
4. Promote `PATH_ANCHORED_STAY_GLOBAL` from the test-local array in
   `tests/unit/removed-global-params-network-coverage.test.mjs` (~455) to an
   exported constant in `src/lib/affiliates-data.js`; update the test to
   import it (single source of truth, so nobody widens the exclusion list in
   one place without the other noticing).
5. CLI entry (`node tools/anchored-only-globals.mjs`) that fetches both
   sources live, prints the candidate report to stdout, and writes a JSON
   report + a Markdown issue body to disk for the workflow to consume.
   Network fetch failures must throw/exit non-zero — never a silent
   "0 candidates".
6. New monthly scheduled GitHub Actions workflow that runs the report and
   opens/updates one deduplicated issue (fixed title) when there are
   candidates, or closes it when there are none — mirroring
   `alert-on-failure.yml`'s dedupe/auto-close pattern. `GITHUB_TOKEN` only
   (`issues: write`, `contents: read`), no new secrets, never edits
   `TRACKING_PARAMS` automatically.
7. Register the new workflow in `alert-on-failure.yml`'s watched list so a
   silently-broken monthly job is itself alerted on, same as the other
   maintenance workflows.
8. Docs: short section in `CONTEXT.md` (where `auto-ingest-rules.yml`'s
   schedule is already documented) + this task file.

## Constraints

- TDD: off by project config; runner `npm test` (`node --test`). Detection
  logic (`findAnchoredOnlyGlobals`, the `bareNames`/ClearURLs-scope
  extensions) gets fixture-based unit tests written RED first regardless,
  per explicit instruction — a pure function with no existing coverage.
- Never auto-edit `TRACKING_PARAMS`, `TRACKING_PARAM_CATEGORIES`, or
  `hot-path-strip.js` from the workflow.
- No new secrets; `GITHUB_TOKEN` only.
- ~400 authored changed lines/task is advisory only.

## Checklist

- [x] T1 — `bareNames` on `parseRemoveparamRules`, tests RED then GREEN.
- [x] T2 — ClearURLs scope-split extraction in `clearurls.mjs`, tests RED
      then GREEN.
- [x] T3 — Promote `PATH_ANCHORED_STAY_GLOBAL` to `affiliates-data.js`;
      update the network-coverage test's import.
- [x] T4 — `findAnchoredOnlyGlobals` in new `tools/anchored-only-globals.mjs`,
      fixture tests RED then GREEN.
- [x] T5 — CLI wiring (fetch, report, JSON + Markdown output), `npm run
      anchored-only-report` script.
- [x] T6 — New monthly workflow (report + dedupe issue open/update/close).
- [x] T7 — Register the new workflow in `alert-on-failure.yml`.
- [x] T8 — CONTEXT.md doc section.
- [x] T9 — Run `npm test`, `npm run test:integration`, `npm run lint:js`,
      `npm run typecheck`; run the CLI once against live upstream and record
      its output in the final report.

## Acceptance criteria

- `findAnchoredOnlyGlobals` and the parser extensions are pure, fixture-
  tested, and covered by RED-then-GREEN evidence.
- `PATH_ANCHORED_STAY_GLOBAL` has one source of truth, imported by the test.
- The CLI runs standalone and fails loudly (non-zero exit) on network
  failure.
- The workflow never auto-edits `TRACKING_PARAMS` and dedupes on issue title.
- `npm test` and `npm run test:integration` green.

## Progress

Done. `parseRemoveparamRules` gained `bareNames` (RED-then-GREEN, 8 new
tests); `clearurls.mjs` gained `extractClearurlsScopeFacts` (RED-then-GREEN,
10 new tests); `PATH_ANCHORED_STAY_GLOBAL` promoted to `affiliates-data.js`
and imported by the network-coverage test (556 tests still green); new pure
module `tools/anchored-only-globals.mjs` (`findAnchoredOnlyGlobals` +
`renderIssueBody`, RED-then-GREEN, 16 new tests) plus its CLI entry and
`npm run anchored-only-report` script; new monthly workflow
`.github/workflows/anchored-only-globals.yml` (issues:write + contents:read
only, dedupe-by-title open/update/close, mirrors alert-on-failure.yml);
registered in `alert-on-failure.yml`'s watched list; CONTEXT.md documents
the schedule next to `auto-ingest-rules.yml`'s.

Checks: `npm test` 8479/8479, `npm run test:integration` 233/233,
`npm run lint:js` clean, `npm run typecheck` clean.

Live CLI run against real upstream (2026-09-24, first pass): 366
`TRACKING_PARAMS`, 9 candidates — `_sid`/`_ss` (ClearURLs: nordwolle.com),
`pk_kwd` (ClearURLs: vivaldi), `spjobid`/`spmailingid`/`spreportid`/
`spuserid` (ClearURLs: moosejaw.com), `tt_content`/`tt_medium` (ClearURLs:
twitch). All 9 were already-adjudicated names from #1228/#1374's own
history, not new signal — a noise bug in the first pass, fixed below.

**Follow-up fix (coordinator review):** promoted `HOT_PATH_REQUIRED` from
a test-local array in `strip-table-parity.test.mjs` to
`src/lib/hot-path-strip.js` (mirrors `PATH_ANCHORED_STAY_GLOBAL`'s
promotion) and added it as an exclusion — covers the Shopify `_sid`/`_ss`
false positive (a client-side-reinjectable name needs the synchronous
hot-path strip on every site, not a host-scoped substitute). Added a new
exported `ADJUDICATED_KEEP_GLOBAL` map in `affiliates-data.js` (7 entries:
`pk_kwd`, the `sp*` Silverpop family, `tt_content`, `tt_medium`), each with
a reason citing #1228 step 4 / #1374 or today's triage, pinned by a new
`tests/unit/adjudicated-keep-global.test.mjs` (non-empty reason + still in
TRACKING_PARAMS, so a stale entry fails loudly). `renderIssueBody`'s triage
steps now say how to add a new adjudicated entry. RED confirmed for both
new exclusion-wiring tests before implementing, then GREEN.

Re-run live CLI after the fix (2026-09-24): 366 `TRACKING_PARAMS`,
**0 candidates**. Checks: `npm test` 8497/8497, `npm run test:integration`
233/233, `npm run lint:js` clean, `npm run typecheck` clean (after fixing a
stale `buildExclusions()` JSDoc `@returns` the new fields tripped).

**Second follow-up fix (native review R3, on `feat/1228-a`):**
1. `main()` now refuses (non-zero exit) when parsed upstream looks
   degenerate: `assertAdguardNotDegenerate`/`assertClearurlsNotDegenerate`
   (new exports) check combined AdGuard fact counts and ClearURLs
   global/anchored counts against conservative floors
   (`MIN_ADGUARD_FACTS=500`, `MIN_CLEARURLS_GLOBAL_PATTERNS=15`,
   `MIN_CLEARURLS_ANCHORED=100`) derived from a live measurement
   (2026-09-24: 2322 AdGuard facts, 48 ClearURLs global patterns, 621
   anchored facts) — well below real counts so ordinary upstream drift
   never trips it, but an empty/truncated/HTML-200 response does.
2. `parseRemoveparamRules` gained `bareRegexes`: an UNANCHORED AdGuard
   regex removeparam spec (e.g. `/^at_custom/`) now counts as global
   evidence, full-match/case-insensitive (same convention as ClearURLs'
   `globalPatterns`), wired into `findAnchoredOnlyGlobals`. Required a
   correctness fix mid-implementation: a naive "whole spec as one regex,
   else split on `|`" approach either merged two top-level pipe-joined
   regexes into one nonsense pattern (greedy `.*`) or shredded a single
   regex's own internal alternation (`/tour|campaign/`) — replaced with a
   delimiter-state tokenizer (`splitOutsideRegexDelimiters`) that only
   splits on a `|` sitting outside a `/.../ ` pair. `skipped` still counts
   every regex/negation spec exactly as before (purely additive). Full-match
   is deliberately conservative relative to AdGuard's own prefix-style regex
   semantics — documented in the source, can under-count, never over-count.
3. New `buildExclusions (#1228 R3)` describe block: each of the 5 exclusion
   sources (`AFFILIATE_PARAM_GUARD`, `REMOTE_PARAM_DENYLIST`,
   `PATH_ANCHORED_STAY_GLOBAL`, `HOT_PATH_REQUIRED`,
   `ADJUDICATED_KEEP_GLOBAL`) is checked present in `buildExclusions()`'s
   output, plus one end-to-end test excluding a representative member of
   each through `findAnchoredOnlyGlobals`.

RED confirmed for all three fixes' new tests before implementing (module-
scoped `git stash` on `tools/import-upstream.mjs` for the regex fix; new
exports simply didn't exist yet for the other two), then GREEN. Checks:
`npm test` 8549/8549, `npm run test:integration` 233/233, `npm run lint:js`
clean, `npm run typecheck` clean. Live CLI re-run (2026-09-24): 362
`TRACKING_PARAMS`, **0 candidates**.
