# Ops docs — index

Three runbooks for the maintainer running MUGA in production. Read in this order on first encounter; jump to the one you need on subsequent visits.

## Read in this order

### 1. [health-signals.md](./health-signals.md)

What to watch after a release, how loud each channel is, and when a blip becomes a regression. Documents the GitHub-issues stream, AMO + CWS reviews, the in-extension `Report unclean URL` and `Report a problem` channels, and direct email — with latency, baseline, and signal-to-noise per source. Includes a threshold table (watch / investigate / confirmed regression), an explicit T+0/+6/+24/+48/+72 checklist for the first 72 hours after release, and the quiet-period cadence after that.

**Consult when:** triaging signals after a release; deciding whether a one-star review or a cluster of GitHub issues warrants action.

### 2. [rollback-playbook.md](./rollback-playbook.md)

Incident response runbook. The calm, decisive doc for the maintainer mid-incident. Covers the revert vs forward-fix decision tree, three paths for identifying the bad commit (`git log` review, `git bisect`, in-extension report cross-reference), copy-pasteable commands for cutting a PATCH release, a fill-in-the-blank communication template, the re-validation window post-patch, and the explicit list of cases where you **do not** roll back (cosmetic, sub-1% impact, intentional behavior).

**Consult when:** a regression has been confirmed (per `health-signals.md` thresholds) and you need to act.

### 3. [staged-release.md](./staged-release.md)

Decision doc for whether a release ships staged on Chrome or full. Covers the asymmetry between CWS (granular % rollouts) and AMO (always 100% on publish), the pros and cons of staging, the explicit "stage when X / skip when Y" criteria, the default 1% → 10% → 50% → 100% ramp schedule with hold rules tied to `health-signals.md`, the available tooling, and a per-release decision log.

**Consult when:** at release time, choosing whether this build ships staged or full; or planning the AMO synchronize / stagger / accept-asymmetry option.

### 4. [landing-deploy.md](./landing-deploy.md)

One-time setup doc for the `muga.app` landing auto-deploy. Covers creating the Cloudflare API token, adding it as a `CLOUDFLARE_API_TOKEN` GitHub secret, confirming the existing Worker name, the trigger surface of `.github/workflows/deploy-landing.yml`, and the rollback path via the Cloudflare Deployments tab.

**Consult when:** provisioning the deploy on a new account, rotating the API token, debugging a missing-secret skip in CI, or rolling back a bad landing deploy.

## When to consult each — quick reference

| Situation | Doc |
|---|---|
| Picked up a one-star review, not sure if it's actionable | `health-signals.md` |
| Three users reported the same broken site in 24h | `health-signals.md` (confirmation) → `rollback-playbook.md` (action) |
| Confirmed regression, deciding revert vs fix | `rollback-playbook.md` |
| Cutting v1.X.Y patch | `rollback-playbook.md` §3 |
| About to tag v1.13.0, deciding rollout strategy | `staged-release.md` |
| Mid-rollout, deciding whether to ramp from 10% to 50% | `health-signals.md` thresholds + `staged-release.md` ramp rules |

## Format and tone

All three docs are plain markdown, runbook-style, calm and direct. They are not packed into the AMO/CWS extension bundle (web-ext uses `--source-dir src/` so anything outside `src/` stays out of the package). Edit them like you would edit a runbook for yourself in 6 months.

## Last reviewed

The per-release decision log in `staged-release.md` §7 is the canonical "is this still current" indicator. If the most recent decision-log entry is older than the most recent release, give the index a re-read pass.
