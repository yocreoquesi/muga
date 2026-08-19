# Landing deploy — `muga.app`

`muga.app` is served by the **Cloudflare Pages** project `muga-landing`, connected directly to this GitHub repository.

| Setting | Value |
|---|---|
| Build command | none |
| Build output directory | `landing` |
| Root directory | repository root |
| Response headers | [`landing/_headers`](../../landing/_headers) |

Push to `main` and Pages builds and deploys. There is no secret to configure and no workflow in this repo that deploys the site.

## Response headers

Everything the site sends — CSP, `X-Frame-Options`, `Referrer-Policy`, HSTS, and the `Cache-Control` overrides that keep the `/clean` bundle from outliving a deploy — comes from `landing/_headers`. Pages reads that file from the **root of the build output directory**, which is why it lives at `landing/_headers` and not at the repository root. A rule that does not match fails silently: nothing errors, the header is simply absent.

`tests/unit/landing-headers-guard.test.mjs` pins the file's contents, but it cannot prove the platform applied them. **Verify against production after any change:**

```bash
curl -sD - -o /dev/null https://muga.app/ | grep -iE 'content-security-policy|x-frame-options|strict-transport'
curl -sD - -o /dev/null https://muga.app/clean/ui.js | grep -i cache-control
```

The first must print three headers. The second must say `no-cache`, not `max-age=14400`.

## Rollback

Cloudflare dashboard → Workers & Pages → `muga-landing` → Deployments → pick a previous deployment → **Rollback**. Deploys are immutable, so rolling back is instant and does not need a revert commit. Fix forward on `main` afterwards.

## History: the Worker that never was

Until 2026-08-19 this document described a different deployment: a Cloudflare Worker, also named `muga-landing`, deployed by `.github/workflows/deploy-landing.yml` via `wrangler`, wrapping `landing/` through the Workers Static Assets binding and stamping security headers in `landing-worker/worker.js`.

None of it ever ran. The workflow needed a `CLOUDFLARE_API_TOKEN` repository secret that was never added, and it was written to **skip rather than fail** when the secret was missing:

```
Skipping deploy. Add CLOUDFLARE_API_TOKEN as a repository secret to enable auto-deploy of muga.app.
```

So it reported success on every run from 2026-07-24 onward while deploying nothing, and Pages quietly served the site the whole time. The consequences were invisible for two months:

- `muga.app` shipped with **no CSP, no `X-Frame-Options` and no HSTS**, because the only file that declared them was never deployed.
- The `/clean` revalidation fix (#1082) never took effect, leaving a four-hour window where a fresh page could run against a stale engine bundle.
- Two unit tests asserted the Worker's headers and passed, which is what made the gap look covered.

The Worker, its wrangler config, its workflow and those two tests were removed in favour of `landing/_headers`. `landing-headers-guard.test.mjs` now asserts they stay removed: a second file claiming to set these headers is precisely how the first gap went unnoticed.

**The transferable lesson:** a deploy step that cannot fail is not a deploy step, and a guard that reads a file the platform never consumes is not a guard. Check response headers against production, not workflow exit codes.
