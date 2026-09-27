# Feature: #1490 — test hardening for resolvePathRuleHostBase (#1467) and the post-unwrap signed-URL guard (#1476)

## Objective

Close the test gaps #1467's and #1476's own native reviews flagged as
non-blocking advisories: no controlled-input generator tests for
`resolvePathRuleHostBase`, no preserve-vs-pathStrips invariant check, an
overly strict superset test, and no `processUrl` coverage for the
canonical-extractor / AMP-resolve unwrap paths in the #1476 signed-URL guard.

## Scope

- `tools/generate-rules.mjs` — extract `computeTailoredDomainState`,
  `resolvePathRuleHostBase` (already existed as a closure) and
  `buildPathRuleSpecs` to module-level exports, parameterized instead of
  closed over `buildDnrRules`' locals. Behavior-preserving only (confirmed:
  `compile:rules` output byte-identical modulo git's CRLF normalization).
- `tests/unit/resolve-path-rule-host-base.test.mjs` (new) — item 1.
- `tests/unit/path-rule-preserve-params.test.mjs` (new) — item 2.
- `tests/unit/path-scoped-dnr-rules.test.mjs` — item 3 (tolerate 0 ancestor
  matches; still requires exactly 1 for every real host).
- `tests/unit/signed-url.test.mjs` — items 4-5.

## Constraints

No production behavior change. If a new test found a real bug, stop and
report instead of silently fixing it (none found — see Progress).

## TDD

Mode: off — no project/session TDD config found. Ordinary functional checks
(existing suite) confirmed the refactor was behavior-preserving before new
tests were added on top.

## Tasks

- [x] T1 Extract `computeTailoredDomainState`/`resolvePathRuleHostBase`/
  `buildPathRuleSpecs` from `buildDnrRules`; add
  `resolve-path-rule-host-base.test.mjs` (multi-label walk-up, nearest vs.
  further tailored ancestor, empty-base tailored ancestor, global fallback,
  guard/deny gating). Route: inline (single file, already-understood
  extraction + one new test file).
- [x] T2 Add `path-rule-preserve-params.test.mjs`: real-data invariant (no
  path-scoped rule strips a param its governing ancestor preserves) +
  synthetic violation proof run through the real `buildPathRuleSpecs`.
- [x] T3 Soften `path-scoped-dnr-rules.test.mjs`'s superset test to accept 0
  ancestor matches (legitimate empty-base case) while keeping >1 a hard
  failure and the superset check itself unchanged for the ≥1 case.
- [x] T4/T5 `signed-url.test.mjs`: canonical-extractor path (t.co + opaque
  wrapper + canonicalBundle, signed vs. unsigned destination), AMP-resolve
  path (see Progress — genuinely cannot exercise Step 1b, documented in the
  test file instead of faked), and an explicit Step 0b/1b invariant test
  (unchanged signed input → untouched; wrapped → cleaned with
  cleanUrl === the unwrapped signed URL).

## Acceptance criteria

- All 5 issue items covered by real assertions, no faked coverage.
- `npm run typecheck`, `npm run lint:js`, `npm test`, `npm run test:integration`,
  `npm run fpfn` all green.
- `git status --short` clean (ignoring the known Windows polyfill-integrity
  environmental failure).

## Checks

- `npm run typecheck` — clean (after fixing a JSDoc-adjacency regression the
  extraction introduced — see Progress).
- `npm run lint:js` — clean.
- `npm test` — 9351 pass, 1 skipped (pre-existing), 0 fail.
- `npm run test:integration` — 233/233 pass.
- `npm run fpfn` — 0 FP (hard gate), 0 FN.
- `npm run compile:rules` — output byte-identical to committed
  `tracking-params.json`/`rules-manifest.json` (git's CRLF-only touch
  reverted, no real diff).

## Progress

**Typecheck regression, self-caught and fixed**: moving
`computeTailoredDomainState`/`resolvePathRuleHostBase`/`buildPathRuleSpecs`
in between `buildDnrRules`' JSDoc docblock and its `export function
buildDnrRules() {` line detached that JSDoc comment from the function (JSDoc
only attaches to the declaration directly below it). `tsc` then inferred
`buildDnrRules`' return type structurally instead of using the documented
`@returns {Array}`, and `tools/generate-rules.mjs`'s own `main()` failed to
typecheck (`Property 'requestDomains' does not exist on type ...`). Fixed by
reordering: the three new helpers now sit before `buildDnrRules`' docblock,
which stays immediately adjacent to the function again.

**AMP-resolve path — genuinely cannot exercise Step 1b for a signed
destination.** `unwrapAmpUrl()` builds its target as `"https://" +
<path-derived rest> + url.search + url.hash` — the query string is the AMP
URL's OWN query, reused verbatim, never a re-encoded/embedded blob the way
`google.com/url?q=<encoded dest>` or a canonical-extractor `linkCanonical`
hides a destination's query from Step 0b's literal `[?&]sig=...` scan. So
whenever the AMP-resolved destination is signed, the pre-unwrap `rawUrl`
already carries that identical signed query, and Step 0b (not Step 1b)
already returns `"untouched"` before `unwrapAndExtract` even runs. Confirmed
by first writing the test as an (incorrect) "cleaned" expectation — it failed
with `actual: 'untouched'` — then correcting the test to assert and document
the real, still-safe behavior instead of forcing a false "cleaned" outcome.
This is not a production bug: the signature is protected either way, just by
a different step than #1476 added. No production code changed for this.

**No other bugs found.** The canonical-extractor and Step 0b/1b invariant
tests all passed against unmodified `src/lib/cleaner.js` on the first run.

`src/lib/cleaner.js` was not modified — no bundle rebuild required.

## Commits

- `test(rules): extract generator helpers and add controlled-input coverage for resolvePathRuleHostBase (#1490)`
- `test(rules): pin path-scoped rules never strip an ancestor-preserved param (#1490)`
- `test(cleaner): cover the canonical-extractor and AMP-resolve paths in the post-unwrap signed-URL guard (#1490)`
- `docs(odd): track #1490 rules/cleaner test-hardening`
