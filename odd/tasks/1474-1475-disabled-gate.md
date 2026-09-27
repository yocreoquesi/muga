# Feature: #1474 / #1475 — disabled-state guard for remote-rules DNR and Firefox Referer/beacon

## Objective

Close two audit-confirmed holes where MUGA kept acting after the user
disabled it, violating AGENTS.md's "every user-facing feature must check
`prefs.enabled && prefs.onboardingDone`" rule.

## Scope

- T1 (#1474): weekly remote-rules fetch re-arms DNR rule 1001 and the
  3100-5099 scoped range on Chrome while disabled, right after
  `applyDnrState`'s gate-closed branch tore them down.
- T2 (#1475): Firefox Referer suppression / beacon blocking act while
  disabled or before onboarding.

## Tasks

- [x] **T1** — Gate `maybeFetchRemoteRules` (`src/background/remote-rules-wake.js`)
  on `prefs.enabled`, alongside the existing `remoteRulesEnabled` /
  `shouldOpenOnboarding` checks. Decision: also skip the fetch itself (not
  just the DNR write) — privacy-consistent, matches "disabled means no
  outbound requests." Defense-in-depth: `mergeIntoCache`
  (`src/lib/remote-rules.js`) takes a `gateOpen` option (default `true`,
  back-compat) and skips ALL `dnr.updateDynamicRules` calls (global rule +
  scoped range) while closed, still writing the cache so
  `reconcileRemoteDnrRule` (dnr-sync.js) can rebuild on the next gate-open.
  `runRemoteRulesFetch` threads `deps.gateOpen` through. Production
  `_remoteRulesDeps(gateOpen)` in service-worker.js defaults to `true`
  (wake path already gates before calling) and the `ENABLE_REMOTE_RULES` /
  `FORCE_FETCH_REMOTE_RULES` handlers pass their own freshly-read
  `prefs.enabled && prefs.onboardingDone`.
- [x] **T2** — Gate `onBeforeSendHeadersSuppressReferer` and
  `onBeforeRequestBlockBeacons` (`src/background/service-worker.js`) on
  `!cachedPrefs.enabled || !cachedPrefs.onboardingDone`, returning early
  before the URL parse — mirrors `computeNavigationStrip`'s existing gate
  and Chrome's DNR gate-closed teardown (dnr-sync.js).

## Constraints

- TDD mode: off (no project/session config found). Each fix still needs a
  regression test observed RED before the fix and GREEN after.
- No `cleaner.js` changes — no bundle rebuild required.
- Conventional commits, one work unit per issue, no AI attribution.

## Checks

- `npm run typecheck` — pass
- `npm run lint:js` — pass
- `npm test` — 9254 pass / 1 pre-existing skip
- `npm run test:integration` — 233 pass
- `git status --short` — clean after each commit
- `node tools/verify-polyfill-integrity.mjs` — known Windows CRLF-only
  failure, ignored per task instructions

## Progress

- T1 red→green: `tests/unit/remote-rules-wake.test.mjs` (disabled extension
  makes zero fetch attempts), `tests/unit/remote-rules.test.mjs`
  (`mergeIntoCache` gateOpen:false → zero DNR calls, cache still written),
  `tests/unit/remote-rules-integration.test.mjs` (`runRemoteRulesFetch`
  gateOpen:false end-to-end). All three confirmed failing pre-fix, passing
  post-fix.
- T2 red→green: `tests/unit/referer-beacon-privacy-ff.test.mjs` — behavioral
  mirror cases (`computeSuppressRefererDecision` /
  `computeBlockBeaconDecision`) for enabled:false / onboardingDone:false,
  plus two source guards pinning the production gate's existence and
  position. Source guards confirmed failing when the two production gate
  lines were removed, passing once restored. Every pre-existing test in
  this file updated to carry explicit `enabled: true, onboardingDone: true`
  (they implicitly assumed it before the gate existed).
- Source-grep ratchet (#824): `referer-beacon-privacy-ff.test.mjs` baseline
  raised 30 -> 34 (two new source guards, minimized to 2 `indexOf` calls
  each instead of 3) — service-worker.js is not importable in Node, no
  behavioral proxy exists for "the gate exists in production at this exact
  position."

## Commits

- T1 (#1474): `c1b3fb3` — fix(sw): keep remote-rules fetch from re-arming
  DNR while disabled (#1474)
- T2 (#1475): this commit (see `git log --oneline -1` on the branch tip) —
  fix(sw): gate Firefox Referer suppression and beacon blocking on
  disabled/onboarding state (#1475)
