# Feature: #1463 — widen AdGuard Filter 17 coverage safely

## Objective

Close as much of the measured gap between MUGA and AdGuard Filter 17
(Tracking Parameters) as can be done **safely**, across the 5 areas the
issue names, without widening any anchor, without stripping a creator
affiliate param by default, and without landing a global param that lacks
vendor evidence or has plausible collision risk.

## Problem / why

#1463's own audit (2026-09-24) found MUGA at 85-86% coverage of AdGuard
Filter 17 across global/host-anchored/path-anchored facts. The gap is not
uniformly safe to close — some of it is deliberate (affiliate guard,
functional denylist), some of it needs per-item vendor evidence, and one
class (`ref`) is a live example of a param that is a genuine creator
affiliate tag on some hosts (PcComponentes / MediaMarkt, already documented
in `affiliates-data.js`) and ordinary referral noise on others.

## Scope

- `src/rules/domain-rules.json` — host-scoped `stripParams` additions for
  Area 2/3's safe generic-name misses (hand-written source; re-synced via
  `node tools/build-rules-store.mjs --import`).
- `src/lib/redirect-networks.js` (or a new sibling leaf) — new host-anchored
  affiliate-strip fact table for Area 4, consulted ONLY when
  `stripAllAffiliates` is on.
- `src/lib/cleaner.js` — `handleAffiliatePipeline` Step 4c extension: apply
  Area 4's host-anchored facts under `stripAllAffiliates`, same pattern as
  the existing landingParams strip (#1443).
- `tools/adguard-global-candidates.mjs` (new) + matching workflow — Area 5's
  measurement-only monthly report, mirrored on
  `tools/anchored-only-globals.mjs` / `.github/workflows/anchored-only-globals.yml`.
- Regenerated: `tracking-params.json`, `rules-manifest.json`,
  `cleaner-bundle.js`, `web` bundle, `tools/rules-source/rules.json` (via
  `--import`).
- Tests: new `tests/unit/adguard-global-candidates.test.mjs`; extended
  `processUrl` tests for the Area 4 stripAllAffiliates host-scoped strip;
  network-coverage test extension if Area 2/3 additions need it.
- Out of scope: `AFFILIATE_PARAM_GUARD` membership, `tools/rules-source/params.json`
  (signed channel) — never edited.

## Constraints (from AGENTS.md + issue)

- Never widen an anchor: a host/path-anchored fact stays at its exact anchor.
- Never strip a creator affiliate param by default; affiliate-related
  stripping only under `stripAllAffiliates`.
- Functional params (`REMOTE_PARAM_DENYLIST`, generic short names) never go
  global.
- Never touch `AFFILIATE_PARAM_GUARD` membership or `params.json`.
- `domain-rules.json` is a projection of `tools/rules-source/rules.json`;
  re-sync with `--import` after a direct edit.
- `src/lib/cleaner.js` edits require `npm run build:content` +
  `npm run build:web` with regenerated bundles committed.
- `npm run lint` is web-ext; `npm run lint:js` is eslint — run both, and
  verify `src/manifest.json` is still the Chrome MV3 manifest after `lint`.
- Verify network coverage against the GENERATED ruleset, not just
  `domain-rules.json`.
- Never move a published fpfn figure to pass a test.

## TDD

Mode: ON for behavior changes (Area 4's stripAllAffiliates host-anchored
strip). Runner: `node --test` (`npm test` / `npm run test:integration`).
RED confirmed before GREEN for the new Step 4c host-scoped strip. Area 2/3's
`domain-rules.json` additions are data-only (existing `getDomainParamSets`
mechanism, already covered by parity/roundtrip tests) — no new RED/GREEN
ceremony, but the roundtrip + strip-table-parity tests must stay green.
Area 5 is pure measurement logic (mirrors `anchored-only-globals.mjs`),
tested with `node:test`, no RED ceremony needed (no existing runtime
behavior changes).

## Measurement (re-run 2026-09-24 against live AdGuard Filter 17 + bundled
rules + rules-source store + live signed channel; see
`tools/import-upstream.mjs`'s `parseRemoveparamRules`)

| Area | AdGuard total | Missing | Notes |
|---|---|---|---|
| Global params | 338 bare names | 48 not in `TRACKING_PARAMS`/prefixes | Overlaps Area 2 (generic names) and known guard-adjacent click-IDs |
| Host-anchored facts | 1809 scoped | 270 not covered by domain-rules.json + rules-source scopedFacts + remote params.json scoped | Split below |
| — `ref` | | 79 facts, 79 distinct hosts | Area 3 |
| — guard-member names | | 78 facts / 46 distinct params | Area 4 (`aid`, `aff*`, `campid`, `clickid`, `cj_*`, `impact_*`, `partner*`, `tag`, …) |
| — `REMOTE_PARAM_DENYLIST` names | | 100 facts / 24 distinct params | Functional, excluded by design |
| — other generic names | | 18 facts / 8 distinct params (`at`, `cid`, `e`, `fr`, `landing`, `pid`, `ref_`, `src_tab_page_id`) | Area 2/3 |

## Tasks

- [x] T0 Set up worktree, branch, `npm ci`, read AGENTS.md/CONTEXT.md, write
  this feature doc. Route: inline.
- [x] T1 Area 1 — vendor research for the ~15 named global candidates
  (`x-clickref`, `x-source`, `x-a-medium`, `eml-name`, `eml-mediaplan`,
  `eml-publisher`, `ym_tracking_id`, `clckid`, `pixelid`, `nbt`,
  `utm_roistat`, `c_*`, `cpt_*`) plus the unnamed remainder of the 48
  global-missing list. Decide GLOBAL / anchored / SKIP per item with
  evidence. Route: inline (WebSearch, <400 lines of doc output, no code
  change expected pending evidence).
- [x] T2 Area 2 — confirm the generic names (`c`, `ad`, `mid`, `var`, `clid`,
  `soft`, `downloadmode`) stay excluded from global; land the 8
  non-affiliate, non-denylist generic names that are ONLY ever host-anchored
  (`at`, `landing`, `pid` ×6 hosts) as `domain-rules.json` scoped facts;
  document the 3 rejected as functional-conflict (`cid`, `e` at
  sharepoint.com; `fr` at yahoo.co.jp family) and 2 more (`ref_` at imdb.com,
  `src_tab_page_id` at shein.com) — both already in that host's
  `preserveParams`. Route: inline (single mechanical data file, already
  understood; 9 host entries).
- [x] T3 Area 3 — evaluate host-anchored `ref` (79 facts) for
  affiliate-referral risk; initially returned unlanded to maintainer.
  **2026-09-25: maintainer decided to land all 79 at AdGuard's exact
  anchors** (trust AdGuard; revisit on user reports). Landed with 0
  exclusions after checking every named exclusion category; discovered and
  documented a stale #160 comment along the way (PcComponentes/MediaMarkt
  ES/DE already strip `ref` deliberately, unrelated to this branch — not
  the exclusion case the comment implied). Route: inline.
- [x] T4 Area 4 — `stripAllAffiliates`-only host-anchored affiliate strip.
  New data table (`AFFILIATE_HOST_STRIP_FACTS`, redirect-networks.js) +
  `handleAffiliatePipeline` Step 4d extension (cleaner.js), TDD RED/GREEN,
  bundle rebuild. Route: inline (I already had full context from reading
  the #1443 Step 4c pattern; spinning up a fresh writer would have cost more
  than it saved).
- [x] T5 Area 5 — `tools/adguard-global-candidates.mjs` measurement-only
  report + workflow, mirroring `anchored-only-globals.mjs`. Route: inline
  (same reasoning as T4 — I already had the exact sibling file open and
  understood; a fresh writer would have re-derived the same context from
  scratch).
- [x] T6 Full verification pass: `npm test`, `test:integration`, `lint:js`,
  `lint` (+ manifest diff check), `fpfn`, `typecheck`.

## Acceptance criteria

- `npm test` and `npm run test:integration` green.
- `fpfn`: 0 FP before and after (hard gate).
- No `AFFILIATE_PARAM_GUARD` member touched; `params.json` byte-identical.
- Area 4's strip only fires under `stripAllAffiliates`; default (off)
  behavior for every affected host is unchanged (regression tests assert
  both branches).
- Every SKIP decision in Area 1/2/3 is documented with its reason
  (no evidence / functional conflict / affiliate-adjacent risk).
- `ref` is NOT added anywhere without maintainer sign-off; the PcComponentes/
  MediaMarkt precedent is cited as the reason.

## Checks

After T1-T3 (commit 39bc932):
- `npm test` — 9094 tests, 9093 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `npm run lint:js` — clean.
- `npm run lint` — 0 errors, 2 pre-existing unrelated warnings (`lib/i18n.js`).
- `git diff --stat src/manifest.json` — empty (unchanged).
- `npm run fpfn` — 0 FP / 0 FN.

After T4 (commit aa864bb):
- `npm test` — 9100 tests, 9099 pass, 1 skipped, 0 fail.
- `npm run typecheck` — clean (required a `deepFreeze` instead of `Object.freeze`
  fix so `AFFILIATE_HOST_STRIP_FACTS` was not inferred as a readonly array
  mismatching `scopedParamsForHostname`'s JSDoc param type).
- `npm run lint:js` — clean. `npm run lint` — 0 errors, 2 pre-existing warnings.
- `npm run compile:rules` — no diff (confirms Area 4 stays out of the DNR pipeline).
- `npm run fpfn` — 0 FP / 0 FN. `npm run test:integration` — 233/233 pass.

T6 — final full pass (after T5, commit: see below):
- `npm test` — 9189 tests, 9188 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `npm run typecheck` — clean.
- `npm run lint:js` — clean.
- `npm run lint` — 0 errors, 2 pre-existing unrelated warnings (`lib/i18n.js`).
- `git diff --stat src/manifest.json` — empty (unchanged after `lint`).
- `npm run fpfn` — 0 FP / 0 FN (hard gate: PASSED).
- `node tools/build-rules-store.mjs --check` — no drift reported.
- `npm run adguard-global-candidates-report` — live smoke test against the
  real upstream list: 0 candidates (see T5 progress note).
- No `AFFILIATE_PARAM_GUARD` member touched (grep-verified: no edits to
  that set in the whole branch diff). `tools/rules-source/params.json`
  byte-identical (never touched — verified via `git diff --stat`, absent
  from every commit's changed-file list).

## Progress

**T1 — Area 1 global candidates: all SKIPPED, none landed.**

Public web search found no citable vendor documentation for any of
`x-clickref`, `x-source`, `x-a-medium`, `eml-name`, `eml-mediaplan`,
`eml-publisher`, `ym_tracking_id`, `clckid`, `pixelid`, `nbt`, the `c_*`
family (`c_ad`, `c_app`, `c_dt`, `c_sys`, `c_ver`, `c_wh`), or the `cpt_*`
family (`cpt_c`, `cpt_m`, `cpt_n`, `cpt_s`). These names appear to be
crowdsourced/observed AdGuard entries without public vendor docs — the
opposite of "low collision risk with evidence" the issue requires before
landing a global strip.

Specific findings:
- **`x-clickref`**: structurally matches `clickref`, which is Partnerize's
  own documented affiliate click-reference parameter
  ([Partnerize docs](https://help.phgsupport.com/hc/en-us/articles/4834811308957-Tracking-Partnerize-Clickref-Pixel-Integration))
  and is ALREADY an `AFFILIATE_PARAM_GUARD` member in MUGA (confirmed via
  measurement: `clickref` is host-anchored-missing at awin1.com,
  coolblue.nl, wise.com — all guard-member hits). An `x-` prefixed variant
  of the same semantic name is a plausible affiliate-attribution param
  under a different vendor's naming convention. **SKIP — affiliate-adjacent,
  do not land.**
- **`wt_mc`**: circumstantially close to WebTrends' documented
  `WT.mc_id` campaign parameter
  ([WebTrends KB](https://kb.webtrends.com/information/how-do-i-track-campaigns-using-the-campaign-id-parameter-wt-mc-id-1365447890899/)),
  but the exact string (`wt_mc`, no dot, underscore form) is not confirmed
  by any primary source. **SKIP — name similarity is not vendor
  confirmation.**
- `utm_roistat`: already covered — `utm_` is in `TRACKING_PREFIXES`, so it
  is NOT in the global-missing list. No action needed (matches issue's own
  caveat).
- `cpt_*`: already host-anchored at yahoo.co.jp only (issue's own text
  confirms this). A single-host observation is not corroboration for a
  global promotion (mirrors the ingestion pipeline's own `MIN_SIGNALS=2`
  posture). **SKIP — stays host-anchored, not promoted.**
- `c_*` app-param family (`c_ad`, `c_app`, `c_dt`, `c_sys`, `c_ver`,
  `c_wh`): coherent single-vendor mobile-app fingerprinting schema (app
  name/version/OS/device), no vendor confirmed. **SKIP — no evidence.**

Beyond the ~15 named candidates, the full 48-entry global-missing list also
contains: (a) the Area 2 generic names (handled in T2/T3), and (b) a large
cluster of redirect-network click-IDs. Checked `getAllLandingParams()`
directly (not just `AFFILIATE_PARAM_GUARD` membership) and found MOST of
this cluster is **already fully handled**, not a gap: `a8`, `admitad_uid`,
`awc`, `cjdata`, `cjevent`, `clickref` (confirming the `x-clickref`
adjacency finding above), `iclid`, `irclickid`, `irgwc`, `raneaid`,
`ranmid`, `ransiteid`, `sscid`, `tduid`, and `wt_mc` are ALL already in
`REDIRECT_NETWORK_PATTERNS.landingParams` (`getAllLandingParams()`) — they
are correctly excluded from `TRACKING_PARAMS` (global, unconditional) BY
DESIGN, and already stripped under `stripAllAffiliates` via the existing
Step 4c (#1443), exactly the conditional-strip treatment this class of
param needs. **No action needed — already correct, not a gap.** This also
retroactively confirms the `wt_mc` SKIP above needed no hedging: it was
never a plain global candidate, it is a landing param.

The only names in this cluster with NEITHER a `TRACKING_PARAMS` entry NOR a
`landingParams` entry, and no vendor evidence found: `clckid`, `client_m`,
`eurl`, `taid` (distinct from the already-covered `ttaid`). **SKIP — no
evidence, no existing mechanism, do not land speculatively.**

Remaining ungrouped: `a8` (plausibly A8.net, a major Japanese affiliate
network's own click id — affiliate-adjacent, SKIP), `eurl` (no evidence,
SKIP), `from` (extremely common functional param, 53 existing host-anchored
uses in domain-rules.json alone — SKIP, high collision), `iclid`/`taid`
(unverified click-ID-shaped names — SKIP), `sid` (session id — SKIP, high
collision, also `REMOTE_PARAM_DENYLIST`-adjacent).

**Net effect of T1: zero new `TRACKING_PARAMS` entries.** No code change
required for this area; the deliverable is this documented decision record.

**T2/T3 — the 18 "other" host-anchored misses, resolved:**

Landed (8 host entries, `domain-rules.json` `stripParams`, no existing
conflict):
- `www.nicovideo.jp`: `at`
- `hotosena.com`: `landing` (new entry; single AdGuard anchor, no counter-
  evidence, plausible ad-tracking name)
- `announcements.bybit.com`, `app.5-delivery.ru`, `getir.com`,
  `nikke-jp.com`, `qcplay.co.jp`, `toomics.com`: new entries, `pid`

Rejected — direct conflict with existing `preserveParams` (AdGuard's anchor
contradicts MUGA's own curated functional protection; reported, not
silently overridden):
- `cid`, `e` at `sharepoint.com` — both already in `preserveParams`
  (SharePoint/OneDrive sharing-link tokens; stripping would break shared-
  document access).
- `fr` at `yahoo.co.jp` (and its 4 anchored subdomains
  `detail.chiebukuro.yahoo.co.jp`, `promo-search.yahoo.co.jp`,
  `search.yahoo.co.jp`, `toku.yahoo.co.jp`) — `fr` is already in
  `yahoo.co.jp`'s `preserveParams` and inherited by every subdomain via
  `getDomainParamSets`' suffix walk. AdGuard's anchor is a false positive
  against MUGA's own already-verified functional param.
- `ref_` at `imdb.com` — already in `imdb.com`'s `preserveParams`.
- `src_tab_page_id` at `shein.com` — already in `shein.com`'s
  `preserveParams`.

**Correction (2026-09-25, parent review of commit 39bc932): `pid` at
`onelink.me` — REJECTED, not landed.** The original commit appended `pid`
to the existing `onelink.me` `domain-rules.json` entry. AdGuard's actual
anchor for this fact is `nikke.onelink.me`, not `onelink.me` — appending it
to the broader parent entry widens the anchor via `getDomainParamSets`'
suffix walk, stripping `pid` on EVERY OneLink subdomain (every app/brand
using AppsFlyer OneLink), not just nikke's. This is exactly the "never
widen an anchor" violation the issue's safety principles forbid. Separately,
AppsFlyer's `pid` is the partner/media-source id that attributes an install
to a specific partner — which can include influencers/affiliates — putting
it in the same affiliate-risk class as Area 4's params, not a plain generic
tracking name. A corrected narrower fix (a new `nikke.onelink.me` child
entry) was considered and rejected too: `domain-rules.json`'s nested-domain
DNR generation has a known one-rule-per-request trap (see
`muga-dnr-one-rule-per-request` in project memory / #1021) where a
parent+child domain pair can produce ambiguous/incomplete DNR coverage.
Given the affiliate-risk-adjacent semantics, `pid` at `nikke.onelink.me` is
simply not landed at all — reverted to the pre-#1463 `onelink.me` entry
(`af_sub1` only). Re-synced via `build-rules-store.mjs --import`,
regenerated `tracking-params.json`/`rules-manifest.json`/web+landing engine
mirrors. `domain-rules.json` entry count unchanged (297 — `onelink.me` was
an existing entry, not a new one, so no count-claim update needed).

**T3 — `ref` (79 facts): maintainer decision 2026-09-25 — LAND, trust
AdGuard's exact per-host anchor. "If users report breakage we revisit."**

Originally returned to the maintainer unlanded (see prior revision of this
section) because `ref` is a confirmed creator-affiliate tag on at least one
real host (the historical #160 comment named PcComponentes/MediaMarkt
ES/DE) and the 79-host list includes several consumer subscription/security
products with plausible "refer a friend" programs. The maintainer reviewed
this and decided to land all 79 at their exact AdGuard anchors, with hard
limits (below), on the basis that AdGuard's own curation is trustworthy at
the anchor level and the blast radius of a wrong strip is recoverable
(noisier URL, not lost revenue) — see the asymmetric-risk principle in
CONTEXT.md §4.

**Landed: 79/79 hosts**, all at AdGuard's EXACT anchor string (verified
against a fresh re-fetch of the live AdGuard Filter 17 list, 2026-09-25 —
still 79, same set as the 2026-09-24 measurement):
- 77 new `domain-rules.json` entries (brand-new host, `stripParams: ["ref"]`).
- 2 appended to an EXISTING exact-match entry (`asahi.com` — already had
  `stripParams: ["cid"]`; `nikkei.com` — already had `stripParams: ["n_cid"]`).
  Both are exact matches (the entry's `domain` string equals AdGuard's
  anchor string), so appending does not widen anything — same rule that
  caught the `onelink.me`/`pid` mistake: never append to a PARENT domain
  whose suffix match is broader than the anchor.
- **Anchor-widening check (per host):** none of the 79 anchors needed the
  "parent domain already exists" handling from the `onelink.me` correction
  — every anchor either had no existing entry (new entry created) or an
  EXACT existing entry (appended). No host was skipped for this reason.

**Excluded: 0 hosts.** Checked every exclusion category the maintainer
named, against the full 79-host list:
- `preserveParams` conflict (host itself or any ancestor domain): **0**
  found (scripted check against domain-rules.json's suffix chain for all
  79 hosts).
- Known creator-affiliate `ref` in MUGA's own data
  (`affiliates-data.js` / `REDIRECT_NETWORK_PATTERNS` / `AFFILIATE_PATTERNS`):
  the only two live sources of a `ref`-carrying host are (a) `vercel.com`
  (`AFFILIATE_PATTERNS`, "Vercel Referrals" direct-injection program,
  `src/rules/manifest.data.js`) and (b) `REDIRECT_NETWORK_PATTERNS`'
  Partnerize entry (`adref`/`clickref`/`pubref` — none is literally `ref`).
  **Neither `vercel.com` nor any Partnerize `redirectHosts` entry is in the
  79-host list** — 0 exclusions needed.
- `REMOTE_PARAM_DENYLIST`: `ref` itself is not a member (checked); no
  interaction.

**Correction to the original #160 citation — PcComponentes / MediaMarkt
ES/DE are NOT an exclusion case, and are NOT in the 79-host list at all.**
Investigating the maintainer's named exclusion (these two brands) surfaced
that the #160 comment in `affiliates-data.js` is **stale**. Live-tested
`processUrl()` with `domainRules` loaded (the real production shape —
`src/content/cleaner.js`'s `cleanWithContext` always passes
`_domainRulesCache`):
- `pccomponentes.com`, `mediamarkt.de`, `mediamarkt.es` **already strip
  `ref`** via their OWN pre-existing `domain-rules.json` `stripParams`
  entries (unrelated to this branch — present before #1463 started).
- This is not a latent bug: `tests/unit/config-integrity.test.mjs`'s
  `allowedOverrides` table explicitly documents and tests it —
  `"ref": [..., "pccomponentes.com", "mediamarkt.es", "mediamarkt.de", ...]`
  with the comment "intentionally stripped on incompatible stores
  (redirect-based affiliate policy)". A later, more specific decision
  (Awin-redirect classification, see the `pccomponentes.com` entry's own
  note: "Affiliate params (Awin redirect model) actively stripped.")
  superseded the #160 comment's direct-injection framing. `AFFILIATE_PATTERNS`
  (`manifest.data.js`) does NOT list PcComponentes or MediaMarkt at all —
  only `vercel.com` uses `ref` as a live, enforced direct-injection tag.
- **Not changed** as part of this task (out of the 79-host scope, and
  already deliberately tested) — flagged here for the maintainer's
  awareness since the #160 comment (still present in `affiliates-data.js`)
  is misleading against current behavior.

**Weekly ingest / reconcile path — checked, does not fight these facts.**
The automated weekly pipeline (`auto-ingest-rules.yml` → `orchestrate.mjs`)
DOES reject every `ref`-named candidate at Gate 1 (`affiliate-guard.mjs`):
`buildPreserveIndex` derives a NAME-level (not host-level) preserve set from
`AFFILIATE_PATTERNS`, and `vercel.com`'s `ref` entry puts the bare name
`ref` in that set — so Gate 1 refuses to auto-promote ANY `ref` candidate
to the signed remote channel, for any host, global or scoped. This is the
mechanism issue #1463 T3's own text meant by "the ingest filters `ref` out
as functional." Verified this cannot undo or fight the hand-written facts
landed here:
1. The weekly pipeline's target is `tools/rules-source/params.json` (the
   SIGNED remote channel), populated via `scopedFacts`/`promote-rules.mjs`.
   `domain-rules.json` is imported into `rules.json`'s `entries` field via
   the SEPARATE, manually-triggered `build-rules-store.mjs --import` — a
   different field, never touched by the weekly automated path.
2. `promote-rules.mjs` reads `domain-rules.json` only as a PRESERVE
   backstop (rejects a signed payload that would strip something
   `domain-rules.json` marks `preserveParams`) — read-only, never removes
   or rewrites `domain-rules.json` content.
3. `build-rules-store.mjs --prefer-anchors` (run by the weekly workflow)
   only relocates a param that is CURRENTLY GLOBAL in the signed channel
   AND host-anchored in `domain-rules.json`. `ref` is not in
   `tools/rules-source/params.json`'s global `params` array (checked) —
   the predicate never fires for it, so this mechanism is a no-op here too.

No conflict found; nothing about the ingest pipeline needed to change.

Regression test added (`tests/unit/cleaner.test.mjs`, "affiliate param /
tracking param collision" describe block): asserts `ref` is stripped on
`goodreads.com` (a landed T3 host) and preserved on `vercel.com` (the one
live host where `ref` is a genuine, currently-enforced creator-affiliate
tag), both called through `processUrl(url, PREFS, domainRules)` — the real
production call shape, not the canary harness's domainRules-free shape.

**T4 — landed.** `AFFILIATE_HOST_STRIP_FACTS` (`src/lib/redirect-networks.js`,
fact-major `{param, hosts[]}`, reusing the existing `scopedParamsForHostname`
suffix-walk lookup from #1409) covers 41 distinct guard-member params / 78
host-facts. 5 params from the original 46-param candidate set (`adref`,
`cjevent`, `clickref`, `raneaid`, `ransiteid`) were excluded because they are
ALREADY in `getAllLandingParams()` — already stripped everywhere under
`stripAllAffiliates` via the existing Step 4c (#1443); a host-scoped
duplicate would be inert. No `preserveParams` conflicts found on any of the
41 params' anchored hosts (checked). `handleAffiliatePipeline` gained a new
Step 4d, same shape as Step 4c but host-scoped via `scopedParamsForHostname`,
respecting the whitelist exactly like every other affiliate-strip step. RED
confirmed (2 of 6 new `cleaner.test.mjs` assertions failed pre-implementation),
then GREEN. `npm run build:content` + `npm run build:web` regenerated
(cleaner.js and redirect-networks.js both feed the content bundle);
`compile:rules` produced NO diff (confirms this never leaks into the DNR/
`TRACKING_PARAMS` pipeline, as required).

One residual risk flagged, not blocking: `sid` is landed at `tapatalk.com`
and `teknosa.com` under `AFFILIATE_PARAM_GUARD`'s Booking/travel category,
but `sid` is also a classic generic session-id name. The strip only fires
under the opt-in `stripAllAffiliates` preference (default off) and only on
these 2 exact AdGuard-anchored hosts, so the blast radius is small, but a
maintainer with product knowledge of tapatalk.com's session model may want
to double-check this one specifically.

**T5 — landed.** `tools/adguard-global-candidates.mjs` mirrors
`tools/anchored-only-globals.mjs` (#1228) in the opposite direction: pure
decision core (`findNewGlobalCandidates`), reused `assertAdguardNotDegenerate`
from the sibling module rather than duplicating the degenerate-upstream
guard, one deduplicated monthly tracking issue
(`.github/workflows/adguard-global-candidates.yml`, cron `0 10 1 * *` — 2h
after `anchored-only-globals.yml` so the four monthly jobs never collide),
never opens a PR, never edits `TRACKING_PARAMS`. Seeded
`ADJUDICATED_SKIP_GLOBAL` (`src/lib/affiliates-data.js`) from T1's 29
concrete SKIP decisions so the exact same names do not reappear every
month (mirrors `ADJUDICATED_KEEP_GLOBAL`'s own stated rationale for the
opposite direction). Added the matching pin test
(`adjudicated-skip-global.test.mjs`, mirrors `adjudicated-keep-global.test.mjs`).
Added the new workflow's `name:` to `alert-on-failure.yml`'s watched list
(G9 guard, `workflow-hardening.test.mjs`, caught this immediately — a
scheduled workflow with no failure alert is exactly the #1401 failure mode).

Live smoke-tested against the real upstream list
(`npm run adguard-global-candidates-report`): **0 candidates** — confirms
T1's structural exclusions (guard/denylist/landingParams/prefixes) plus the
seeded `ADJUDICATED_SKIP_GLOBAL` fully account for every name in the
original 48-entry global-missing measurement.
