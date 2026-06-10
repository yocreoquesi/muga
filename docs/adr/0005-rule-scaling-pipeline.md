# ADR-0005: Self-scaling ruleset — clean-room ingestion gated by an automated affiliate safety net

**Date**: 2026-06-03
**Status**: Accepted — documents architecture shipped across v2.3.0 (#779, #780, #781, #782)
**Issue**: [#783](https://github.com/yocreoquesi/muga/issues/783) (this ADR), [#785](https://github.com/yocreoquesi/muga/issues/785) (epic — Self-scaling ruleset)
**Builds on**: [ADR-0002](./0002-denoise-pivot-creator-agnostic.md) (creator-agnostic denoise pivot), [ADR-0003](./0003-awin-redirect-model-resolution.md) (redirect-network model)
**Supersedes**: nothing
**Milestone**: v2.3.0: Self-scaling ruleset

## Context

MUGA's value proposition since the 2.1 pivot ([ADR-0002](./0002-denoise-pivot-creator-agnostic.md)) is a **creator-agnostic, local-first denoise tool**: tracking parameters are stripped from URLs in the browser, rules ship with the extension, no telemetry. The quality of that product is bounded by one number — the coverage of `TRACKING_PARAMS`. The more tracking params MUGA knows about, the more it cleans.

Until the Self-scaling ruleset initiative, `TRACKING_PARAMS` grew **reactively**: a user noticed a tracker MUGA missed, filed a report, a maintainer verified it and added the param by hand. That pipeline has two structural ceilings:

1. **It does not scale.** Coverage is a function of how many users bother to report, which is a tiny fraction of the trackers in the wild. A solo-operated extension with a modest install base will never out-report the open-source filter-list ecosystem (AdGuard, ClearURLs, uBlock) that already tracks thousands of params.
2. **The obvious fix is catastrophically dangerous.** "Just import the upstream lists" looks free until you remember what MUGA protects. The product's entire moat is the **CAPS affiliate safety net** — MUGA must never strip an affiliate-attribution or functional param, because doing so silently breaks a creator's revenue link or a site's search box. Upstream lists are built for ad-blockers that do not carry MUGA's preserve obligations; they contain param names that overlap MUGA's affiliate and functional preserve sets. A naïve import would strip them globally.

The risk here is **asymmetric**, and that asymmetry is the whole design:

> Stripping a tracker by mistake is cheap — the URL is a little noisier than it could be, nobody is harmed, and the next pass catches it. Stripping an affiliate or functional param by mistake is catastrophic — a creator's commission silently evaporates, or a site's search/pagination/locale breaks for every MUGA user, and we learn about it from an angry report weeks later.

A symmetric process (human reviews each candidate, applies equal scrutiny in both directions) wastes the asymmetry: it spends the same expensive human attention guarding against cheap mistakes as it does against catastrophic ones, and it reintroduces the very human-in-the-loop ceiling we are trying to remove. There is also a **legal** dimension: curated filter lists are compilations, and lifting one wholesale raises copyright/database-right questions even when the underlying facts (individual param names) are not themselves protectable.

The initiative ([#785](https://github.com/yocreoquesi/muga/issues/785)) asked: *can `TRACKING_PARAMS` scale without depending on active user reports, while preserving the CAPS moat and staying on the right side of the law?*

## Decision

**MUGA scales its ruleset through an in-repo, clean-room ingestion pipeline whose entire job is to convert the asymmetric risk into asymmetric automation: aggressive toward _preserve_, conservative toward _strip_. The human leaves the critical path — replaced by deterministic gates, never by accepting affiliate-deletion risk.**

The pipeline lives under `tools/rule-ingestion/` and chains three steps in a fixed order (`pipeline.mjs`):

```
runIngestion()  →  runOrchestrateCli()  →  runPromote()
   (signals)        (gate + sign)            (verify + merge)
```

### 1. Clean-room ingestion — signals, not copies (EPIC B)

`runIngestion()` (`ingest.mjs`) fetches a small set of enabled upstream lists, but it never imports a compilation. Each source has an **adapter** (`adapters/`) that extracts only **literal param-name facts** — bare strings — and discards every curated pattern, regex, and arrangement. Raw upstream bytes land in a gitignored **quarantine zone** (`tools/rule-ingestion/quarantine/<adapter>.raw`), outside `src/`, ephemeral in CI, and never committed or bundled. `verify-quarantine.mjs` enforces three invariants: nothing under `quarantine/` is git-tracked, the path is `.gitignore`d, and it lives outside `src/` so it can never reach the `dist/` bundle.

Two adapters are enabled (`adapters/index.mjs` → `ENABLED_ADAPTERS = [adguardTp, clearurls]`):

| Source | License | Re-derivation |
|---|---|---|
| AdGuard URL Tracking Protection (Filter 17) | GPL-3.0 | `parseRemoveparamRules()` — extracts literal `$removeparam=` names only |
| ClearURLs Rules | LGPL-3.0 | literal-name regex `/^[a-z0-9_-]+$/`; two-pass global affiliate exclusion |

The ClearURLs adapter runs a **two-pass global algorithm**: pass 1 unions every `providers[*].referralMarketing[]` name across all providers into a `globalReferral` set; pass 2 admits a `rules[]` name only if it survives the literal check **and** is not in `globalReferral`. This is deliberately global, not per-provider — a name that ClearURLs lists as a tracker for provider A but as referral-marketing for provider B must still be excluded, because admitting it from A would strip an affiliate param. A param's provenance is recorded as a `signals[]` array (`candidate.mjs`); a param reported by both adapters carries `signals: ["adguard-tp", "clearurls"]`.

**DuckDuckGo is excluded in code** (`EXCLUDED_SOURCES` in `adapters/index.mjs`). Its tracker lists are CC BY-NC-SA 4.0 — the NonCommercial clause is off-limits for a commercial extension regardless of the facts-are-not-copyrightable argument, because the issue is the license term a commercial user would be accepting, not the copyrightability of the data.

### 2. The automated gate stack — the decision engine (EPIC C)

`runOrchestration()` (`orchestrate.mjs`, pure — zero I/O, zero crypto) evaluates **every candidate against all four gates with no short-circuit**, collecting all rejections. A candidate is promoted to `autoMerge` **only if zero gates reject it**; any rejection routes it to `quarantine` with its reasons recorded. The gate order is fixed and must not change:

| # | Gate | Guards against | Decision posture on malformed input | P0 moat guard |
|---|---|---|---|---|
| 1 | `affiliate-guard` | param name colliding with a known affiliate-attribution or redirect-landing param (built live from `AFFILIATE_PATTERNS` + `REDIRECT_NETWORK_PATTERNS` in `src/lib/affiliates.js`) | **accept** (no name = no match) | **YES** |
| 2 | `corroboration-gate` | params seen by fewer than `MIN_SIGNALS = 2` independent sources | **reject** (uncorroborated) | no |
| 3 | `canary-gate` | params that, when added to the runtime strip list, break any affiliate-survival canary — runs the live `processUrl()` cleaner over every `PRESERVE_CANARIES` | **accept** | **YES** |
| 4 | `functional-bias-gate` | universally-functional names (search, pagination, identity, locale, sort/filter/view) — a hardcoded `FUNCTIONAL_PARAM_NAMES` set of 43 names | **accept** | no |

The **malformed-input postures encode the asymmetry directly**. Gates 1, 3, and 4 fail _safe_ by **accepting** a malformed candidate — because their job is to _reject_ dangerous strips, and a missing param name cannot collide, cannot break a canary, and cannot be a functional name. Gate 2 fails _safe_ by **rejecting** — because its job is to _require_ corroboration, and "no signals" means "not yet corroborated," so accepting it would defeat the gate.

Gates 1 and 3 are the **P0 affiliate moat guards** and they are complementary, not redundant: Gate 1 is **structural** (does this name collide with a known affiliate param?), Gate 3 is **behavioral** (does adding this name as a strip rule actually break an affiliate-survival canary when run through the real cleaner?). Gate 3 never mutates `TRACKING_PARAMS` or any singleton — it injects the candidate as a transient `remoteParams` pref so the test is hermetic. Gates 2 and 4 are quality/correctness guards (false-positive control and UX protection), not moat guards, but all four are required for auto-merge.

### 3. Sign, verify, promote — the signed artifact boundary (EPIC C5/C6 + EPIC D)

`runOrchestrateCli()` signs the auto-merge param set with **Ed25519** (`node:crypto`) over a canonical message identical to the existing `sign-rules.mjs` format, so the existing `verifySignature()` in `src/lib/remote-rules.js` validates it unchanged — **no new verifier was introduced**. The signing key comes only from `MUGA_SIGNING_KEY_PATH` (env, never a CLI arg — shell-history hygiene). It writes the signed artifact (`promote/promote-candidates.json`: `{ version, published, params, sig }`) and an always-written audit sidecar (`quarantine/quarantine-report.json`). Both are **ephemeral intermediates** handed to the next step within the same run — both paths are gitignored and never committed; only the `.gitkeep` under `promote/` is tracked. What ultimately lands in the repo is the merged `params.json`, not the signed run artifact.

`runPromote()` (`promote-rules.mjs`) is **fail-closed**: it verifies the Ed25519 signature before any write; a bad or unverifiable signature throws with `exitCode: 2` and nothing is written. It re-applies the preserve set (union of every `domain-rules.json[*].preserveParams`) as a final structural backstop, skipping any param that collides, enforces a `STALE_DAYS = 180` freshness bound with a 24h clock-skew tolerance, and writes atomically (`params.json.tmp` → `renameSync`). A no-op run writes nothing.

### 4. Governance — the "no user reports" engine (EPIC D)

`auto-ingest-rules.yml` runs the whole pipeline on a schedule (`cron: 0 4 * * 0` — Sunday 04:00 UTC) plus `workflow_dispatch`. It is **self-contained**: it replicates the full `ci.yml` gate suite inline (compile, DNR build, content build, polyfill integrity, quarantine verify, i18n, unit, integration, contextual conformance, lint, Playwright E2E), signs, branches, commits only `params.json` artifacts, opens/updates an idempotent PR, and squash-merges. It squash-merges rather than using `--auto` because PRs opened by `GITHUB_TOKEN` do not re-trigger `ci.yml` (GitHub's recursion guard), so `--auto` would deadlock waiting on checks that will never arrive — and the gates already ran inline in the same job, so the merged artifact is exactly what passed.

Every exclusion is surfaced — **no silent caps** (EPIC D2, #782). Per-adapter and merged ingest stats (`admitted`, `skipped`, `affiliateExcluded`, `emptyDropped`) flow through `quarantine-report.json`, and a pure formatter (`report-formatter.mjs` → `format-surface.mjs`) renders a human review surface to `$GITHUB_STEP_SUMMARY` and the PR body on both noop and non-noop runs. The surface step is off the critical path: a missing or malformed input emits fallback markdown and exits 0, never failing the run, and reports `err.code` rather than `err.message` so it never leaks runner paths.

### Why in-repo build tooling, not a separate repo or service

The pipeline lives in `tools/rule-ingestion/` as build tooling that runs in CI and commits to the same repo, **not** as a separate repository or a hosted service. This is deliberate (see Alternatives) and is the same posture ADR-0004 moved the product toward: fewer moving parts, no extra infrastructure to operate, and — critically — the gates can import the **live** product code (`src/lib/cleaner.js`, `src/lib/affiliates.js`, the canary suite) so the safety net is validated against exactly the code that ships, not a snapshot that can drift.

## Alternatives considered

**Option B — import the upstream lists directly into `TRACKING_PARAMS`.** Periodically pull AdGuard/ClearURLs and append their `removeparam` names. Rejected on both counts that define the problem: it copies curated compilations (legal exposure) and it has no affiliate safety net, so it would strip affiliate and functional params globally — the catastrophic failure mode. This is the option the entire ADR exists to avoid.

**Option C — keep the human in the loop, just give them better tooling.** Build a dashboard that surfaces candidate params from upstream lists and lets a maintainer approve each one. Rejected because it does not remove the scaling ceiling — coverage is still bounded by human review throughput — and it wastes the risk asymmetry by applying equal human scrutiny to cheap and catastrophic mistakes alike. The gates do the conservative-toward-strip work deterministically and at machine scale; the human is freed to handle only the genuinely ambiguous quarantined cases.

**Option D — a single combined gate (one big affiliate/functional check).** Collapse the four gates into one preserve-collision filter. Rejected because the gates guard **different failure modes** and have **different fail-safe directions**. A structural name check (Gate 1) cannot catch a param that is individually harmless but breaks a canary in combination with the live cleaner (Gate 3); a corroboration requirement (Gate 2) must fail-_reject_ while the moat guards fail-_accept_. Merging them would force a single malformed-input posture, breaking the asymmetry that the separate postures encode. Four narrow gates with explicit, independently-testable postures are auditable; one wide gate is not.

**Option E — a separate repository or a hosted ingestion service.** Run the pipeline out-of-band and publish a signed rule feed the extension consumes. Rejected for the same reasons ADR-0004 decommissioned `unwrap.muga.app`: a separate service is infrastructure to operate, monitor, and threat-model, and a separate repo means the safety net validates against a copy of the product code that can drift from what ships. In-repo tooling that imports live `src/` code keeps the canary gate honest and keeps the operational surface at zero new services. The signed-artifact boundary (Ed25519, fail-closed verify) already provides the integrity guarantee a separate feed would, without the separation cost.

**Option F — corroboration threshold of 1 (admit any single-source param).** Lower `MIN_SIGNALS` to 1 to maximize coverage. Rejected because single-source params are exactly where false positives concentrate, and the asymmetry says a false-positive strip is the expensive direction. Requiring two independent sources (`MIN_SIGNALS = 2`) is a cheap, deterministic confidence floor; the params it quarantines are not lost — they surface in the review surface and are admitted as soon as a second source corroborates them.

## Consequences

**Positive:**

- `TRACKING_PARAMS` scales without user reports. Coverage is now bounded by upstream-list breadth, not report volume, with the affiliate moat enforced deterministically rather than by hand.
- The asymmetric risk is encoded structurally: aggressive toward preserve (four gates, two of them P0 moat guards, fail-safe postures), conservative toward strip (corroboration floor, fail-closed signature verify, preserve-set backstop in promote).
- No new infrastructure. The whole pipeline is CI build tooling committing to the same repo; the canary gate validates against live shipping code, so the safety net cannot drift from the product.
- Clean-room legal posture: only literal facts are extracted, raw compilations are quarantined and never committed, sources are re-derived through MUGA's own gates, and NonCommercial sources are excluded in code. The license ledger lives in `PROVENANCE.md`.
- No silent caps: every exclusion (adapter skip, affiliate exclusion, empty drop, gate rejection, promote skip) is counted and surfaced to a human review surface on every run.
- The signature boundary is reused, not reinvented — the same `verifySignature()` the extension already trusts validates the promoted artifact.

**Negative:**

- The four-gate stack plus signing/verify is meaningfully more code and more concepts than "append the upstream list." The complexity is justified by the catastrophe it prevents, but it is real maintenance surface (`tools/rule-ingestion/` is ~a dozen modules with dedicated tests).
- Coverage is intentionally throttled by the `MIN_SIGNALS = 2` corroboration floor and the conservative literal-only extraction. Some legitimate single-source trackers sit in quarantine until a second source corroborates them. This is the asymmetry working as designed, but it does mean MUGA strips fewer params than a maximalist importer would.
- The hardcoded `FUNCTIONAL_PARAM_NAMES` set (43 names) and the README's preserve-set/canary counts are prose-and-constant, not dynamically proven invariants in every case. They require maintenance as the product's functional and affiliate surface evolves; a stale set could over- or under-reject. (Mitigation: Gate 4's disjointness with the live `TRACKING_PARAMS` is enforced by a test that imports the live set.)
- The auto-merge PR squash-merges without a second `ci.yml` pass (GitHub recursion guard). The inline gate replication is the mitigation, but it means the auto-ingest job's gate list must be kept in sync with `ci.yml` by hand.

**Neutral:**

- The `entropy` and `crossSiteFrequency` candidate fields are currently `null` — placeholders for the GATE 2 heuristic arms tracked in [#798](https://github.com/yocreoquesi/muga/issues/798). Today only `signals.length` drives corroboration. This ADR documents the shipped two-source floor; the heuristic arms are a future deepening, not a change to the architecture here.
- Two upstream sources are enabled today (AdGuard, ClearURLs). Brave, uBlock/uAssets, and Neat URL are recorded in the ledger as GPL/MPL-compatible candidates but are not wired. Adding one follows the documented `PROVENANCE.md` checklist; the architecture does not change.

## Verification

The architecture this ADR documents shipped and is verified by the implementation it describes:

1. **Clean-room invariants** — `npm run verify:quarantine` asserts nothing under `quarantine/` is git-tracked, the path is `.gitignore`d, and it is outside `src/`. CI runs it as a gate.
2. **Gate semantics** — each gate has dedicated unit tests asserting its decision and its malformed-input posture (accept for 1/3/4, reject for 2); the corroboration threshold (`MIN_SIGNALS = 2`), the affiliate preserve index, the canary set, and the functional-name disjointness with live `TRACKING_PARAMS` are all test-covered.
3. **Fail-closed promote** — `promote-rules.mjs` tests assert a bad/unverifiable signature throws `exitCode: 2` and writes nothing, and that a stale (`> STALE_DAYS`) artifact is refused.
4. **Pipeline glue + exit propagation** — `pipeline.mjs` tests assert the fixed `ingest → orchestrate → promote` order, exit-code propagation (0/1/2/3), and that `surface-input.json` is written on both noop and non-noop paths.
5. **No silent caps** — the review-surface formatter tests assert per-adapter and merged stats, gate-rejection breakdowns, and promote skips all render, with null-safe fallback and no path leakage.
6. **End-to-end governance** — `auto-ingest-rules.yml` ran the full inline gate suite and squash-merged the v2.3.0 ingestion PRs (#806–#809); the merged `params.json` is exactly the artifact the gates passed.

This ADR is **Accepted** as the standing record of the architecture. A follow-up ADR will be filed only if a future change alters the gate stack's structure, the clean-room posture, or the in-repo build-tooling decision — for example, if the GATE 2 heuristic arms ([#798](https://github.com/yocreoquesi/muga/issues/798)) change corroboration from a discrete signal count to a scored model, or if a source is added that requires a new legal posture.
