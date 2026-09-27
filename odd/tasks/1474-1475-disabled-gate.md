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
- T3 (#1474 follow-up, native review advisory findings): `e6c3981` —
  fix(sw): require a live gate re-check for remote-rules DNR writes
  (#1474 follow-up)
- T4 (#1474 follow-up round 2, native review advisory): this commit —
  see Follow-up round 2 section below.

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

## Follow-up round 2 (native review advisory, #1474 scope only)

One advisory finding after native review approved the round-1 follow-up:
`FORCE_FETCH_REMOTE_RULES` collapsed three different gates (master
`enabled` off, `remoteRulesEnabled` off, onboarding pending) into the same
`reason:"disabled"` string, so the round-1 "Update now" toast would have
fired the wrong ("MUGA is disabled") message for the latter two.

- [x] Distinct reason strings per gate in `FORCE_FETCH_REMOTE_RULES`
  (`src/background/service-worker.js`): `"disabled"` (master toggle,
  unchanged), `"remote_rules_off"` (the feature's own pref, was
  `"disabled"`), `"onboarding"` (consent pending, was `"disabled"`).
- [x] `options.js`'s toast condition (`resp?.reason === "disabled"`)
  needed NO code change — it already checked the exact string, so it now
  correctly fires ONLY for the master-disabled case. Comment updated to
  explain why the other two stay silent: both are rarely-reachable races
  (the button lives inside a section hidden while `remoteRulesEnabled` is
  false; there is no options-page path at all while onboarding is
  pending), and no accurate existing string was found for either — per
  instruction, no new copy was invented for them.
- [x] DRIFT-GUARD mirror `forceFetchRemoteRules()` in
  `service-worker-patterns.test.mjs` updated to return the same three
  distinct reasons; existing tests (a)/(b) updated to expect
  `"remote_rules_off"` / `"onboarding"`; new test asserts all three gates
  yield pairwise-distinct reasons and that only `"disabled"` matches what
  the UI toast checks for. Confirmed RED (reverted the mirror's two
  reasons back to `"disabled"`, both existing tests plus the new
  distinctness test failed exactly as expected) then GREEN.
- [x] Confirmed (report only, no code change needed): `_currentGateOpen`'s
  prefs cache IS invalidated on `chrome.storage.onChanged` — the `area ===
  "sync"` branch (service-worker.js ~line 759) unconditionally calls
  `_invalidatePrefsCache()` on ANY sync change, which covers `prefs.enabled`
  (a sync pref per `PREF_DEFAULTS` in `src/lib/prefs.js`); the `area ===
  "local"` branch invalidates on `changes.mugaConsent` (~line 732-733),
  which covers `onboardingDone` via the consent overlay. So a toggle
  flipped mid-fetch is visible to the next `getPrefsWithCache()` call
  inside `_currentGateOpen()`, confirming the TOCTOU fix (round 1) works
  against the real caching layer, not just synthetic test prefs.

No new source-grep ratchet increments this round (all new assertions in
`service-worker-patterns.test.mjs` exercise the pure `forceFetchRemoteRules()`
mirror, not `swSource` text). One structural-test window in
`options-patterns.test.mjs` widened (1700 -> 2500 chars) after the
click-handler comment grew — same window-drift pattern as earlier rounds.
