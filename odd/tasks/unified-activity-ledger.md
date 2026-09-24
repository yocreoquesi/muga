# Unified Activity ledger (#1352)

## Objective

Close #1352: merge the popup's two ledgers ("This session" / `showHistory`
and "Recent activity" / `showRecentActivity`) into ONE Activity panel in
Settings (`options.html` `#section-activity`), with a scope control that
switches between the current session and recent activity. Remove both
ledgers from the popup entirely.

## Problem

ADR-0011 Decision 3 classified both as "a record, not a glance" and assigned
them to Settings, but left open whether they stay two panels. The maintainer
decided (2026-09-24, issue comment): **one Activity panel, one scope
control**, not two panels side by side.

Current state (re-verified against this worktree, ADR-0011's own line
numbers are stale by ~450 lines after #1350/#1351 shrank popup.js):

- **"This session"**: `showHistory` (`src/popup/popup.js:1052-1180`), reads
  `sessionStorage.get({history: []})` (`src/lib/storage.js:394`,
  `chrome.storage.session` ponyfill). Written by `appendHistory`
  (`src/background/service-worker.js:660-673`), capped at `HISTORY_MAX = 10`.
  **No pref gates recording** — it rides on the internal `!skipSideEffects`
  flag only (`process-url.js` step 9b).
- **"Recent activity"**: `showRecentActivity` (`popup.js:941-1049`), reads
  `chrome.storage.local.attributionLedger` via `presentLedger()`
  (`src/lib/attribution-ledger.js`) + `renderEntries()`
  (`src/lib/attribution-ledger-view.js`, already a pure, tested module — no
  changes needed there). Recording IS gated: `prefs.attributionLedgerEnabled`
  (default true), checked at `process-url.js:265`. The toggle already lives
  in Settings (`options.html` `#attribution-ledger` checkbox, Advanced >
  Developer tools > Privacy), wired at `options.js:362`. It only gates
  writes — the popup's old renderer never hid the section when the pref was
  off, and this change preserves that display behaviour exactly.
- Both are `<details>` panels in `popup.html` (history: `:82-85`, starts
  `hidden`; recent-activity: `:133-139`, does not start `hidden`, uses an
  empty-state paragraph instead). Their CSS lives in `popup.css`
  (`.history*` ~`:453-552`, shared `.history-breakdown` selector at
  `:671-690`, `.recent-activity*` ~`:843-949`). Both depend on popup-local
  clipboard helpers (`_setClipboardIcon`, `copyToClipboard`,
  `copyWithFeedback`, `getCopySafeCleanUrl`, `_renderParamBreakdown`) that
  exist ONLY for these two panels except `_renderParamBreakdown` /
  `_buildParamIndex`, which the per-page preview breakdown
  (`showUrlPreview`) also uses and which therefore stay in popup.js.
- `#section-activity` already exists (`options.html:132-152`, built by
  #1350/#1351) with two sibling panels (`domain-stats-panel`,
  `suspicious-params-panel`) and a shared
  `updateActivitySectionVisibility()` helper (`options.js:619-626`) that
  hides the section only when every panel is hidden.

## Scope

In scope:
- One new panel, `activity-ledger-panel`, inside `#section-activity`,
  hosting BOTH ledgers behind a scope control (a native `<fieldset>` +
  `<legend>` + two `<input type="radio" name="activity-scope">`, real
  radio group, keyboard-operable natively — no synthetic ARIA widget).
- Two pure view modules (RED-first):
  - `src/lib/session-history-view.js` (`planSessionHistoryView`) — extracts
    the validate/shape logic implicit in `showHistory`, mirroring
    `domain-stats-view.js`'s precedent.
  - `src/lib/activity-scope-view.js` (`ACTIVITY_SCOPES`,
    `DEFAULT_ACTIVITY_SCOPE`, `isValidActivityScope`,
    `planActivityScopeView`) — the scope-filtering logic (which of the two
    sub-panels is hidden for a given scope value).
  - `attribution-ledger-view.js` / `attribution-ledger.js` are reused
    UNCHANGED for the "recent" scope's rows.
- `options.js`: render both scopes' lists once at init (session history has
  no toggle to re-trigger it; recent activity's toggle lives elsewhere and
  does not change what is already stored, matching current popup parity),
  wire the two radio inputs to show/hide the corresponding sub-panel, add
  `activity-ledger-panel` to `updateActivitySectionVisibility()`'s panel
  list. Port (not duplicate-and-keep) the clipboard helpers and
  `getCopySafeCleanUrl` from popup.js, since popup no longer needs them.
- `options.css`: port the `.history-*` / `.recent-activity-*` /
  `.history-breakdown` / `.param-breakdown` row styling (renamed only where
  a popup-specific class no longer makes sense, e.g. no `<details>` chevron
  chrome since Settings doesn't collapse this panel).
- Remove from `popup.html`/`popup.js`/`popup.css`: both `<details>` blocks,
  `showHistory`, `showRecentActivity`, their call sites, the now-unused
  clipboard helpers, the `#stat-urls-wrap` click-to-open-history wiring
  (the target it opened no longer exists), and the dead CSS.
- i18n: reuse `history_label`, `ledger_section_title`, `history_empty`,
  `ledger_empty`, `history_copy_hint`, `history_copied`,
  `history_copy_original`, `ledger_*` badge/template/copy keys verbatim (no
  new strings needed for the row content — the data and its copy did not
  change, only its surface). Add two new keys in all 7 locales:
  `activity_ledger_label` (the panel's list-group-title) and
  `activity_ledger_hint` (one line explaining the lifetime difference, since
  ADR-0011 calls that a "real distinction"). Retire `show_history` (the
  stat-tile's `data-i18n-title`) in all 7 locales — the stat tile no longer
  opens anything.
- Tests: RED-first unit tests for both new pure modules; a guard test file
  (`tests/unit/settings-activity-ledger.test.mjs`, mirroring
  `settings-activity-domain-stats.test.mjs`) asserting: no duplicate DOM
  ids, `#section-activity` hosts the new panel, `options.js` wiring exists,
  and — the issue's explicit ask — **popup no longer renders either
  ledger** (no `#history`, no `#recent-activity`, no `showHistory`, no
  `showRecentActivity`). Update/remove tests that pinned the old popup
  surface: `tests/unit/popup-recent-activity.test.mjs`,
  `tests/unit/popup-copy-safe-history.test.mjs` (their behavioural coverage
  of `getCopySafeCleanUrl` and the ledger row-building moves to new
  Settings-side test files). Remove the now-obsolete
  `tests/e2e/popup.spec.mjs:82-84` case ("history section is hidden when
  empty" — `#history` no longer exists), following the same precedent as
  the already-removed "domain stats section is hidden when empty" case
  right below it.

Out of scope: changing what data either ledger records, changing
`attributionLedgerEnabled`'s recording gate, adding a recording gate to
session history (no pref existed before; none is added now — that would be
a scope/product decision, not a UI move), merging the two ledgers' DATA
into one unified row shape (the maintainer's decision was one PANEL with a
SCOPE CONTROL that switches between two views, not one merged list — their
underlying shapes differ too much: session history carries before/after +
removed-tracking breakdown, recent activity carries badge/creator/network
attribution and no "before" value).

## Constraints

- Conventional Commits, no Co-Authored-By / AI attribution, no push/PR.
- TDD: off by project config (no repo-wide TDD-on marker found, matching
  `settings-activity-home.md`'s prior finding); runner `npm test`
  (`node --test tests/unit/*.mjs`). Red-green discipline applied per-change
  for the two new pure modules.
- es = peninsular Spanish; no em-dashes in UI copy; copy keeps MUGA's
  URL-cleaner identity. `t()` has no interpolation.
- Privacy: no change to what is recorded, where it is stored, or who can
  read it. The `attributionLedgerEnabled` recording gate
  (`process-url.js:265`) is untouched. Session history's storage
  (`chrome.storage.session`) and cap (`HISTORY_MAX = 10`) are untouched.
- Accessibility: the scope control is a real `<fieldset>`/`<legend>`/radio
  group (native keyboard support: Tab in/out, arrow keys between options),
  not a synthetic ARIA widget.

## Assumptions (genuine product decisions the recorded decision didn't settle)

Simplest reasonable choice made, consistent with existing behaviour, per
instruction not to stop for these:

1. **Default scope on open: "session".** Matches the popup's original DOM
   order (history rendered before recent-activity) and is the narrower,
   more immediately relevant view (this browsing session).
2. **Entries per scope: unchanged (10 each).** `HISTORY_MAX` and
   `DEFAULT_LEDGER_CAPACITY` are pre-existing caps set by the recording
   side, not the view; the merge doesn't touch capacity.
3. **Scope choice does not persist across Settings reloads.** No new pref
   or storage key is introduced for it; it is transient UI state (like
   which panel is expanded today). Persisting it would be a new tiny piece
   of state with its own sync/local-only decision — out of scope for a
   surface-move issue.
4. **No live re-render on `attributionLedgerEnabled` toggle change.** The
   popup's old renderer never reacted to that pref changing (it only
   affects future writes), so neither does the new one — exact behavioural
   parity, not a new gap.

None of these affects privacy or data retention, so none required stopping.

## Checklist

- [x] T1 — Feature document created and committed alone. (ae38695)
- [x] T2 — `src/lib/session-history-view.js` (`planSessionHistoryView`) +
      RED-first unit test `tests/unit/session-history-view.test.mjs`. RED
      observed (ERR_MODULE_NOT_FOUND) before the module existed; GREEN
      after (6/6). (e3aa0eb)
- [x] T3 — `src/lib/activity-scope-view.js` (`ACTIVITY_SCOPES`,
      `DEFAULT_ACTIVITY_SCOPE`, `isValidActivityScope`,
      `planActivityScopeView`) + RED-first unit test
      `tests/unit/activity-scope-view.test.mjs`. RED observed before the
      module existed; GREEN after (8/8). (e3aa0eb)
- [x] T4 — `options.html`: `activity-ledger-panel` inside
      `#section-activity` (scope fieldset/radios + two sub-panels); 2 new
      locale keys (`activity_ledger_label`, `activity_ledger_hint`) across
      all 7 locales; retire `show_history` across all 7 locales. (5b12d3f
      added the panel + keys; bd506bc retired show_history alongside the
      popup removal it belongs with)
- [x] T5 — `options.js`: ported clipboard helpers +
      `getCopySafeCleanUrl` + `_buildActivityParamIndex`/
      `_renderActivityParamBreakdown` (renamed from the popup's names to
      avoid a substring collision with an existing paramBreakdown-pref
      guard test), render both scopes (`renderActivityLedgerPanel`), wire
      the radio group, extend `updateActivitySectionVisibility()`'s panel
      list, call at init. (5b12d3f)
- [x] T6 — `options.css`: ported the row styling for both sub-panels.
      (5b12d3f)
- [x] T7 — `popup.html`/`popup.js`/`popup.css`: removed both panels, their
      renderers, call sites, now-orphaned helpers, the stat-tile
      click-to-open wiring, and the dead CSS. (bd506bc)
- [x] T8 — Guard tests: `tests/unit/settings-activity-ledger.test.mjs`
      (new, extended in bd506bc with the popup-no-longer-renders-either-
      ledger block); `tests/unit/settings-activity-ledger-copy.test.mjs`
      (new, ports the copy-affordance coverage); removed
      `tests/unit/popup-recent-activity.test.mjs`,
      `tests/unit/popup-copy-safe-history.test.mjs`, and
      `tests/unit/popup-copy-with-feedback.test.mjs` (all superseded);
      fixed 3 other tests that referenced the moved code
      (`copy-no-side-effects-966.test.mjs`, `options-surfaced-prefs.test.mjs`,
      `popup-aria-i18n.test.mjs`); removed the obsolete
      `tests/e2e/popup.spec.mjs` history case. (bd506bc)
- [x] T9 — Full check suite at each work-unit commit tip (see Progress).

## Acceptance criteria (from issue #1352 + maintainer decision)

> Both ledgers rendered in Settings as ONE Activity panel with a scope
> control, neither rendered in the popup, no separate ledger surfaces.

## Applicable checks

`npm test`, `npm run test:integration`, `npx playwright test`,
`npm run lint:js`, `npm run typecheck`, `npm run check:i18n`, `npm run lint`
(web-ext) + `git diff --quiet src/manifest.json`. No `build:content` /
`build:web` bundle rebuild expected (neither bundler's inputs include
`src/popup/`, `src/options/`, or new `src/lib/*-view.js` modules) — verify
and record.

## Progress

- 2026-09-24: Explored issue #1352 (with comments — maintainer decision
  recorded), ADR-0011, the #1350/#1351 precedent
  (`odd/tasks/settings-activity-home.md`,
  `odd/tasks/strip-locally-to-settings.md`), current `popup.js`/`popup.html`
  /`popup.css`, `options.js`/`options.html`/`options.css`,
  `service-worker.js`/`process-url.js` recording paths, existing tests.
  Wrote this document. Corrected ADR-0011's stale line numbers against the
  current tree (see Problem section).
- 2026-09-24: Implemented in 3 work-unit commits on `feat/1352-unified-activity`
  (branched from `origin/main`). Checks run at EVERY commit tip:
  - `e3aa0eb` (pure view models, +245 lines): `npm test` 8469/8469 pass + 1
    known skip; `npm run typecheck` clean (needed a `@returns {value is
    "session"|"recent"}` JSDoc type predicate on `isValidActivityScope` for
    `resolved` to narrow); `npm run lint:js` clean; `npm run check:i18n` ok;
    `npm run test:integration` 233/233; `npm run lint` (web-ext) 0
    errors/notices, 2 pre-existing `UNSAFE_VAR_ASSIGNMENT` warnings in
    `lib/i18n.js` (unrelated); manifest unchanged; `npx playwright test`
    140/141 passed, 1 flake (`popup.spec.mjs` "settings link opens options
    page", timeout waiting for a new page) confirmed as pre-existing by
    re-running it alone (passed) — this commit touches no popup/options
    files at all.
  - `5b12d3f` (Settings unified panel, +975/-2 lines): `npm test` 8484/8484
    pass + 1 skip; typecheck/lint:js/check:i18n clean; `test:integration`
    233/233; `lint` (web-ext) same 2 pre-existing warnings, 0 errors;
    manifest unchanged; `playwright test` 141/141 passed, 4 skipped (no
    flake this run). Two guard-test collisions found and fixed here: (1) a
    literal `"param-breakdown"` substring in a comment/class name collided
    with an existing guard pinning the retired `paramBreakdown` pref's
    checkbox id — renamed to `activity-param-breakdown`
    /`_buildActivityParamIndex`/`_renderActivityParamBreakdown`; (2) a
    template-literal `aria-label` tripped the JS-set-hardcode i18n guard —
    fixed by assigning to a named variable first (value still fully
    resolved through `t()`).
  - `bd506bc` (popup retirement, +296/-1098 lines net): `npm test`
    8471/8471 pass + 1 skip; typecheck/lint:js/check:i18n clean;
    `test:integration` 233/233; `lint` (web-ext) same 2 pre-existing
    warnings, 0 errors; manifest unchanged; `playwright test` 140/144
    passed, 4 skipped, 0 failed. Found and fixed 3 collateral test breaks
    from moving code out of popup.js: `copy-no-side-effects-966.test.mjs`
    (asserted the copy-safe PROCESS_URL shape against `POPUP_SOURCE`, now
    `OPTIONS_SOURCE`), `options-surfaced-prefs.test.mjs` (split one
    "renders breakdown unconditionally" test in two — the per-page one
    stays on popup.js, the per-history-entry one moved to options.js), and
    `popup-aria-i18n.test.mjs` (removed the now-dead audit #1042
    aria-expanded-resync describe block for the retired history
    `<details>`/stat-tile-click wiring).
  - No `build:content`/`build:web` rebuild at any tip: confirmed via
    `git diff --stat origin/main..HEAD -- src/content src/rules
    src/lib/param-breakdown-view.js src/lib/affiliates-data.js web/`
    (empty diff) — neither bundler's inputs were touched.
  - `git log --format='%H %an <%ae> %s' origin/main..HEAD`: all 4 commits
    authored by `Antonio Rodriguez <yocreoquesi@gmail.com>`, no
    Co-Authored-By / AI attribution anywhere.
