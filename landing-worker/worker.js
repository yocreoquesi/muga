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
//   - External resources: images/icons from rules.muga.app (img-src), and the
//     Archivo + IBM Plex Mono webfonts (the stylesheet from fonts.googleapis.com
//     via style-src, the font files from fonts.gstatic.com via font-src). Those
//     two origins are the only external hosts the page may reach; if the
//     landing ever drops the <link> to Google Fonts, tighten both directives
//     back down.
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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' https://rules.muga.app data:; " +
    "font-src https://fonts.gstatic.com; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

/**
 * Decides the browser Cache-Control for a landing asset.
 *
 * The landing page and the inlined /clean tool form an HTML<->module contract:
 * index.html (and /clean/index.html) load JS/CSS/JSON modules by fixed,
 * unhashed names (./clean/ui.js, ./clean/engine/cleaner-bundle.js, the
 * *.gen.mjs mirrors, etc.). Static Assets serves those with a multi-hour
 * max-age, so after a deploy that changes the contract a returning visitor can
 * get fresh HTML but a stale cached module and see a broken tool ("Cleaning is
 * unavailable right now") until the module's cache expires.
 *
 * `no-cache` does NOT mean "don't cache" — it means the browser must
 * revalidate with the edge before reusing the cached copy. With the ETag the
 * asset already carries, an unchanged asset returns a cheap 304 and a changed
 * one returns fresh bytes, so a deploy is picked up on the very next load with
 * no stale window. Returns null for anything else (images, fonts, favicons),
 * leaving the Static Assets default long-cache in place.
 *
 * @param {string} pathname URL pathname (e.g. "/clean/ui.js", "/", "/clean/").
 * @returns {string|null} "no-cache" for contract assets, otherwise null.
 */
export function cacheControlFor(pathname) {
  const path = typeof pathname === "string" ? pathname : "";
  // A trailing "/" (or the root) resolves to an index.html document.
  if (path === "/" || path.endsWith("/") || /\.(?:html|js|mjs|css|json)$/i.test(path)) {
    return "no-cache";
  }
  return null;
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const newResponse = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      newResponse.headers.set(name, value);
    }
    let pathname = "/";
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      pathname = "/";
    }
    const cacheControl = cacheControlFor(pathname);
    if (cacheControl) {
      newResponse.headers.set("Cache-Control", cacheControl);
    }
    return newResponse;
  },
};
