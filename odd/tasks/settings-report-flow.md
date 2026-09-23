# Settings report flow (#1353)

## Objective

Give Settings a user-reachable "report a problem with this URL" flow. Today
the only Settings copy of the report form lives inside the Developer tools
card, gated behind `devToolsMode` — a QA affordance, not a user-facing one.

## Problem

Issue #1353 (fourth slice of ADR-0011, correcting #1271's premise): the
`report-include-url-row` CSS class exists in both `popup.html` and
`options.html`, but the element ids differ (`report-include-url-row` in the
popup vs `url-report-include-url-row` in Settings) and the Settings copy is
bound to the raw QA URL tester at `options.html:522-541` /
`options.js:1483,1528`, reachable only behind `devToolsMode`. **There is no
user-reachable report flow in Settings today.**

## Why (ADR-0011 Decision 3)

A report form has a confirmation checkbox about sending a full URL to a
third party. That deserves to be read carefully — the opposite of the
popup's two-second glance budget. Settings has the stable address and
unbounded viewport such a decision needs.

## Scope

- Build a NEW, ungated, user-reachable "Report a problem" card in
  `src/options/options.html`, in its own `<section>` — NOT inside
  `#section-activity` (another agent, #1351, is concurrently adding a panel
  there — keeping this in its own section avoids a merge collision) and NOT
  inside the Developer tools card.
- Reuse the existing pure report-building funnel
  (`src/lib/broken-site-report.js` — `buildBrokenSiteReportBody`,
  `buildBrokenSiteReportFields`) and the existing GitHub-issue deep-link
  mechanism. No new egress, no new remote endpoint, no new pref.
- The flow mirrors the QA URL tester's shape (paste a URL, MUGA runs it
  through the cleaner, review results, then report) since Settings has no
  "current tab" context the way the popup does.
- Add one new small pure predicate, `isReportableUrl`, to
  `broken-site-report.js` (wraps the module's existing private URL-parsing
  gate) so the new UI can show inline validation before running the cleaner,
  with a failing test observed first (RED) before implementation.

## Explicitly out of scope (deferred, decided later)

- Do NOT touch `showReportButton` / `paramBreakdown` pref semantics or their
  "in the popup" label copy — that is #1354/#1355.
- Do NOT remove or alter the popup's own report flow
  (`popup.html:121-127`, `popup.js:636-645`,`:844-912`) — deferred.
- Do NOT touch the existing Developer-tools QA URL tester
  (`options.html:504-568`, `options.js` `testUrl()`/`initDevTools()`) beyond
  reading it as reference. Left alone, not consolidated, in this slice.
- Do NOT touch `#section-activity` (#1351 concurrent work).

## Constraints

- New visible strings translated in all 7 locales
  (`src/lib/locales/*.mjs`); `es` = peninsular Spanish; no em-dashes; keep
  the URL-cleaner identity in copy.
- All new DOM ids unique across `options.html` (enforced by
  `tests/unit/settings-activity-domain-stats.test.mjs`'s id-uniqueness
  guard).
- `t()` has no interpolation — no `{n}`/`%s` placeholders in new copy.
- Conventional Commits, no AI/co-author attribution, no push/PR.

## TDD

Off by project config (no repo-wide TDD-on marker found); runner `npm test`
(`node --test tests/unit/*.mjs`). Applied anyway to the new pure predicate:
failing test observed first, then implementation, per task instructions.

## Checklist

- [x] T1 — create this task file, commit alone.
- [x] T2 — add `isReportableUrl(url)` to `src/lib/broken-site-report.js`;
      write its test first in `tests/unit/broken-site-report.test.mjs`,
      observe RED, implement, observe GREEN. (commit ad01b66; RED confirmed
      via `SyntaxError: ... does not provide an export named
      'isReportableUrl'`, then GREEN: 36/36 in the file, 8074/8075 full
      suite with the one pre-existing skip)
- [x] T3 — add the new "Report a problem" section to `options.html`
      (own `<section id="section-report">`, ungated, unique
      `report-url-*` ids) + wire it in `options.js`
      (`initReportFlow()`, called from `init()` right after
      `initExportImport()`), reusing `buildBrokenSiteReportBody` +
      `isReportableUrl` + the existing
      `cleanForPreview`/`getRemoteParams`/`scopedParamsForHost` helpers the
      QA tester already uses. Same GitHub issue deep-link, no new egress.
- [x] T4 — added `section_report`, `report_url_label`, `report_url_hint`,
      `report_url_invalid` to all 7 locale files (reused
      `dev_url_tester_placeholder`, `aria_dev_url_input`, `dev_url_test_btn`,
      `dev_url_result_label`, `dev_url_removed`, `dev_url_clean`,
      `dev_url_action`, `dev_url_error`, `dev_url_report_btn`,
      `report_include_full_url_label`, `report_include_full_url_hint` as-is
      for the shared parts of the flow).
- [x] T5 — full check suite run; see Checks/Progress below.

## Acceptance criteria

- A user can reach a "report a problem with a URL" flow in Settings without
  enabling Developer tools mode.
- Including the full URL in the report stays strictly opt-in (checkbox
  unchecked by default), reusing the exact same privacy gate as the two
  existing surfaces.
- No new network egress; the only outbound call is the pre-existing
  `github.com/.../issues/new` deep link.
- `showReportButton`/`paramBreakdown` semantics and popup copy unchanged.
- No duplicate DOM ids in `options.html`.
- All 7 locale files stay key-parity complete with non-empty values.

## Checks

- `npm test`
- `npm run lint:js`
- `npm run typecheck`
- `npm run check:i18n`
- `npm run lint` (web-ext; run without piping into `head`; confirm
  `git diff --quiet src/manifest.json` after)
- Relevant e2e: none found covering options reporting
  (`tests/e2e/options.spec.mjs`, `tests/e2e/popup.spec.mjs` have no
  "report" coverage) — noted, not run.

## Progress

- 2026-09-24: Task file created (T1).
- 2026-09-24: T2 done, commit ad01b66.
- 2026-09-24: T3/T4 done. Checks observed:
  - `npm test`: 8099/8100 pass, 1 pre-existing skip (matches ADR-0011's
    "one pre-existing skipped test" note), 0 fail.
  - `npm run lint:js`: clean.
  - `npm run typecheck`: clean.
  - `npm run check:i18n`: "ok: no FIXME markers, stubs, or empty
    translations in src/lib/locales/*.mjs".
  - `npm run lint` (web-ext): 0 errors, 2 pre-existing warnings in
    `lib/i18n.js` (unrelated, `UNSAFE_VAR_ASSIGNMENT` on innerHTML,
    predates this change). `git diff --quiet src/manifest.json` confirmed
    clean afterward.
  - e2e: `tests/e2e/options.spec.mjs` and `tests/e2e/popup.spec.mjs` have
    no "report" coverage — nothing relevant to run.
  - Targeted re-run of `tests/unit/settings-activity-domain-stats.test.mjs`
    (id-uniqueness guard), `tests/unit/i18n-locale-modules.test.mjs`
    (locale key-parity), `tests/unit/options-patterns.test.mjs`,
    `tests/unit/options-aria-i18n.test.mjs`,
    `tests/unit/options-dev-tools-gate.test.mjs`: 98/98 pass.
  - Status: all checklist items done. Feature complete for this slice.
