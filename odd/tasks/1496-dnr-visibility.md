# Feature: #1496 — make Chrome network-layer cleans visible without new permissions

## Objective

On Chrome, MUGA's `declarativeNetRequest` rules clean tracking links at the
network layer, before any JS (including the popup's own check) ever sees the
dirty URL. That made a huge share of real Chrome cleans invisible: the
popup's "this page" block only ever said "already clean", the stats
counters and the "N stripped in this tab" chip never moved, and the store
screenshot + copy implied a live before/after the average Chrome user almost
never sees. Fix the visibility gap using only permissions MUGA already has,
make the copy honest about what is and isn't counted, replace a vacuous e2e
assertion with real per-path proof, and regenerate the misleading store
image.

## Problem / why

- `chrome.declarativeNetRequest.getMatchedRules({ tabId })` is available to
  any extension holding `activeTab` for the queried tab — granted for free
  the moment the user opens the popup — and calls made from a user gesture
  are exempt from its 20/10min quota. Confirmed against current Chrome docs
  (https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-getMatchedRules):
  "This method is only available to extensions with the
  `declarativeNetRequestFeedback` permission or having the `activeTab`
  permission granted for the `tabId` specified in filter." MUGA's manifest
  carries `activeTab` already (`src/manifest.json`) — no new permission.
- `setExtensionActionOptions({ displayActionCountAsBadgeText })` was
  evaluated and rejected: per Chrome's own docs, without the
  `declarativeNetRequestFeedback` permission (which MUGA does not have and
  this issue must not add), the automatic badge text falls back to a
  placeholder rather than a real count. It would also fight the existing
  native `chrome.action.setBadgeText` badge (#910,
  `src/background/toolbar-badge.js` + `src/lib/toolbar-presenter.js`),
  which already respects `prefs.enabled && onboardingDone` and carries its
  own tooltip/color logic undocumented interaction with the declarative
  path. Decision: keep the existing toolbar badge architecture unchanged;
  add the new per-tab visibility to the popup's existing "N stripped in
  this tab" chip instead, sourced from `getMatchedRules` only when nothing
  JS-driven happened in that tab.
- `getMatchedRules` returns `{ ruleId, rulesetId, tabId, timeStamp }` per
  match — no URL, no rule body. Not every MUGA rule that can match is a
  "cleaned" signal (the signed-URL allow guard, allowlist allow rules,
  Referer/beacon privacy rules) — counting those would silently overcount,
  the same class of honesty bug the vacuous e2e assertion below let
  through. `src/lib/dnr-visibility-view.js` classifies matches against the
  authoritative registry in `src/lib/dnr-ids.js`.

## Scope

- `src/lib/dnr-visibility-view.js` (new) — pure classifier:
  `isCleaningMatch(match)`, `planDnrVisibilityView(matchedRulesList)`.
- `src/popup/popup.js` — `getDnrVisibilityView(tabId)` (Chrome-only
  feature-detected, silent on any failure/quota), wired into the tab-badge
  chip and into `renderCountCelebration`'s "already clean" branch.
- `src/popup/popup.html` / `.css` — new `#stats-dnr-note` caveat under the
  lifetime stats block, hidden on Firefox and during the fresh-install
  zero state.
- `src/lib/locales/*.mjs` (all 7) — new keys `preview_dnr_cleaned`,
  `tab_badge_dnr_label`, `stats_dnr_note`.
- `tests/unit/dnr-visibility-view.test.mjs` (new) — 16 cases covering every
  rule family in `dnr-ids.js`.
- `tests/e2e/url-cleaning.spec.mjs` — replaced the vacuous
  `toBeGreaterThanOrEqual` stats assertion with two honest tests (see
  Verification).
- `tools/screenshots/components.js`, `templates.js`, `kit.css` —
  `popup()` gained a `mode: "cleaned" | "dnr"` branch; `ss4` now renders
  Chrome with `mode: "dnr"` and Firefox with the original `mode: "cleaned"`
  (Firefox's blocking webRequest stripper genuinely sees the dirty URL, so
  its before/after mock stays accurate). Lede copy no longer promises the
  before/after on every page.
- `docs/assets/store-4-this-page-popup-1280x800.png` and
  `firefox-store-4-this-page-popup-1280x800.png` — regenerated.
- `README.md`, `landing/index.html` — alt text for the store-4 image no
  longer claims a universal before/after.
- Out of scope / explicitly not done: `docs/store-listing.md`'s "shows you
  a clear before and after" line is about the copy/right-click flow (always
  JS-driven, never DNR-blind) — accurate, left unchanged.  Landing's
  `muga.app/clean` web-tool copy ("you see what came off and why") is about
  the always-JS-driven web tool, not the extension popup — accurate, left
  unchanged.

## Constraints

- No new entries in `src/manifest.json` or `src/manifest.v2.json`
  `permissions`/`optional_permissions`. Verified: `git diff origin/main --
  src/manifest.json src/manifest.v2.json` is empty.
- Vanilla JS, ES modules in `src/lib/`, feature-detect every `chrome.*`
  call, `textContent` only, WHY comments, `(#1496)` references.

## Route

Delegated-direct, single writer (this session). Files touched: 18 modified
+ 2 new — well past the 2-file mechanical-inline threshold, so this ran as
one bounded writer session rather than a sequence of inline edits.

## TDD mode

Off — no project TDD config found (`AGENTS.md` has no TDD directive, no
`.tdd` marker). Ran ordinary functional checks with explicit red→green
evidence where a real behavioral bug was found (see Verification: the SPA
stats e2e test failed twice for two different real reasons before landing
green — see notes below).

## Verification

| Command | Result |
|---|---|
| `npx tsc -p jsconfig.json` (typecheck) | clean |
| `npm run lint:js` (eslint) | clean |
| `npm run check:i18n` | ok — no FIXME/stub/empty locale slots |
| `npm test` (unit) | 9405/9406 pass, 1 pre-existing skip, 0 fail |
| `npm run test:integration` | 233/233 pass |
| `npx playwright test tests/e2e/url-cleaning.spec.mjs tests/e2e/popup.spec.mjs` | 14/14 pass |
| `npx playwright test` (full suite) | 164 pass, 1 fail (`toolbar-badge.spec.mjs` "no digit is shown for a fresh tab"), 3 skipped. Re-ran that spec file alone: 10/10 pass. Pre-existing full-suite-order flake unrelated to this change — it fails only when run after unrelated earlier spec files in the same serial Playwright run, not when isolated, and it runs on unmodified toolbar-badge/onboarding-badge code this change never touches. |
| `npm run lint` (web-ext, not piped) | 0 errors, 5 warnings: 2 pre-existing (`lib/i18n.js` innerHTML, unrelated), 3 new expected `UNSUPPORTED_API` notices for `declarativeNetRequest.getMatchedRules` in `popup/popup.js` (Firefox doesn't implement it — exactly why the call is feature-detected; not an error) |
| `git status` | clean after each commit |
| `git diff origin/main -- src/manifest.json src/manifest.v2.json` | empty — no permission change |
| Known env failure | polyfill integrity check fails on Windows CRLF checkout (pre-existing, documented in AGENTS.md context, not triggered by this change) |

### Red → green note (SPA stats e2e test)

The second new e2e test (SPA pushState increments stats) went through two
real failed iterations before passing, each pinning a genuine discovery
rather than a tooling mistake:

1. First attempt used `utm_source`/`utm_medium` in the pushState URL — these
   are in the sync main-world hot-path STRIP subset
   (`src/lib/hot-path-strip.js`), so they never survive to the async
   isolated-world reclean pipeline this test exists to prove. Fixed by
   switching to `clickid` (a `TRACKING_PARAMS` entry deliberately absent
   from the hot-path subset).
2. Second attempt tried to synchronize on a page-world
   `history.replaceState` call counter (mirroring
   `tests/e2e/history-defuser-reclean.spec.mjs`). Empirically, the isolated
   world's own `history.replaceState()` call does not route through a
   main-world monkey-patch of the same-named method (Chrome isolated worlds
   get their own reference to built-in DOM methods) — confirmed by direct
   instrumentation: the URL cleaned and `stats.urlsCleaned` incremented
   while the page-world counter stayed at 0. The existing Amazon-host test
   this pattern was copied from only asserts an UPPER bound
   (`toBeLessThanOrEqual(2)`), which a stuck-at-0 counter also satisfies —
   it never actually proved that signal fires from the isolated world.
   Replaced with the repo's existing `waitForDnrPropagation` fixed-wait
   convention (#824), which is honest about the same debt this file
   already carries elsewhere.

## Acceptance criteria

- Popup shows "MUGA cleaned this link before it loaded" (not the generic
  "already clean") when Chrome's DNR matched one of MUGA's cleaning rules
  on the tab, with the per-tab count folded into the existing chip.
- Firefox and still-dirty-URL paths keep the existing before/after + %
  branch unchanged.
- Stats block copy discloses under-counting on Chrome only, not
  unconditionally.
- `tests/e2e/url-cleaning.spec.mjs`'s stats test asserts real per-path
  behavior: DNR-only nav → no count change (documented limitation); SPA nav
  DNR can't see → strict increase.
- Store-4 Chrome image shows the state a Chrome user actually sees; Firefox
  image unchanged in substance (still accurate for Firefox).
- No new manifest permissions.

## Progress

All tasks complete. Work-unit commits on `fix/1496-dnr-visibility`
(branched from `origin/main`, worktree
`.claude/worktrees/agent-af00921bd97c0dce1`):

1. `feat(popup): show DNR network-layer cleans on Chrome without new permissions (#1496)` —
   `src/lib/dnr-visibility-view.js`, its unit tests, `popup.js` wiring.
2. `feat(i18n): add DNR-visibility copy to popup and stats block, all 7 locales (#1496)` —
   locale files, `popup.html`/`.css`.
3. `test(e2e): replace vacuous stats assertion with honest per-path proof (#1496)` —
   `tests/e2e/url-cleaning.spec.mjs`.
4. `fix(assets): regenerate store-4 popup screenshot for Chrome's DNR-cleaned state (#1496)` —
   `tools/screenshots/*`, `docs/assets/*store-4*`, `README.md`,
   `landing/index.html`.
5. `docs(odd): add #1496 DNR-visibility task doc` — this file.

No push, no PR (per instructions).
