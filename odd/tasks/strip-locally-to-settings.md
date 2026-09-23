# Strip locally moves to Settings (#1351)

## Objective

Move the popup's "Suspicious params" collapsible (both heuristic breakdowns
plus its two decision-bearing actions, "Strip locally" and "Report upstream")
out of the two-second popup surface and into Settings' Activity section
(`#section-activity`, built by #1350/PR #1365), per ADR-0011 Decision 1 and
Decision 3. This is the third of four ADR-0011 slices (#1350-#1353); only
#1351 is in scope here.

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

## Scope

In scope:
- Extract the pure, testable pieces of the suspicious-params view (grouping/
  formatting of entropy + frequency flags, row view-model shaping) into a
  `src/lib/*-view.js` module, following the `domain-stats-view.js` /
  `remote-rules-changelog-view.js` / `attribution-ledger-view.js` precedent
  (`options.js`/`popup.js` are browser-only, can't run under `node:test`).
- `options.html`: a new panel inside `#section-activity`, alongside
  `#domain-stats-panel` (own id, e.g. `suspicious-params-panel`, to avoid
  colliding with the popup's `#suspicious-params` — same id-collision
  pattern #1350 solved for domain stats).
- `options.js`: render the panel (entropy + frequency breakdowns, per-row
  Strip-locally / Report-upstream actions with the same idempotent
  "already done" / "already reported" states as the popup had), wired at
  init, on relevant storage changes (`userCustomRules`, `submittedParams`),
  and reusing `addUserCustomRule` from `src/lib/user-custom-rules.js`.
- **Per-panel section visibility**: `#section-activity` currently hides
  entirely when `prefs.domainStats` is off (`options.js` `renderDomainStatsActivity`,
  a known gap flagged in `odd/tasks/settings-activity-home.md`'s "Notes for
  the next slice"). Once this panel lands, `#section-activity` must hide
  only when **every** panel inside it is hidden, not be tied to the
  `domainStats` pref alone.
- `popup.html`/`popup.js`/`popup.css`: remove the `#suspicious-params`
  `<details>` block, `showSuspiciousParams` and its four helpers, their
  call sites (init + the `storage.onChanged` re-render branch), and their
  CSS. Retire the dead deep link (`popup.js:1300`, `strip_locally_manage`)
  along with `_renderStripLocallyCount` — it becomes redundant once the
  action and the `#user-custom-rules` receipt are in the same document.
- Guard test(s): no duplicate DOM ids across `options.html`, a test
  asserting `userCustomRules` can no longer be written from popup.js (per
  the issue's closing condition), and a test for the per-panel Activity
  visibility rule (Activity visible when suspicious-params has content even
  if `domainStats` is off, and vice versa).
- i18n: reuse existing keys (`suspicious_params_label`,
  `suspicious_params_entropy_group`, `suspicious_params_frequency_group`,
  `entropy_score_label`, `suspicious_params_freq_detail`,
  `strip_locally_btn`, `strip_locally_btn_done`, `report_upstream_btn`,
  `report_upstream_already_reported`, `list_full`). Add any new key needed
  for the Settings framing across all 7 locales (es = peninsular Spanish,
  no em-dashes, `t()` has no interpolation).

Out of scope (separate issues, do not implement): session/recent-activity
ledgers (#1352), report flow (#1353).

## Open product question (BLOCKING — see Progress)

The entropy subgroup's data source, `findSuspiciousParams(url)`
(`src/lib/entropy-heuristic.js:126`), scores the params of **one specific
URL** — in the popup, that's `chrome.tabs.query({active:true,
currentWindow:true})`, i.e. "the page you have open right now". Settings
(`options.html`) is opened in its own tab; querying the active tab from
there will, in the ordinary case, resolve to the Settings tab itself (no
meaningful URL to score), not "the page the user was just looking at".
Unlike the frequency subgroup (cross-site, storage-backed, no page
dependency) or the domain-stats table already moved in #1350 (aggregated
history, no single-page dependency), the entropy breakdown has no data
source in Settings that means the same thing it meant in the popup.

Neither ADR-0011 nor issue #1351 addresses this — ADR-0011 groups "two
heuristic breakdowns" together as one collapsible without examining whether
the entropy breakdown's single-current-page premise survives the move; the
issue's acceptance text ("popup rendering neither") settles that the popup
stops computing it, not what replaces it in Settings.

Flagged to the user per the ODD product-decision rule; implementation of
the entropy piece is blocked until answered. Everything else in scope
(frequency subgroup, both actions, the receipt/visibility work) does not
depend on the answer and proceeds first.

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
- [ ] T2 — BLOCKED: resolve the open product question above before touching
      the entropy subgroup.
- [ ] T3 — `src/lib/suspicious-params-view.js` (or similarly named) pure
      module + RED-first unit test for the frequency-subgroup / row
      view-model logic that does not depend on T2's answer.
- [ ] T4 — `options.html`: `suspicious-params-panel` inside
      `#section-activity`; locale keys reused/added in all 7 locales.
- [ ] T5 — `options.js`: render the panel, wire init/storage-change, make
      `#section-activity` visibility per-panel (hide iff all panels hidden).
- [ ] T6 — `popup.html`/`popup.js`/`popup.css`: remove
      `showSuspiciousParams` + 4 helpers, `#suspicious-params` markup, CSS,
      call sites; retire the dead deep link.
- [ ] T7 — Guard tests: no duplicate ids, `userCustomRules` unwritable from
      popup.js, per-panel Activity visibility.
- [ ] T8 — Full check suite: `npm test`, `npm run lint:js`, `npm run
      typecheck`, `npm run check:i18n`, `npm run lint` (web-ext, then
      confirm `git diff --quiet src/manifest.json`); e2e spec check for any
      popup suspicious-params coverage.

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
