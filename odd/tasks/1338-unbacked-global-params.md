# Feature: #1338 — resolve the 107 unbacked global tracking params

## Objective

Implement the maintainer's 2026-09-24 decision on issue #1338: anchor, remove,
keep-global, or mark-unsure every one of the 107 global `TRACKING_PARAMS`
entries that neither AdGuard Filter 17 nor ClearURLs corroborates, in any
form — global or anchored.

## Problem / why

#1338's own audit found MUGA carries more global tracking params than either
of its two upstream sources, and 107 of them have zero upstream evidence at
all. The maintainer's decision (last issue comment) sorts them into four
buckets:

- **ANCHOR (17)**: host-anchor to amazon.\* / ebay.\* / aliexpress.com /
  tiktok.com, same method as #1228 (PR #1374).
- **REMOVE (13)**: no vendor evidence or a known collision (#1212/#1217
  class) — drop from `TRACKING_PARAMS` entirely.
- **KEEP-GLOBAL (~60)**: well-known vendor click-ids/ESP params — document
  the vendor inline, filling gaps from PRD #529's original bulk import.
- **UNSURE (~14)**: keep global, mark with an inline `#1338: unverified,
  needs a real sample` comment.

## Scope

- `src/lib/affiliates-data.js` — `TRACKING_PARAMS` and
  `TRACKING_PARAM_CATEGORIES`.
- `src/rules/domain-rules.json` — add anchored params to the relevant hosts'
  `stripParams` where not already present (hand-written source).
- `src/lib/hot-path-strip.js` — drop any removed/anchored param from the
  hand-curated hot-path table.
- Regenerated: `src/rules/tracking-params.json`, `src/rules/rules-manifest.json`,
  content/web bundles, `tools/rules-source/rules.json` (via
  `build-rules-store.mjs --import`, to re-sync the store after a direct
  `domain-rules.json` edit).
- Count claims: README, CONTEXT.md, docs/index.html, docs/transparency.html,
  onboarding, landing "N more" line, all 7 locales.
- `tests/unit/removed-global-params-network-coverage.test.mjs` — extend for
  the newly-anchored params (network-layer coverage).
- Out of scope: `AFFILIATE_PARAM_GUARD` membership itself, the signed remote
  channel (`tools/rules-source/params.json`) — never touched.

## Constraints

- Never touch `AFFILIATE_PARAM_GUARD` members.
- Never touch `tools/rules-source/params.json` (signed channel); if an
  anchored param is also in its global list, report it, don't edit the
  channel.
- `domain-rules.json` is a projection of the store
  (`tools/rules-source/rules.json`); a direct artifact edit must be
  re-synced with `node tools/build-rules-store.mjs --import` or
  `rules-store-roundtrip.test.mjs` fails.
- A genuine conflict between the decision and existing, already-landed
  evidence (a test, an ADR, a documented incident) is reported, not
  silently resolved either way.

## TDD

Mode: off — no project TDD config found; this is a data/rules change plus
test extension, not new runtime behavior. Runner: `npm test` (node:test).
Ordinary functional checks apply (RED confirmed on the extended coverage
test before the anchoring landed; see Progress).

## Tasks

- [x] T1 Read issue #1338 (body + 3 comments) and PR #1374/#1228 to confirm
  the exact anchoring method and precedent exclusions (guard members,
  path-anchored parents). Route: inline (research, <4 files at this stage).
- [x] T2 Cross-check every ANCHOR/REMOVE param against `AFFILIATE_PARAM_GUARD`
  and existing pinned tests (`PATH_ANCHORED_STAY_GLOBAL`,
  `strip-table-parity.test.mjs`'s `HOT_PATH_REQUIRED`). Found 3 conflicts
  (see Progress) — left those 7 params global, did not silently follow the
  decision text over already-landed evidence.
- [x] T3 Edit `TRACKING_PARAMS` + `TRACKING_PARAM_CATEGORIES`: anchor 10,
  remove 11, add UNSURE markers to the 9 named params, fill vendor/unverified
  comments on the 62-param bare "Various ad/analytics platforms" block.
- [x] T4 Add the 5 safe anchor params to `domain-rules.json` amazon.\*
  `stripParams` (aliexpress/tiktok already carried theirs); drop `_pos`/`_fid`
  reversion, keep `hot-path-strip.js` in sync.
- [x] T5 Regenerate `tracking-params.json`, bundles, and re-sync the rules
  store (`--import`); verify `--check` reports no drift and
  `tools/rules-source/params.json` is untouched.
- [x] T6 Update count claims (387 → 366) across README/CONTEXT/docs/
  onboarding/locales/landing.
- [x] T7 Fix stale fixtures that assumed a since-anchored/removed param was
  still global without `domainRules` (canary, cleaner.test.mjs, ab_channel
  YouTube test).
- [x] T8 Run full checks: `npm test`, `test:integration`, `lint:js`,
  `typecheck`, `check:i18n`, `lint`, manifest diff, `fpfn` before/after.

## Acceptance criteria

- `npm test` and `npm run test:integration` green.
- `fpfn`: 0 FP before and after (hard gate); FN unchanged.
- No `AFFILIATE_PARAM_GUARD` member touched; `params.json` byte-identical.
- Every removed/anchored param's disposition is documented inline in
  `affiliates-data.js`.
- Any conflict between the decision and prior evidence is reported, not
  silently resolved.

## Checks

- `npm test` — 8317 tests, 8316 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `npm run lint:js` — clean.
- `npm run typecheck` — clean.
- `npm run check:i18n` — clean.
- `npm run lint` — 0 errors, 2 pre-existing unrelated warnings (`lib/i18n.js`).
- `git diff --quiet src/manifest.json` — unchanged.
- `npm run fpfn` — 0 FP / 0 FN before and after.

## Progress

**Process deviation**: this document was written after research and
implementation, not before the first write, because the task was picked up
mid-flow. Recorded here for honesty rather than silently backfilled as
"planned first."

**Three conflicts found between the #1338 decision text and already-landed
evidence** (reported, not silently resolved):

1. **eBay 5** (`mkevt mkcid mkrid toolid customid`) — all five are
   `AFFILIATE_PARAM_GUARD` members. `generate-rules.mjs`'s `extraStrips`
   filter drops guard members from a host's DNR removeParams (the exact
   mechanism that excluded `linkcode`/`creativeasin`/`click_id` in PR #1374).
   Host-anchoring them would never reach the compiled DNR rule — a silent
   downgrade from pre-request to (nonexistent) coverage. Also independently
   already pinned in `PATH_ANCHORED_STAY_GLOBAL`
   (`removed-global-params-network-coverage.test.mjs`). Left global.
2. **`lp_asin` / `store_ref`** — the same `PATH_ANCHORED_STAY_GLOBAL` test
   (citing #1229 / ADR-0008) already established upstream anchors both to a
   *path*, not a host; `domain-rules.json` can only express host scope, so
   anchoring them to amazon.\* would claim more than the evidence supports.
   Left global.
3. **`_pos` / `_fid`** — `strip-table-parity.test.mjs`'s `HOT_PATH_REQUIRED`
   pins both as the exact Shopify storefront family a real historical field
   report showed being re-injected client-side via `history.replaceState`.
   This directly contradicts the REMOVE rationale ("no vendor evidence").
   Left global.

Net effect: 30 params named in the decision, 21 actually moved (10 anchored
+ 11 removed), 9 left global pending a maintainer decision on the three
conflicts above. `TRACKING_PARAMS`: 387 → 366.

**UNSURE markers**: only the 9 explicitly named in the decision text (`fbc
fbp dm_i _psq mnv_sid axr_tref ucx_ref sprtype _ke`) were marked. The
decision says "and the rest of that group" (~14 total) without naming the
remaining ~5 — not guessed at, left as an open gap.

**KEEP-GLOBAL vendor fill**: the 62-entry "Various ad/analytics platforms"
bare block in `affiliates-data.js` (bulk-imported v1.13.0 / PRD #529,
uncommented) was identified as the actual KEEP-GLOBAL/UNSURE pool (matches
the "~60" estimate). Web-searched the ambiguous ones rather than inventing:
confirmed 15 real vendors (Segmentify, Zucks, BeMob, famAD, Jmty,
ShareASale, Spot.IM, PersonaClick, Vero, and Russia's ERID ad-labeling
mandate), marked the remaining 47 `// vendor unverified (#1338)` per the
explicit instruction not to invent one.

**Store sync**: `src/rules/domain-rules.json` is a projection of
`tools/rules-source/rules.json` (see `tools/build-rules-store.mjs`). Adding
new `stripParams` entries directly to the artifact required
`node tools/build-rules-store.mjs --import` to re-sync the store (writes
only `rules.json`, never `params.json`) — otherwise
`rules-store-roundtrip.test.mjs`'s byte-for-byte projection test fails.

**Fixture repairs** (same class as PR #1374's "fixes two cleaner.test.mjs
Amazon fixtures"): one `PRESERVE_CANARIES` entry
(`tools/affiliate-safety/canaries.mjs`) and two `cleaner.test.mjs`/
`domain-rules.test.mjs` tests assumed `psc`/`e_t`/`ab_channel` were still
global without `domainRules`; updated to match the new anchored/removed
reality.
