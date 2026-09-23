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
- [ ] T2b (out-of-scope, coordinator heads-up) Parallel PR #1364 removes
  `spr` from `TRACKING_PARAMS` (396 -> 395). It does not touch
  `landing/index.html`. Fix the stale hardcoded copy at ~line 694 ("utm_*,
  fbclid, gclid, mc_cid, msclkid and 396 more") to match: 5 named, 395 total
  -> "and 390 more". Own small commit, separate from T3-T7. Route: inline
  (one-line, mechanical, already-understood).
- [ ] T3 Add `landing/_redirects` + `tests/unit/landing-redirects-guard.test.mjs`
  (RED first: file/test doesn't exist -> assertion fails; then create the
  file and observe GREEN). Route: inline (one new small file + one new small
  test, both fully understood).
- [ ] T4 Landing eager-init on `?url=`: modify the bootstrap script in
  `landing/index.html`, add assertions to
  `tests/unit/landing-inline-morph-source-guard.test.mjs` (RED first against
  the unmodified file, then GREEN). Route: inline (one file, mechanical,
  already-understood change; existing test file extended, not rewritten).
- [ ] T5 Retarget the two `https://muga.app/clean` landing links to
  `#demo-tool`. Route: inline (mechanical, same file as T4's edit).
- [ ] T6 Retarget the README link bar and update
  `tests/unit/docs-claims.test.mjs`. Route: inline (2 small, fully
  understood files).
- [ ] T7 Stop mirroring `web/index.html` into `landing/clean/` (`tools/
  build-web.mjs` filter), delete the stale `landing/clean/index.html`, run
  `npm run build:web` and confirm no diff, update `web/README.md` (and its
  mirrored `landing/clean/README.md`, refreshed by the build) to say `/clean`
  is retired. Route: inline (small, mechanical, already-understood).
- [ ] T8 Full check pass (`npm test`, `lint:js`, `typecheck`,
  `check:web-boundary`, `build:web` no-diff), record results here, final
  commit(s).

## Checks

`npm test`, `npm run lint:js`, `npm run typecheck`, `npm run check:web-boundary`,
`npm run build:web` (must leave no diff). Known flake:
`tests/unit/sign-rules.test.mjs` can fail at file level under full-suite load
on Windows (passes isolated) — rerun in isolation and report if it's the
only failure.

## Progress

- 2026-09-24: T1 done (exploration, see Technical finding above). T2 done,
  this document committed alone.
