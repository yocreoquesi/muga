# Landing brand refresh + store images

## Objective

Redesign muga.app (`landing/`) and replace the store images using the new
brand identity from the local brand kit (`../muga-brand-kit/`, outside the
repo). Fresh look, keep the Signal Path visual language (mark as diagram,
hairlines, Plex Mono URLs, purple as the single signal).

## Problem

The landing and the store images still lean on retired messaging: privacy
and tracking fear framing, the creator/referral wedge as a lead feature,
and "denoise" copy in the store images. The rotator also carries "Making
URLs Good Again", which echoes a political slogan.

## Why

Positioning decided 2026-09-24. MUGA is the reference URL cleaner: clean
links that keep working, easy to read and to share, with only the substance
the user needs. Privacy is a side effect, and creator credit is best effort,
so neither is a lead message. Signature "Just the link.", descriptor
"Links, without the clutter."

## Scope

- `landing/index.html`, `landing/404.html`, and the README rotator line
  (readme-claims couples them).
- Token hex changes, if any, propagate to `web/index.html` and
  `docs/muga-docs.css`.
- Store images in `docs/assets/`, plus every reference to them: README,
  landing, `docs/index.html`, and the `tools/screenshots` generators. The
  generators must not regenerate the stale images.
- Out of scope: extension UI, the `landing/clean/*` engine (generated from
  `web/`), store listing text, uploading to the stores (manual, user).

## Constraints

Guard tests (see the mapping in the session): landing-claims,
landing-inline-morph-source-guard, landing-layout-guard,
landing-headers-guard, landing-redirects-guard, copy-absolute-claims,
tracking-count-claims, readme-claims, version-consistency,
ui-tokens-zero-state, web-engine-mirror, docs-no-unwrap-server,
docs-shortener-claims, docs-verify-claims.

## Tasks

- [x] T1 Landing redesign: index.html + 404.html + README rotator (route:
      delegated writer, opus; trigger: 2+ non-trivial files, prep reading
      of 4+ files)
- [x] T2 Store images: new PNGs in docs/assets, references updated, stale
      generators ported or retired (route: delegated writer, opus; same
      trigger)

## Checks

- TDD: off (no project or session TDD configuration). Ordinary checks run
  instead.
- `npm test`, `npm run lint:js`, `npm run build:web` followed by an empty
  `git diff -- web/engine landing/clean`.
- Visual pass of the landing at 1440 px and 375 px, in headless Chrome
  screenshots.

## Delivery

Strategy: ask-on-risk. Work-unit commits on `feat/landing-brand-refresh`.
Push, PR and issue creation are the user's decisions.

## Progress

- Branch created from main 5ebdc00.
- T2 done in 52f2373 (chore(assets)): 5 Chrome + 5 Firefox store
  screenshots, promo tiles and og-1200x630.png copied from the kit; cws-ss*
  and screenshot-ss* deleted after README, landing and docs/index.html were
  repointed. Stale generators (capture.mjs, capture-promo.mjs, the HTML
  mocks, generate-promo-tiles.py) removed; the kit render sources are ported
  into tools/screenshots/ (render.mjs + fetch-fonts.mjs, fonts fetched into
  a gitignored folder). `npm run screenshots` reproduces all 13 images pixel
  for pixel (0.000% diff against the kit).
- T1 done in b64c54c (feat(landing)): new landing and 404; README line 18
  and the docs/index.html rotator carry the three approved backronyms.
- Verification: `npm test` 9094 tests, 0 fail; `npm run lint:js` clean;
  `npm run build:web` leaves web/engine and landing/clean unchanged;
  headless Chrome previews at 1440, 375 and 320 px show no horizontal
  scroll, fonts loaded, and the live tool cleans a utm link (59% shorter).
- Next step: user review of the previews. Push and PR are the user's call.
  The new images go live on rules.muga.app only after merge to main.
- Review split (2026-09-25): the full branch exceeded the native reviewer
  context budget (lens_context_budget_exceeded, 48 files / 4990 lines), so
  the user chose to split the local history into slices. The resulting tree
  is identical to the pre-split tip (backup ref
  `backup/landing-brand-refresh-presplit`).
  - 8b16189 chore(assets): new PNGs plus deletion of the stale generators.
    Mechanical, so it ships with ordinary checks only and no native review.
  - 1708055 chore(tools): ported render sources. Native review approved and
    acknowledged (review-b66e6945d2d714ae, reliability lens). Five advisory
    findings remain as follow-ups: fetch-fonts never checks response.ok; the
    font cache only looks for fonts.css; the static server prefix check has
    no path.sep; an unmatched filter exits 0; a template error waits for the
    30 s timeout.
  - 356e923 feat(landing) plus c18d1b8 docs(odd). Native review approved and
    acknowledged (review-b95a79524f6a7e09). Both advisory findings are
    expected: the "missing" images are in 8b16189, and the images depend on
    deploy order (rules.muga.app serves them from main).
