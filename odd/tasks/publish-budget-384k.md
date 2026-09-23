# Feature: raise the publish budget to 384 KB and let #1344 relocate

## Objective

Use the headroom v3.1.0 bought. Raise `PUBLISH_PAYLOAD_BUDGET_BYTES` from 50 KB
to 384 KB, then run the #1344 anchor-preference relocation that the old budget
kept inert.

## Problem / why

- The budget sat at 51184/51200 bytes: 8 anchored facts were cut and every one
  of the 62 #1344 relocation candidates deferred.
- v3.1.0 (2026-09-11) ships `MAX_PAYLOAD_BYTES = 512 KB`. The maintainer reports
  the fleet is on 3.1 (2026-09-23), which is the precondition the budget
  docblock names (release → adoption → number).

## Scope

- `tools/build-rules-store.mjs`: budget constant and its comments.
- `tools/rules-source/params.json` / `rules.json`: regenerated projections,
  hand version bump for scoped-only changes.
- Tests that pinned the 50 KB saturation (`channel-prefers-anchors.test.mjs`,
  others the suite names).
- Out of scope: the runtime `MAX_PAYLOAD_BYTES`, DNR rule caps, #1326 slice 3.

## Constraints

- The orphan count must never rise (#1344 invariant).
- A published figure is never moved to pass a test; tests assert the new truth
  with measured numbers.
- The scoped DNR range holds at most `DNR_SCOPED_PARAMS_MAX_RULES` = 2000 rules;
  the generated ruleset must stay inside it.
- Merging to main publishes the signed channel (`publish-rules.yml`).

## TDD

Mode: off for this feature (no project TDD config; the change is a constant plus
a data regeneration). Runner: `npm test` (node:test). Ordinary checks apply.

## Tasks

- [x] T1 Raise the budget to 384 KB, rewrite the stale comments, bump
  params.json to version 14, regenerate projections, and update the tests that
  pinned the 50 KB saturation to the measured post-raise state.
  Route: delegated (writer; 2+ non-trivial files).
- [ ] T2 Run `--prefer-anchors` (#1344), verify orphans do not rise and the
  scoped DNR rules stay within 2000, update tests to the relocated state.
  Route: delegated (same writer).

## Checks

`npm test`, `npm run check:rules-store`, `npm run lint:js`, `npm run typecheck`,
`npm run compile:rules` + `npm run build:dnr` with no unexpected diff.

## Acceptance

- Budget is 384 KB; the committed payload fits it.
- The 8 budget-cut facts publish.
- #1344 candidates relocate where the invariant allows; orphans do not rise.
- All checks green.

## Progress

- 2026-09-23: T1 budget constant, comments and version bump written on
  `feat/raise-publish-budget-384k`; 13 saturation-pinned tests fail as
  expected. Handed to writer.
- 2026-09-23: T1 closed. Updated `tests/unit/channel-prefers-anchors.test.mjs`:
  - The real-store saturation test now asserts the measured truth (all 62
    qualifying candidates relocate cleanly, 0 stay global, orphans 0->0) —
    the 384 KB budget is no longer saturated.
  - The "ten #1228 params" naive-eviction demonstration now uses a local,
    budget-independent `SATURATED_BUDGET = 50 * 1024` constant (the old
    ceiling) instead of the module's own (now roomy) budget, reproducing the
    same 14-evicted-params/16-facts evidence deterministically.
  - The "ten host-anchored params" describe block renamed/reworded: they are
    now reported as `relocated` (dry-run) rather than `stayedGlobalForBudget`,
    while the committed store still carries them globally (relocation itself
    is T2's job).
  - The neighbour-eviction binary-search test: at 384 KB the naive
    `[0, PUBLISH_PAYLOAD_BUDGET_BYTES]` search range is no longer safe — past
    a point the BASELINE itself stops covering the neighbour
    (`orphansBefore` flips 0->1), after which `relocated` re-enters `1`
    (relocating no longer makes an already-broken baseline worse) before
    hitting 0 again at total exhaustion — a real, correct, non-monotonic
    admission-rule behavior the naive single-pass binary search wasn't
    built to see at this scale. Fixed by first bounding the search's `hi` to
    the tightest padding where `orphansBefore` is still 0 (found the same
    way), then binary-searching the `relocated` transition inside that
    bound. Verified this reproduces the exact original assertions (solo
    relocates, crowded defers, orphans unchanged).
  - Module docblock in `tools/build-rules-store.mjs` (the #1344 section) and
    the test file's own docblock updated to state the 2026-09-23 384 KB
    finding alongside the historical 50 KB saturation evidence.
  Checks green: `npm test` (7975 pass, 1 pre-existing skip), `npm run
  check:rules-store`, `npm run lint:js`, `npm run typecheck`.
  Commit: (recorded after commit — see below).

## Related

- PR #1358 (#1357 fix: caret-terminated path anchors), independent.
