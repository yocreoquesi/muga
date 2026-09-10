# ADR-0010: Path-scoped param rules — a literal path-prefix predicate for `domain-rules.json`

**Date**: 2026-09-10
**Status**: **Accepted** — slices 1 and 2 shipped (schema + mechanism + first real use). Slice 3 (ingesting the 325 params #1326 measured) is **out of scope**.
**Issue**: [#1326](https://github.com/yocreoquesi/muga/issues/1326)
**Builds on**: [ADR-0008](./0008-host-scoped-facts.md) (host-scoped facts leaving quarantine), [ADR-0005](./0005-rule-scaling-pipeline.md) (the gate stack that still governs ingestion)
**Amends**: nothing structurally — additive to the `domain-rules.json` schema and to `tools/generate-rules.mjs`'s DNR projection
**Milestone**: none

## Context

#1326 measured that MUGA discards 23% of everything upstream anchors: AdGuard
Filter 17 anchors 463 of its `removeparam` rules to *host + path*
(`||google.*/search$removeparam=ved`), not just host. `domain-rules.json` can
only say *host* — ADR-0008 gave it that much — so a path-anchored fact was
either discarded (correct, but a real gap) or widened past its evidence to the
whole host (unsafe, and the thing #1229/ADR-0008 explicitly forbid: "import at
the anchor, never widen"). 325 params across 94 hosts sit in that gap.

This ADR is slices 1 and 2 of the issue: decide the predicate shape, teach the
schema and the generator to express and project it, and prove a parity test
protects it. Slice 3 — actually ingesting the 325 — is deliberately not
attempted here; landing the mechanism with one real, hand-verified use (Google
Search's `ved`/`sca_esv`/`gs_lcp`) is the point, per the issue's own framing:
*"The 325 are the yardstick, not the requirement."*

## The constraint that shapes everything

`tests/unit/dnr-rules-sync.test.mjs`'s header states it, and this ADR does not
re-derive it: **Chrome applies AT MOST ONE redirect rule per request** —
redirect actions do not cascade, and the request is not re-evaluated after a
rewrite. So every request must match exactly one param-stripping rule, and
that rule must carry the COMPLETE set for it.

Today the generator achieves that for host-only rules through **disjoint
conditions**: the global rule (id 1, `urlFilter: "*"`) carries every
`TRACKING_PARAM` and excludes every tailored domain via
`excludedRequestDomains`; each profile rule (300-799) is
`requestDomains`-scoped, and Chrome matches only one of the two because they
are mutually exclusive by construction. Everything sits at priority 1.

## Decision 1 — disjointness by priority, not exclusion

**A path predicate cannot use the exclusion mechanism**, because DNR
conditions have `excludedRequestDomains` but there is no
`excludedUrlFilter`. A host's profile rule cannot be told "match this host
except this one path" the way the global rule is told "match everything
except these hosts." Exclusion works when the carve-out is a request
*attribute with its own condition field* (a domain); it does not exist for a
carve-out on *part of* the field the rule is already scoped by (a path within
an already-matched host).

The codebase already has a working precedent for the other disjointness
mechanism: **priority**. The #1221 host-scoped remote rules outrank the
global rule (`DNR_SCOPED_PARAMS_PRIORITY = 2`), and
`tests/e2e/scoped-dnr-rules.spec.mjs` proves it live in Chromium with the
comment *"outranks the global rule, which is what makes the thin shape
work."* That precedent is COMPOSITIONAL, though (the scoped rule ADDS to the
global rule across two redirect passes — see `DNR_SCOPED_PARAMS_PRIORITY`'s
own docblock on why priority 1 there composed only 11/12 times in real
Chromium testing). A path rule does not need composition: it is a single,
self-sufficient, COMPLETE rule (see Decision 3), so simple priority-wins
disjointness is enough — no redirect-pass trick required.

**So**: a path rule runs at `DNR_PATH_SCOPED_PRIORITY = 3` (`src/lib/dnr-ids.js`)
— above every priority-1 global/profile rule AND above the dynamic
host-scoped remote rules (priority 2), in case a future host ever needs both
mechanisms at once. It wins on its own `(domain, path-prefix)` match; the
profile/global rule wins everywhere else on the host. No exclusion list is
written or read on either side.

## Decision 2 — the predicate shape: a literal path prefix, not a regex

#1094 and #1109 were both an over-matching **host** regex. A path predicate
is a strictly *bigger* surface than a host regex — a host has a handful of
labels; a path has unbounded depth and shape — so the risk of a plausible
regex over-matching in a way nobody notices until a false positive ships is
larger, not smaller, than the failure class those two issues already cost the
project.

A **literal path prefix** covers every case #1228 excluded for exactly this
reason: `/search`, `/webhp`, `/itm`, `/stores/`, `/p/`, `/goods/`,
`/promotion/` are all literal prefixes upstream already anchors to, with no
regex needed. `SCOPED_PARAM_RE`-style validation (`tools/rules-store.mjs`'s
new `PATH_PREFIX_RE`, `^\/[A-Za-z0-9_\-./]*$`) enforces this structurally: a
`pathPrefixes` entry that is not a plain path literal is rejected at
construction and at `parseStore`, not just by convention.

**What this gives up.** A literal prefix cannot express a word-boundary
anchor: `/search` as a prefix also matches `/searchhistory` or
`/searching`. The urlFilter the generator emits (`||domain/prefix`, see
Decision 3) is a genuine prefix match, not a whole-path or whole-segment
match — DNR's `urlFilter` requires no trailing `*` to mean "and anything
after," so there is no way to say "this path segment, and only this segment"
without either a trailing `^` (DNR's separator-match character, which itself
only matches ONE of a fixed set of separator characters, not "end of
segment" generally) or a regex. This ADR accepts the over-match: it is a
strictly cheaper mistake than the one it replaces (host-wide stripping, or
discarding the fact entirely), because the accepted party is stripping a
tracking param on a path that FEELS like the anchored one but is not exactly
it — never an affiliate, never a functional param, since Decision 3 still
routes every addition through `AFFILIATE_PARAM_GUARD`/`REMOTE_PARAM_DENYLIST`.
A future slice that finds this tradeoff too loose for a specific host can
narrow it with more `pathPrefixes` entries (e.g. `/search/results` in
addition to `/search`) without a schema change — but no regex ships in
`domain-rules.json` in this change, matching the issue's own prohibition.

## Decision 3 — completeness: the path rule carries the host's whole set, plus the path params

Because Chrome fires at most one redirect rule per request, a path rule that
carried only the newly-anchored params (a "thin delta," like the dynamic
host-scoped remote rules) would, on winning by priority, strip ONLY those
params and let everything else the profile rule would otherwise strip
through untouched — `utm_source` would survive on `google.com/search` because
the higher-priority path rule "won" and had nothing to say about it. That is
a **half-cleaned URL**, the exact failure mode the one-rule-per-request model
exists to prevent.

So a path rule's `removeParams` is always: **the host's own complete profile
set (its own `TRACKING_PARAMS` minus preserves, plus any of its own extra
strips — the same computation the 300-799 range already does) UNION the
path-scoped params**, guarded through the same
`AFFILIATE_PARAM_GUARD`/`REMOTE_PARAM_DENYLIST` filter `extraStrips` already
uses. When a domain has no profile rule of its own (no preserves, no extra
strips), its "host base" is simply the full global `TRACKING_PARAMS` — the
set that already applies to the rest of that host via the global rule today.
Either way, the path rule is never a delta. This is verified structurally
(`tests/unit/path-scoped-dnr-rules.test.mjs`) and against the real generated
artifact (`tests/unit/removed-global-params-network-coverage.test.mjs`'s
`#1326` block).

## Decision 4 — the two-matcher risk, and how it is closed

DNR and the runtime cleaner (`src/lib/cleaner.js`) are two independent
implementations of the same predicate, and `dnr-runtime-parity.test.mjs`
exists precisely because they can silently diverge. A path predicate adds a
SECOND axis they must agree on (not just "does this host match," but "does
this host **and path** match").

`getDomainParamSets(hostname, domainRules, pathname)` gained a third,
optional argument. It folds a `pathStrips` group's params into `domainStrip`
**only when `pathname` is a string and starts with one of the group's
`pathPrefixes`**. A caller that omits `pathname` (every pre-existing call
site except the one inside `stripTrackingParams`, which already has
`url.pathname` on hand) gets **no path-scoped strips at all** — never "apply
them all." That direction matters: mapping a missing pathname to "apply
everything" would strip a path-anchored param across the WHOLE host from any
call site that has not been updated to pass one, which is precisely the
over-claim this whole mechanism exists to avoid. Mapping it to "apply
nothing" fails toward under-cleaning, the cheap direction.

`tests/unit/path-scoped-dnr-rules.test.mjs` is the parity test for this
predicate, structured like `dnr-runtime-parity.test.mjs` (a small
`simulateDnr` compared against `processUrl`) but extended with:
- `urlFilter` matching for the two shapes `tracking-params.json` actually
  emits (`"*"` and `||domain/prefix`), since the general parity test's
  `conditionMatches` never needed to interpret `urlFilter` before (the
  global rule's `"*"` is a no-op wildcard);
- priority-based winner selection among structurally-matching rules, since a
  path-scoped host now legitimately has TWO rules match the same request
  (profile + path) where before exactly one ever did.

## Decision 5 — the publish channel: path predicates stay OUT of it

Scoped facts already ride the weekly signed payload (#1229 —
`tools/rules-store.mjs`'s `scopedFacts[]` / `emitScoped`), and #1278/#1306
sized and hardened that channel's byte budget. **Path predicates do NOT enter
that channel in this change.** `pathPrefixes` lives only on `entries[]` (the
BUNDLED artifact's source), never on `scopedFacts[]`, and
`emitScoped`/`canonicalScopedMessage`/the remote payload schema are
untouched. The remote channel keeps publishing exactly the flat `{param,
hosts[]}` shape it always has.

This is a scope decision, not a technical limitation: `pathPrefixes` could in
principle be added to a future payload version, but doing so changes the
signed message format (`canonicalScopedMessage`'s separators — `@`, `+`,
`,`, `|` — would need a slot for prefixes without colliding with existing
separators) and the runtime verifier, and it changes the budget math #1278/
#1306 did. That is real design work this ADR deliberately does not do. Path
predicates are, for now, a BUNDLED-only mechanism: they change on a release
cadence, not a weekly fetch.

## First real use: `ved`, `sca_esv`, `gs_lcp`

#1228 excluded these three from host-anchoring for exactly the reason this
ADR exists to fix: upstream anchors them to `||google.*/search` and
`||google.*/webhp`, and `domain-rules.json` could only say `google.com`
site-wide, which would have over-claimed relative to the evidence. They
stayed global instead — correct under the old schema, and the annotation in
`tests/unit/removed-global-params-network-coverage.test.mjs` said so
explicitly.

This change:
- Removes all three from `TRACKING_PARAMS` (`src/lib/affiliates-data.js`,
  399 → 396) and from `google.com`'s own `stripParams` (they were listed
  there too, redundantly, while still global — left in place they would have
  re-globalized via `extraStrips` the moment they left `TRACKING_PARAMS`).
- Adds one `pathStrips` group to `google.com`'s `domain-rules.json` entry:
  `{ pathPrefixes: ["/search", "/webhp"], params: ["ved", "sca_esv",
  "gs_lcp"] }`.
- `domain-rules.json` profiles only `google.com` (not `google.co.uk`,
  `google.de`, etc.) — scoping stays exactly as narrow as the existing
  profile, which is the host the evidence and the existing preserve set
  (`q`, `cid`, …) already cover. The wildcard `google.*` upstream uses was
  weighed and rejected: `domain-rules.json` has no TLD-family concept, and
  inventing one to chase a wildcard is exactly the kind of curated
  arrangement ADR-0005/ADR-0008 keep out of the ingestion boundary. If
  `google.com` alone had not been worth shipping, the right call would have
  been to stop and report rather than invent TLD profiles — it was worth
  shipping, so this ADR does not need that fallback.

Verified against the GENERATED `src/rules/tracking-params.json` (not against
`domain-rules.json`, which only states intent):
`tests/unit/removed-global-params-network-coverage.test.mjs`'s new `#1326`
block and `tests/unit/path-scoped-dnr-rules.test.mjs` together prove a
`google.com/search` URL matches exactly one FIRING rule (the path rule, at
priority 3) stripping the three plus google.com's complete profile set;
`google.com/maps` matches only the profile rule and preserves all three; and
no other host is affected (the removed globals simply stop being stripped
anywhere else, which is correct — they were never legitimately global).

## Alternatives considered

**A — Ship a restricted regex instead of a literal prefix.** E.g. a subset of
regex limited to anchors and character classes. Rejected: #1326's own
prohibition is explicit ("No regex path predicates in shipped rule data"),
and #1094/#1109 are the lived cost of a regex surface in bundled rule data.
A literal prefix covers every case in the issue's own list without one.

**B — Thin path rules (delta-only), matching the dynamic host-scoped remote
shape.** Rejected by Decision 3: a thin rule that WINS by priority but omits
the rest of the host's strip set half-cleans the URL, which is exactly the
failure the one-rule-per-request model exists to prevent. The remote
mechanism gets away with "thin" because it is designed to COMPOSE across two
redirect passes at a carefully measured priority (2); a path rule that wins
outright on `urlFilter` has no second pass to fall back on.

**C — Exclude the path rather than the whole host from the profile rule,
via some future `excludedUrlFilter`.** Not available in the platform today;
recorded here so a future contributor does not "discover" the same gap and
re-litigate it. Priority-based disjointness (Decision 1) achieves the same
outcome without needing it.

**D — Put `pathPrefixes` on `scopedFacts[]` and ship it through the remote
channel now.** Rejected by Decision 5, and by the issue's explicit
prohibition. The channel's budget, message format, and verifier were sized
and hardened for the flat shape; changing that is a separate, larger piece
of work this slice does not need to unblock its own goal (proving the
mechanism, landing one real use).

## Consequences

**Positive.**
- MUGA can now express a fact upstream anchors more precisely than host
  scope, closing a real and measured 23%-of-anchored-facts gap, without
  widening any existing claim past its evidence.
- The schema change is fully additive and proven lossless: every existing
  `domain-rules.json`/`tools/rules-source/rules.json` entry re-projects
  byte-identically (`tests/unit/rules-store-roundtrip.test.mjs`, unchanged
  and still green).
- The new DNR rule range (800-899, `DNR_PATH_SCOPED_RULE_ID_BASE`) is STATIC
  (part of `tracking-params.json`, same ruleset as the 300-799 profile
  range), so it is covered by the same wholesale `updateEnabledRulesets`
  toggle the consent gate already uses for the whole static ruleset — it
  needed no addition to `dnr-teardown.js`'s `ownedDynamicRanges`, which
  tracks only per-ID DYNAMIC ranges.

**Negative / costs.**
- A path predicate cannot share a rule across hosts the way the 27 `cid`
  hosts collapsed into one profile rule in #1323 — every `(domain,
  pathPrefixes-group, prefix)` tuple is its own rule. `DNR_PATH_SCOPED_MAX_RULES`
  (100) is sized modestly for this reason, not to the 300-799 range's scale.
- The literal-prefix tradeoff (Decision 2) is a real, accepted over-match on
  paths that share a prefix with the anchored one. Bounded by the guard/deny
  filter, but not eliminated.
- A **known, out-of-scope residual overlap**: `tools/rules-source/rules.json`
  already carries a GLOBAL (`scope: "*"`) entry for `ved` in its remote
  channel (from an earlier, independent ingestion — `ved` is NOT in this
  entry via the mechanism this ADR adds), and `tools/rules-source/params.json`
  — the file that feeds the SIGNED weekly payload — already published it at
  `version: 12`. That entry is untouched by this change: removing it would
  require re-signing and re-publishing the remote payload, which needs the
  production signing key and is a separate operational action, not a code
  change this PR can make safely. Until that entry is removed and
  republished in a future cycle, an installed extension that has fetched
  that payload will continue to strip `ved` globally via the DYNAMIC remote
  rule (id 1001), independent of and in addition to this change's BUNDLED,
  path-scoped behavior. This does not weaken anything this ADR claims about
  the bundled artifact (`tracking-params.json`, verified above) — it is a
  pre-existing, separate channel this change deliberately does not touch
  (Decision 5) — but it means the practical, end-to-end "only path-scoped"
  guarantee for `ved` specifically is not yet complete for users on that
  payload version. Recorded here so it is not rediscovered as a surprise.

**Neutral.**
- `sca_esv` and `gs_lcp` were never in the remote channel's global list (only
  `ved` was), so they do not carry the residual overlap above.
- Slice 3 (ingesting the other 322 of the measured 325) is unstarted. Nothing
  here blocks it; the mechanism this ADR ships is exactly what that
  ingestion would need to target.

## Verification

1. **Schema losslessness** — `tests/unit/rules-store-roundtrip.test.mjs`
   (unchanged, 32/32 green): every pre-existing entry round-trips
   byte-identically through `emitDomainRules`/`importArtifacts` with the new
   optional `pathPrefixes` field never touched.
2. **Structural correctness of the generated rule** —
   `tests/unit/path-scoped-dnr-rules.test.mjs`: priority, condition shape,
   `urlFilter` anchor, "not a regex" check.
3. **The one-rule-per-request invariant, extended** —
   `tests/unit/dnr-rules-sync.test.mjs`'s `ruleMatchesHost` now treats a
   non-`"*"` `urlFilter` as "cannot match a bare host," so the existing
   host-only invariants stay meaningful instead of false-flagging the new
   rule as a host-wide double-match.
4. **Parity** — `tests/unit/path-scoped-dnr-rules.test.mjs`'s DNR/runtime
   comparisons for `google.com/search`, `/webhp`, and `/maps`.
5. **The first real use, pinned** —
   `tests/unit/removed-global-params-network-coverage.test.mjs`'s `#1326`
   block: the three params left `TRACKING_PARAMS` and google.com's
   `stripParams`, and landed exactly in `pathStrips`.
6. **The published transparency numbers** — `docs/transparency.html`'s FP/FN
   counts (`npm run fpfn` / `tests/unit/docs-claims.test.mjs`) stay 0/0; this
   change does not touch what the harness measures.
