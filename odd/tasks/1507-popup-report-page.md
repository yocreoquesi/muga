# Feature: #1507 — one-click "Report this page" via the broken-site form

## Objective

Reporting the page you are on took about 8 steps, and the Settings report
bypassed the issue forms (`issues/new?title&body`, no `template=`), so
reports arrived without `broken-site`/`needs-triage` (#1502) and skipped the
form's privacy acknowledgement. Give the popup a one-click link-out to the
`broken-site.yml` form, prefilled for the current tab (full URL included,
per the 2026-10-15 maintainer decision) plus a settings snapshot, and move
Settings onto the same builder.

## Problem / why

- `buildBrokenSiteReportFields` already targeted `broken-site.yml` but only
  unit tests called it; Settings hand-built a markdown body instead.
- The popup report was removed by ADR-0011 because it carried a consent
  form. The consent step now lives on GitHub (the form's required privacy
  checkbox), so a link-out keeps ADR-0011's reason intact.

## Scope

- `src/lib/broken-site-report.js` — `buildSettingsSnapshot`,
  `buildBrokenSiteReportUrl` (length cap, snapshot truncated first), fields
  builder prefills the full URL in its own field, carries `action` and
  `settings`, and passes the template's exact labels.
- `src/lib/cleaning-context.js` — carries `remoteRulesVersion`.
- `.github/ISSUE_TEMPLATE/broken-site.yml` — `url` field with the "Check
  this URL has no personal data before submitting" hint, new `action` and
  `settings` fields, stale "popup / options report buttons" text fixed.
- `src/popup/*` — "Report this page" button.
- `src/options/*` — Settings and the dev URL tester use the same link
  builder; `issues/new?title&body` path, the "Include the full URL" opt-in
  and its per-URL reset are deleted.
- Locales (7) — new `popup_report_page`; retired
  `report_include_full_url_label/_hint`.
- `docs/adr/0011-popup-glance-and-act.md` — note recording the link-out.

Route: delegated direct (one bounded writer; 2+ non-trivial files).

## Checklist

- [x] T1 Settings snapshot (non-default scalars from `SETTINGS_FIELDS`,
  `disabledCategories`, list counts + page-matching entries only, remote
  rules on/off + payload version)
- [x] T2 Fields builder + link builder with length cap; template fields
- [x] T3 Popup "Report this page" wiring + copy in 7 locales
- [x] T4 Settings report on the same builder (`buildPageReportLink`); opt-in
  checkbox, its per-URL reset and `issues/new?title&body` deleted
- [x] T5 ADR-0011 note
- [ ] T6 (out of allowed surface, follow-up) `CONTRIBUTING.md:11` should name
  the popup button too; dead `.report-include-url-*` rules in
  `src/options/options.css`

## Acceptance criteria

- Popup opens `issues/new?template=broken-site.yml&...` with hostname,
  version, browser, action, params, scoped params, full URL (own field),
  settings snapshot.
- Full URL only when http(s) and ≤ 2000 chars. Link ≤ 8000 chars; snapshot
  truncated first.
- Lists never leave the device in full.
- Settings and the dev tester produce the same link shape; no
  `issues/new?title=` path remains.

## Verification evidence

- T1 RED: `node --test tests/unit/report-settings-snapshot.test.mjs` →
  `SyntaxError: ... does not provide an export named 'buildSettingsSnapshot'`.
  GREEN: 13/13 pass.
- T2 RED: `node --test tests/unit/broken-site-report.test.mjs` →
  `does not provide an export named 'MAX_REPORT_LINK_LENGTH'`; then 3 fails
  until the template gained `action`/`settings`/the URL hint. GREEN: all pass.
- T2 RED: `cleaning-context.test.mjs` "#1507: carries the payload version"
  failed; GREEN after `remoteRulesVersion` was added.
- T3/T4 RED: `broken-site-report.test.mjs` → `does not provide an export
  named 'buildPageReportLink'`. GREEN: 52/52 with the snapshot tests.
- Popup wiring is pinned structurally in `report-button.test.mjs` (popup.js
  is browser-only); ratchet baseline 18 → 22 with rationale.
- Task close: `npm test` 9449 tests, 9448 pass, 0 fail, 1 skipped;
  `npm run lint:js` clean; `npm run test:integration` 233/233;
  `npm run check:i18n` ok; `npm run typecheck` clean.

## Commits

- 9083bb7 feat(report): prefill the broken-site form with full URL and settings snapshot (#1507)
- (this commit) feat(popup): one-click Report this page via the broken-site form (#1507)

## Next step

Push + PR are the maintainer's call. Follow-up T6 needs `CONTRIBUTING.md`
and `src/options/options.css` edits outside this writer's surface.
