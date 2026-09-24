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

In progress — see final report for outcomes and live CLI output.
