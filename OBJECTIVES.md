# MUGA Objectives

> **Last reviewed:** 2026-05-07
> **Next scheduled review:** 2026-11-07 (6 months), or sooner if the North Star moves materially.
> **Closes:** [#338](https://github.com/yocreoquesi/muga/issues/338).

This document is the public reference for **what success looks like** for MUGA, **what MUGA will not pursue**, and **the principles by which proposals are accepted or declined**. Every "should we build X?" question gets answered against this file. If the file says no, the issue gets closed with a link here.

It is not a roadmap. The roadmap lives in the issue tracker, organised by [strategic-review waves](docs/launch/README.md). This doc is the *frame* the roadmap fills in.

---

## North Star

> **Weekly active users (WAU) on Firefox AMO.**

One number. Publicly verifiable from outside the maintainer's account.

**Where the number comes from.** AMO exposes [`addons.mozilla.org/api/v5/addons/addon/muga/`](https://addons.mozilla.org/api/v5/addons/addon/muga/) — anyone can fetch it and read the average daily users field. We aggregate to weekly to smooth weekday/weekend drift.

**Why this metric.**

1. **Privacy posture.** MUGA collects zero telemetry. We cannot build our own analytics — that would contradict the product. We measure with what stores publish.
2. **Auditable from outside.** The AMO endpoint is public. A reader can verify our claim without trusting us. The Chrome Web Store user count, by contrast, only shows on the developer dashboard — we track it internally but it is not part of the *public* North Star because it is not auditable.
3. **"Active" beats "installed".** An install that gets uninstalled in 24 hours is not success. Weekly active filters out drive-by installs and dead profiles.
4. **One number.** Not three. Not a dashboard. A single metric the maintainer can recite and the community can argue with.

**What this metric does not capture.** Privacy outcomes (params stripped per session, creator tags preserved per session) are also worth knowing, but they live in [`docs/transparency.html`](docs/transparency.html) and the [benchmark report](docs/comparison.html), not here. The North Star answers "is the project alive and growing?", not "is the project doing its job?". Both questions matter; only the first is the North Star.

---

## 6-month targets

Numbers tied to the North Star. These are **guesses informed by reference projects**, not forecasts. The maintainer reviews them at the next scheduled review and edits in place.

| Milestone | Target (AMO WAU) | Rationale |
|---|---|---|
| Month 1 post-launch | 1,000 | Hit if HN / ProductHunt / Reddit launch lands a single front-page placement. Privacy Guides listing alone can do this. |
| Month 3 | 5,000 | Requires either organic word-of-mouth from creators (the wedge audience) or a second launch wave. Wave 2 of the strategic review targets exactly this. |
| Month 6 | 15,000 | Requires sustained discovery — store search, blog mentions, recommended-by lists. Realistic for a single-maintainer project with no marketing budget. |
| Stretch (Month 6) | 30,000 | Requires HN front page + ProductHunt top 5 + at least one large-creator endorsement. Not the plan. The contingency. |

**Reference points** the targets are calibrated against:

- ClearURLs (AMO): ~30,000 daily users after years of presence.
- Decentraleyes (AMO): hundreds of thousands.
- Privacy Badger (AMO): ~1.1M, but with EFF endorsement and ~10 years of compounding.
- Ghostery (AMO): hundreds of thousands across multiple products.

A new privacy extension with no paid marketing typically settles in the 5,000–50,000 range during its first year. The targets above place MUGA on the modest end of that distribution by month 6 with 30k as the upside.

The Chrome Web Store half is tracked privately at the same milestones (1k / 5k / 15k WAU on the CWS dashboard). It is not in the public table because it is not externally verifiable.

---

## Non-goals

Things MUGA will **not** pursue, with reasoning. These are confirmed by the 2026-04-26 strategic review and only get reopened if the strategic frame changes, not because a single contributor wants the feature.

- **Ad / network blocking.** uBlock Origin already does this well; competing dilutes MUGA's wedge ("fair to creators") and brings us into a different threat model with different update cadence requirements.
- **Cloud sync, accounts, server-side state.** The whole product depends on the claim that URLs never leave your browser. An account would mean a server. A server would mean trust. The wedge dies.
- **Auto-cookie consent / GDPR banner dismissal.** Different problem space (DOM injection, regional law, false-positive risk on high-stakes flows). Consent-O-Matic already does this; MUGA staying focused on URLs is the value.
- **Closed-source / Pro tier.** Donations ([GitHub Sponsors](https://github.com/sponsors/yocreoquesi), [Ko-fi](https://ko-fi.com/yocreoquesi)) and direct-injection affiliate revenue (preserves your price, never on top of an existing creator tag) are the only revenue paths. A Pro tier means a feature gate, which means the free tier needs to be deliberately worse than it could be — that is hostile to the user.
- **Anti-fingerprinting beyond what the URL surface affords.** Window-name and history defusers stay because they are part of the URL story. Canvas/WebGL/audio fingerprinting is a different product (Brave, Mullvad Browser).
- **Mobile-first redesign.** Firefox Android works because the same MV2 build runs there. A native-mobile UX rebuild is out of scope until the desktop North Star is met.

---

## Decision principles

When an issue or PR proposes something new, four heuristics run against it. **Failing any one is a hard close.**

1. **Does it serve the "fair to creators" wedge?** Either it preserves creator affiliate referrals, or it strips tracking that other cleaners miss because they conflate tracking with affiliate parameters. If it does neither, it is a different product.

2. **Does it preserve the zero-network privacy posture?** No telemetry. No accounts. No server-side state. The only network egress in the default install is the optional weekly remote-rules fetch from [`rules.muga.app`](https://rules.muga.app/), and even that is an Ed25519-signed plain GET with no user data attached.

3. **Can a single maintainer maintain it?** MUGA is one person plus contributors. A feature that requires ongoing per-merchant negotiation, per-locale moderation, or per-platform support burden gets declined unless a maintainer commits to that surface area in writing.

4. **Would the strategic review verdict approve it?** The 2026-04-26 strategic review (three independent analyses) set the wedge and the non-goals above. A proposal that contradicts those needs an explicit "strategic frame is changing because X" justification, not just a feature wish.

These principles are the same ones the strategic review used. They are intentionally fewer than four would be by accident — three would invite ambiguity, five would invite cherry-picking.

---

## How decisions get made

1. **New idea → opens a GitHub issue.** Author runs the four principles in their head before opening; the issue body should already reference them where the trade-off is non-obvious.
2. **Triage** applies the principles. If any fail, the issue is closed with a link to this doc and the failing principle named.
3. **Survives triage → labelled** with priority (`priority:P1`, `P2`, `P3`) and category (`category:product`, `category:ops`, `category:community`, `category:marketing`).
4. **Material trade-offs against the North Star or a principle** are flagged in the issue body for the next scheduled review (every 6 months) — they accumulate, and the review either ratifies or rejects them.

---

## Risks

Material risks to the North Star that are tracked outside the issue tracker because they outlive a single triage cycle. Each risk links to the audit or runbook that documents it.

- **Amazon Associates account loss.** MUGA's affiliate revenue is concentrated across six Amazon storefronts (US, UK, ES, DE, FR, IT). An adverse reading of the Associates Operating Agreement — or an enforcement action against extension-based affiliation — collapses that revenue and forfeits escrowed earnings. The mitigation surface (current behaviour, disclosure flow, kill-switch gap) is audited in [`docs/affiliate-compliance.md`](docs/affiliate-compliance.md). Status: **DRAFT — pending legal verification of regional clauses**. Tracking: [#339](https://github.com/yocreoquesi/muga/issues/339).

---

## Review cadence

This document is reviewed:

- **Every 6 months** on a fixed calendar (next: 2026-11-07).
- **Whenever the North Star moves materially** — for example, the user count crosses a milestone that changes what "active" means in practice.
- **Whenever a non-goal is challenged** in an issue with strong reasoning. The challenge gets logged here even if rejected, so the rejection is auditable.

Edits to this file land via the same PR/commit flow as the rest of the repo. The edit's commit message documents what changed and why.
