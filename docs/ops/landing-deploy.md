# Landing deploy — `muga.app`

The marketing landing at `muga.app` is served by a Cloudflare Worker named
**`muga-landing`** that wraps `landing/index.html` (and future sibling
assets) via the Workers Static Assets binding. Source of truth lives in
this repo; production stays in sync via `.github/workflows/deploy-landing.yml`.

## One-time setup (maintainer only)

The auto-deploy workflow needs a Cloudflare API token in the GitHub repo's
secrets. Without it the workflow emits a warning and skips the deploy — it
does **not** fail CI, so the secret can be added retroactively at any time.

### 1. Create the API token in Cloudflare

1. Cloudflare Dashboard → top-right avatar → **My Profile**
2. Tab **API Tokens** → **Create Token**
3. Pick the **Edit Cloudflare Workers** template
4. **Account Resources**: include the account that owns the `muga-landing`
   Worker (only that one — least privilege)
5. **Zone Resources**: include `muga.app` (so the Worker can manage its
   custom domain binding)
6. Click **Continue to summary** → **Create Token**
7. Copy the token immediately — Cloudflare only shows it once

### 2. Add the secret to GitHub

1. GitHub repo (`yocreoquesi/muga`) → **Settings** → **Secrets and variables**
   → **Actions** → **New repository secret**
2. Name: `CLOUDFLARE_API_TOKEN`
3. Value: the token from step 1
4. Click **Add secret**

### 3. Confirm the existing Worker name

Cloudflare Dashboard → **Workers & Pages** → confirm there is a Worker
named exactly **`muga-landing`** (case-sensitive). If the existing Worker
has a different name, either:

- Rename the existing Worker to `muga-landing` in the CF dashboard, or
- Update the `name = "muga-landing"` line in [`wrangler.toml`](../../wrangler.toml)
  to match the existing name

The `muga.app` custom-domain binding lives on the existing Worker and is
**not** redeclared in `wrangler.toml`. `wrangler deploy` updates the
Worker's script and assets without touching its triggers, so the custom
domain survives the migration.

## What gets deployed

| Path | What it is |
| --- | --- |
| `landing/index.html` | The landing markup (served at `https://muga.app/`) |
| `landing/**` | Any future sibling assets (CSS, images) under the same dir |
| `landing-worker/worker.js` | The Worker shim that defers all requests to the `ASSETS` binding |
| `wrangler.toml` | Worker name + assets binding config |

## Trigger surface

The workflow runs on `push` to `main` and only when one of the relevant
paths changes:

- `landing/**`
- `landing-worker/**`
- `wrangler.toml`
- `.github/workflows/deploy-landing.yml`

It can also be triggered manually via the **Actions** tab → **Deploy landing**
→ **Run workflow**.

## Rollback

If a deploy goes wrong, Cloudflare keeps the last ~10 Worker versions:

1. Cloudflare Dashboard → **Workers & Pages** → `muga-landing` → tab
   **Deployments**
2. Find the previous good deployment → **Rollback**

The rollback is instant and does not touch the repo. After rolling back,
fix the issue in the repo and push again to redeploy.

## Version in the landing must match the package version

`tests/unit/version-consistency.test.mjs` enforces that the four version
stamps in `landing/index.html` (JSON-LD `softwareVersion`, brand `.ver`
tag, hero eyebrow, and footer) all match `package.json`. Forgetting to
bump them when bumping the extension version will fail CI before the
deploy workflow runs.
