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
- [ ] T3 — `src/lib/suspicious-params-view.js` pure module (Settings-side
      frequency row shaping) + RED-first unit test.
- [ ] T4 — `popup.js`/`popup.html`/`popup.css`: simplify to entropy-only,
      read-only; delete the 4 strip/report helpers, their call sites, the
      dead deep link, and their CSS; drop the `userCustomRules` reactive
      re-render branch.
- [ ] T5 — `options.html`: `suspicious-params-panel` inside
      `#section-activity` with scope-hint copy; locale keys added/removed
      in all 7 locales.
- [ ] T6 — `options.js`: render the frequency panel + strip-everywhere +
      report-upstream actions (via `withSyncMutation`/`withListLock`), wire
      at init and after import; make `#section-activity` visibility
      per-panel (hide iff all panels hidden).
- [ ] T7 — Guard tests: no duplicate ids, `userCustomRules` unwritable from
      popup.js, per-panel Activity visibility; update/replace the superseded
      `popup-strip-locally-button.test.mjs` / `popup-report-upstream-button.test.mjs`
      / `popup-suspicious-section.test.mjs`.
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
- 2026-09-24: Maintainer decision received (recorded above). Proceeding with
  T3 onward.
