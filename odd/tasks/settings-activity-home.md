# Settings Activity home (#1350)

## Objective

Build an "Activity" home in Settings (`options.html`) for the popup's
record/analysis panels named by ADR-0011, and move the first of the four
panels — the domain-stats table — into it. This is the first of four slices
(#1350-#1353); only #1350 is in scope here.

## Problem

`options.html` today has only the *gating toggle* for domain stats
(`id="domain-stats"`, a checkbox in Advanced > Display). It has no table, no
view of the data. The view lives only in the popup
(`popup.html:66-69`, `popup.js:920-966`, function `showDomainStats`), which
ADR-0011 says is the wrong surface for a "ranked table answering 'where does
the noise come from over time'" — a question about history that rewards
study, not a two-second glance.

Moving the panel into `options.html` collides with the existing checkbox id:
both currently use `id="domain-stats"` in separate documents; moving the
panel into the same document as the checkbox would create a real duplicate
id unless the panel gets a new id.

## Scope

In scope:
- A new "Activity" section in `options.html` (TIER 1, not gated behind
  Advanced/dev-mode — a record, like the existing ungated
  "Your locally-stripped params" section) hosting the domain-stats table.
- Extract the pure sort/slice/shape logic of the popup's `showDomainStats`
  into a testable module (`src/lib/domain-stats-view.js`), following the
  precedent of `remote-rules-changelog-view.js` /
  `attribution-ledger-view.js` (options.js/popup.js are browser-only and
  can't be exercised under `node:test`).
- Wire `options.js` to render the table from `getDomainStats()`
  (`src/lib/storage.js`), gated on `prefs.domainStats` exactly as the popup
  did (hide the section when the pref is off; show an empty state when the
  pref is on but there's no data yet).
- Remove the panel from `popup.html`/`popup.js` entirely: the `<details
  id="domain-stats">` block, `showDomainStats()`, its call site, and its
  popup.css rules.
- Resolve the id collision: the new Settings panel gets its own id
  (`domain-stats-panel`); the checkbox keeps `id="domain-stats"`.
- New/reused i18n: reuse existing keys (`domain_stats_label`,
  `domain_stats_empty`, `domain_stats_params`, `domain_stats_urls`); add one
  new key `section_activity` in all 7 locales (es = peninsular Spanish, no
  em-dashes).
- Tests: a unit test asserting no duplicate DOM ids in `options.html`, a unit
  test for the extracted view module (RED first), a unit test asserting the
  popup no longer renders `#domain-stats`/`showDomainStats`.

Out of scope (separate issues, do not implement): suspicious-params (#1351),
session history / recent-activity ledgers (#1352), report flow (#1353). The
Activity section is built so those slices have a home to land in later, but
their content is not moved here.

## Constraints

- Conventional Commits, no Co-Authored-By / AI attribution, no push/PR.
- TDD: off by project config (no repo-wide TDD-on marker found); runner
  `npm test` (`node --test tests/unit/*.mjs`). Red-green discipline still
  applied per-change (write the failing view-module test before the module
  exists).
- es = peninsular Spanish; no em-dashes in UI copy; copy keeps MUGA's
  URL-cleaner identity.
- Accessibility: heading levels/landmarks consistent with sibling sections;
  aria-labels only where the popup actually had them.

## Checklist

- [x] T1 — Feature document created and committed alone. (a1ba77a)
- [x] T2 — `src/lib/domain-stats-view.js` (`planDomainStatsView`) + RED-first
      unit test `tests/unit/domain-stats-view.test.mjs`. RED observed
      (ERR_MODULE_NOT_FOUND) before the module existed; GREEN after (7/7).
- [x] T3 — `options.html`: new `<section id="section-activity">` with
      `domain-stats-panel` card; `en.mjs` + 6 other locales get
      `section_activity`. `options.css` gets the moved row styling.
- [x] T4 — `options.js`: `renderDomainStatsActivity()`, wired at init, after
      toggle change, and after import.
- [x] T5 — `popup.html`/`popup.js`/`popup.css`: removed the domain-stats
      panel, its renderer (`showDomainStats`), its call site, its CSS, and
      the now-unused `getDomainStats` import.
- [x] T6 — Guard tests in `tests/unit/settings-activity-domain-stats.test.mjs`:
      no-duplicate-id across `options.html`, the checkbox/panel id split,
      `#section-activity` is TIER 1 (positioned before Advanced), and popup
      no longer declares/calls `showDomainStats` or the removed element ids.
- [x] T7 — Full check suite run (see Progress); no build:content/build:web
      bundle touched (neither bundler's inputs include src/popup, src/options,
      or the new src/lib module); final commit(s) below.

## Notes for the next slice (#1351)

`#section-activity` currently hides itself entirely when `prefs.domainStats`
is off, since it hosts only the domain-stats panel today. Once #1351 adds a
second, independently-gated panel to the same section, that section-level
hide will need to become "hide iff every child panel is hidden" rather than
being tied to one pref. Left as-is here since #1350 has exactly one panel
and ADR-0011 does not decide the multi-panel layout.

## Acceptance criteria (copied from issue #1350)

> An Activity section in Settings that hosts the domain-stats table, the
> panel gone from `popup.html`/`popup.js`, the id collision resolved, and a
> test asserting the popup no longer renders it.

## Applicable checks

`npm test`, `npm run lint:js`, `npm run typecheck`, `npm run check:i18n`,
`npm run lint` (web-ext). No content/web bundle touched (domain-stats code
is not part of `build:content`/`build:web` inputs) — verify and skip rebuild
if confirmed unaffected.

## Progress

- 2026-09-24: Explored ADR-0011, issues #1350-#1353, popup.js/html,
  options.js/html, storage.js, locale/test conventions. Wrote this document.
- 2026-09-24: Implemented T2-T6. Checks run from a clean worktree:
  - This worktree had no `node_modules` at all (fresh worktree checkout);
    `npm install` was run once to restore it (needed for `npm run typecheck`,
    which reads `./node_modules/@types`; `npm test`/`lint:js`/`check:i18n`
    had been resolving from elsewhere and already passed before the install).
  - `npm test`: 8046 tests, 8045 pass, 1 skipped (the known pre-existing
    skip), 0 fail. Re-ran `tests/unit/sign-rules.test.mjs` in isolation per
    the known-Windows-flake note: 27/27 pass, no flake observed.
  - `npm run lint:js`: clean, 0 problems.
  - `npm run typecheck`: clean, 0 errors (after the `npm install` above).
  - `npm run check:i18n`: ok, no FIXME/stub/empty translations.
  - `npm run lint` (web-ext): 0 errors, 0 notices, 2 warnings — both
    pre-existing `UNSAFE_VAR_ASSIGNMENT` notices in `src/lib/i18n.js`
    (innerHTML), unrelated to this change.
  - `tests/unit/context-map.test.mjs`: 10/10 pass (ADR-0011 index entry
    unaffected).
  - No `build:content`/`build:web` rebuild needed: neither bundler's inputs
    include `src/popup/`, `src/options/`, or the new
    `src/lib/domain-stats-view.js`.
  - e2e: searched `tests/e2e/` for any spec covering the popup's
    domain-stats panel; none exists (the only e2e hit,
    `export-import.spec.mjs`, checks the `domainStats` *pref boolean* in the
    export payload, unrelated to the UI panel). Nothing to update; Playwright
    was not run.

