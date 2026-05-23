// MUGA Landing — minimal Worker that defers to the Static Assets binding.
//
// The Worker is intentionally small. All the content lives in landing/ and
// is served by Cloudflare's Static Assets infrastructure (configured via
// wrangler.toml [assets]). We only keep this script so the Worker has an
// explicit entry point and so we have a hook for future enhancements
// (redirects, A/B tests, security headers) without changing the deploy
// surface.

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
