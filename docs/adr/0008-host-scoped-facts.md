# ADR-0008: Host-scoped facts — may `(param, host)` leave quarantine?

**Date**: 2026-08-22
**Status**: **Accepted** — Path A. Unblocks the host-scope slice of the rule-model normalization
**Issue**: [#1221](https://github.com/yocreoquesi/muga/issues/1221)
**Builds on**: [ADR-0005](./0005-rule-scaling-pipeline.md) (clean-room ingestion), and `tools/rule-ingestion/PROVENANCE.md` (the license ledger)
**Amends**: ADR-0005's extraction boundary — not its gates, not its risk posture
**Milestone**: none

> **This is an engineering analysis, not legal advice.** It sets out what the
> repo already commits to, what changes, and where the exposure sits, so the
> decision was made deliberately rather than by omission. The reading has not
> been confirmed by a lawyer; Path B below is the recorded fallback precisely
> because that confirmation has not happened.

## Context

MUGA's ingestion adapters extract **bare parameter names** and discard everything
else. ADR-0005 states it plainly:

> extracts only literal param-name facts — bare strings — and discards every
> curated pattern, regex, and arrangement

`PROVENANCE.md` encodes the same boundary as a table: *"Extract individual
literal param **names**"* on the allowed side, *"Skip regex/patterns, keep atomic
facts only"* on the forbidden.

That boundary has a measured cost.

**Upstream is host-scoped; MUGA's channel is not.** AdGuard's Filter 17 anchors
roughly 1418 of its `removeparam` rules to specific hosts against 436 global.
ClearURLs organises everything per provider, each with its own `urlPattern`.
Dropping the anchor turns a precise fact into an over-general one.

**That over-generalisation has already shipped as a bug.** #1212: MUGA stripped
`u` — ShareASale's affiliate id — on shareasale.com. `u` is a real ClearURLs
rule, scoped to tweakers and LinkedIn Learning. The fact was right; MUGA applied
it everywhere. #1217 measured the class: of the twenty one- and two-character
names that had reached the list, **zero** were global upstream.

**And it caps intake.** The corroboration gate requires two independent sources
because anything published applies to the whole web. The 2026-07-01 ingestion
report: 1989 candidates, 182 admitted, **1796 of the 1807 rejections failed
corroboration alone** — a single upstream source knew them. A host-scoped fact
would not need that bar; its blast radius is one host.

Four measurements bound the decision:

| Question | Measured |
|---|---|
| Is the DNR rule budget a constraint? | **No.** 329,975 static rules available; 2000 synthetic complete-per-host profiles (24 MB) all fire in real Chromium (#1221) |
| Is there preserve knowledge upstream to reuse? | **Almost none.** AdGuard Filter 17 carries 2600 `removeparam` lines and **95** exception lines. MUGA already holds all 26 usable `(host, param)` preserve facts |
| Does the repo already let a host scope leave quarantine? | **Yes.** `PROVENANCE.md` sanctions moat-expansion emitting `{ provider, urlPattern, referralMarketing[] }` tuples — shipped code |
| Are the enabled sources license-compatible with MUGA? | **Yes.** The ledger says so: AdGuard GPL-3.0 *"compatible with MUGA's GPL v3"*; ClearURLs LGPL-3.0 *"ships alongside MUGA without relicensing"* |

## The question

**Is `(param, host)` an atomic fact, or is it curated arrangement?**

`PROVENANCE.md` rests on *Feist* (facts carry no copyright; only original
selection and arrangement, thinly) and on *BHB v. William Hill* limiting the EU
sui generis database right to investment in **obtaining** data rather than
**creating** it.

**The case for fact.** "`si` is a tracking parameter **on youtube.com**" is a
proposition about the world, independently verifiable by loading a YouTube URL.
It is not less factual than "`si` is a tracking parameter" — it is *more precise*.
The unscoped version is the compiler's fact with information deleted, and the
deletion is what produced #1212. The host is not an editorial choice; it is a
property of where the tracker was deployed. AdGuard did not invent that `si` is
YouTube's, they observed it. A single pair is neither a selection nor an
arrangement: it is one row, not the shape of the table.

**The case against.** A pair carries more of the compilation's structure than a
bare name, and the EU sui generis right bites on extraction of a *substantial
part*, assessed quantitatively **and** qualitatively. Taking ~1418 anchored pairs
is a large slice of Filter 17. The counter is that MUGA already extracts ~2600
bare names from the same file, so the quantitative question is not new — but the
qualitative one arguably is, because pairs preserve more of what makes the
database useful.

## The second path this decision has

The ledger records something that makes the question less binary than #1221
framed it. **Both enabled sources are already license-compatible with MUGA's own
GPL-3.0.** Compatibility is stated in `PROVENANCE.md`, not inferred here.

That means there are two ways to obtain host anchors, and the clean-room posture
is only one of them:

| | Path | What it requires | What it costs |
|---|---|---|---|
| **A** | **Fact extraction** — treat `(param, host)` as an atomic fact, as bare names are treated today | Nothing new: the same quarantine, the same gates, the same "signals not copies" discipline | Carries the residual sui-generis question above. Keeps MUGA free of attribution and derivative-work obligations |
| **B** | **Licensed use** — accept that the pairs may be a substantial extraction and comply | Attribution of AdGuard/ClearURLs in the repo and the store listing; keeping the derived data under GPL-3.0 (MUGA already is) | Removes the legal question entirely. Couples MUGA's rule data to upstream licensing, and a future source with an incompatible licence could no longer be mixed in silently |
| **C** | **Status quo** — keep discarding host anchors | Nothing | Keeps #1212's failure mode structurally reachable, keeps 1796 signals per cycle in quarantine, keeps the corroboration bar high because everything published is global |

Path C is what the four measurements above argue against. It is listed because
"do nothing" must be costed like anything else, and here its cost is known.

## Decision

**Path A, with Path B as the documented fallback.**

`(param, host)` may leave quarantine as an atomic fact, on the same terms bare
names already do: raw bytes stay quarantined and uncommitted, no curated regex,
selection or ordering is reproduced, and **every pair is still re-derived through
the EPIC C gates before it can land**. A pair MUST NOT be shipped because an
upstream shipped it.

Nothing in ADR-0005's safety architecture changes. Gates 1 (affiliate-guard) and
3 (canary) remain the P0 moat guards with their fail-safe postures intact. The
only boundary that moves is what an adapter may carry out of quarantine: a
`(param, host)` pair instead of a bare `param`.

Path B is recorded because it is genuinely available and cheap to exercise: if
the sui-generis reading is judged too thin, adding attribution and a GPL notice
for the derived rule data resolves it without abandoning the work — the enabled
sources are already compatible.

## Rationale

- Precision is the safety property, not a nicety. A scoped fact cannot be applied
  to a host it was never learned about, which is precisely the invariant #1221
  says any design must protect and precisely what #1212 broke.
- The repo already answers this question one way, in shipped code: moat-expansion
  carries `urlPattern` out of quarantine for the affiliate direction. Two
  pipelines answering the same legal question in opposite directions is not a
  posture, it is an inconsistency.
- The gates, not the extraction boundary, are what make ingestion safe. ADR-0005's
  own words: *"we use upstream lists as signals that point at candidate facts,
  then independently re-derive and justify each one."* That justification is
  unchanged by carrying the anchor — if anything it gets stronger, because a
  scoped claim is falsifiable against one host.
- The budget objection is gone. It was reasonable to assume host-scoped rules
  would strain the ruleset; measurement says 2000 profiles fit with room to
  spare.

## Consequences

**Enables.** `candidate.mjs` gains a scope field, the AdGuard adapter can emit
`(param, host)`, and the corroboration gate can become scope-aware: a GLOBAL
claim still needs two sources; a HOST-SCOPED one can be admitted on one, because
its blast radius is a single site.

**Requires, without exception.** A host-scoped strip rule only takes effect if the
global rule cedes that host via `excludedRequestDomains` — measured under #1221:
among static rules the global rule shadows a tailored one on the same host *even
when the global rule's own transform is a no-op*. Any change that adds a
host-scoped rule must add the host to the global exclusion list in the same
change, or the rule is silently inert.

**Costs.** Ingestion carries more upstream structure, so the sui-generis exposure
is larger in kind than bare names. Path B is the mitigation and it is cheap.
Package size grows with each new host profile (~12 KB per rule at today's
`removeParams` count) — a distribution concern, not a DNR one.

**Does not change.** The `referralMarketing` exclusion in the rule-ingestion
adapter is safety-critical and stays. DuckDuckGo stays excluded — its
NonCommercial term is a licence problem, not a facts problem, and no reading of
this ADR reaches it. The remote signed payload stays global; nothing here
requires it to become host-expressive (that is the separate question in #1221).

**Reversible.** If the reading is later judged wrong, the anchors are additive
data. They can be dropped back to bare names, or Path B adopted, without
rewriting the pipeline.
