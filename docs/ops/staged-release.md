# Staged release — decision doc

The maintainer is at release time. The build is green, the CHANGELOG is written, the tag is ready to push. One question remains: **does this release ship staged or full?**

This file is the answer key. Read it before tagging. Decide. Capture the decision in §6 so future-you sees the reasoning, not just the result.

Companion docs: [`health-signals.md`](./health-signals.md) (the signals you watch during the ramp) and [`rollback-playbook.md`](./rollback-playbook.md) (what to do if the ramp surfaces a regression).

## 1. What the stores support

The two stores have asymmetric capabilities. This shapes everything below.

**Chrome Web Store.** Supports staged rollouts via the developer dashboard. You publish a build, set a rollout percentage (1%, 5%, 10%, 25%, 50%, 100% — granularity varies), and the store hands the build to that fraction of installs. You can ramp by editing the percentage or hold it indefinitely. There is no automatic ramp; the maintainer drives every stage.

**Firefox AMO.** Does **not** support staged rollouts for self-distributed extensions. When AMO approves a submission and the maintainer publishes it, all existing Firefox installs receive the update on their next browser-driven check (typically within hours). There is no percentage knob. This is structural, not a missing feature.

**Consequence: any staged release is asymmetric.** Chrome users may run v1.11.0 while Firefox users run v1.12.0 for 1–7 days. This is fine in practice — MUGA's behavior is identical across browsers — but the maintainer must remember it during incident triage. A regression report from a Firefox user during the ramp window doesn't disprove a Chrome-only regression theory; the populations are on different versions.

## 2. Pros of staged release

- **Smaller blast radius.** A regression that escaped unit + e2e tests reaches 1% of installs first, not 100%. Time to react before everyone is affected.
- **Time to react.** A staged ramp gives 24–72h of signal-watching at each stage before committing to the next. The rollback playbook (§3 of `rollback-playbook.md`) becomes "hold the stage" instead of "cut a patch release" — much cheaper.
- **Forces a slower cadence.** For changes that touch consent, content-script architecture, or anything that runs on every navigation, slow is good. The release window becomes the validation window.
- **Cheaper revert path.** A held-stage release that gets pulled at 1% reaches 1% of users. Pulling at 100% is a different story — the rollback playbook applies.

## 3. Cons of staged release

- **More complex release pipeline.** The maintainer must drive the ramp manually: check signals, bump percentage, repeat. The release.yml workflow does not handle this; it ends at the 100%-on-Firefox + initial-percentage-on-Chrome submission.
- **Longer time to 100%.** A typical staged ramp is 3–7 days end-to-end, vs. day-one for a full release.
- **Asymmetric population during the window.** Two browsers on different versions briefly. Triage burden noted in §1.
- **Hard to pull back mid-stage.** CWS's staged-rollout tooling assumes you ramp **up**. Pulling a staged release back to 0% is technically possible (rollback to the previous build), but the tooling is not designed for it. Most "pull back" scenarios are better handled by a hot patch (v1.12.1) per the rollback playbook than by trying to un-publish v1.12.0 from the partially rolled-out fraction.
- **Easy to forget.** Without an explicit calendar reminder, the maintainer can leave a release at 10% for weeks. Set a reminder at each stage.

## 4. Recommendation — when to stage, when to skip

**Stage on Chrome when the release touches:**

- Consent storage or migration (`chrome.storage.local` consent layer, sync→local migration, ToS re-onboard).
- Content-script architecture (the bundled cleaning library, message-passing topology, BADGE_AND_STATS side-channel).
- Content-script bundle generation (`tools/bundle-content.mjs`, esbuild config, the committed bundle output).
- AMP redirect or redirect-unwrap logic — anything affecting which URL the browser actually loads.
- Affiliate injection logic (`affiliates.js`, `cleaner.js` affiliate paths).
- Anything that runs on **every navigation**. The blast radius of a bug here is the whole user base, instantly.
- declarativeNetRequest rule changes (parameter list, redirect rules) — these run before the page loads.
- Permission changes (manifest), even subtractive ones.

**Skip staging — ship full — when the release is:**

- Cosmetic only (a tooltip color, a UI string, a layout tweak in the popup or options page).
- README-only or other repo-doc updates with no code change.
- Copy-only changes to legal docs (privacy.html, tos.html) that don't change behavior.
- An isolated bug fix touching a narrow path the user can avoid (e.g. a debug-mode-only fix).
- A version bump-only release (rare, but happens when a manifest field is corrected).

**When in doubt: stage.** The cost of a staged release is a few extra days of attention. The cost of a regression hitting 100% of Chrome users on day one is incident response. The asymmetry pays for itself.

## 5. Default ramp schedule

When staging is adopted, the default schedule is:

| Stage | % | After | Gate |
|---|---|---|---|
| 0 | 1% | T+0 | submission approved |
| 1 | 10% | T+24h | signals clean per `health-signals.md` §3 |
| 2 | 50% | T+48h | signals clean |
| 3 | 100% | T+72h | signals clean |

**Hold rules.** At any stage, if the signals are not clean (per the threshold table in `health-signals.md` §2), **hold the stage** — do not advance. Investigate. If the cause is confirmed, fall through to the rollback playbook.

**Ramp rules.** Advance only when:
- The previous stage has been at its percentage for the documented duration.
- Signals across all channels (`health-signals.md` §1) are clean.
- No unresolved CWS or AMO review at one star with detail.
- No active in-extension report cluster.

The schedule is guidance. A high-confidence release (e.g. a tiny isolated fix) can compress to 1% → 100% in 24–48h. A high-uncertainty release (consent migration, architecture rewrite) should pad each stage by 12–24h.

## 6. Tooling

**CWS dashboard handles the rollout.** No `release.yml` change is strictly required. The release pipeline produces the build artifact; the maintainer uploads it via the dashboard at the chosen percentage.

**Optional: workflow_dispatch input for `rollout_pct`.** A future iteration could extend `release.yml` to accept a percentage as input, which the publish step then passes to the CWS submission API. This is opt-in and not required by this PRD. Track as a maintenance follow-up.

**The release tag is a single immutable commit.** Staging is per-publish-channel, not per-tag. `v1.12.0` exists once in git; CWS rolls it out staged, AMO publishes it 100%. There is no `v1.12.0-stage1` tag.

**No telemetry, no automatic gating.** Every ramp decision is the maintainer reading external signals per `health-signals.md`. There is no automated "if error rate > X, hold." This is a deliberate choice — MUGA does not collect the data that would feed such a check.

## 7. Decision log — fill in at release time

A short, append-only log. The maintainer adds one entry per release. Future-maintainer reads this section to understand prior choices.

The log starts at v1.13.5 — the first release after this doc landed. Earlier releases (v1.11.0 through v1.13.4) shipped before the staged-release process was documented and are out of scope for this log.

### v1.13.5 — 2026-05-05

- **Staged?** No — full rollout on Chrome.
- **Why.** Branded-domain release: signed remote-rules endpoint moved from `yocreoquesi.github.io/muga` to `rules.muga.app`. No behaviour change on a default install (remote rules are off by default). Falls under §4 "skip staging" — the change does not run on every navigation and the optional permission re-prompt was already understood by users who had opted in.
- **Ramp followed.** Full submission on tag push.
- **Outcome.** Clean. No regression reports inside the 72h window.

### v1.13.6 — 2026-05-06

- **Staged?** No — full rollout on Chrome.
- **Why.** Onboarding hardening. The Firefox `window.close()` regression was visible to every new install on Firefox; staging on Chrome (which was unaffected) would have delayed the fix on the platform that was already working without addressing the broken one. Pre-launch install base is residual; blast radius of "ship full" is bounded. Falls under §4 "isolated bug fix."
- **Ramp followed.** Full submission on tag push.
- **Outcome.** Clean. No regression reports inside the 72h window. The companion #508 coverage work landed without staging for the same reason.

### Next release — placeholder

(Add a new H3 entry per release. Do not edit older entries — the log is append-only. If a release was not staged, say so and reference the §4 skip criterion that applied.)

## Appendix: AMO and the asymmetry problem

Firefox installs are 100% on day one. The maintainer's response to this asymmetry has three options, all valid in different contexts:

- **Synchronize.** Stage Chrome AND hold Firefox publish until the Chrome ramp completes. AMO submission can sit "in review" or be deliberately held by not pressing "publish" after approval. This eliminates the asymmetric population at the cost of slowing Firefox.
- **Stagger.** Submit to AMO first, let it bake at 100% for 24–48h before opening the Chrome rollout. Firefox is the canary. Smaller install base on Firefox makes this acceptable for most releases. (At MUGA's current install ratios, Firefox is ~10–20% of installs.)
- **Accept the asymmetry.** Publish both at the same time, Chrome staged, Firefox 100%. Triage during the window factors in the version mismatch.

The default is **accept the asymmetry**. Synchronize only when the release is high-risk (consent migration, architecture rewrite). Stagger when the release is medium-risk and the maintainer wants extra signal time.
