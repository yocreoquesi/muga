# Feature: #1467 — path-scoped rule hostBase must resolve the nearest tailored ancestor

## Objective

Fix `tools/generate-rules.mjs` so a path-scoped DNR rule (#1326) on a host that
carries `pathStrips` but no profile of its own resolves its `removeParams`
base from the nearest tailored ANCESTOR domain (or the global rule), instead
of always falling back to raw `TRACKING_PARAMS`.

## Problem / why

Issue #1467 claims a DNR *priority tie* between path-scoped rules and
domain-profile rules. That premise is wrong:
`DNR_PATH_SCOPED_PRIORITY = 3` (`src/lib/dnr-ids.js`) is strictly above every
priority-1 profile/global rule, so the path rule deterministically wins on
its own (domain, prefix) match — there is no tie.

The real defect (pre-existing, first flagged as "not in scope" by #1463's
audit — see that feature doc's note, corrected here) is in
`buildDnrRules()`'s `pathRuleSpecs` construction (~line 594-654,
`tools/generate-rules.mjs`): `hostBase` was
`removeParamsByDomain.get(rule.domain) ?? [...TRACKING_PARAMS]`.
`removeParamsByDomain` is keyed only by domains that are THEMSELVES tailored
in `domain-rules.json`. A path rule on an untailored subdomain of a tailored
ancestor falls back to raw `TRACKING_PARAMS`, silently dropping every extra
strip the ancestor's profile rule adds, and — had any existed — could have
silently widened past a param the ancestor preserves (checked: none of the
affected hosts' path params collide with their ancestor's `preserveParams`,
so no widening actually occurred).

Chrome's `requestDomains`/`excludedRequestDomains` matching is
subdomain-inclusive, so outside the path rule's own prefix the ancestor's
profile rule (or the global rule) still fires on that host today — the fix
must mirror that: walk up domain labels from the path rule's own domain,
first tailored domain found wins, fall back to global `TRACKING_PARAMS` only
if none exists.

## Scope

- `tools/generate-rules.mjs` — `resolvePathRuleHostBase()` helper.
- `tests/unit/path-scoped-dnr-rules.test.mjs` — new superset-of-ancestor
  regression suite, covering every generated path-scoped rule.
- Regenerated: `src/rules/tracking-params.json` only (`rules-manifest.json`
  and `wrapper-dnr-rules.json` also regenerated but reverted — CRLF-only
  noise, confirmed with `git diff --ignore-cr-at-eol`).
- `odd/tasks/1463-adguard-coverage.md` — one-line correction: the "potential
  double-match on Chrome's tie-break" note was itself imprecise (no tie
  exists); pointed at this fix.

## Constraints

- Minimal, surgical fix — no reshaping of the surrounding profile-rule /
  global-rule construction.
- No change to any other path rule's output beyond the 4 affected hosts.
- `git status --short` clean (ignoring CRLF-only noise) after full regen.

## TDD

Mode: off — no project/session TDD config found. Ordinary functional checks
apply; RED confirmed on the extended test before the generator fix + regen,
GREEN after (see Progress).

## Tasks

- [x] T1 `tools/generate-rules.mjs`: add `resolvePathRuleHostBase(domain)` —
  walks up domain labels, returns the nearest tailored ancestor's
  `removeParams` (or `[]` for a tailored-but-ruleless ancestor that preserves
  every tracking param) or global `TRACKING_PARAMS` if no tailored ancestor
  exists; use it in place of the old `?? [...TRACKING_PARAMS]` fallback.
  Extend `tests/unit/path-scoped-dnr-rules.test.mjs` with a
  superset-of-ancestor assertion over every generated path-scoped rule
  (structural, reads `src/rules/tracking-params.json` directly). Route:
  inline (single already-understood file for the fix; test lives beside its
  existing fixtures in the same file).
- [x] T2 Regenerate (`compile:rules`, `build:dnr`, `build:content`,
  `build:web`), verify with `build-rules-store.mjs --check`, revert the two
  CRLF-only-changed generated files, run full verification.

## Acceptance criteria

- Every generated path-scoped rule's `removeParams` is a superset of the
  removeParams of whatever profile/global rule Chrome would otherwise apply
  to that host outside the rule's own path prefix.
- No other path rule's `removeParams` changes beyond the 4 affected hosts'
  6 rule ids (807, 808 order-only, 810, 825, 838, 839).
- `npm test`, `npm run test:integration`, `npm run fpfn` (hard gate),
  `npm run typecheck`, `npm run lint:js` all green.
- `git status --short` clean after regen (ignoring CRLF-only noise).

## Checks

- `npm run typecheck` — clean.
- `npm run lint:js` — clean.
- `node --test tests/unit/dnr-rules-sync.test.mjs tests/unit/path-scoped-dnr-rules.test.mjs` — 71/71 pass.
- `npm test` — 9238 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `npm run fpfn` — 0 FP (hard gate), 0 FN.
- `node tools/verify-polyfill-integrity.mjs` — fails (known Windows CRLF-checkout environmental failure, ignored per instructions).
- `git status --short` after full regen — clean except the 3 hand-written/regenerated files below.

## Progress

**RED evidence** (before the generator fix, against the pre-existing
`src/rules/tracking-params.json`): the new
`every path-scoped rule's removeParams is a superset of the ancestor rule
Chrome applies outside its prefix (#1467)` suite failed on exactly the 5
rules predicted by the issue investigation:

```
✖ rule 807 (ca.indeed.com/cmp) — missing: acatk, adid, advn, cmp, jrtk, pub, sjdu, vjs, xfps, xkcb, xpse
✖ rule 810 (cc.naver.com/cc) — missing: frm, n_ad, n_cid, n_match, n_query, n_rank, napm, nclid, sca_esv, sm
✖ rule 825 (lcs.naver.com/m) — missing: frm, n_ad, n_cid, n_match, n_query, n_rank, napm, nclid, sca_esv, sm
✖ rule 838 (search.naver.com/p/crd/rd) — missing: frm, n_ad, n_cid, n_match, n_query, n_rank, napm, nclid, sca_esv, sm
✖ rule 839 (search.naver.com/search.naver) — missing: frm, n_ad, n_cid, n_match, n_query, n_rank, napm, nclid, sca_esv, sm
```

`rule 808 (ca.indeed.com/viewjob)` passed even before the fix — its own
`pathStrips.params` already named every param `indeed.com`'s profile strips,
so nothing was missing there (only param ORDER changed after the fix, since
those names moved from the path rule's own `addition` list into the shared
`hostBase`).

**GREEN after fix + regen**: all 60 tests in
`path-scoped-dnr-rules.test.mjs` (48 path rules + structure/parity fixtures)
pass; `dnr-rules-sync.test.mjs` unaffected (11/11 pass, its own
ONE-RULE-PER-HOST suite is scoped to profile-rule domains, doesn't see
path-rule-only hosts — the gap the new test closes).

**Per-rule before/after diff** (6 rule ids changed total; no other of the 48
path rules changed):

| Rule id | Host + prefix | Params added | Params removed |
|---|---|---|---|
| 807 | `ca.indeed.com/cmp` | 11: `acatk, adid, advn, cmp, jrtk, pub, sjdu, vjs, xfps, xkcb, xpse` | 0 |
| 808 | `ca.indeed.com/viewjob` | 0 (same set, order only — those 11 names moved from the path's own `addition` list into `hostBase`) | 0 |
| 810 | `cc.naver.com/cc` | 10: `frm, n_ad, n_cid, n_match, n_query, n_rank, napm, nclid, sca_esv, sm` | 0 |
| 825 | `lcs.naver.com/m` | same 10 as above | 0 |
| 838 | `search.naver.com/p/crd/rd` | same 10 as above | 0 |
| 839 | `search.naver.com/search.naver` | same 10 as above | 0 |

**Preserve-param widening check**: `naver.com` preserves `query, where, sort,
period, start, page, ie, nso`; `indeed.com` preserves `q, l, jt, salary,
fromage, radius`. None of the 4 affected hosts' own `pathStrips.params`
(`bw/px/py/sx/sy`, `bh/bw/domcomplete/.../ts`, `i/px/py/sx/sy/tqi`,
`attributionid/fromjk/tk`, `acatk/ad/adid/advn/camk/cmp/i2af/jrtk/pub/rjptk/
sjdu/tk/vjs/xfps/xkcb/xpse`) collide with either ancestor's preserved names —
**no widening existed**, pre- or post-fix.

**No other path rules changed** beyond the 6 ids above — confirmed by diffing
every rule id's full JSON between the pre-fix and post-fix
`tracking-params.json`.

**CRLF noise**: `rules-manifest.json` and `wrapper-dnr-rules.json` were
regenerated with byte-identical content once CRLF is ignored
(`git diff --ignore-cr-at-eol` empty for both) — reverted, not committed.

## Commits

- `fix(rules): resolve path-scoped rule hostBase via nearest tailored ancestor (#1467)` — `tools/generate-rules.mjs`, `tests/unit/path-scoped-dnr-rules.test.mjs`.
- `chore(rules): regenerate tracking-params.json for #1467` — `src/rules/tracking-params.json`.
- `docs(odd): correct #1463's priority-tie note and track #1467` — `odd/tasks/1463-adguard-coverage.md`, `odd/tasks/1467-path-rule-ancestor-profile.md`.
