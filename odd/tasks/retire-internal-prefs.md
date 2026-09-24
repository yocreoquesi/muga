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
- [x] T2 — remove the `dnrEnabled` Settings control (options.html/js,
      settings-schema.js, locales); verified Firefox DNR-off fallback path
      (isFirefoxMV2 early-return, blocking-webRequest path) is untouched;
      DNR↔runtime parity test stays green (it never depended on the control).
- [x] T3 — relocate `canonicalExtractorEnabled` +
      `experimentalParamClassesEnabled` controls into `#dev-tools-panel`
      (devToolsMode-gated), out of the dev-mode-gated Advanced card.
- [x] T4 — retire `paramBreakdown` (prefs.js, settings-schema.js,
      options.html/js, popup.js unconditional breakdown, locales).
- [x] T5 — retire `showReportButton` + the popup report button
      (prefs.js, settings-schema.js, options.html/js, popup.html/js,
      locales); closes #1354. Reworded the preserved-creator hint (7
      locales) to point at Settings instead of "the link below".
- [x] T6 — documented `onboardingDone`/`consentVersion`/`consentDate` as
      consent state in prefs.js (and data_architect.md); fixed the stale
      `prefs.js:52` comment ("Bump to re-trigger onboarding on ToS changes").
- [x] T7 — updated the ADR-0011 pref table with a resolution/status per
      internal-with-a-default pref, plus a short resolution summary.
- [x] T8 — import/export tolerance pass: dedicated
      `tests/unit/retired-prefs-import-tolerance.test.mjs` proves getPrefs()
      against a realistic chrome.storage.sync stub never surfaces a retired
      key and never throws, and planImport() ignores all four keys together
      in one legacy-shaped file. (Superseded in part by R3-001 below:
      dnrEnabled's stored value is no longer honoured at all — the internal
      default governs unconditionally.)
- [x] T9 — regenerated `build:content`/`build:web` bundles (all three
      cleaner-bundle.js copies changed by 1 line each), separate commit.
- [x] T10 — full check pass green: `npm test` (8283 pass, 1 pre-existing
      skip), `npm run test:integration` (233 pass), `lint:js` (clean),
      `typecheck` (clean), `check:i18n` (clean), `lint` (0 errors, 2
      pre-existing unrelated warnings in i18n.js; `git diff --quiet
      src/manifest.json` confirmed clean after). e2e:
      `tests/e2e/options.spec.mjs` (21/21), `tests/e2e/export-import.spec.mjs`
      (3/3), `tests/e2e/popup.spec.mjs` (7/7) — one relocation-visibility
      assertion bug found and fixed (toggle inputs are opacity:0 by design;
      switched to toBeAttached()/toBeChecked() + panel toBeVisible()).

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
- 2026-09-24: T2 done — `dnrEnabled` control removed. RED confirmed (9
  failures across settings-schema/export-import tests) before removing the
  checkbox from `options.html`/`options.js`, the `SETTINGS_FIELDS` entry,
  and the 3 orphaned locale keys (`row_dnr_label`/`_hint`,
  `aria_dnr_enabled`) from all 7 locales. Confirmed `dnr-sync.js`'s Firefox
  MV2 early-return (`isFirefoxMV2()`) and the blocking-webRequest fallback
  are untouched — the control removal only touched Settings UI/schema, never
  `dnr-sync.js` itself.
- 2026-09-24: T3 done — `canonicalExtractorEnabled` +
  `experimentalParamClassesEnabled` moved into `#dev-tools-panel`. RED
  confirmed (3 placement-assertion failures) before moving the two rows out
  of the dev-mode-gated Advanced card's HTML and relocating their
  `bindToggle` calls next to the devToolsMode wiring in `options.js`.
- 2026-09-24: T4 done — `paramBreakdown` retired. RED confirmed (9
  failures) before removing the pref, control, and the two
  `prefs.paramBreakdown === true` gates in `popup.js` (now unconditional:
  `if (result.removedTracking?.length > 0)` / `if
  (entry.removedTracking?.length > 0)`).
- 2026-09-24: T5 done — `showReportButton` + the popup's own report flow
  retired. RED confirmed (13 failures) before removing the
  `#report-broken`/`#report-include-url-row` markup, the ~50-line
  click-handler block in `popup.js` (and its now-unused imports
  `getRemoteParams`/`buildBrokenSiteReportFields`/`scopedParamsForHost`),
  the pref/control/locale keys, and rewording the preserved-creator hint in
  all 7 locales to point at Settings. Rewrote `report-button.test.mjs` and
  trimmed the obsolete report-broken-clone assertions from
  `popup-rerender-leaks.test.mjs`.
- 2026-09-24: T6 done — doc-only, no RED/GREEN cycle needed (no logic
  changed). Documented the three consent-state keys in place in `prefs.js`
  and `data_architect.md`; fixed the stale `prefs.js:52` comment.
- 2026-09-24: T7 done — doc-only. Appended a resolved status to each of the
  9 internal-with-a-default rows' Bucket column plus a short resolution
  summary; left the ADR's own decision text untouched as the historical
  record. `context-map.test.mjs` (c4, ADR index/status agreement) confirmed
  still green.
- 2026-09-24: T8 done — added
  `tests/unit/retired-prefs-import-tolerance.test.mjs` (new coverage, not a
  RED/GREEN cycle — the behavior already existed as a side effect of T1-T5,
  this proves it explicitly): a realistic `chrome.storage.sync` stub shows
  retired keys never surface and never throw, `dnrEnabled`'s stored value is
  still honoured, and `planImport()` tolerates all four keys at once.
- 2026-09-24: T9 done — `npm run build:content && npm run build:web`;
  `src/content/cleaner-bundle.js`, `web/engine/cleaner-bundle.js`,
  `landing/clean/engine/cleaner-bundle.js` each changed by one minified
  line. Committed separately from hand-written source.
- 2026-09-24: T10 done — `npm test` (8283/8283 + 1 pre-existing skip),
  `npm run test:integration` (233/233), `lint:js`, `typecheck`,
  `check:i18n` all clean; `npm run lint` (web-ext) 0 errors / 2 pre-existing
  unrelated warnings, `git diff --quiet src/manifest.json` confirmed clean
  after. Ran `npx playwright test tests/e2e/options.spec.mjs` and caught a
  real bug in my own new e2e assertion (`toBeVisible()` on a toggle
  `<input>`, which is always `opacity:0` by design) — fixed to
  `toBeAttached()`/`toBeChecked()` + panel `toBeVisible()`, all 21 options
  e2e tests pass, plus 3/3 export-import and 7/7 popup e2e specs.

## Branch restructuring: stacked slices

The single `feat/1355-retire-internal-prefs` branch above was restructured
by the coordinator into three stacked, independently reviewable slices in
the same worktree (identical final tree at the original tip):

- `feat/1355-a` — T0-T2 + bundle regen (task doc, `hoverPreviewDelayMs`,
  `dnrEnabled` control removal).
- `feat/1355-b` (on `feat/1355-a`) — T3-T4 + e2e fix + bundle regen
  (Developer-tools relocation, `paramBreakdown` retirement).
- `feat/1355-c` (on `feat/1355-b`) — T5-T9 (`showReportButton` retirement,
  consent-state docs, ADR-0011 update, import tolerance test, closeout,
  bundle regen).

Native review of A+B's hand-written commits (RDD) returned **approved with
warnings to fix now**. This section records those fixes; the T0-T10
checklist/progress above documents the original implementation and is left
as-is except for two corrections noted inline (T8's dnrEnabled claim, above).

## Native review findings and fixes (R3-001 .. R3-004)

- **R3-001 (slice A, fixed)** — a user who had explicitly stored
  `dnrEnabled: false` before its Settings control was removed stayed
  stranded on the DNR-off path forever: the control that could flip it back
  no longer existed, but `getPrefs()` still honoured the stale stored value.
  Maintainer decision: the internal default governs unconditionally.
  `getPrefs()` (`src/lib/prefs.js`) now forces `dnrEnabled` to
  `PREF_DEFAULTS.dnrEnabled` after the storage merge, discarding whatever was
  stored. A new one-time migration, `migrateDropDnrEnabledPref()`
  (`src/lib/storage-migrations.js`), deletes the stale key — modelled on
  `migrateDropCookieConsent`'s read-then-remove shape (no value to preserve,
  so no read-modify-write step and no unsafe intermediate state), wired into
  the single `runOneTimeMigrations()` call site (#1257) rather than a new
  one. RED confirmed in `tests/unit/dnr-enabled-internal-default.test.mjs`
  (9 of 11 assertions failed pre-fix) before implementing.
  `tests/unit/retired-prefs-import-tolerance.test.mjs` (slice C) updated to
  match — it asserted the old, now-wrong behavior.
- **R3-002 (slice B, fixed)** — `experimentalParamClassesEnabled`'s control
  moved to Developer tools, a surface most users never open; a user who had
  this experimental (default-off, false-positive-prone) heuristic ON before
  the move could be stuck with it running with no visible way back.
  Maintainer decision: turn it OFF once on upgrade; the user can re-enable it
  in Developer tools. `migrateExperimentalParamClassesOff()` (same file) is
  a genuinely one-time migration (unlike R3-001's pure delete, it WRITES a
  value the user might later change back), so it needs — and has — a
  persistent done-marker (`chrome.storage.local["experimentalParamClassesOffMigrated"]`)
  written only after the value flip actually succeeds, so a deliberate later
  re-enable is never re-flipped and a crash mid-migration safely retries.
  Wired into the same single `runOneTimeMigrations()` call site. RED
  confirmed in `tests/unit/experimental-param-classes-migration.test.mjs`
  (all 10 assertions failed pre-fix, `TypeError: ... is not a function`)
  before implementing.
- **R3-003 (slice B, fixed)** — the containment tests for the moved
  Developer-tools controls (and the sibling `#925` Advanced-card check) only
  compared string offsets, which proves an id appears somewhere in a stretch
  of *text*, not that it is an actual DOM *descendant* of a container — two
  sibling `<div>`s at the same depth would have passed identically. No
  HTML-parser (`jsdom`/`linkedom`/`happy-dom`) is a devDependency of this
  project (verified: none in `package.json`; `cheerio` exists only
  transitively via `addons-linter`, undeclared, not safe to depend on), and
  the HARD RULE against `npm install` (only `npm ci`) rules out adding one —
  so this uses the documented fallback: a balanced `<div>`-tag walk
  (`isNestedInsideDiv()` in `tests/unit/options-surfaced-prefs.test.mjs`),
  with HTML comments stripped first defensively. Verified the walk actually
  discriminates (not vacuously true) against a hand-built sibling-vs-descendant
  case before trusting it against the real file.
- **R3-004 (slice B, fixed)** — `tests/e2e/options.spec.mjs`'s relocation
  test only checked the moved checkboxes' own attachment/checked state.
  Those `<input>`s are always `opacity:0` + `width:0;height:0` by design
  (empty bounding box), so `toBeHidden()`/`toBeVisible()` on the checkbox
  itself is trivially true regardless of gating and proves nothing. Added
  `expect(page.locator("#dev-tools-panel")).toBeHidden()` both before
  turning `dev-tools-mode` on and after turning it back off — the actual
  CSS-gated ancestor, which is the real signal.
- Every slice's tip re-verified green after these fixes:
  `npm test`, `npm run test:integration`, `lint:js`, `typecheck`,
  `check:i18n`, `npm run lint` (0 errors, manifest untouched), and the full
  `options`/`export-import`/`popup` e2e specs (31/31) on the final
  `feat/1355-c` tip.
