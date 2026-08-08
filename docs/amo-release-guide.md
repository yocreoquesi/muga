# Release Guide: what ships automatically, and what does not

> Releases are automated. Pushing a `vX.Y.Z` tag runs
> [`.github/workflows/release.yml`](../.github/workflows/release.yml), which
> gates on the full test and e2e suites and then submits to **both** stores.
>
> This document exists for the parts that are still manual, and to say exactly
> which ones those are. It previously described AMO as a manual process with
> automation "planned for when cadence justifies it"; that automation shipped,
> and the guide had not caught up.

---

## Releasing

```bash
git checkout main && git pull
git tag v3.0.0
git push --tags
```

If the tagged commit carries `[skip ci]` in its message (the `publish-rules.yml`
auto-commit does), GitHub suppresses the tag-push trigger. Use the manual
dispatch instead, which takes the tag name as an input:

```bash
gh workflow run release.yml -f tag=v3.0.0
```

The workflow will not publish unless `npm test`, the live-Worker integration
tests and the Playwright e2e suite all pass first.

---

## What the tag push does for you

| | Chrome Web Store | Firefox AMO |
|---|---|---|
| Upload the built package | automatic | automatic |
| Publish / submit for review | automatic | automatic |
| Extension **name** | automatic | automatic |
| **Short description** / summary | automatic | automatic |
| **Detailed description** | **manual** | automatic |
| Release notes | not supported by the API | automatic |
| Source archive for reviewers | n/a | automatic |
| Keywords / tags | **manual** | **manual** |
| Category | **manual** | **manual** |
| Screenshots | **manual** | **manual** |

### How the copy actually travels

**Chrome** derives the store title from the manifest `name` and the summary
from the manifest `description`. MUGA ships no `default_locale` or `_locales/`,
so those two fields are simply whatever `src/manifest.json` says. Changing the
name is a code change, not a dashboard change.

**AMO** gets its listing fields from `amo-metadata.json`, which
`scripts/prepare-amo-metadata.sh` regenerates during the release:

- `version.release_notes` from the matching `CHANGELOG.md` section
- `name` from `src/manifest.json`
- `summary` and `description` from the **Firefox Add-ons (AMO)** section of
  [`docs/store-listing.md`](./store-listing.md)

`web-ext sign --amo-metadata` spreads that whole object into the
`PUT /addon/{id}/` request, so editing `docs/store-listing.md` is what updates
the public AMO listing. The dashboard is the mirror; the file is the source.

The committed `amo-metadata.json` is a template holding only `version` — the
listing fields are injected at release time and are deliberately not committed,
so they cannot go stale against `docs/store-listing.md`.

---

## What you still have to do by hand

### Chrome Web Store, every time the marketing copy changes

The CWS API (v1.1) supports `upload` and `publish` and nothing else. There is no
endpoint for listing metadata, so this cannot be automated:

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. **Store listing** tab → paste the **Detailed description** from the
   *Chrome Web Store* section of `docs/store-listing.md`
3. Update the 5 keywords from the same document
4. Confirm category and screenshots
5. Submit for review

Copy rule that has already cost one rejection: **never enumerate retailer or
brand names** in the listing body. That triggered a keyword-spam rejection
(routing ID FZSL, 2026-05).

### Both stores, when it applies

- Keywords / tags, category and screenshots
- Permission justifications, which live in the CWS *Privacy practices* tab

---

## If a submission fails

Both store steps use `continue-on-error` and report `success | noop | failure`
in the job summary, so a partial failure on one store does not mask the other.
Re-running the same tag is safe: a store reporting "version already submitted"
is treated as a no-op, not an error.

Two failure modes worth recognising:

- **CWS returns HTTP 200 with an `itemError` array in the body.** Checking only
  the status code hides this; `scripts/cws-check-response.mjs` parses the body.
  This masked five consecutive silently failed releases (#616, v1.13.4 through
  v1.16.0).
- **AMO caps release notes at 3000 characters.** v1.13.0's notes were 4938 and
  broke the upload with no obvious cause. `tools/amo-build-metadata.mjs`
  truncates at a safe budget and links to the GitHub Release for the rest.

---

## Keeping review time short

- Do not change permissions unless necessary. A permission change moves AMO from
  auto-review (minutes) to manual review (1 to 5 days).
- Do not minify or obfuscate. The one build step is the content-script bundle,
  and its output is committed so a reviewer can diff it against its source.
- The reviewer notes in `amo-metadata.json` already explain that build step and
  how to verify it. Keep them accurate if the build changes.
- After submitting, check the dashboard for two days. Answer reviewer questions
  within 24 hours.

---

## Secrets the workflow needs

Set in **Settings → Secrets → Actions**. They are encrypted at rest, masked in
logs, unavailable to fork PRs, and only injected into the ephemeral runner.

| Secret | Source |
|---|---|
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | https://addons.mozilla.org/developers/addon/api/key/ |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Google Cloud OAuth client |
| `CWS_EXTENSION_ID` | the item ID in the Developer Dashboard URL |

Never commit these anywhere, including `.env` files and workflow plaintext.
