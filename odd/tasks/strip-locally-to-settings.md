# Strip locally moves to Settings (#1351)

## Objective

Split the popup's "Suspicious params" collapsible per the 2026-09-24
maintainer decision below: the ENTROPY subgroup stays in the popup,
READ-ONLY, no action. The FREQUENCY subgroup and every action that writes
`userCustomRules` ("Strip locally", now "Strip everywhere" for clarity, and
"Report upstream") move into Settings' Activity section (`#section-activity`,
built by #1350/PR #1365), per ADR-0011 Decision 1 and Decision 3. This is the
third of four ADR-0011 slices (#1350-#1353); only #1351 is in scope here.

## Problem

`showSuspiciousParams` (`src/popup/popup.js:934-1083`) and its four helpers
— `_appendStripLocallyButton` (`:1099`), `_appendReportUpstreamButton`
(`:1194`), `_renderStripLocallyCount` (`:1281`), `_flashStripLocallyMessage`
(`:1322`) — render in the popup. `_appendStripLocallyButton`'s click handler
writes `userCustomRules` to `chrome.storage.sync`, a rule that strips on
**every host**. ADR-0011 names this "the single most consequential action
the product offers", currently reachable from a surface tuned for a
two-second glance. The receipt for that action (`#user-custom-rules` in
`options.html:109-117`, from #1271 item 4) already lives in Settings; the
action itself does not, so `_renderStripLocallyCount` carries a deep link
(`popup.js:1300`) back to a section the user could otherwise not reach. Once
the action lives next to its receipt, that link is redundant.

## Maintainer decision (2026-09-24)

Raised as a blocking question before implementation: `findSuspiciousParams(url)`
(entropy subgroup) scores the params of ONE specific URL — the popup's
`chrome.tabs.query({active:true, currentWindow:true})`, i.e. "the page you
have open right now". Settings has no equivalent "current page" (it opens in
its own tab). Neither ADR-0011 nor issue #1351 addresses this.

**Decision**: the entropy subgroup stays in the popup as READ-ONLY
information about the current page (it fits the popup-as-glance test), with
NO button there that writes a global rule. The frequency subgroup and every
action that writes `userCustomRules` (the global strip rule) move to
Settings. So: popup keeps an entropy list with no strip/report actions;
Settings' Activity section gets the frequency subgroup plus the "strip
everywhere" and "report upstream" actions, with clear scope copy. Also: a
parallel branch (#1353) adds `#section-report` right after `#section-activity`
in `options.html` — this change touches only its own panel inside
`#section-activity`, nothing in that area, to keep the eventual merge simple.

Consequence for copy: the popup's "Strip locally" button label was already
misleading (the rule it wrote was global, not local) — this is exactly the
"clear copy about its scope" the issue asks for, so the button is renamed
`strip_globally_btn` ("Strip everywhere") rather than carried over verbatim.
`report_upstream_btn`/`report_upstream_already_reported` and the frequency
group's labels move unchanged. Report-upstream is dropped from the popup's
entropy rows entirely (not just the strip action) — entropy-flagged params
were already rarely in the tracker store the report form reads from (see
the removed `_appendReportUpstreamButton` doc comment), so report-upstream's
natural home is exclusively with the frequency rows that moved to Settings.

## Scope

In scope:
- Extract the pure, testable row/shape logic for the SETTINGS-side frequency
  panel (domains/values shaping, `isPromoted`/`reportedDate` derivation) into
  `src/lib/suspicious-params-view.js`, following the `domain-stats-view.js` /
  `remote-rules-changelog-view.js` / `attribution-ledger-view.js` precedent
  (`options.js`/`popup.js` are browser-only, can't run under `node:test`).
  The entropy subgroup needs no such module — it stays a straight render of
  `findSuspiciousParams()`'s own output, same as before.
- `popup.js`: simplify `showSuspiciousParams` to entropy-only, read-only rows
  (name + score). Delete `_appendStripLocallyButton`, `_appendReportUpstreamButton`,
  `_renderStripLocallyCount`, `_flashStripLocallyMessage` entirely, their call
  sites, and the `userCustomRules`-triggered re-render branch in the
  `storage.onChanged` listener (no longer relevant once entropy has no
  buttons). Retire the dead deep link (`popup.js:1300`, `strip_locally_manage`)
  along with `_renderStripLocallyCount`.
- `popup.html`: drop `#strip-locally-count`; keep `#suspicious-params` /
  `#suspicious-params-list` (still hosts the entropy rows).
- `options.html`: a new panel inside `#section-activity`, alongside
  `#domain-stats-panel` — `suspicious-params-panel` (own id, avoiding a
  collision with the popup's `#suspicious-params`, same pattern #1350 solved
  for domain stats). Includes a scope-hint line for the strip action.
- `options.js`: render the frequency panel (per-row "Strip everywhere" +
  "Report upstream" actions, same idempotent done/already-reported states as
  the popup had), wired at init and after import; the strip action uses the
  existing `withSyncMutation`/`withListLock` race-safe pattern (same lock
  `addEntry`/`removeEntry` already share for `userCustomRules`), reusing
  `addUserCustomRule` from `src/lib/user-custom-rules.js`.
- **Per-panel section visibility**: `#section-activity` currently hides
  entirely when `prefs.domainStats` is off (`options.js` `renderDomainStatsActivity`,
  a known gap flagged in `odd/tasks/settings-activity-home.md`'s "Notes for
  the next slice"). Refactored so each panel owns its own `hidden` state and
  the section hides only when **every** panel inside it is hidden.
- Guard tests: no duplicate DOM ids across `options.html`, a test asserting
  `userCustomRules` can no longer be written from popup.js (per the issue's
  closing condition), and a test for the per-panel Activity visibility rule.
- i18n: reuse `suspicious_params_frequency_group`, `suspicious_params_freq_detail`,
  `report_upstream_btn`, `report_upstream_already_reported`, `list_full`,
  `entropy_score_label`, `suspicious_params_entropy_group`,
  `suspicious_params_label` (entropy-only now, text still accurate). Remove
  now-orphaned `strip_locally_btn`, `strip_locally_btn_done`,
  `strip_locally_active_count`, `strip_locally_manage` (the i18n-orphan test
  forbids unreferenced keys). Add `strip_globally_btn`, `strip_globally_btn_done`,
  `suspicious_params_settings_hint`, `suspicious_params_settings_empty` — all
  7 locales, es = peninsular Spanish, no em-dashes, `t()` has no interpolation.

Out of scope (separate issues, do not implement): session/recent-activity
ledgers (#1352), report flow / `#section-report` (#1353).

## Constraints

- Conventional Commits, work-unit sized, NEVER Co-Authored-By / AI
  attribution. No push/PR.
- TDD: off by project config; runner `npm test`
  (`node --test tests/unit/*.mjs`). Red-green discipline still applied
  per-change (failing test observed before the new view module exists).
- Any new/changed visible string: all 7 locales in `src/lib/locales/*.mjs`;
  es = peninsular Spanish; no em-dashes; keep MUGA's URL-cleaner identity;
  `t()` has no interpolation.
- Writing `userCustomRules` (a global strip rule) must stay an explicit,
  deliberate user action with clear copy about its scope, in its new home.
- ~400 authored changed lines/task is advisory only, not a hard cap.

## Checklist

- [x] T1 — Feature document created and committed alone.
- [x] T2 — Maintainer decision recorded (see above); unblocked.
- [x] T3 — `src/lib/suspicious-params-view.js` pure module (Settings-side
      frequency row shaping) + RED-first unit test.
- [x] T4 — `popup.js`/`popup.html`/`popup.css`: simplified to entropy-only,
      read-only; deleted the 4 strip/report helpers, their call sites, the
      dead deep link, and their CSS; dropped the `userCustomRules` reactive
      re-render branch.
- [x] T5 — `options.html`: `suspicious-params-panel` inside
      `#section-activity` with scope-hint copy; locale keys added/removed
      in all 7 locales.
- [x] T6 — `options.js`: renders the frequency panel + strip-everywhere +
      report-upstream actions (via `withSyncMutation`/`withListLock`), wired
      at init and after import; `#section-activity` visibility is per-panel
      (hide iff all panels hidden).
- [x] T7 — Guard tests: no duplicate ids, `userCustomRules` unwritable from
      popup.js, per-panel Activity visibility; superseded
      `popup-strip-locally-button.test.mjs` / `popup-report-upstream-button.test.mjs`
      replaced by options-side equivalents; `popup-suspicious-section.test.mjs`
      rewritten for the entropy-only, read-only contract.
- [x] T8 — Full check suite green (see Progress).

## Delivery: re-sliced into stacked PRs (2026-09-24)

The single-branch delivery above landed as one ~1900-line diff against
`origin/main`. The maintainer chose **stacked PRs to main** (over the
~400-line budget) and asked for the SAME final result re-sliced into three
sequential, independently-green branches, each built on the previous one.
Re-slicing did not change one line of the final result — it only changed
which commit each already-written line landed in. The three branches:

1. **`feat/1351-a-view-model`** (on `origin/main`) — `src/lib/suspicious-params-view.js`
   + its RED-first unit test, pure and unwired, plus the two feature-doc
   commits (plan + maintainer decision). +341 lines vs `origin/main`.
2. **`feat/1351-b-settings-panel`** (on slice A) — the Settings-side build:
   `suspicious-params-panel` in `#section-activity`, `updateActivitySectionVisibility()`
   (per-panel visibility), the new locale keys (`strip_globally_btn`/`_done`,
   `suspicious_params_settings_hint`/`_empty`) added ALONGSIDE the still-live
   popup `strip_locally_*` keys, and the options-side tests. The popup keeps
   its original "Strip locally" behaviour unchanged at this point —
   deliberate, temporary duplication so this slice is green on its own.
   +897 lines vs slice A (over the ~400 advisory budget: kept as one
   cohesive commit rather than split, since options.html/options.js/options.css
   and their tests are one indivisible unit of behaviour — reported honestly
   rather than force-split or trimmed).
3. **`feat/1351-c-popup-retire`** (on slice B) — retires the popup's
   strip/report actions: `popup.js`/`popup.html`/`popup.css` become
   entropy-only and read-only, the four helpers + dead deep link + their CSS
   are deleted, the now-orphaned `strip_locally_*` keys are removed from all
   7 locales, the two superseded popup-side test files are deleted, and the
   "`userCustomRules` can no longer be written from the popup" guard (the
   issue's explicit closing condition) is added. This branch's tree is
   byte-identical to the original single-branch tip (verified via
   `git diff <original-tip> feat/1351-c-popup-retire --stat`, empty except
   for this doc's own narrative, which was rewritten to describe the
   3-slice delivery instead of the 1-slice one).

Each branch was verified green at its own tip: `npm test`, `npm run lint:js`,
`npm run typecheck`, `npm run check:i18n` (see Progress for exact numbers).
Delivery (push/PR) is a separate, later decision under ordinary repository
policy — this pass only re-sliced the already-authored commits.

## Acceptance criteria (from issue #1351)

> The suspicious-params breakdown and both of its actions living in Settings
> next to the locally-stripped list, the popup rendering neither, and a test
> asserting `userCustomRules` can no longer be written from the popup.

## Applicable checks

`npm test`, `npm run lint:js`, `npm run typecheck`, `npm run check:i18n`,
`npm run lint` (web-ext; run without piping to `head`, then verify
`git diff --quiet src/manifest.json`). Check `tests/e2e/` for any spec
covering the popup's suspicious-params panel and update/run it if found
(known flake: `tests/unit/sign-rules.test.mjs` under full-suite load, passes
isolated).

## Native review fixes (R3, 2026-09-24)

Native review of slices A+B was APPROVED (acknowledged), with three
advisories fixed here, as one commit on top of `feat/1351-b-settings-panel`:

1. **R3-render-interleave** (`renderSuspiciousParamsActivity`) — the
   function cleared the list, then awaited storage twice; two overlapping
   calls (a toggle flip mid-render, a rapid re-render after import) could
   interleave rows or leave the list empty under a fresher call. Fixed with
   the same run-counter/`isStale()` pattern `initReportFlow`'s
   `runReportUrlCheck` already uses (#1353), module-scoped since this
   function (unlike that one) is called from several independent sites.
   The list is now cleared+filled exactly once, after every await, only if
   the call is still the latest one.
2. **R3-strip-silent-noop** (`buildStripGloballyButton`) — the click
   handler returned silently on a duplicate, an aborted write, or any
   non-"max" error; the button was never disabled while the write was in
   flight; and the row's `isPromoted` state came from a render-time
   snapshot that can go stale by click time. Fixed: `btn.disabled = true`
   before the write starts; an explicit `error === "duplicate"` branch now
   flips to the done state (visible feedback) instead of a no-op; a new
   `strip_globally_error` toast (all 7 locales) covers a genuine failure,
   re-enabling the button so the user can retry; the whole handler is
   wrapped in try/catch. `withSyncMutation` already re-reads the current
   list right before `addUserCustomRule` decides, so the fresh-read
   requirement was structural already — the bug was the missing feedback
   on that fresh check's "duplicate" outcome, not a stale read.
3. **R3-tautological-deeplink-tests** — the Report-upstream deep-link URL
   construction (the 50-domain cap, the never-leak-hashes/timestamps
   contract) lived inline in `buildReportUpstreamButton`, and its test
   rebuilt the SAME logic independently rather than calling the real code.
   Extracted into `src/lib/tracker-flag-deeplink.js`
   (`buildTrackerFlagDeepLinkUrl`, RED-first unit test), and
   `options-report-upstream-button.test.mjs` now only pins that
   `buildReportUpstreamButton` calls the real helper.

RED-first observed for #1 (structural run-counter/isStale assertions failed
against the pre-fix source) and #3 (`ERR_MODULE_NOT_FOUND` before the
module existed). #2 is a click-handler behavioural fix without a
runnable-before-fix harness (options.js is browser-only, same constraint as
every other options.js test in this suite); its structural tests were
written and verified against the fixed code, then checked to genuinely
distinguish old from new behaviour (each assertion targets a specific
line/branch the old code lacked).

Because slice C did not touch `options.js` (it only retires the popup), this
fix commit lands on B and slice C is rebased onto the new B tip with
conflicts limited to the shared locale files and the two Settings-side test
files C also touches (adding back its own deferred assertions) — resolved
by keeping both slices' additions.

## Progress

- 2026-09-24: Explored issue #1351 (with comments — none), ADR-0011, the
  merged #1350/PR #1365 precedent (`odd/tasks/settings-activity-home.md`,
  `src/lib/domain-stats-view.js`, `options.html`/`options.js` Activity
  section), `popup.js` (`showSuspiciousParams` + 4 helpers,
  `entropy-heuristic.js`, `cross-site-frequency.js`), and the existing
  structural tests (`popup-suspicious-section.test.mjs`,
  `popup-strip-locally-button.test.mjs`,
  `popup-report-upstream-button.test.mjs`). Found the entropy-subgroup /
  current-tab gap above and stopped to ask before implementing the panel.
- 2026-09-24: Maintainer decision received (recorded above). Proceeding with
  T3 onward. Implemented T3-T8 as a single-branch delivery (`npm test`
  8107/8107 pass + 1 known skip, `lint:js`/`typecheck`/`check:i18n` clean,
  `lint` web-ext 0 errors, manifest untouched); ~1900 lines vs `origin/main`.
- 2026-09-24: Re-sliced into stacked PRs per maintainer request (see
  "Delivery: re-sliced into stacked PRs" above). Checks at each tip:
  - `feat/1351-a-view-model` (+341 vs `origin/main`): `npm test` 8115/8115
    pass + 1 skip; `lint:js`/`typecheck`/`check:i18n` clean.
  - `feat/1351-b-settings-panel` (+897/-12 vs slice A): `npm test`
    8170/8170 pass + 1 skip; `lint:js`/`typecheck`/`check:i18n` clean.
  - `feat/1351-c-popup-retire` (tree identical to the original single-branch
    tip except this doc): `npm test` 8142/8142 pass + 1 skip (matches the
    pre-reslice baseline exactly); `lint:js`/`typecheck`/`check:i18n` clean.
  Identical-tree check: `git diff --cached <original-tip> --stat` at slice
  C showed only `odd/tasks/strip-locally-to-settings.md` differing (this
  doc's own narrative); every source/test file byte-identical.
- 2026-09-24: Coordinator rebased the stack onto a newer `origin/main`
  (a=92300b0, b=9369689, c=e536813). Native review of A+B approved with 3
  advisories (see "Native review fixes" above), fixed as one commit on top
  of B; checks at the new B tip: `npm test` 8228/8228 pass + 1 skip;
  `lint:js`/`typecheck`/`check:i18n` clean. `feat/1351-c-popup-retire`
  rebased onto the new B tip, resolving conflicts in this doc and the two
  Settings-side test files C also touches (kept both slices' additions in
  each case — see final tip hashes/counts reported to the user).
