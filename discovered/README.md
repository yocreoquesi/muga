# discovered/ — Crawler Artifact Landing Zone

This directory receives signed JSON artifacts produced by [caps-crawler](https://github.com/yocreoquesi/caps-crawler).
Every file committed here is a permanent audit record. **Nothing in this directory is ever auto-deleted or auto-applied.**

---

## Artifact Arrival Flow

1. caps-crawler signs a discovery artifact with the `crawler-2026-a` Ed25519 private key.
2. The crawler opens a pull request adding `discovered/<date>.json` to this repository.
3. The `discovered-validate.yml` workflow triggers on the PR and runs:
   - **Schema validation** — checks the artifact conforms to `discovered.schema.json`.
   - **Signature verification** — verifies the Ed25519 signature using the stored public key at `tools/rule-ingestion/crawler-pubkey.txt`.
4. If validation passes, the workflow marks the PR ready for human review via CODEOWNERS.
5. A maintainer reviews the artifact manually and merges (or rejects) the PR.
6. **Merge is always a manual human action. Auto-merge is never permitted.**

---

## Schema and Signature Validation

### Schema

Every artifact must conform to `discovered.schema.json` (repo root).
Required top-level fields:

| Field             | Type                  | Constraint                     |
| ----------------- | --------------------- | ------------------------------ |
| `discovered_at`   | string                | ISO 8601 UTC                   |
| `crawler_version` | string                | git SHA hex, 7–40 chars        |
| `corpus`          | array of string       | lowercase hostnames, ≥1 entry  |
| `candidates`      | array of objects      | empty array is valid heartbeat |
| `signature`       | string                | hex lowercase, 128 chars       |

Each `candidates` element:

| Field             | Type    | Constraint  |
| ----------------- | ------- | ----------- |
| `param`           | string  | case-sensitive parameter name |
| `first_seen_on`   | string  | hostname                      |
| `injected_by`     | string  | (no further constraint)       |
| `occurrence_count`| integer | ≥1                            |

### Signature verification (manual)

```bash
node tools/rule-ingestion/discovered-verify.mjs
```

This script iterates every `discovered/*.json` file, validates shape and signature, and exits non-zero on the first failure.

---

## Reviewer Checklist

Before merging a crawler artifact PR, a reviewer MUST:

1. **Confirm the workflow is green** — both schema and signature checks must pass.
2. **Spot-check the top-3 candidates by `occurrence_count`** — do the parameter names look like real tracking parameters, not internal application state or noise?
3. **Confirm `crawler_version` resolves** — paste the value into the caps-crawler repo commit graph and confirm it resolves to a real, known commit.
4. **Verify `discovered_at` is plausible** — timestamp should match the PR's creation window.
5. **Check `corpus`** — the list of hostnames should be a recognizable subset of the crawler's configured target list.
6. **Do not merge artifacts that fail any check above**, even if CI is green.

---

## Permanent Retention

Artifacts in `discovered/` are part of the repository's audit trail.
**Do not delete or prune committed artifact files.**
If an artifact is later found to be erroneous or malicious, document the issue in the PR that identified it — do not delete the file.

---

## External Steps Required to Complete Integration

The following two steps are **external to this repository** and must be completed separately by a maintainer. They are documented here only; they are NOT implemented in this change.

### Step 1 — Retarget caps-crawler to yocreoquesi/muga

In the caps-crawler repository, update `crawl.yml` so its PR target is `yocreoquesi/muga` (replacing the current target repo).

### Step 2 — Provision a fine-grained PAT

A maintainer must generate a GitHub fine-grained personal access token (PAT) scoped to the `yocreoquesi/muga` repository with the following permissions:

- `contents: write` — to push the artifact file
- `pull-requests: write` — to open the PR

Store this PAT as the `CAPS_SPEC_PR_TOKEN` Actions secret in the muga repository settings, replacing any previous value. The caps-crawler `crawl.yml` references this secret name.

---

## Notes

- Branch protection "require review before merge" must be enabled on the default branch in repository settings. This is a repository configuration step outside the repo itself.
- An empty `candidates` array is a valid artifact (heartbeat run — the crawler ran but found no new candidates in the corpus).
