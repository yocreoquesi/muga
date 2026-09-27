# Feature: #1472 — rename store listing to "MUGA: URL Cleaner. Just the link."

## Objective

Rename the extension on both stores from `MUGA: URL Cleaner. Remove tracking`
to `MUGA: URL Cleaner. Just the link.`, matching the "Just the link." identity
already shipped on muga.app (#1468). Update the short description to lead
with cleaning links and keep tracking removal as a secondary point. Update
every reference to the old name, and fix the stale MV2 `version_name` found
along the way.

## Problem / why

Tracking removal is one thing MUGA does, not the product's identity. The new
name keeps "URL Cleaner" (the primary search keyword) while "Just the link."
matches the landing page. "Tracking" moves into the short description so it
still helps search without being the headline. This reverses the #1272
decision recorded in `docs/store-listing.md`.

Separately: `src/manifest.v2.json` `version_name` was stale at "3.0.0" while
`version` is "3.1.0", and `tools/verify-release-version.mjs` only checked the
MV3 manifest's `version_name`, so this kind of drift was a silent failure on
the Firefox side.

## Scope

- `src/manifest.json`, `src/manifest.v2.json`: `name`, `description`,
  MV2 `version_name`.
- `docs/store-listing.md`: extension name (both stores), Chrome short
  description, AMO summary, decision note (#1272 reversal).
- `README.md`, `docs/faq.html`, `docs/index.html`, `docs/privacy-page.html`,
  `docs/tos.html`, `docs/transparency.html`, `src/privacy/privacy.html`:
  title/meta references to the old name.
- `tests/unit/manifest-descriptions.test.mjs`: canonical pitch string.
- `tests/unit/amo-listing-metadata.test.mjs`: distinguishing-phrase regex
  (found via `npm test`, not in the issue's explicit file list).
- `tests/unit/docs-no-unwrap-server.test.mjs`,
  `tests/e2e/onboarding.spec.mjs`: comments pinning the old name.
- `tools/verify-release-version.mjs`: extend to check MV2 `version_name`.
- `tests/unit/verify-release-version.test.mjs`: new cases for the MV2 check.

Out of scope (deliberately left as-is): the long-form "Detailed description"
prose in `docs/store-listing.md` (not asked for, no name reference), the
Chrome Web Store keyword list (no name reference), CHANGELOG.md history
(historical record, not a current listing).

## Constraints

- Chrome name limit and AMO name limit: `tests/unit/manifest-descriptions.test.mjs`
  enforces 45 chars (the real store limit, tighter than the 75 chars in the
  issue's starting note); new name is 33 chars.
- Chrome short description: 132 chars max; new description is 125 chars.
- AMO summary: 250 chars max; new summary is 239 chars.
- No em-dashes, no retailer/brand names (CWS keyword-spam rejection history,
  routing ID FZSL).
- No Co-Authored-By / AI attribution in commits.

## TDD

Mode: off — no project/session TDD config found. Ordinary functional checks
apply (existing + extended unit tests, typecheck, lint, e2e).

## Tasks

- [x] T1 Rename in both manifests (`name`, `description`), fix MV2
  `version_name` 3.0.0 -> 3.1.0. Route: inline (2 small, already-understood
  JSON files).
- [x] T2 Update every reference to the old name/description across
  README, docs/*.html, src/privacy/privacy.html, docs/store-listing.md
  (name x2, short description, AMO summary, #1272 decision note), and the
  tests that pin the old strings. Route: inline (mechanical string
  replacement across already-identified files via `git grep`).
- [x] T3 Extend `tools/verify-release-version.mjs` to check MV2
  `version_name`, with matching unit test cases in
  `tests/unit/verify-release-version.test.mjs`. Route: inline (one function,
  mirrors the existing MV3 check).
- [x] T4 Create this feature doc.

## Acceptance criteria

- `src/manifest.json` and `src/manifest.v2.json` both have
  `"name": "MUGA: URL Cleaner. Just the link."` and identical `description`.
- `src/manifest.v2.json` `version_name` is `"3.1.0"`.
- No remaining occurrence of `MUGA: URL Cleaner. Remove tracking` in the repo
  (verified with `git grep -n "Remove tracking"`; the only hit left is the
  deliberate historical mention inside the onboarding.spec.mjs comment).
- `node tools/verify-release-version.mjs v3.1.0` passes and would now catch a
  stale MV2 `version_name`.
- `npm run typecheck`, `npm run lint:js`, `npm test`, `npm run test:integration`
  pass; `git status --short` clean at the end.

## Checks

- `npm run typecheck` — clean.
- `npm run lint:js` — clean.
- `npm test` — 9240 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `node tools/verify-release-version.mjs v3.1.0` — passes.
- `node --test tests/unit/verify-release-version.test.mjs` — 17/17 pass,
  including the two new MV2 `version_name` cases.
- `npm run lint` (web-ext) — 0 errors, 2 pre-existing warnings
  (`lib/i18n.js` innerHTML, unrelated to this change); `src/manifest.json`
  confirmed restored to MV3 (`manifest_version: 3`) afterward.
- `node tools/verify-polyfill-integrity.mjs` — fails (known Windows
  CRLF-checkout environmental failure, ignored per instructions).
- `git status --short` / `git diff --ignore-cr-at-eol --stat` — only the
  intended files changed, no EOL-only noise.

## Progress

Branch `feat/store-name-just-the-link`, created from `origin/main` at
`ebda114`. One extra file needed updating beyond the issue's explicit list:
`tests/unit/amo-listing-metadata.test.mjs` pinned the old AMO summary text
(`/without breaking pages/`) and failed `npm test` once the summary changed;
updated its regex to `/tries to preserve creator credit/`, a phrase still
unique to the AMO summary versus the Chrome short description.

## Commits

- `feat(store): rename listing to "MUGA: URL Cleaner. Just the link." (#1472)`
- `fix(release): check MV2 version_name in the release guard (#1472)`
- `docs(odd): track store rename feature (#1472)`
