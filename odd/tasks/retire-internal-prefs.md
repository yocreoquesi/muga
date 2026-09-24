# Retire / relocate the internal-with-a-default prefs (#1355, #1354)

## Objective

Close #1355 (9 "internal-with-a-default" prefs classified by ADR-0011 either
have no control at all, or a control that should not exist as a plain
Settings toggle) and #1354 (two Settings labels say "in the popup" and go
stale once the popup panels move), per the maintainer's recorded decisions on
both issues and the ADR-0011 pref table.

## Problem

ADR-0011 (`docs/adr/0011-popup-glance-and-act.md`) classified all 36
`PREF_DEFAULTS` keys. 9 landed in "internal-with-a-default": a toggle grew
because it was the easy way to make something testable/reversible, not
because a user needs to set it. Each needs its own resolution instead of
staying an intuition:

| Pref | Decision (maintainer, 2026-09-24) |
|---|---|
| `hoverPreviewDelayMs` | retire; fixed 2500ms in code; no control, no export |
| `dnrEnabled` | remove the user control; keep an internal default (parity test covers both matchers); don't break the Firefox tracking_params DNR-off fallback |
| `canonicalExtractorEnabled` | move its control into Developer tools (devToolsMode-gated) |
| `experimentalParamClassesEnabled` | move into Developer tools until false-positive evidence supports promotion |
| `paramBreakdown` | retire (popup glance shows the breakdown unconditionally now); closes #1354's stale "in the popup" label |
| `showReportButton` | retire; reporting lives in Settings (#1353, section-report); remove the popup report button + its pref; closes #1354 |
| `onboardingDone` | internal state, not a preference: document it where declared |
| `consentVersion` | internal state; fix the stale `prefs.js:52` comment (ADR-0007 removed the re-onboarding engine) |
| `consentDate` | internal state: document it |

Constraint: stored values for retired prefs already in users'
`chrome.storage` must not break anything — reads fall back to fixed
behaviour, and importing an old settings file that still carries a retired
key must be tolerated (ignored, not rejected), same precedent as the already
-removed `cookieConsentMode`/`followShortenersEnabled` keys in
`settings-schema.js`.

Out of scope: #1352 (merging the two popup ledgers into one Activity panel) —
do not touch `showHistory`/`showRecentActivity` ledger logic.

## Scope

- `src/lib/prefs.js` — PREF_DEFAULTS: retire `hoverPreviewDelayMs`,
  `paramBreakdown`, `showReportButton`; keep `dnrEnabled` internal (no UI);
  document `onboardingDone`/`consentVersion`/`consentDate` as consent state,
  fix the stale re-onboarding comment.
- `src/content/hover-preview.js` — fixed `HOVER_PREVIEW_DELAY_MS = 2500`
  constant, no pref read.
- `src/lib/settings-schema.js` — SETTINGS_FIELDS/BOOLEAN_KEYS: drop
  `dnrEnabled`, `paramBreakdown`, `showReportButton` entries (no control ⇒
  not user-settable ⇒ not exported), matching the existing
  hoverPreviewDelayMs/cookieConsentMode precedent. Keep
  `canonicalExtractorEnabled`/`experimentalParamClassesEnabled` (still real,
  still user-settable, just relocated).
- `src/options/options.html` + `options.js` — remove the `dnr-enabled`,
  `param-breakdown`, `show-report-button` rows/wiring; move the
  `canonical-extractor` and `experimental-param-classes` rows from the
  dev-mode-gated Advanced card into the devToolsMode-gated
  `#dev-tools-panel`.
- `src/popup/popup.js` + `popup.html` — drop the `prefs.showReportButton`
  gate and the `#report-broken`/`#report-include-url-row` markup entirely;
  drop the `prefs.paramBreakdown === true` gate (breakdown always renders
  when there is something to show).
- `src/lib/locales/{en,es,pt,de,fr,it,ja}.mjs` — remove now-orphaned keys
  (`row_dnr_label`, `row_dnr_hint`, `aria_dnr_enabled`,
  `row_param_breakdown_label`, `row_param_breakdown_hint`,
  `aria_param_breakdown`, `row_show_report_button_label`,
  `row_show_report_button_hint`, `aria_show_report_button`,
  `report_dirty_url`, and any popup-report-only keys left orphaned). Keep
  `param_breakdown_label` (still used, unconditionally, in the popup) and
  `report_include_full_url_label/hint` (still used by the Settings/dev URL
  tester's own report flow).
- `docs/adr/0011-popup-glance-and-act.md` — add a resolution note per
  internal-with-a-default pref (status only; the ADR's own decision text is
  historical and is not rewritten).
- `docs/data_architect.md` — drop the `hoverPreviewDelayMs` row (enforced by
  `tests/unit/docs-prefs-table.test.mjs`).
- Tests: update/extend `tests/unit/{hover-preview,settings-schema,
  export-import,options-surfaced-prefs,report-button,remote-rules,
  popup-rerender-leaks}.test.mjs`, `tests/unit/fixtures/
  muga-settings-1395-params.json`-based tolerance coverage, and the matching
  `tests/e2e/export-import.spec.mjs` expectations.
- Regenerated artifacts (separate commit(s) if they change):
  `src/content/cleaner-bundle.js`, `web/engine/cleaner-bundle.js`,
  `landing/clean/engine/cleaner-bundle.js` via `npm run build:content` /
  `npm run build:web`.

## Constraints

- No product decision left open by the issue's recorded table — anything
  ambiguous stops and asks.
- `es` locale = peninsular Spanish; no em dashes in any new/changed
  user-facing string, in any locale.
- Firefox: `tracking_params` DNR is off there (blocking-webRequest path
  owns it) — `dnrEnabled` control removal must not touch that fallback.
- TDD: off by project config; runner `npm test`. This task writes/edits
  tests first (RED) for every behavior change before touching source, per
  explicit instruction, then implements to GREEN.

## Checklist

- [x] T0 — write this task file, commit alone.
- [x] T1 — retire `hoverPreviewDelayMs` (prefs.js, hover-preview.js,
      settings-schema.js comment, tests, docs/data_architect.md row).
- [ ] T2 — remove the `dnrEnabled` Settings control (options.html/js,
      settings-schema.js, locales); verify Firefox DNR-off fallback path is
      untouched; keep the DNR↔runtime parity test green.
- [ ] T3 — relocate `canonicalExtractorEnabled` +
      `experimentalParamClassesEnabled` controls into `#dev-tools-panel`
      (devToolsMode-gated), out of the dev-mode-gated Advanced card.
- [ ] T4 — retire `paramBreakdown` (prefs.js, settings-schema.js,
      options.html/js, popup.js unconditional breakdown, locales).
- [ ] T5 — retire `showReportButton` + the popup report button
      (prefs.js, settings-schema.js, options.html/js, popup.html/js,
      locales); closes #1354.
- [ ] T6 — document `onboardingDone`/`consentVersion`/`consentDate` as
      consent state in prefs.js; fix the stale `prefs.js:52` comment.
- [ ] T7 — update the ADR-0011 pref table with a resolution/status per
      internal-with-a-default pref.
- [ ] T8 — import/export tolerance pass: prove a legacy settings file
      carrying retired keys imports cleanly (keys ignored, no throw).
- [ ] T9 — regenerate `build:content`/`build:web` bundles if changed,
      separate commit(s).
- [ ] T10 — full check pass: `npm test`, `npm run test:integration`,
      `lint:js`, `typecheck`, `check:i18n`, `lint` (+ manifest diff check),
      relevant e2e specs (`options`/`popup`) if runnable locally.

## Acceptance criteria

- Every pref in the table above matches its recorded decision.
- No dangling locale key (checked by `check:i18n` + existing
  `options-surfaced-prefs`/i18n-parity tests) and no orphaned pref reference
  in source.
- A legacy `chrome.storage`/settings-export payload carrying any retired key
  still imports/loads without error, with the retired key ignored.
- `tests/unit/docs-prefs-table.test.mjs` and `dnr-runtime-parity.test.mjs`
  stay green.
- `npm test` and `npm run test:integration` green (or pre-existing skip
  only); `lint:js`, `typecheck`, `check:i18n` green; `npm run lint` run
  un-piped with `git diff --quiet src/manifest.json` confirmed after.

## Progress

- 2026-09-24: T0 done — this file created.
- 2026-09-24: T1 done — `hoverPreviewDelayMs` retired. RED confirmed in
  `tests/unit/hover-preview.test.mjs` (3 failing assertions) and
  `tests/unit/docs-prefs-table.test.mjs` (obsolete doc key) against the
  pre-change source, then made GREEN by: removing the pref from
  `PREF_DEFAULTS`, adding `HOVER_PREVIEW_DELAY_MS = 2500` in
  `hover-preview.js`, updating the `settings-schema.js` comment, and
  dropping the doc row in `data_architect.md`.
