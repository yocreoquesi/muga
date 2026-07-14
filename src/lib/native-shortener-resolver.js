/** MUGA: Native shortener resolver — resolves branded URL shorteners in-extension */
//
// Sole shortener resolution path as of ADR-0004 phase 5 (proxy decommissioned).
// Follows the shortener's redirect chain the same way the browser would and
// returns the final destination (response.url) — no server hop.
//
// IN-BROWSER CONSTRAINT: a `fetch(url, { redirect: "manual" })` in a service
// worker yields an OPAQUE response (status 0, headers unreadable), so the
// `Location` header can never be read there — the earlier manual, per-hop
// implementation was silently a no-op in the extension (it only worked in Node,
// where the maintainer probe runs). We therefore use `redirect: "follow"` and
// read `response.url`. Consequence: the browser follows the WHOLE chain, so the
// per-hop "stop at the first non-shortener host" control is gone; only the FINAL
// destination is validated (Option A, best-effort affiliate handling).
//
// Behaviour & safety floor — MUGA is a denoise tool, not a security/privacy
// product, so these are CORRECTNESS guards (don't hand back garbage), not a
// security posture. Notably http:// destinations are allowed: the user clicked
// a shortener and wants to reach it, whatever its scheme.
//   - credentials: "omit", cache: "no-store", redirect: "follow"; body cancelled.
//   - http:// shortener URLs are upgraded to https for the fetch (prefer https:
//     the shortener serves it and it skips an extra http->https hop — a hygiene
//     choice, not a CSP requirement); the destination scheme is kept.
//   - Only allowlisted generic shorteners (opaque-networks.js) are resolved.
//   - Final destination scheme must be http(s); length capped at 2000 chars.
//   - Private/loopback/link-local FINAL destinations are rejected.
//   - Fetch aborted after timeoutMs (default 5000).

// The allowlisted generic shorteners are the single canonical list in
// opaque-networks.js (also used by isGenericShortener). Re-exported here so
// callers that import from the resolver (options.js, tests) keep working, and
// so the permission list never drifts from the classifier. amzn.to is
// intentionally absent — it sits in opaque-networks' PENDING_VERDICT bucket
// awaiting issue #665 (Amazon-affiliate decision), so this work leaves it be.
import { GENERIC_SHORTENERS, isGenericShortener, isAdGateway } from "./opaque-networks.js";
export { GENERIC_SHORTENERS };

/** Default fetch timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Maximum destination URL length accepted. Mirrors the cleaner.js 2000-char cap. */
const MAX_DESTINATION_LENGTH = 2000;

// ── Private-host detection ────────────────────────────────────────────────────
// Self-contained: does not depend on any deleted proxy module.

function isPrivateIPv4(a, b, c) {
  if (a === 0) return true;                          // 0.0.0.0/8 ("this host")
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16-31.0.0/12
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local)
  // CGNAT shared address space (RFC 6598): 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // TEST-NET-1/2/3 (RFC 5737): documentation ranges, never routable
  if (a === 192 && b === 0 && c === 2) return true;   // 192.0.2.0/24
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true;  // 203.0.113.0/24
  // 6to4 relay anycast (RFC 3068): 192.88.99.0/24 (deprecated but must block)
  if (a === 192 && b === 88 && c === 99) return true;
  return false;
}

/**
 * Returns true if the hostname is a private/loopback/link-local/cloud-metadata
 * address that should never be a valid shortener destination.
 *
 * @param {string} hostname - Hostname from URL.hostname (lower-cased by URL parser).
 * @returns {boolean}
 */
export function isPrivateHost(hostname) {
  if (!hostname) return false;

  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

  if (h === "localhost") return true;
  if (h === "::1") return true;          // IPv6 loopback
  if (h === "::") return true;           // IPv6 unspecified (routes to local host)
  if (h === "metadata.google.internal") return true;
  if (h === "169.254.169.254") return true;

  // IPv6 link-local: fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;

  // IPv6 Unique Local Address: fc00::/7 (RFC 4193) — the IPv6 analogue of
  // RFC 1918 private space (first hextet fc00–fdff). Never a valid destination.
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d, or the compact hex form ::ffff:7f00:1).
  const mapped = h.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const rest = mapped[1];
    let a, b, c;
    if (rest.includes(".")) {
      const p = rest.split(".");
      if (p.length === 4) [a, b, c] = p.map(Number);
    } else {
      // Compact hex form only has two groups — c is not extractable; treat
      // as undefined so range checks that need c fall through safely.
      const g = rest.split(":");
      if (g.length === 2) {
        const hi = parseInt(g[0], 16);
        if (Number.isFinite(hi)) { a = hi >> 8; b = hi & 0xff; }
      }
    }
    if (a !== undefined && isPrivateIPv4(a, b, c)) return true;
  }

  const parts = h.split(".");
  if (parts.length === 4) {
    const [a, b, c] = parts.map(Number);
    if (isPrivateIPv4(a, b, c)) return true;
  }

  return false;
}

// ── Allowlist helpers ────────────────────────────────────────────────────────

/**
 * True if `hostname` is an allowlisted generic shortener. Delegates to
 * isGenericShortener (opaque-networks.js) so the resolver and the rest of the
 * pipeline share one classifier (handles `www.` stripping and wildcards).
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isAllowlistedShortener(hostname) {
  if (!hostname) return false;
  return isGenericShortener(hostname.toLowerCase());
}

// ── resolveShortener ─────────────────────────────────────────────────────────

/**
 * Resolves a branded URL shortener to its destination via a native
 * `fetch(url, { redirect: "follow" })`, reading `response.url` (the final URL
 * after the browser follows the chain). `redirect: "manual"` yields an opaque
 * response in a service worker, so the Location can't be read there — see the
 * file header. The response body is discarded (only the URL is needed).
 *
 * The browser follows the WHOLE chain, so only the FINAL destination is
 * validated (scheme, length, private-host). `hops` is always 1 — the per-hop
 * count is no longer observable.
 *
 * @param {string} url              - The shortener URL to resolve.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Fetch timeout in ms (default 5000).
 * @returns {Promise<
 *   { ok: true, destination: string, hops: number } |
 *   { ok: false, reason: string }
 * >}
 *
 * Failure reasons:
 *   "not_shortener"           input host is not in the allowlist
 *   "ad_gateway"              input host is a known ad-gateway (opaque-networks.js
 *                             AD_GATEWAY_NETWORKS) — never resolved, no fetch attempted
 *   "network"                 fetch threw (network error / DNS / CSP / too many
 *                             redirects)
 *   "timeout"                 fetch aborted after timeoutMs
 *   "no_redirect"             the request never left the shortener host
 *   "oversize_location"       destination exceeded MAX_DESTINATION_LENGTH
 *   "invalid_url"             final URL unparseable or non-http(s) scheme
 *   "private_address_blocked" destination resolved to a private/loopback host
 */
export async function resolveShortener(url, opts) {
  const timeoutMs = (opts && typeof opts.timeoutMs === "number") ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  // Validate the input is an allowlisted shortener before touching the network.
  let inputUrl;
  try {
    inputUrl = new URL(url);
  } catch {
    return { ok: false, reason: "not_shortener" };
  }
  // shortener-resolver-expansion Slice 1 (D1): reject known ad-gateway hosts
  // before the network fetch, with a distinct reason. Belt-and-suspenders —
  // ad-gateway hosts are also absent from GENERIC_SHORTENERS, so the
  // allowlist check below would already fail closed with "not_shortener".
  if (isAdGateway(inputUrl.hostname)) {
    return { ok: false, reason: "ad_gateway" };
  }
  if (!isAllowlistedShortener(inputUrl.hostname)) {
    return { ok: false, reason: "not_shortener" };
  }

  // CSP connect-src whitelists only https shortener origins, and every
  // allowlisted shortener serves https (an http short link just 301s to it), so
  // upgrade the fetch URL to https or connect-src blocks it (throws "network").
  // The destination is read from response.url below, so an http:// destination
  // is still preserved as-is — we never re-fetch it.
  let fetchUrl = inputUrl.toString();
  if (fetchUrl.startsWith("http://")) {
    fetchUrl = "https://" + fetchUrl.slice("http://".length);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    // redirect:"follow" (NOT "manual"): in a browser service worker a manual
    // redirect yields an OPAQUE response (status 0, headers unreadable), so the
    // Location can never be read and the resolver was silently a no-op. Following
    // the chain and reading response.url is the only readable path in-browser.
    // Trade-off (accepted, Option A): the browser follows the WHOLE chain, so the
    // per-hop "stop at the first non-shortener host" affiliate/SSRF control is
    // gone — only the FINAL destination is validated. MUGA is a denoise tool and
    // affiliate handling here is best-effort, so revealing/cleaning the true
    // destination wins over per-hop control.
    response = await fetch(fetchUrl, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    // Also covers net::ERR_TOO_MANY_REDIRECTS (loops / over-long chains).
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }

  // We only ever need the final URL, never the body — cancel the stream so the
  // destination page is not downloaded.
  try { await (response.body && response.body.cancel()); } catch { /* noop */ }

  const finalUrl = response.url;
  if (typeof finalUrl !== "string" || !finalUrl) {
    return { ok: false, reason: "no_redirect" };
  }

  let destUrl;
  try {
    destUrl = new URL(finalUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (destUrl.protocol !== "http:" && destUrl.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }
  // Still on an allowlisted shortener host → the request never redirected off
  // the shortener, so nothing was resolved.
  if (isAllowlistedShortener(destUrl.hostname)) {
    return { ok: false, reason: "no_redirect" };
  }
  if (destUrl.toString().length > MAX_DESTINATION_LENGTH) {
    return { ok: false, reason: "oversize_location" };
  }
  if (isPrivateHost(destUrl.hostname)) {
    return { ok: false, reason: "private_address_blocked" };
  }

  return { ok: true, destination: destUrl.toString(), hops: 1 };
}
