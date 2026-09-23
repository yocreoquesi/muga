# Feature: retire /clean as a destination, without breaking the ?url= share link (#1356)

## Objective

Stop promoting `/clean` as a second destination for the URL-cleaning tool
(the landing already hosts the same tool inline at `#demo-tool`), while
preserving the `?url=` share link #1333 shipped: a shared `/clean?url=...`
link must still land on a working, already-cleaned result, not a bare
redirect that drops the query string or a landing that ignores it.

## Problem / why

#1262 raised "decide what happens to `/clean`" and left it open. #1356
(this issue) decides: retire it, because a second promoted destination for
one tool is a second thing to keep true. It also corrects two of its own
predecessor's assumptions after checking the code:

- Retiring does **not** remove the `web/` <-> `landing/clean/` byte-parity
  mirror (`ui.js`, `ui-view.js`, `param-insight.js`, `report-link.js`,
  `engine/`) — the landing loads those at runtime, so they stay.
- `?url=` only prefills-and-cleans today via `ui.init()`, which the landing's
  bootstrap deliberately never calls on page load (lazy, to keep the engine
  bundle off the critical path for a normal visit). A naive redirect to `/`
  would land on a tool that never runs, which is worse than a 404.

## Scope

- `landing/_redirects` (new) — Cloudflare Pages redirect file; `/clean` and
  `/clean/` -> the landing's tool anchor, preserving the query string, no
  loop.
- `landing/index.html` — eager tool start when `?url=` is present on load
  (bootstrap script only); retarget the two `https://muga.app/clean` links
  (platform card, footer) to the in-page anchor.
- `README.md` — retarget the link-bar entry.
- `tests/unit/docs-claims.test.mjs` (~104-120) — update the link-bar
  assertion to the new target instead of deleting it.
- `tests/unit/landing-inline-morph-source-guard.test.mjs` — new assertions
  for the eager-start-on-`?url=` behaviour.
- `tests/unit/landing-redirects-guard.test.mjs` (new) — pins `_redirects`
  content: correct source/destination/code, no loop, no accidental
  `/clean/*` splat that would break the still-served `landing/clean/`
  assets.
- `tools/build-web.mjs`, `web/README.md` — see "Technical finding" below:
  stop mirroring `web/index.html` into `landing/clean/index.html`, and
  delete the already-mirrored copy, so the retirement survives the next
  `npm run build:web`.

Out of scope: `web/index.html` itself (kept as a local dev-only preview of
the standalone tool — nothing serves it in production once `/clean` is
retired, and the repo's own mirror-drift test,
`tests/unit/web-engine-mirror.test.mjs`, never asserted index.html
byte-parity in the first place, only `ui.js`/`ui-view.js`/`param-insight.js`/
`report-link.js`); `web-ui-source-guard.test.mjs` (still exercises the still-
present `web/index.html`); the affiliate/creator-referral logic; anything
under `src/`.

## Technical finding (not in the issue's plan, verified before writing code)

`tools/build-web.mjs`'s `cpSync(WEB_DIR, LANDING_CLEAN_DIR, { recursive: true })`
mirrors the **entire** `web/` tree into `landing/clean/`, including
`index.html` (confirmed: `web/index.html` and `landing/clean/index.html` were
byte-identical before this change). The issue's plan says "deleting
`landing/clean/index.html` and nothing else" — literally true for the
committed tree, but deleting only the mirrored copy would not survive the
next `npm run build:web` (a required pre-commit check here), which would
silently recreate it from `web/index.html`. Fix: exclude `index.html` from
the `cpSync` filter, then delete the stale mirrored copy once. Confirmed this
does not fight any existing guard: `web-engine-mirror.test.mjs`'s parity loop
only lists `["ui.js", "ui-view.js", "param-insight.js", "report-link.js"]`,
never `index.html`, and CI's drift check (`git diff --exit-code -- web/engine
landing/clean`) passes once the excluded file is gone from both sides.

## Constraints

- The byte-parity mirror for `ui.js`/`ui-view.js`/`param-insight.js`/
  `report-link.js`/`engine/` must keep passing unchanged
  (`web-engine-mirror.test.mjs`).
- No redirect loop; `/clean` must not redirect back to `/clean`.
- The query string must survive the redirect encoded, unmodified.
- Landing eager-init must not put the engine bundle on the critical path for
  a normal visit (no `?url=`) — the lazy focusin/pointerdown path stays for
  everyone else.
- No em-dashes in any user-facing copy; es locale unaffected (no locale
  strings touched here). Artifacts in English.
- Cloudflare Pages' own docs do not explicitly document that a bare
  `_redirects` destination (no query string of its own) forwards the
  original request's query string automatically — this is standard for
  Netlify's format (which Pages' `_redirects` mirrors) but unconfirmed for
  Pages specifically. Flagged as unverifiable locally; see Progress.

## Acceptance criteria

- `landing/_redirects` redirects `/clean` and `/clean/` to `/#demo-tool`
  (or documents why the exact syntax differs), status 301, no loop.
- A `?url=` arriving at the landing prefills and cleans on load without
  requiring a click/focus first (structural test, since the bootstrap script
  is browser-only DOM code and the repo's own established convention for
  this exact file is a structural `readFileSync` scan, not a jsdom
  execution).
- Neither landing link still points at `https://muga.app/clean`.
- README link bar and `docs-claims.test.mjs` agree on the new target.
- `landing/clean/index.html` is gone and stays gone after `npm run
  build:web`.
- All existing tests (`web-engine-mirror`, `web-ui-source-guard`,
  `landing-headers-guard`, `docs-claims`, `landing-inline-morph-source-guard`)
  still pass.

## TDD

Mode: off (no project TDD config found in CONTRIBUTING.md/AGENTS.md).
Runner: `npm test` (node:test). RED observed before writing the redirect
file and the eager-init code (see Progress), then made GREEN; ordinary
checks apply everywhere else.

## Tasks

- [x] T1 Explore: confirm Cloudflare Pages serving model, the `web/` <->
  `landing/clean/` mirror mechanics, `?url=` prefill code path, and the two
  landing link locations. Route: inline (decision-only reads, <=3 files at a
  time plus targeted greps).
- [x] T2 Write this feature document and commit it alone.
  Route: inline.
- [x] T2b (out-of-scope, coordinator heads-up) Parallel PR #1364 removes
  `spr` from `TRACKING_PARAMS` (396 -> 395). It does not touch
  `landing/index.html`. Fixed the stale hardcoded copy at ~line 694 ("utm_*,
  fbclid, gclid, mc_cid, msclkid and 396 more") to match: 5 named, 395 total
  -> "and 390 more". Own commit (b375f5b), separate from T3-T7. Route: inline
  (one-line, mechanical, already-understood).
- [x] T3 Added `landing/_redirects` + `tests/unit/landing-redirects-guard.test.mjs`
  (commit 2cd3d85). RED observed (file missing -> ENOENT), then GREEN
  (10/10). Route: inline (one new small file + one new small test, both
  fully understood).
- [x] T4 Landing eager-init on `?url=`: modified the bootstrap script in
  `landing/index.html`, added 5 assertions to
  `tests/unit/landing-inline-morph-source-guard.test.mjs` (commit 2130da6).
  RED observed (3 of the 5 new assertions failed against the unmodified
  file), then GREEN (all 30 tests in the file, including every pre-existing
  one). Route: inline (one file, mechanical, already-understood change;
  existing test file extended, not rewritten).
- [x] T5 Retargeted the two `https://muga.app/clean` landing links to
  `#demo-tool` (commit 3b168c4). RED observed (3 new assertions failed),
  then GREEN (33/33). Route: inline (mechanical, same file as T4's edit).
- [x] T6 Retargeted the README link bar and updated
  `tests/unit/docs-claims.test.mjs` (commit 076ee6f). RED observed (link-bar
  assertion failed against the unmodified README), then GREEN (13/13).
  Route: inline (2 small, fully understood files).
- [x] T7 Stopped mirroring `web/index.html` into `landing/clean/` (`tools/
  build-web.mjs` filter), deleted the stale `landing/clean/index.html`, ran
  `npm run build:web` twice (confirmed no diff, index.html stays gone),
  updated `web/README.md` (and its mirrored `landing/clean/README.md`,
  refreshed by the build) to say `/clean` is retired (commit 309a6d8). RED
  observed (new existsSync assertion failed while the mirrored copy still
  existed), then GREEN (18/18 in web-engine-mirror.test.mjs, 53/53 across
  web-engine-mirror + web-boundary + web-ui-source-guard). Route: inline
  (small, mechanical, already-understood).
- [x] T8 Full check pass, see Progress below.

## Checks

`npm test`, `npm run lint:js`, `npm run typecheck`, `npm run check:web-boundary`,
`npm run build:web` (must leave no diff). Known flake:
`tests/unit/sign-rules.test.mjs` can fail at file level under full-suite load
on Windows (passes isolated) — rerun in isolation and report if it's the
only failure.

## Progress

- 2026-09-24: T1 done (exploration, see Technical finding above). T2 done,
  this document committed alone (b560c0f).
- 2026-09-24: T2b done (b375f5b) at the coordinator's request (parallel
  PR #1364).
- 2026-09-24: T3-T7 done, one commit each, RED observed before each
  implementation (see Tasks above for the exact per-task RED/GREEN
  evidence): 2cd3d85, 2130da6, 3b168c4, 076ee6f, 309a6d8.
- 2026-09-24: T8 full check pass, in this order:
  - `npm test`: 8039 tests, 8038 pass, 1 skipped (pre-existing, by design),
    0 fail. No `sign-rules.test.mjs` flake observed on this run.
  - `npm run lint:js`: clean, exit 0.
  - `npm run typecheck`: clean, exit 0 (required `npm install` first — this
    worktree had no `node_modules`; `@types/node` was missing, causing
    TS2688. Installing surfaced an unrelated pre-existing `package-lock.json`
    version drift (3.0.0 vs package.json's 3.1.0); reverted that file since
    it is unrelated to #1356).
  - `npm run check:web-boundary`: clean, exit 0.
  - `npm run build:web`: ran twice across the session; both times left
    `git diff --exit-code -- web/engine landing/clean` clean, and
    `landing/clean/index.html` stayed absent.
  - Working tree confirmed clean before the final report (only this
    document's edits remain to commit).

## Unverifiable locally

- Cloudflare Pages' actual runtime behaviour for `landing/_redirects`:
  whether a bare destination (no query string of its own) forwards the
  original request's `?url=` automatically. Documented for Netlify's format
  (which Pages' `_redirects` follows) but not explicitly stated in
  Cloudflare's own Pages docs. Verify post-deploy with:
  `curl -sD - -o /dev/null "https://muga.app/clean?url=https://example.com/p?utm_source=x"`
  and confirm the `Location` header keeps `?url=...` intact, matching the
  pattern `docs/ops/landing-deploy.md` already uses for verifying headers.
