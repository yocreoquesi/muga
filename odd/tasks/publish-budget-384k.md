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
- [x] T2 Run `--prefer-anchors` (#1344), verify orphans do not rise and the
  scoped DNR rules stay within 2000, update tests to the relocated state.
  Route: delegated (same writer).

- [x] T3 Make the weekly auto-ingest preserve the #1344 relocation. The
  first post-merge ingest (run 35921813206) failed `npm test`: the pipeline
  re-added the 62 relocated params to the global list, the circularity #1344
  itself described ("hand-removing them is undone by the next ingest").
  Route: delegated (writer; exploration of the ingest pipeline spans 4+ files).

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
  Commit: d6bdec4.
- 2026-09-23: T2 closed. Ran `node tools/build-rules-store.mjs
  --prefer-anchors`: relocated 62 params (see full list in the CLI output /
  final report), 0 deferred, orphans 0 -> 0, 338518 bytes left in the 384 KB
  budget. `tools/rules-source/params.json` version bumped 14 -> 15 (one
  content-changing bump for this commit's own params[] change, on top of
  T1's own 13 -> 14 bump for its scoped[] change — two genuine payload
  changes across two commits, each following the tool's own documented
  "bump on a change to params[]/scoped[]" rule, not a single change bumped
  twice).
  Verified: all ten #1228 params (igsh mibextid smid campaign crid igshid
  n_cid ocid share_id trk) are out of the global list and present as scoped
  facts. `npm run compile:rules` + `npm run build:dnr` produced only
  CRLF-only noise (empty under `--ignore-cr-at-eol`) on
  src/rules/{rules-manifest,tracking-params,wrapper-dnr-rules}.json —
  reverted via `git checkout`, since those three derive from the BUNDLED
  `TRACKING_PARAMS`, not the remote channel this change touches. Measured
  the generated scoped DNR rule groups (`buildScopedDnrRules` over the
  published `scoped` section): 459 groups, well within
  `DNR_SCOPED_PARAMS_MAX_RULES` = 2000.
  Updated `tests/unit/channel-prefers-anchors.test.mjs` again for the
  applied (not just dry-run) state: the "62 candidates" test now asserts a
  safe idempotent no-op re-run (0/0/0); the "ten params" naive-eviction test
  reconstructs the pre-relocation global list (the ten no longer appear in
  the real committed global list at all) and remeasures under the synthetic
  50 KB ceiling — 13 unrelated params evicted (was 14 pre-relocation; the
  real global list is now 62 entries shorter, which shifts the exact byte
  cutoff); the "ten host-anchored params" describe block now asserts they
  are out of global, present as scoped, and a no-op on a fresh run.
  Checks green again: `npm test` (7985 pass, 1 pre-existing skip), `npm run
  check:rules-store`, `npm run lint:js`, `npm run typecheck`, `npm run
  compile:rules` + `npm run build:dnr` (no unexpected diff).
  Commit: d343941 (fix(rules): relocate host-anchored params ... #1344).

- 2026-09-23: Native review (medium, lineage review-70037cfeea8cda79)
  granted and approved, acknowledged. Advisory follow-ups applied in a
  separate commit: the naive-eviction test asserts the property (> 0 evicted)
  instead of pinning 13; the orphan bisection asserts its endpoints; a new
  guard in rules-store-roundtrip.test.mjs asserts the committed scoped section
  compiles to fewer than DNR_SCOPED_PARAMS_MAX_RULES rules. `npm test` 7988
  pass / 0 fail; lint:js and typecheck clean. Known flake:
  sign-rules.test.mjs fails intermittently under full-suite load on Windows
  (passes 5/5 isolated, seen on main-based branches too).
  Open advisory: R3-legacy-cap-exceeded (the payload now exceeds 3.0.x's 50 KB
  cap; adoption rests on the maintainer's report).

- 2026-09-23: PR #1358 and #1359 merged; channel v15 live at
  rules.muga.app (53403 bytes, both signatures, `trk` not global). Manual
  auto-ingest dispatch failed `npm test` (T3 opened).

- 2026-09-23: T3 closed. Mapped the write path first: `promote-rules.mjs`
  reads `params.json` and the store directly (not via `build-rules-store.mjs`),
  merges upstream's `art.params` (which `parseRemoveparamRules`'s design
  correction C1 folds a host-anchored name into, by design — C1 is still
  right, see tools/import-upstream.mjs) into the global list, and writes both
  files itself; `land-scoped.mjs` then calls `build-rules-store.mjs`'s
  `writeAll`, which re-renders `params.json`'s `scoped` section from
  whatever the store's global list is AT THAT POINT — so a param promote just
  re-added gets re-shadowed by `withoutGloballyShadowed`, exactly reproducing
  the circularity #1344 already named.

  Chose approach (b): wired `node tools/build-rules-store.mjs
  --prefer-anchors` into `.github/workflows/auto-ingest-rules.yml`, as a new
  step after land-scoped and before the gates/publish, gated on
  `steps.pipeline.conclusion == 'success'` (matching land-scoped, not the
  global `noop` signal — the failure mode is a promote run that reports
  non-noop while still being wrong). Its own `changed` output (new
  `GITHUB_OUTPUT` emission in `build-rules-store.mjs`'s CLI, mirroring
  land-scoped's) feeds the combined `steps.work.outputs.any` decision.
  Rejected approach (a) (excluding a param from promote's merge via the raw
  3-part predicate): it would decide admission WITHOUT the orphan/budget
  check `computeAnchorPreference` already does, risking a real orphan on a
  future saturated budget, and would duplicate logic. `--prefer-anchors`
  already derives candidates live from the store, is already proven
  orphan-safe (`channel-prefers-anchors.test.mjs`), and a no-op run writes
  nothing / bumps no version — so composing it after promote+land-scoped is
  the smallest correct fix, reusing tested code instead of adding a second
  admission path.

  RED: added a "T3 (#1344)" describe block to
  `tests/unit/ingestion-scheduled-workflow.test.mjs` asserting the
  `--prefer-anchors` step exists, runs after land-scoped and before the test
  gate and the publish step, is gated like land-scoped (not on the global
  noop), and feeds the combined signal. Verified RED by stashing the fix and
  running `node --test tests/unit/ingestion-scheduled-workflow.test.mjs`: 4
  failures. Restored the fix: `node --test` on that file passes (38/38).
  Also added a function-level regression test in
  `tests/unit/channel-prefers-anchors.test.mjs` ("T3 (#1344) — a param
  promote re-globalizes is relocated back out on the next run") that builds a
  post-relocation store, simulates promote's re-add via `withGlobalParams`,
  and asserts `computeAnchorPreference` relocates it back out with orphans
  unchanged and a stable idempotent second run — passes.

  Real-pipeline reproduction (scratch git worktree at commit 1b82b2d, under
  the session scratchpad, `npm ci` + a throwaway ed25519 key added to
  `TRUSTED_PUBLIC_KEYS` INSIDE THAT WORKTREE ONLY, never committed):
  `MUGA_SIGNING_KEY_PATH=... npm run pipeline:rules` (promote wrote v15->16,
  +60 net params) then `node tools/rule-ingestion/land-scoped.mjs --report
  ...` (1517 facts landed, 58 new) then `npm test` — **7989 tests, 32
  failing**, all in `channel-prefers-anchors.test.mjs` (igsh, mibextid, smid,
  campaign, ... back in the global list — the exact run-35921813206 failure).
  Then `node tools/build-rules-store.mjs --prefer-anchors` (the step the fix
  adds): relocated the same 62 params, orphans 0->0, 336932 bytes left in
  budget. `npm test` again — **7989 tests, 0 failing** (1 pre-existing skip).
  Worktree and throwaway key deleted afterward (`git worktree remove` hit a
  Windows long-path error on the nested `node_modules`; emptied it with
  `robocopy /MIR` against an empty dir first, then `rm -rf` + `git worktree
  prune` — confirmed gone from `git worktree list`).

  On the branch: `npm test` 7994/7993 pass (1 pre-existing skip, no flake
  observed), `npm run check:rules-store` clean (informational inert-facts
  line only, no drift), `npm run lint:js` clean, `npm run typecheck` clean.
  No CRLF or generated-file noise (`git diff --stat -- tools/rules-source/
  src/rules/ docs/rules/` empty — this task never ran compile:rules/build:dnr
  since nothing here touches TRACKING_PARAMS).

  Files changed: `.github/workflows/auto-ingest-rules.yml` (new
  `prefer_anchors` step + updated combined-signal step + header comment),
  `tools/build-rules-store.mjs` (GITHUB_OUTPUT `changed=` emission for
  `--prefer-anchors`), `tests/unit/ingestion-scheduled-workflow.test.mjs`,
  `tests/unit/channel-prefers-anchors.test.mjs`.

  Commit: 9b19158 (fix(rules): keep the #1344 relocation across ingest runs).

- 2026-09-23: T3.1 (coordinator review finding). Concern: in steady state,
  promote re-adds the same 62 relocated params every week (C1), so pipeline
  `noop` reads `false` and `--prefer-anchors` relocates 62 every week
  (`changed: true`) forever, even once net content stops moving — and each
  step's own version bump stacks (promote +1, prefer-anchors +1) into one run.
  Measured, not reasoned about: scratch worktree at 741bd57 (T3's commit,
  before this fix), throwaway key trusted in that worktree only. Week 1
  (`pipeline:rules` -> `land-scoped.mjs` -> `--prefer-anchors`, then committed):
  pipeline noop=false (v15->16, +60 net), land-scoped changed=true (58 new
  facts), prefer-anchors relocated 62, final version 17 (a STACKED double
  bump: 15->16->17). Week 2 (same sequence again, same live upstream,
  uncommitted): pipeline noop=false again (v17->18, +62 net — the same 62
  params look "new" against the post-relocation list), land-scoped
  changed=false (0 added — the 58 facts were already landed), prefer-anchors
  relocated the SAME 62 params again, final version 19 (another stacked
  bump). `git diff --stat tools/rules-source` after week 2: only
  `params.json`, 2 lines (version/published) — `rules.json` byte-identical to
  week 1's commit, `params.length` 94 both weeks, `scoped.length` 1017 both
  weeks. Confirmed: a true net no-op, but the workflow (as T3 shipped it)
  would have signed, published and auto-merged a new version anyway.

  Fix: added `tools/rule-ingestion/reconcile-net-change.mjs` — compares the
  working tree's `params.json` (ignoring `version`/`published`/`sig` via
  `normalizeParamsForCompare`) and `rules.json` (byte-for-byte) against
  `git show HEAD:...`. Identical: `git checkout -- tools/rules-source`
  (restore, discard the run's bumps), report `changed:false`. Different:
  `withVersion` surgically rewrites ONLY the top-level `"version"` field
  (never re-`JSON.stringify`s the whole file, which would blow away
  `renderParamsFile`'s one-fact-per-line `scoped` formatting) to exactly
  `HEAD`'s version + 1, collapsing any stacked bump to one. Wired into
  `.github/workflows/auto-ingest-rules.yml` as a new `reconcile` step after
  `--prefer-anchors` and before the work-decision step; that step's `ANY` is
  now assigned directly from `steps.reconcile.outputs.changed`
  (`ANY="$RECONCILED"`) instead of OR-ing the raw `GLOBAL`/`SCOPED`/`ANCHORS`
  signals — OR-ing `GLOBAL` back in would have reintroduced the exact bug,
  since it reads `false` every week in steady state regardless of net
  content. GLOBAL/SCOPED/ANCHORS are kept and logged for observability, not
  removed. Corrected the prefer-anchors step's own comment, which had claimed
  "a run that relocates nothing... stays a true no-op end to end" — that
  never actually triggers once #1344's candidates exist, since prefer-anchors
  relocates the same params every week; reconcile is what achieves
  quiescence, not prefer-anchors's own no-op case.

  RED: `tests/unit/rule-ingestion-reconcile-net-change.test.mjs` written
  first — ran against a temporarily-moved-away module file (`ERR_MODULE_NOT_FOUND`,
  1 fail), then against the real module (13/13 pass, including a stacked-bump
  regression test asserting HEAD=15/current=17 collapses to 16, and a pinned
  edge case for the real committed scoped fact `{"param":"version",...}` never
  being mistaken for the top-level field). Added a "T3.1" describe block to
  `tests/unit/ingestion-scheduled-workflow.test.mjs` (step exists, ordered
  after prefer-anchors and before the decision step, gated like land-scoped,
  `ANY` derived from `RECONCILED` not the old GLOBAL-OR, superseded comment
  text gone): 5 failures against the pre-fix workflow, 44/44 after.

  Re-measured post-fix (fresh scratch worktree at 5da93af, same throwaway-key
  protocol): week 1 — pipeline v15->16, prefer-anchors relocated 62,
  reconcile "net content differs from HEAD — version set to 16" (collapsed
  the stacked 15->16->17 to a single 16), committed. Week 2 — pipeline
  v16->17 (+62 net, same C1 re-offer), land-scoped changed=false,
  prefer-anchors relocated the same 62, reconcile "net content identical to
  HEAD ... restored tools/rules-source to HEAD, nothing to publish this run".
  `git status --short` after week 2: clean under `tools/rules-source/`;
  committed version stayed 16. Week 2 is now a true no-op; week 1 still
  publishes with exactly one version bump.

  Checks: `npm test` 8014/8013 pass (1 pre-existing skip, no flake), `npm run
  check:rules-store` clean, `npm run lint:js` clean, `npm run typecheck`
  clean. No generated-file/CRLF diff. Both scratch worktrees and both
  throwaway keys deleted (`robocopy /MIR` against an empty dir, then `rm -rf`
  + `git worktree prune`; confirmed gone from `git worktree list`).

  Files changed: `tools/rule-ingestion/reconcile-net-change.mjs` (new),
  `.github/workflows/auto-ingest-rules.yml` (new `reconcile` step, corrected
  `ANY` assignment, corrected comment), `tests/unit/ingestion-scheduled-workflow.test.mjs`,
  `tests/unit/rule-ingestion-reconcile-net-change.test.mjs` (new).

  Commit: 5da93af (fix(rules): guard the weekly ingest against #1344
  relocation churn).

## Next step

All three tasks closed and all checks lists green. Nothing outstanding for
this feature; #1344 is closed by this relocation and the weekly ingest now
preserves it. Delivery (push, PR) is the user's decision under ordinary
repository policy — not done by this agent.

## Related

- PR #1358 (#1357 fix: caret-terminated path anchors), independent.
