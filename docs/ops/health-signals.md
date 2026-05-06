# Health signals — runbook

What to watch after a release, how loud each channel is, and when a blip becomes a regression. This is the maintainer's read-it-on-call doc — not a postmortem template, not a metrics dashboard.

The premise: MUGA has **no telemetry** by design. There is no event stream, no error reporter, no usage counter that calls home. That's a privacy decision and it stays that way. So "health" means external signals: what users say, what stores say, and the in-extension reports the user explicitly chose to send.

The thresholds below are guidance, not gates. Maintainer judgment overrides every number on this page.

## 1. Signal sources

For each source: **what it is**, **latency** (how long after a real problem before the signal lands), **baseline volume** (what you see on a quiet day), **signal-to-noise** (rough sense of how often a hit is real).

### GitHub issues — `github.com/yocreoquesi/muga/issues`

- **What.** Anyone with a GitHub account can open one. Reports come from power users — devs, privacy enthusiasts, the kind of person who reads release notes.
- **Latency.** 12–72h after release, typically. Some early reports land in the first 6h, the long tail can stretch a week.
- **Baseline.** 0–2 issues per quiet week. Most weeks: zero.
- **Signal-to-noise.** High when an issue lands. The audience is technical and self-selecting; "MUGA broke amazon.de" from a GitHub issue is almost always a real bug. Treat every issue as a real signal until disproved.

### AMO reviews / ratings — `addons.mozilla.org/.../muga/`

- **What.** Free-text reviews and a 1–5 star rating per user.
- **Latency.** 24h–14 days. Firefox users tend to install, use for a while, then come back to leave a review. Slow channel.
- **Baseline.** ~1 new review per month at current install base. Rating moves rarely.
- **Signal-to-noise.** Mid-to-high. AMO users who leave a 1-star review almost always cite something specific — "stopped working on X", "broke checkout on Y". The text is the signal; the star is a summary.

### CWS reviews / ratings — Chrome Web Store

- **What.** Same shape as AMO: free text + 1–5 stars.
- **Latency.** 12h–7 days. Faster than AMO — Chrome users review more impulsively.
- **Baseline.** ~2–4 new reviews per month at current install base.
- **Signal-to-noise.** Mid. More noise than AMO (one-star reviews complaining about unrelated things, "doesn't work" with no detail). Read the text, ignore standalone star drops without text.

### In-extension "Report unclean URL" button (#271)

- **What.** Popup link visible only when MUGA modified the URL and `showReportButton` is on. Opens a pre-filled GitHub issue tagged `unclean-url`. Sends hostname, version, browser, removed params — never the full URL or query string.
- **Latency.** Seconds, but lands in the same GitHub issues stream — so observed latency is the same as GitHub issues.
- **Baseline.** 0–1 per week. The friction (clicking, confirming the GitHub flow) keeps this rare.
- **Signal-to-noise.** Very high. By the time someone walks the unclean-URL path, they are looking at a URL they believed should have been cleaned. Each hit is a coverage gap or a rule miss.

### In-extension "Report a problem with this URL" button

- **What.** Older sibling of the unclean-URL flow. Opens a pre-filled GitHub issue with broader context.
- **Latency.** Same as the unclean-URL channel — lands as a GitHub issue.
- **Baseline.** 0–2 per week.
- **Signal-to-noise.** High. Same audience effect: someone clicked through deliberately because something looked wrong.

### CHANGELOG / release-notes comments

- **What.** Comments on release commit messages, on tagged releases, or on the project landing page.
- **Latency.** Hours to a week after a release.
- **Baseline.** Rare. Most weeks: zero.
- **Signal-to-noise.** Mid. Often comments are praise or thanks ("great release") with no signal. When negative, usually a duplicate of something already in the issues stream.

### Direct emails — `yocreoquesi@gmail.com`

- **What.** The maintainer's contact email. Some users prefer email over GitHub.
- **Latency.** Variable. Same day to a week.
- **Baseline.** 0–1 per month. Rare.
- **Signal-to-noise.** Very high. People who go through the email path almost always have a specific complaint or question. Real signal, low volume.

## 2. Reading thresholds (guidance, not gates)

Numbers below are rough heuristics from the post-grill rollout window. Adjust as the install base grows.

| Signal | Watch | Investigate | Confirmed regression |
|---|---|---|---|
| GitHub issues mentioning the same symptom | 1 in 24h | 2 in 24h | 3+ in 24h, OR 5+ in 7d |
| Star rating drop (CWS or AMO, rolling 7d) | −0.1 | −0.2 | −0.3, OR a one-star with detail |
| "Report unclean URL" rate vs. baseline | 2× | 5× | 10× |
| "Report a problem" rate vs. baseline | 2× | 3× | 5× |
| Direct email mentioning regression | 1 | 2 | 2+ in 48h |

**Operative rules.**

- **Same-symptom clustering matters more than count.** Three issues each describing a different broken site is a "weird week." Three issues describing the same broken checkout flow on the same store is a regression — go.
- **A single one-star review with detail beats a star-rating drop without.** Star math is lossy; the text isn't.
- **Baseline shifts with release cadence.** A spike right after a release is expected — investigate, but don't panic until the spike outlives the release window (see §3).
- **The maintainer's judgment overrides every threshold above.** This table is a starting point for triage, not a gate that demands action.

## 3. First 72 hours after release — checklist

The release just shipped (CWS rollout opened, AMO submission entered review or got approved, depending on which one finishes first). The next 72 hours are the high-attention window. Check on a 12–24h cadence; cap each session at ~10 minutes so this doesn't take over the week.

### T+0 to T+6h — release-day pass

- [ ] CWS dashboard: rollout state is what you expect (e.g. 10% if a staged release).
- [ ] AMO dashboard: submission status (in review / approved / requested-changes).
- [ ] GitHub issues stream: any new issues since the release tag?
- [ ] Skim the last 6h of CWS reviews. Anything new?
- [ ] If staged release: install percentage matches the plan.
- [ ] Smoke-test the new build on your own browser (one Chrome, one Firefox profile).

### T+6h to T+24h — overnight pass

- [ ] GitHub issues stream: tally new issues by symptom.
- [ ] CWS reviews and ratings: any drop?
- [ ] AMO reviews and ratings: any drop?
- [ ] In-extension report counts (count of GitHub issues with the `unclean-url` or `report-a-problem` label since release tag).
- [ ] If staged release and signals look good: ramp to next stage per the staged-release doc.

### T+24h to T+48h — second-day pass

- [ ] Same as overnight pass, plus:
- [ ] Read the actual text of any new CWS or AMO reviews — not just the count.
- [ ] If any same-symptom cluster has formed (3+ issues, same root cause): treat as confirmed regression. Open the rollback playbook ([`docs/ops/rollback-playbook.md`](./rollback-playbook.md)).
- [ ] If staged release: ramp to next stage if green, hold or revert if not.

### T+48h to T+72h — third-day pass

- [ ] Same as second-day pass, plus:
- [ ] Cross-check: anything in the email channel that didn't reach GitHub or the stores?
- [ ] If staged release and signals are clean: ramp to 100%.
- [ ] If a regression has been triaged but not yet fixed: decide between hot patch (point release) and rollback. The threshold for rollback over hot patch is "fix takes more than 24h to land safely."

After T+72h, downgrade to the quiet-period cadence below.

## 4. Quiet-period monitoring

Past the 72h release window, the cadence drops sharply. The signals don't change — just the frequency you check them.

- **Daily, ≤2 minutes.** Glance at GitHub issues stream. New issues since yesterday? If yes, read titles. If anything looks like a regression cluster, investigate right then.
- **Weekly, ≤10 minutes.** Read all new CWS and AMO reviews. Re-tally the in-extension report rates against baseline. Check the email channel.
- **Monthly, ≤30 minutes.** Re-baseline. Has the install base grown? If yes, the thresholds in §2 may need to scale up. Note the new baseline at the bottom of this file or in the maintainer's runbook.

The pattern: the higher the latency of a signal, the less often you need to check it. CWS reviews can sit for 3 days before you read them and you lose nothing. GitHub issues are different — those are dense and immediate, so a daily skim is cheap insurance.

## Appendix: where to look (links)

- GitHub issues: https://github.com/yocreoquesi/muga/issues
- GitHub issues with `unclean-url` label: https://github.com/yocreoquesi/muga/issues?q=is%3Aissue+label%3Aunclean-url
- CWS dashboard: Chrome Web Store developer console
- AMO dashboard: addons.mozilla.org developer hub
- Direct email: `yocreoquesi@gmail.com`

## Appendix: what to do once a regression is confirmed

This doc tells you when to act. The companion docs tell you how:

- [`docs/ops/rollback-playbook.md`](./rollback-playbook.md) — rollback playbook. When to revert, how to revert per store, what to communicate.
- [`docs/ops/staged-release.md`](./staged-release.md) — staged-release process. Stage gates, ramp criteria, abort criteria.
