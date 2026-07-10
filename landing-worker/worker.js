// MUGA Landing — minimal Worker that defers to the Static Assets binding.
//
// The Worker is intentionally small. All the content lives in landing/ and
// is served by Cloudflare's Static Assets infrastructure (configured via
// wrangler.toml [assets]). We only keep this script so the Worker has an
// explicit entry point and so we have a hook for future enhancements
// (redirects, A/B tests, security headers) without changing the deploy
// surface.
//
// CSP audit (landing/index.html):
//   - All styles are in a single <style> block in <head> (static, no user data).
//   - Two <script> blocks are inline (backronym rotator + console easter egg).
//   - External resources: images/icons from rules.muga.app (img-src).
//   - No eval, no external scripts, no frames.
//   - 'unsafe-inline' is required for both style-src and script-src because the
//     landing page uses a <style> tag and two inline <script> blocks with no
//     build step and no nonce/hash injection at the Worker layer. The landing
//     page contains no user-controlled data so the risk is accepted for a
//     static marketing page; the script is self-contained and audited.

/** Security headers applied to every response from the landing Worker. */
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' https://rules.muga.app data:; " +
    "font-src 'none'; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const newResponse = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      newResponse.headers.set(name, value);
    }
    return newResponse;
  },
};
