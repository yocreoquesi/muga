# Feature: #1491 — test hardening for SW, options, and AMO release guards

## Objective

Close 8 non-blocking test-hardening advisories from the native reviews of
#1474 (PR #1486), #1473/#1479 (PR #1485), and #1481 (PR #1484).

## Scope / constraints

Test-hardening only. Two items required a minimal, directly-necessary
production fix to make the requested test meaningful (see item 3 below);
no other production behavior was changed. Branch `test/1491-sw-options-amo-hardening`
from `origin/main`. No push, no PR (per task instructions).

## Tasks

- [x] **1** — Structural guard pinning the leading `if (!prefs.enabled)`
      early return in the real `FORCE_FETCH_REMOTE_RULES` handler
      (`src/background/service-worker.js`). Added one anchored
      comment-tolerant regex test in `tests/unit/service-worker-patterns.test.mjs`.
      Bumped the #824 source-grep ratchet baseline by exactly 1 (97 -> 98),
      justified inline. Verified red (guard removed/reordered) -> green (real code).
- [x] **2** — Cross-reference comment added to
      `tests/unit/referer-beacon-privacy-ff.test.mjs` documenting the
      accepted tradeoff (behavioral coverage runs copies of the Firefox
      listener gates, linked to production only via `indexOf` source
      guards). No rewrite, comment only — the comment was missing.
- [x] **3** — `handleDevModeChange`'s rollback path (setDevMode rejects ->
      checkbox reverts, reveal skipped, no scroll/focus) had no test.
      **Discovery**: `setDevMode()` swallowed its own storage rejection
      internally and always resolved successfully, so the revert branch in
      `handleDevModeChange` was dead code — a real storage failure left the
      checkbox silently "on" with nothing persisted. Fixed `setDevMode()` to
      return a boolean (matching `setPrefs()`'s existing convention) and
      `handleDevModeChange` to gate on it. Added 2 Playwright e2e tests in
      `tests/e2e/options.spec.mjs` (direct toggle + the "View Aggressive
      privacy settings" nudge link), forcing `chrome.storage.local.set` to
      fail. Verified red against the pre-fix dead-code path -> green against
      the fix.
- [x] **4** — Replaced the raw `{`/`}` character-counting function-boundary
      trick (breaks on a brace inside a string/comment/regex) with a shared,
      tokenizer-aware `findMatchingBrace()`/`stripJsComments()` in the new
      `tests/unit/helpers/source-scan.mjs` (+ its own test file, 17 cases
      incl. red demonstrations of the old trick failing). Migrated every
      sibling test file using the identical trick (14 files, incl. the
      named `settings-activity-domain-stats.test.mjs`): content-cleaner-toast-sync,
      inline-affiliate-network-www-1101, options-dev-tools-gate,
      options-strip-globally-button, options-sync-save-failed,
      prev-version-persistence-1100, session-storage-race-1097,
      settings-activity-controls-relocation, settings-activity-ledger-copy,
      settings-activity-ledger (2 call sites), settings-activity-suspicious-params,
      strip-table-generated, strip-table-parity. `options-surfaced-prefs.test.mjs`
      (HTML div-depth counting) and `process-url-call-sites.test.mjs`
      (paren-depth for call args) use a related but distinct trick on a
      different construct — left out of scope; not the brace-counting
      function-boundary helper the issue names.
- [x] **5/6/7** — `tests/unit/amo-firefox-signing.test.mjs`:
      - 5: the "--source-dir variable never resolves (indirectly) to raw
        src/" guard silently passed on an unresolved variable
        (`lastVarAssignment` -> null -> `notEqual(null, "src")` passes).
        Now asserts the variable is actually assigned first; added a
        meta-test proving the old logic's silent pass.
      - 6: the Unpack-step assertions matched raw text, so a comment
        merely mentioning `dist/firefox`/`AMO_SOURCE_DIR=` would satisfy
        them. Added a quote-aware `stripHashComments()` and match against
        the stripped text; added a meta-test with a comment-only synthetic step.
      - 7: added coverage for the `dist/firefox/*.zip` exactly-one-match
        glob guard — extracts the real shell snippet from `release.yml`
        and runs it with `bash` against scratch dirs (0/1/2 zip files),
        skipping cleanly if bash is unavailable (mirrors
        `tests/unit/with-firefox-manifest.test.mjs`). Verified red (guard
        disabled) -> green (real guard).
- [x] **8** — Removed the unused `id: amo-unpack` step id in
      `.github/workflows/release.yml` (~line 178); confirmed nothing
      references `steps.amo-unpack` anywhere in the repo.

## Commits (this branch, `test/1491-sw-options-amo-hardening`)

1. `test: replace raw brace-counting with a comment/string/regex-aware boundary` — item 4
2. `test(sw): structural guard for FORCE_FETCH_REMOTE_RULES enabled gate (#1491)` — items 1, 2
3. `test(release): harden AMO signing guards, add zip-glob guard test (#1491)` — items 5-8
4. `fix(options): make handleDevModeChange's checkbox-revert path reachable (#1491)` — item 3

## Verification

TDD mode: not explicitly configured for this repo; ran ordinary functional
checks (existing `npm test` / `npm run test:integration` / `lint:js` /
`typecheck` conventions) plus explicit red->green demonstrations per item
(deliberately broken source, confirmed the new test fails, restored,
confirmed it passes) — see the final report for exact commands and results.
