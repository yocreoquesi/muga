# Rollback playbook — incident response

A regression has shipped. This file is the calm, decisive runbook for the maintainer mid-incident. Read top-to-bottom on first incident; on subsequent incidents, jump to the section you need.

Companion docs: [`health-signals.md`](./health-signals.md) (how the regression got noticed) and [`staged-release.md`](./staged-release.md) (how the rollout was structured, which determines whether you can hold a stage instead of patching).

The first rule: **do not panic-revert in the first hour**. The signals that flag a regression also flag false positives. Confirm before acting.

## 1. Decision tree — revert or forward-fix?

Once the regression is confirmed (per the thresholds in `health-signals.md` §2), pick one path:

### Revert preferred when

- The regression is traceable to a **single isolated commit**, AND
- That commit can be reverted cleanly without taking out unrelated work that has shipped on top of it, AND
- Re-testing the reverted state takes the normal CI cycle (no special integration work required).

### Forward-fix preferred when

- The regression is **integrated** — multiple commits depend on the bad code, OR
- A clean revert would also revert unrelated, valuable work, OR
- The fix is small and the maintainer is confident it lands faster than a revert + full re-validation, OR
- The "regression" is actually the system working as designed and the fix is a clarifying tweak (e.g. a UI string, a default flag).

### When in doubt

Default to **revert**. A revert is cheap to undo (re-apply the original commit) once you know what was wrong. A forward-fix that turns out to be incomplete is expensive — you spend time debugging the fix instead of debugging the original commit.

## 2. Identifying the bad commit

You confirmed a regression. You don't yet know which commit caused it. Two paths:

### Path A — `git log` review (fast path)

If you have a hypothesis about the area (e.g. "checkout broke on amazon.de"):

```bash
git log --oneline v1.12.0..HEAD -- src/lib/affiliates.js src/content/cleaner.js
git log --oneline v1.11.0..v1.12.0 -- src/lib/affiliates.js src/content/cleaner.js
```

Read the touched paths in the release range. Most regressions trace to a commit whose message or path makes the cause obvious in retrospect.

### Path B — `git bisect` (when the area is unclear)

If you have a reproducer but no hypothesis:

```bash
git bisect start
git bisect bad v1.12.0
git bisect good v1.11.0
# bisect checks out a commit; reproduce; mark it
git bisect bad   # or: git bisect good
# repeat until done
git bisect reset
```

For MUGA, the typical bisect range is one release of commits (~10–30). Bisect resolves in 4–5 steps.

### Path C — search the in-extension reports

If multiple users hit the `Report unclean URL` button and the GitHub issues all share a hostname, that hostname's affiliate or rule entry is your prime suspect. Grep:

```bash
git log --oneline -p v1.11.0..v1.12.0 -- src/lib/affiliates.js | grep -i <hostname>
```

## 3. Cutting the patch release

You have the bad commit. Now cut a PATCH release.

```bash
# 1. Branch from main (latest tagged release tip)
git checkout main
git pull --ff-only
git checkout -b release/v1.12.1

# 2. Revert OR fix
git revert <bad-commit-sha>            # revert path
# OR
$EDITOR <files>                         # forward-fix path
git commit -m "fix(<scope>): <one-line summary> (#<issue>)"

# 3. Bump version (PATCH only — 1.12.0 → 1.12.1)
$EDITOR src/manifest.json src/manifest.v2.json package.json
# version-consistency.test.mjs will catch any miss

# 4. CHANGELOG entry
$EDITOR CHANGELOG.md
# Under a new ## [1.12.1] - YYYY-MM-DD section:
# ### Fixed
# - <one-line summary of the regression and what was reverted/fixed> (#<issue>)

# 5. Run the full test suite locally
npm ci
npm test
npm run test:e2e

# 6. Commit the bump and CHANGELOG
git add src/manifest.json src/manifest.v2.json package.json CHANGELOG.md
git commit -m "chore(release): v1.12.1"

# 7. Push the branch and open a PR
git push -u origin release/v1.12.1
gh pr create --title "release: v1.12.1 — <regression>" --body "..."

# 8. After CI green and PR merged, tag from main
git checkout main
git pull --ff-only
git tag v1.12.1
git push origin v1.12.1

# 9. The release.yml workflow fires on the v* tag and submits to CWS + AMO
gh workflow view release.yml
gh run list --workflow=release.yml --limit 3
```

**PATCH only.** A regression patch is `1.12.0 → 1.12.1`, not `1.13.0`. Do not bundle new features into a patch release. If a new feature was on deck, hold it for the next minor.

## 4. Communication template

Pinned GitHub issue, posted as soon as the patch is cutting (not after it ships):

```markdown
**v1.12.0 had a regression in [area]. Patched in v1.12.1 (releasing now).**

**Symptoms.** [One sentence describing what users see — e.g. "MUGA fails to clean URLs on amazon.de checkout."]

**Cause.** [One sentence on the technical cause — e.g. "An overly broad rule pattern matched a URL fragment used by amazon.de's checkout."]

**If you're affected.** [What the user can do right now — e.g. "Disable MUGA on amazon.de via Settings until v1.12.1 lands. CWS + AMO submissions are in flight; expected to roll out within 24-48h."]

**Tracking.** This issue.
```

CHANGELOG entry (under the new `## [1.12.1]` section):

```markdown
### Fixed
- [Symptom in one short sentence]. Reverted [commit/PR ref]. (#<issue>)
```

**No external announcement** (HN, Reddit, Twitter, blog) for routine incidents. The pinned issue is enough — readers who care subscribe to the repo, and CWS/AMO surface the version automatically. External posts amplify the regression narrative more than they help the affected user.

For non-routine incidents (a privacy-impacting bug, a security issue, a regression affecting > 5% of installs), escalate communication: a CHANGELOG entry alone is insufficient. Treat that case as out of scope for this playbook — it's its own incident class and is paired with whatever disclosure obligation applies.

## 5. Re-validation post-patch

The patch shipped. Now confirm it actually fixed the thing. Without telemetry, this is the same external-signal loop as `health-signals.md`, with the focus narrowed to the specific regression's symptom:

- [ ] **In-extension reports.** Are new `Report unclean URL` issues for the same host still arriving? Drop to baseline confirms the fix.
- [ ] **GitHub issues.** Are new comments appearing on the pinned issue saying "still broken in 1.12.1"? If yes, the patch is incomplete.
- [ ] **CWS + AMO reviews.** Slow signal, but watch for a sentiment shift over 7–14 days.
- [ ] **Self-test.** The maintainer reproduces the original repro on the patched build. Must come back clean.

Re-validation window is **48–72 hours after v1.12.1 reaches 100% rollout**. If signals are clean at the end of the window, close the pinned issue. If a residual issue remains, decide between a v1.12.2 hot patch and rolling the residual into the next minor — same decision tree as §1.

## 6. When NOT to roll back

Some regressions don't justify a patch release. Hold them for the next planned release.

- **Cosmetic issues.** A typo in a tooltip, a color drift in dark mode, a label that's mildly off. Note in CHANGELOG, fix in next minor.
- **Edge-case bugs.** Affects <1% of installs and the next minor is < 7 days away. The patch + re-test cost is higher than the user impact.
- **Already documented in known-issues.** If the bug was disclosed in the v1.12.0 CHANGELOG (or in a known-issues entry), users already had warning. Roll the fix into the next minor and update the known-issues note.
- **Behavior changes that look like regressions but were intentional.** A user reports a deprecation as a bug. Reply, link the announcement, do not patch.

The bar for a hot patch: **users are losing functionality they had in v1.11.0**. If that test fails, hold the fix.

## 7. Close-out

The pinned issue is the close-out paper trail. Once the regression is fixed and re-validated:

- [ ] Re-validate per `health-signals.md` § quiet-period monitoring.
- [ ] If a staged rollout was capped (per `staged-release.md`), lift the cap and resume the original ramp.
- [ ] Update CHANGELOG: under `## [1.12.1]`, add a one-line note pointing to the pinned issue.
- [ ] Comment on the pinned issue: `Fixed in v1.12.1, re-validated as of <date>. Closing.`
- [ ] Close the pinned issue. Unpin it.
- [ ] If the bad commit had an associated PR, comment on that PR with a back-pointer to the regression issue so future archeology is cheap.

## Appendix: rollback when the release pipeline itself fails

The release workflow (`.github/workflows/release.yml`) submits to CWS and AMO automatically on a `v*` tag push. Failures during submission are not the same as a runtime regression — they're a release-pipeline incident. Triage:

- **CWS submission rejected.** Read the rejection email. Update `docs/store-listing.md` or `amo-metadata.json` if needed (per `docs/legal-sync` PRDs), re-tag.
- **AMO submission stuck "in review."** Wait. AMO review can take 1–14 days for a non-trivial release. Do not re-submit — duplicate submissions only delay further.
- **Workflow itself failed (e.g. esbuild step, tag-checkout).** Read the run log: `gh run view <run-id> --log-failed`. Fix in `release.yml` or `tools/bundle-content.mjs`, push to main, retag.

These are not user-facing regressions. The runbook above does not apply.
