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
- T2 (#1475): `714c419` — fix(sw): gate Firefox Referer suppression and
  beacon blocking on disabled/onboarding state (#1475)
- T3 (#1474 follow-up, native review advisory findings): this commit —
  see Follow-up section below.

## Follow-up (native review advisory findings, #1474 scope only)

Three advisory findings raised after native review approved the branch —
all scoped to #1474 (remote-rules), no further #1475 changes.

- [x] **F1** — `_remoteRulesDeps` now REQUIRES its `getGateOpen` argument
  (no default): `function _remoteRulesDeps(getGateOpen)` throws a
  `TypeError` when it is not a function, so a future call site that drops
  the argument fails loudly instead of silently defaulting to "always
  open." All 5 call sites (`PROCESS_URL`, `onStartup`, `onInstalled`,
  `ENABLE_REMOTE_RULES`, `FORCE_FETCH_REMOTE_RULES`) now pass a shared
  `_currentGateOpen` function. Structural guard in
  `tests/unit/service-worker-patterns.test.mjs` pins the no-default
  signature, the throw, and that every call site passes `_currentGateOpen`
  by reference — confirmed to fail (empirically, both ways) when a call
  site is reverted to `_remoteRulesDeps()` or the throw is removed.
- [x] **F2** (TOCTOU) — the gate is no longer read once at call time.
  `runRemoteRulesFetch` (`src/lib/remote-rules.js`) now calls
  `deps.getGateOpen()` right before `mergeIntoCache` — AFTER the network
  fetch and every validation step — so a user who flips `prefs.enabled`
  either way while a fetch is in flight (up to `FETCH_TIMEOUT_MS`, 15s)
  gets the correct outcome: re-enabling mid-fetch still gets the DNR rule
  written; disabling mid-fetch gets none. Falls back to a static
  `deps.gateOpen` boolean (default `true`) for callers with no live prefs
  source; fails CLOSED on a `getGateOpen` read error. Proven with real
  `runRemoteRulesFetch` calls in `tests/unit/remote-rules-integration.test.mjs`
  (flag flipped inside `fetchImpl` itself, after it resolves) — confirmed
  RED against a temporarily-reintroduced eager-read simulation, GREEN
  against the real late-read implementation.
- [x] **F3** — resolved the open question from the original report:
  `FORCE_FETCH_REMOTE_RULES` ("Update now") now checks `prefs.enabled`
  FIRST (mirroring `maybeFetchRemoteRules`'s gate order exactly) and
  returns `{ok:false, reason:"disabled"}` without fetching, instead of
  silently succeeding with a skipped DNR write. Updated the DRIFT-GUARD
  mirror `forceFetchRemoteRules()` in `service-worker-patterns.test.mjs`
  (new gate order + new case (0), all pre-existing mock prefs objects
  given explicit `enabled: true`). UI: `src/options/options.js`'s "Update
  now" click handler now shows a toast for `resp.reason === "disabled"`
  (previously: total silence, not misleading but unhelpful — a button that
  visibly does nothing reads as broken) via new key
  `optionsRemoteRulesUpdateDisabled`, added to ALL SEVEN locales (en, es
  peninsular, pt, de, fr, it, ja) — the codebase requires exact key parity
  across all locale modules (`tests/unit/i18n-locale-modules.test.mjs`),
  not just en/es. New source guard in `tests/unit/options-patterns.test.mjs`
  pins the click handler's new branch + locale-key existence.

Source-grep ratchets bumped (all with inline justification comments):
`service-worker-patterns.test.mjs` 90 -> 97 (source-grep-ratchet.test.mjs)
and 65 -> 70 (its own dedicated drift-guard.test.mjs); `options-patterns.test.mjs`
101 -> 105. service-worker.js and options.js remain non-importable in
Node, so the new structural guards have no behavioral alternative — each
was verified empirically to actually fail when the guarded invariant is
broken, not merely to assert the code exists.
