# Feature: #1503 — show the creator-affiliate choice explicitly at onboarding

## Objective

Make MUGA's default (creators' affiliate tags are kept) visible at setup,
with "Keep creators' affiliate tags" preselected and "Remove them too" one
click away, so a kept tag no longer reads as a bug (#1502).

## Problem / why

- The opt-out exists (Settings, Affiliate & creators, "Remove all affiliate
  tags from other sources" = `stripAllAffiliates`) but nothing surfaces it.
- Maintainer decision (2026-10-15): keep the default and the narrative; make
  the choice visible instead.

## Scope

- `src/lib/onboarding-affiliate-choice.js` (new): pure mapping
  (`affiliateChoiceFromPrefs`, `prefsPatchForAffiliateChoice`) plus a
  DOM-free `bindAffiliateChoice` that writes through the same `setPrefs`
  path as the Settings toggle. Nothing is written on load, so existing users
  and synced values are never overwritten.
- `src/onboarding/onboarding.html` / `.css` / `.js`: new radio-group section.
- `src/lib/locales/*.mjs` (all 7): `ob_affiliate_*` keys.
- Out of scope: changing the default, re-prompting existing users, ADR
  changes, a new pref, cleaner changes, migrations.

## Checklist

- [x] T1 logic + tests: pure module + wiring tests (RED observed, GREEN).
- [x] T2 UI + copy in 7 locales + copy tests.
- [x] T3 docs: none needed beyond this file (no user docs describe the
      onboarding layout; `docs/store-listing.md` does not mention it).

## Acceptance criteria

- Onboarding shows the choice; keep is preselected on a fresh install.
- Choosing remove writes `stripAllAffiliates: true`; back to keep writes
  `false`; the default stays `false`.
- An existing `true` is shown as remove and never rewritten on load.
- A failed write reverts the selection and shows an inline error.
- Copy in en/es/pt/de/fr/it/ja, peninsular Spanish, no em-dashes.

## Route

Delegated direct, single bounded writer (4+ non-trivial files).

## Verification evidence

| Command | Observed |
|---|---|
| `npm test` | 9498 tests, 9497 pass, 0 fail, 1 pre-existing skip |
| `npm run lint:js` | clean |
| `npm run test:integration` | 233/233 pass |
| `npm run check:i18n` | ok |
| `npx tsc -p jsconfig.json` | clean |
| `npx playwright test tests/e2e/onboarding.spec.mjs tests/e2e/onboarding-regression.spec.mjs` | 12/12 pass |
| Throwaway real-Chromium smoke (not committed) | keep preselected; nothing written on load (`stripAllAffiliates` unset); clicking remove wrote `true`; reload showed remove; clicking keep wrote `false`; no page errors |

## Progress

- T1: RED `node --test tests/unit/onboarding-affiliate-choice.test.mjs`
  failed (module not found). GREEN: 13/13 pass. The "early keep click while
  the read is in flight" case was RED against the first draft (`stored`
  initialised to keep skipped the write), fixed by initialising it to null.
- T2: RED copy test 9/9 fail (keys missing), GREEN after adding keys.
