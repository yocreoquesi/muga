# Feature: #1508 - gate the popup rate nudge on active days

## Objective

Make the popup rate nudge reach people who actually use MUGA, on every
browser, without ever becoming pushy.

## Problem / why

The nudge required `stats.urlsCleaned >= 200` plus 7 days since install. On
Chrome the DNR network layer does most of the cleaning and never moves
`urlsCleaned` (#1496/#1497), so most Chrome users never reached 200 and the
nudge almost never showed. Ratings are the main ranking signal we can
influence.

## Scope

- `src/lib/rate-nudge.js` (new): pure gate `shouldShowRateNudge`, active-day
  counter `planActiveDayUpdate` / `createActiveDayRecorder`,
  `isActiveDayDecision`, `toLocalDayIndex`, threshold constants.
- `src/lib/storage.js`: `getActiveDays()` reader (kept out of
  `STAT_DEFAULTS` so "reset stats" does not re-arm the nudge).
- `src/background/service-worker.js`: count a day on any cleaning, unwrap,
  detection or preserve decision (`PROCESS_URL` and `recordNetworkClean`,
  which covers `BADGE_AND_STATS` and the Firefox webRequest stripper), only
  when `prefs.enabled && prefs.onboardingDone`.
- `src/popup/popup.js` / `popup.html`: count the popup open as an active day,
  call the pure gate, add a dismiss button; `urlsCleaned >= 200` gate removed.
  Session guard and `getRateUrl()` kept.
- Stored state: only `activeDaysCount` (integer) and `activeDaysLastDay`
  (integer local-day index) in `chrome.storage.local`. No dates list, no sites.
  `firstUsed` is reused for "days since first use" (no parallel field).

## Constraints

- Same-day dedupe; safe under concurrent writers: the write is absolute
  (`count+1` computed from one read), so two contexts racing on the same day
  both write the same value; the recorder also memoizes the counted day and
  single-flights its read.
- No new locale keys: the dismiss button reuses `toast_dismiss` for its
  `aria-label` and the migration banner's existing close-button class.

## Route

Delegated direct, single bounded writer (2+ non-trivial files).

## Tasks

- [x] T1: pure gate + active-day counter + `tests/unit/rate-nudge.test.mjs`
- [x] T2: wiring (popup open + dismiss, SW decision ping, `getActiveDays`)
- [x] T3: CHANGELOG: no `Unreleased` section convention in `CHANGELOG.md`
      (sections are written at release time), so no entry added. N/A.

## Acceptance criteria

- Nudge shows only when >= 14 active days AND >= 21 days since `firstUsed`.
- Only on a user-opened popup; never a toast or notification.
- At most 2 showings ever, >= 14 days apart.
- Clicking the nudge or its dismiss button silences it permanently.
- No `urlsCleaned` gate; session guard and `getRateUrl()` unchanged.
- Paused or pre-onboarding MUGA neither counts days nor shows the nudge.

## Verification

| Command | Result |
|---|---|
| RED: `node --test tests/unit/rate-nudge.test.mjs` (before `src/lib/rate-nudge.js` existed) | fail: `ERR_MODULE_NOT_FOUND` for `src/lib/rate-nudge.js` |
| GREEN: `node --test tests/unit/rate-nudge.test.mjs` | 25/25 pass |
| `npm test` | 9460 tests, 9459 pass, 0 fail, 1 pre-existing skip |
| `npm run lint:js` | clean |
| `npm run test:integration` | 233/233 pass |

Not covered by automated tests: the popup and service-worker wiring itself
(popup.js is browser-only; a source-grep wiring test was skipped to avoid
growing the #824 ratchet baseline). Manual browser check still pending.

## Follow-ups (outside this change's edit surface)

- `src/options/options.js` developer "preview rating nudge" still renders
  `shown=N/3` and cycles at 3; the real maximum is now 2.
