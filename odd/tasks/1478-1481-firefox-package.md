# #1478 + #1481 — Firefox manifest data collection + AMO packaging

## Objective
Fix two audit findings (2026-09-27, audited at ebda114), both targeted at the
3.2.0 release:

- **#1478**: `src/manifest.v2.json` declares an optional `technicalAndInteraction`
  data-collection permission MUGA never requests. Firefox shows this as an
  install-time opt-in toggle and on the AMO listing, contradicting the
  "no telemetry" copy.
- **#1481**: The AMO submission step in `.github/workflows/release.yml` signs
  raw `src/` with `web-ext sign`, bypassing `tools/strip-test-seams.mjs`. The
  published Firefox XPI ships live test seams (`lib/test-fixtures.js`,
  `__MUGA_TRUSTED_KEYS__` override) and stray build-only files
  (`manifest.v3.json`, `rules/manifest.json`, `icons/newicon.png`).

## Problem / why
- #1478: no code anywhere requests a data-collection permission (verified —
  `permissions.request` hits are unrelated host-permission calls in
  options.js). AMO's `technicalAndInteraction` type is the one optional type
  shown in the install flow itself per Mozilla docs, so this is a real,
  user-visible trust mismatch, not a false positive.
- #1481: `scripts/with-firefox-manifest.sh` backs up `src/manifest.json` to
  `src/manifest.v3.json` **inside** `src/` before swapping in the MV2
  manifest. `tools/strip-test-seams.mjs` copies the whole `--source-dir` into
  a temp dir before stripping — so while the backup sits in `src/`, both
  `build:firefox` (GitHub release zip) and the raw `web-ext sign` AMO call
  pick it up. AMO additionally never goes through `strip-test-seams.mjs` at
  all, so it ships completely unstripped test seams.

## Scope
- `src/manifest.v2.json` — drop `data_collection_permissions.optional`.
- `tests/unit/config-integrity.test.mjs` — assert `optional` is absent/empty.
- `scripts/with-firefox-manifest.sh` — write the manifest backup to a
  `mktemp` path outside `src/`, not `src/manifest.v3.json`.
- `.github/workflows/release.yml` — AMO submission signs the already-built,
  already-stripped `dist/firefox/*.zip` artifact (unpacked to a temp dir),
  not raw `src/`.
- `tests/integration/release-zip-hygiene.test.mjs` — extend forbidden-path
  check to catch a stray `manifest.v3.json` in a built zip.
- New structural guard(s) asserting release.yml never signs
  `--source-dir=src/` / `--source-dir src/` for AMO.
- Docs: none needed — no doc names the optional permission by category, so
  nothing else to reconcile.
- Out of scope: `name`/`description`/`version_name` in manifest.v2.json
  (owned by in-flight #1472 — untouched).

## Constraints
- TDD off, but each fix needs an observed red→green guard.
- One conventional commit per issue.
- Never push / open PR (explicit instruction).
- Keep MV2 manifest.v2.json's other fields for #1472 untouched.

## Tasks
- [x] T1 (#1478): Add/extend `config-integrity.test.mjs` assertion that
      `data_collection_permissions.optional` is absent or empty — observe
      RED against current manifest.
- [x] T2 (#1478): Drop `optional` from `src/manifest.v2.json` — observe
      GREEN. Commit `fix(firefox): drop unused optional data collection permission (#1478)`.
- [x] T3 (#1481): Add structural guard(s) — release.yml never signs raw
      `--source-dir=src/` for AMO; `with-firefox-manifest.sh` never backs up
      inside `src/`; built firefox zip never contains `manifest.v3.json` —
      observe RED against current release.yml / script.
- [x] T4 (#1481): Fix `scripts/with-firefox-manifest.sh` (mktemp backup
      outside `src/`) and `.github/workflows/release.yml` (AMO signs the
      already-stripped `dist/firefox` artifact) — observe GREEN. Commit
      `fix(release): sign the stripped Firefox artifact for AMO (#1481)`.

## Checks
- `npm run typecheck`
- `npm run lint:js`
- `npm run lint` (web-ext, not piped — verify src/manifest.json stays MV3 after)
- `npm test`
- `npm run test:integration`
- Local Firefox package build (`npm run build:firefox`) inspected for test
  seams / stray files — mirrors what the new guard checks.
- `git status --short` clean at the end.

## Progress
Route: direct inline (single writer already assigned to this bounded
worktree task; all files understood from exploration above, no further
sub-delegation needed).

- T1/T2 (#1478): commit 17f4ab9 `fix(firefox): drop unused optional data
  collection permission`. RED observed (new config-integrity assertion
  failed against unfixed manifest.v2.json), then GREEN (29/29 pass).
- T3/T4 (#1481): RED observed two ways —
  1. `tests/unit/amo-firefox-signing.test.mjs` failed against the unfixed
     `release.yml` (raw `--source-dir=src/`) and unfixed
     `with-firefox-manifest.sh` (`BACKUP="src/manifest.v3.json"`).
  2. Reproduced the real #1481 bug end-to-end: temporarily restored the
     pre-fix script, ran `npm run build:firefox`, confirmed the built zip
     really did contain a stray `manifest.v3.json` (3480 bytes), and that
     `tests/integration/release-zip-hygiene.test.mjs`'s new forbidden-path
     entry caught it (RED).
  Then applied both fixes (mktemp backup outside `src/`;
  `release.yml`'s AMO step now unzips the already-built, already-stripped
  `dist/firefox/*.zip` into `$RUNNER_TEMP` and signs that, dropping the
  manifest-swap wrapper for that step entirely) and re-ran everything GREEN:
  unit guard 5/5, `npm run build:firefox` produces a clean zip (146 files,
  no `manifest.v3.json`, no `newicon.png`, `lib/test-fixtures.js` is the
  470-byte inert stub), `src/manifest.json` back to MV3 afterward,
  integration hygiene test 6/6, and a local simulation of the AMO unzip
  step confirmed the resulting source dir has `manifest_version: 2` and no
  stray files.

## Verification results
- `npm run typecheck`: clean, no output.
- `npm run lint:js`: clean, no output.
- `npm run lint` (web-ext, not piped): 0 errors, 2 pre-existing unrelated
  warnings (lib/i18n.js UNSAFE_VAR_ASSIGNMENT — sanitizeHTML allowlist
  path). `src/manifest.json` confirmed MV3 afterward; `git status --short`
  clean (no leftover manifest.v3.json).
- `npm test`: 9245 pass, 1 skipped (pre-existing, unrelated), 0 fail.
- `npm run test:integration`: 233 pass, 0 fail, including the extended
  release-zip-hygiene guard (6/6) against real local builds.
- Local Firefox package build (`npm run build:firefox`, mirroring
  release.yml): 146 files, no `manifest.v3.json`, no `icons/newicon.png`,
  `lib/test-fixtures.js` is the 470-byte inert stub, no
  `__MUGA_TRUSTED_KEYS__` runtime seam. Simulated the release.yml AMO
  unzip step against that artifact: resulting source dir has
  `manifest_version: 2` and no stray files.
- Known env failure (browser-polyfill integrity on Windows CRLF): not
  observed in this run — no failures to report.
- `git status --short`: clean.

## Next step
Done. Branch `fix/1478-1481-firefox-package` has 2 commits ahead of
`origin/main` (17f4ab9, 2530c76). Not pushed, no PR opened, per instruction.
