# #1228 next batch — host-anchored global params, next installment

## Objective

Continue issue #1228 ("params in the global strip rule are only ever
host-anchored upstream"): re-measure MUGA's current `TRACKING_PARAMS`
(src/lib/affiliates-data.js) against a fresh live fetch of AdGuard Filter 17
and ClearURLs `data.min.json`, using the exact same method as the prior
steps (#1322 step 1, #1323 step 2, #1324 step 3, #1341/#1368-1370 for
#1326's path-scoping extension). Remove any param whose ONLY upstream
evidence is host- or path-anchored (never global), keep it stripped via its
real host(s) in `domain-rules.json`, and add network-layer coverage tests
matching `tests/unit/removed-global-params-network-coverage.test.mjs`'s
existing per-param/per-host pattern.

## Problem

The issue's most recent comment claims "~32 new candidates from a later
AdGuard snapshot" but the comment itself states the measurement scripts were
scratch and were never committed — there is no reproducible list to read
back. Also unresolved: `mkcid`/`mkevt`/`mkrid` were deferred out of step 3
pending #1326's path-anchor mechanism; #1326 slice 3 (PRs #1368-#1370) has
since shipped 46 `(host, pathPrefix)` groups — need to check whether that
now covers the eBay `mkevt`/`mkcid`/`mkrid` family.

## Scope

1. Re-derive the candidate list myself: fetch live AdGuard Filter 17 +
   ClearURLs `data.min.json`, reproduce `parseRemoveparamRules`'s anchor
   classification (host vs path vs truly-bare/global) directly against the
   raw text (the exported `parseRemoveparamRules().params` set is NOT
   "global-only" — it unions bare AND host-anchored names by design, for the
   importer's own new-candidate-merge purpose — so a fresh bareness tracker
   per name is needed for a removal-direction measurement).
2. For every current `TRACKING_PARAMS` entry with anchored-only evidence:
   check `AFFILIATE_PARAM_GUARD` / `REMOTE_PARAM_DENYLIST` membership, check
   whether the anchor is a whole host (landable in `stripParams`) or a path/
   query (stays global per ADR-0008 "import at the anchor, never widen"),
   check self-hosted/SaaS-platform risk (one example site does not establish
   host-exclusivity for a platform like Piwik/Matomo or an ESP like
   Silverpop, whose sibling params in the SAME TRACKING_PARAMS family stay
   global for the same reason).
3. Remove confirmed params from `TRACKING_PARAMS` (both the flat array and
   any `TRACKING_PARAM_CATEGORIES` duplicate) and from
   `src/lib/hot-path-strip.js` if present there too (separate hand-curated
   hot-path subset, same "no host-scope expressiveness" reasoning).
4. Verify (not assume) that every anchored host already carries the param in
   its own `domain-rules.json` `stripParams`, and that the generated
   `src/rules/tracking-params.json` DNR profile rule for that host actually
   lists it in `removeParams` post-regeneration (network-layer proof, not
   just JSON-source presence).
5. Add a new `describe` block to
   `tests/unit/removed-global-params-network-coverage.test.mjs` (step 4)
   following the exact existing per-param/per-host pattern, plus a
   "deliberately excluded" sub-block pinning every candidate that was
   evaluated and rejected, with its reason — so nobody "completes the set"
   later without a fresh measurement.
6. Update every count-claim surface consistently: README.md, CONTEXT.md,
   docs/index.html, docs/transparency.html, onboarding.html, all 7 locale
   files, landing/index.html's "N more" line.
7. Check whether #1326 slice 3 now covers `mkcid`/`mkevt`/`mkrid` — report
   only, no action if still uncovered (that's #1326's remit, not this
   issue's next batch).
8. Do NOT touch `tools/rules-source/params.json` (signed remote channel).

## Constraints

- TDD: off by project config; runner `npm test` (`node --test`). RED
  confirmed by temporarily reverting `src/lib/affiliates-data.js` +
  `src/rules/tracking-params.json` to HEAD and re-running the new coverage
  test file before restoring the edited versions (verified failing
  assertions for the newly-removed params), then GREEN after restoring.
- Never widen a host anchor to global (ADR-0008); never guess a host from a
  weak/contradicted signal.
- Exclude and report, don't silently drop, any candidate whose evidence is
  actually global or that a guard interacts with.
- ~400 authored changed lines/task is advisory only; generated artifacts
  (tracking-params.json, rules-manifest.json, cleaner-bundle.js,
  param-categories.gen.mjs, content-script STRIP copies) don't count.

## Checklist

- [x] T1 — Fetch live AdGuard Filter 17 + ClearURLs `data.min.json`; build an
      independent per-name anchor classifier (bare/global vs host vs path).
- [x] T2 — Cross-reference against current `TRACKING_PARAMS` (395 entries);
      produce the raw candidate list (22) with per-candidate evidence.
- [x] T3 — Triage each candidate: guard membership, anchor tightness
      (query/path vs whole host), self-hosted/SaaS-platform risk, checked
      against real domain-rules.json/PR precedent for prior exclusions
      (`sprefix`, `ingress` already correctly pinned as path/wildcard
      anchored — confirmed via raw AdGuard lines + PR #1324's own text, not
      re-removed).
- [x] T4 — Check `mkcid`/`mkevt`/`mkrid` vs #1326 slice 3: confirmed still
      uncovered (no `pathStrips` entry, still global) — report only.
- [x] T5 — RED: add step-4 `describe` block to
      `removed-global-params-network-coverage.test.mjs` for the 8 confirmed
      params; verified failing against HEAD.
- [x] T6 — Remove the 8 confirmed params from `TRACKING_PARAMS` (+ category
      duplicate) and from `hot-path-strip.js` (`sxsrf` only).
- [x] T7 — Regenerate `compile:rules`, `build:strip`, `build:dnr`,
      `build:content`, `build:web`; verify GREEN; fix 2 pre-existing cleaner
      tests that relied on `content-id`/`_encoding` being global without
      passing `domainRules`.
- [x] T8 — Update count claims across all surfaces (395 -> 387; landing
      "390 more" -> "382 more").
- [x] T9 — Run full checks: `npm test`, `lint:js`, `typecheck`,
      `check:i18n`, `npm run fpfn` (0 FP before/after), `npm run lint`
      (web-ext, 0 errors / 2 pre-existing unrelated warnings), manifest
      diff clean.

## Acceptance criteria

- `npm test` green, `npm run fpfn` still 0 false positives.
- Every removed param still network-layer-stripped on every host its
  evidence names (proven against generated `tracking-params.json`, not
  `domain-rules.json` alone).
- Every excluded candidate has a written reason and, where applicable, a
  pinning test so it can't silently re-enter or silently get removed later.
- No signed remote channel file touched.

## Progress

Done. 8 params removed (`_encoding`, `content-id`, `social_share`,
`skiptwisterog`, `starsleft`, `spia` -> amazon.* (16 hosts); `sxsrf` ->
google.com; `mall_affr` -> aliexpress.com). `TRACKING_PARAMS`: 395 -> 387.
14 candidates excluded with reasons (see final report). `mkcid`/`mkevt`/
`mkrid` confirmed still uncovered by #1326 slice 3 — left untouched,
reported only. All checks green. Work committed on branch
`fix/1228-next-batch` as 2 commits: `6a93881` (task doc), `c576d6f`
(implementation).
