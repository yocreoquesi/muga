# Firefox AMO: Release Guide

> Manual process for now. CI/CD automation planned for when cadence justifies it.

---

## Manual release process

### 1. Build

```bash
npm test                          # must pass all 730+ tests
npm run build:firefox             # generates dist/firefox/
```

### 2. Package

```bash
# Extension zip (what AMO installs)
cd dist/firefox && zip -r ../../muga-firefox.zip . && cd ../..

# Source code zip (AMO requires it because we have a build step)
git archive --format=zip --prefix=muga-source/ HEAD -o muga-source.zip
```

### 3. Upload to AMO

1. Go to https://addons.mozilla.org/developers/addon/muga/versions/submit/
2. Upload `muga-firefox.zip`
3. Attach `muga-source.zip` when prompted for source code
4. Fill "Notes to Reviewer" (see template below)
5. Submit

### 4. Notes to Reviewer template

```
Version X.Y.Z

Changes in this version:
- [summary of changes]

No permission changes from previous version.

Build instructions:
1. Unzip source code
2. npm install
3. npm run build:firefox
4. Output in dist/firefox/

Open source: https://github.com/yocreoquesi/muga
License: GPL v3
```

### 5. Post-submission

- Auto-review: minutes to hours (most common for updates)
- Manual review: 1-5 days (if permissions or code patterns are flagged)
- Check dashboard daily for 2 days after submission
- If reviewer asks questions, respond within 24 hours

---

## Tips to minimize review time

- Do not change permissions unless absolutely necessary
- Do not minify or obfuscate code
- Always attach source code with clear build instructions
- Keep a clean history -- each approved version builds trust
- Use "Notes to Reviewer" on every submission

---

## Future: CI/CD automation plan

When release cadence justifies it, automate with GitHub Actions:

### Workflow trigger

Tag `vX.Y.Z` push triggers the workflow.

### Required secrets (GitHub Settings > Secrets > Actions)

- `AMO_JWT_ISSUER` -- API key from https://addons.mozilla.org/developers/addon/api/key/
- `AMO_JWT_SECRET` -- API secret from same page

### Security notes

- Secrets are encrypted at rest by GitHub
- Never appear in logs (auto-masked)
- Not accessible from fork PRs (GitHub default protection)
- Only injected into ephemeral runner during workflow execution
- Runner is destroyed after workflow completes
- No credentials touch the repository

### Workflow outline

```yaml
# .github/workflows/amo-release.yml (DO NOT COMMIT UNTIL READY)
name: Firefox AMO Release
on:
  push:
    tags: ['v*']

jobs:
  release-firefox:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm ci
      - run: npm test
      - run: npm run build:firefox

      - name: Sign and upload to AMO
        run: npx web-ext sign --source-dir=dist/firefox/ --api-key=${{ secrets.AMO_JWT_ISSUER }} --api-secret=${{ secrets.AMO_JWT_SECRET }}

      - name: Attach .xpi to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: web-ext-artifacts/*.xpi
```

### What NOT to do

- Never commit API keys in the repo (not in .env, not in workflow plaintext)
- Never expose secrets in workflows triggered by fork PRs
- Never give write permissions to the workflow unless strictly needed
