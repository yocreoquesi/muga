# MUGA Clean (web/) — standalone web cleaner tool

A static, client-side page that reuses MUGA's real cleaning engine to strip
tracking parameters and unwrap known redirect wrappers from a pasted URL,
entirely in the browser. No server, no analytics, no account, nothing about
the URL you paste ever leaves your device. MUGA cleans your links and never
adds its own affiliate tag. Any existing affiliate or creator referral tag is
respected by default, never stripped or overwritten; stripping third-party
tags is an optional extra you control.

Served in production at `muga.app/clean/` (see `landing/clean/` below).

## The one-way boundary (read this before touching anything here)

```
src/  ──never imports──>  web/
web/  ──never imports──>  src/          (except the generated engine copy)
```

`web/` is a standalone tool that happens to reuse MUGA's cleaning logic. It
is architected as three concentric layers, dependencies pointing inward
only (`sdd/web-cleaner-tool/design`, ADR-1):

- **Engine** (`web/engine/cleaner-bundle.js`, `web/engine/domain-rules.json`,
  `web/engine/domain-rules.gen.mjs`) — **generated, never hand-edited.**
  Byte-identical / deterministically-derived copies of
  `src/content/cleaner-bundle.js` and `src/rules/domain-rules.json`. This is
  the ONLY coupling to MUGA core, and it is a build artifact, not an import.
- **Adapter** (`web/engine/adapter.js`) — the ONLY authored module allowed to
  reference `window.__mugaCleaner`. Translates MUGA's internal `processUrl`
  return shape into a small, stable contract (`cleanUrl(input)`). If MUGA's
  internal API ever shifts, only this file changes.
- **UI** (`web/index.html`, `web/ui.js`, `web/ui-view.js`) — depends solely
  on the adapter's exported `cleanUrl()` contract. No knowledge of
  `processUrl` or `__mugaCleaner`.

`src/` must never import anything from `web/` or `landing/clean/`, and
`web/` (and its generated mirror) must never import anything from `src/`
other than through the generated engine copy above. This is enforced by:

- `npm run check:web-boundary` (`tools/check-web-boundary.mjs`) — scans
  every file under `web/`, `landing/clean/`, and `src/` for cross-references
  and fails the build if any are found.
- `tests/unit/web-boundary.test.mjs` — the same check, runnable locally
  under `npm test`.
- CI (`ci.yml`) runs both of the above on every push.

## Why the engine copies are generated, and why you must never hand-edit them

`web/engine/cleaner-bundle.js` is regenerated from
`src/content/cleaner-bundle.js` (itself built by `npm run build:content`).
`web/engine/domain-rules.json` and `web/engine/domain-rules.gen.mjs` are
regenerated from `src/rules/domain-rules.json`. All of it is written by:

```
npm run build:web
```

(`tools/build-web.mjs`). This script also mirrors the entire `web/` tree
into `landing/clean/`, which the Cloudflare Pages project that serves
muga.app picks up automatically (its build output directory is `landing/`) —
that mirror is how `muga.app/clean/` gets deployed, with zero new
infrastructure.

If you edit `web/engine/cleaner-bundle.js`, `web/engine/domain-rules.json`,
`web/engine/domain-rules.gen.mjs`, or anything under `landing/clean/`
directly, your changes will be silently overwritten (or, worse, cause a CI
failure) the next time `npm run build:web` runs. **Always edit the source
of truth in `src/` and regenerate.**

`web/engine/domain-rules.gen.mjs` exists (alongside the JSON copy) because
`web/engine/adapter.js` originally loaded `domain-rules.json` via
`import ... with { type: "json" }`, which has limited support in older
browsers. `domain-rules.gen.mjs` is a plain named-export ES module
(`export const DOMAIN_RULES = [...]`) with the exact same data, so every
module-supporting browser can load it with a normal `import`, no
import-attribute syntax required. It follows the same convention as
`src/rules/manifest.data.js` and `src/rules/wrappers.data.js`.

CI regenerates all of the above and `git diff`s the result; if it does not
match what is committed, CI fails with instructions to run `npm run
build:web` and commit. `tests/unit/web-engine-mirror.test.mjs` is the local
(pre-PR) version of that same check.

## Running and developing locally

```
npm run build:web            # regenerate the engine copies + landing/clean/ mirror
npm run test:serve:web        # serve web/ at http://localhost:5557/
```

Then open `http://localhost:5557/` in a browser. Any change to
`web/index.html`, `web/ui.js`, or `web/ui-view.js` is picked up on refresh
(no build step for these — they are plain ES modules and a static page).

If you change anything under `src/content/` or `src/rules/domain-rules.json`
that the web tool depends on, re-run `npm run build:web` and commit the
regenerated files alongside your source change.

## Tests

- `tests/unit/web-adapter.test.mjs` — adapter behavior against a fake
  injected engine (input validation, pure-cleaner prefs, mapping,
  degradation).
- `tests/unit/web-adapter-contract.test.mjs` — the dirty-to-expected grid
  against the REAL bundle (loaded DOM-free via
  `tests/unit/helpers/load-web-engine.mjs`); a breaking MUGA engine change
  fails this suite before any UI code needs to change.
- `tests/unit/web-ui-view.test.mjs` — unit tests for the pure
  `web/ui-view.js` formatting layer.
- `tests/unit/web-ui-source-guard.test.mjs` — structural `readFileSync`
  checks over `web/index.html` / `web/ui.js` (security boundary, copy style
  constraints, accessibility) since the DOM-wiring code cannot be exercised
  under `node:test`.
- `tests/unit/web-engine-mirror.test.mjs`, `tests/unit/web-engine-purity.test.mjs`,
  `tests/unit/web-boundary.test.mjs` — drift and boundary guards described
  above.
- `tests/browser/web-clean.html` — manual test battery against the real
  running tool (`npm run test:serve:web`): tracking-param strip, wrapper
  unwrap, affiliate preservation, no-op, and negative cases.

## Non-goals (first slice)

- Path-based shortener resolution (`bit.ly`, `t.co`, ...) — requires a
  network fetch, which would break the "nothing leaves your device"
  guarantee.
- Accounts, saved history, or any persisted state.
- Any server-side processing.
- Locales beyond English.
