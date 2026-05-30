/** MUGA: Native shortener resolver — resolves branded URL shorteners in-extension */
//
// Replaces the unwrap.muga.app proxy path for the eight GENERIC_SHORTENERS
// (ADR-0004). Performs the same HTTP redirect the browser would perform,
// reads the `Location` header, and returns the destination — no server hop.
//
// This module is PURE resolution logic: it is NOT wired into the service
// worker (ADR-0004 phase 1). Gating on optional_host_permissions and the
// dual-path feature flag land in phases 2-3.
//
// Behaviour & safety floor — MUGA is a denoise tool, not a security/privacy
// product, so these are CORRECTNESS guards (don't hand back garbage), not a
// security posture. Notably http:// destinations are allowed: the user clicked
// a shortener and wants to reach it, whatever its scheme.
//   - credentials: "omit", cache: "no-store", redirect: "manual".
//   - Only allowlisted generic shorteners (opaque-networks.js) are resolved.
//   - Destination scheme must be http(s); javascript:/data:/… are rejected.
//   - Destination length capped at 2000 chars.
//   - Private/loopback/link-local destinations are rejected — never a real web
//     destination, and it keeps the resolver from becoming an SSRF helper.
//   - Redirect chains are followed manually ONLY across allowlisted shorteners,
//     up to MAX_HOPS; loops and over-limit chains fail closed.
//   - Fetch aborted after timeoutMs (default 5000).

// The allowlisted generic shorteners are the single canonical list in
// opaque-networks.js (also used by isGenericShortener). Re-exported here so
// callers that import from the resolver (options.js, tests) keep working, and
// so the permission list never drifts from the classifier. amzn.to is
// intentionally absent — it sits in opaque-networks' PENDING_VERDICT bucket
// awaiting issue #665 (Amazon-affiliate decision), so this work leaves it be.
import { GENERIC_SHORTENERS, isGenericShortener } from "./opaque-networks.js";
export { GENERIC_SHORTENERS };

/** Default fetch timeout in milliseconds. Mirrors proxy-client.js. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Maximum destination URL length accepted. Mirrors the cleaner.js / proxy 2000-char cap. */
const MAX_DESTINATION_LENGTH = 2000;

/** Maximum number of allowlisted-shortener hops to follow before failing closed. */
const MAX_HOPS = 5;

/** HTTP status codes that carry a `Location` redirect. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ── Private-host detection (ported from proxy-client.js) ─────────────────────
// Intentionally self-contained: proxy-client.js is scheduled for deletion in
// ADR-0004 phase 5, so the native resolver must not depend on it.

function isPrivateIPv4(a, b) {
  if (a === 0) return true;                          // 0.0.0.0/8 ("this host")
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16-31.0.0/12
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local)
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

  // IPv4-mapped IPv6 (::ffff:a.b.c.d, or the compact hex form ::ffff:7f00:1).
  const mapped = h.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const rest = mapped[1];
    let a, b;
    if (rest.includes(".")) {
      const p = rest.split(".");
      if (p.length === 4) [a, b] = p.map(Number);
    } else {
      const g = rest.split(":");
      if (g.length === 2) {
        const hi = parseInt(g[0], 16);
        if (Number.isFinite(hi)) { a = hi >> 8; b = hi & 0xff; }
      }
    }
    if (a !== undefined && isPrivateIPv4(a, b)) return true;
  }

  const parts = h.split(".");
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (isPrivateIPv4(a, b)) return true;
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
 * `fetch(url, { redirect: "manual" })`, reading the `Location` header.
 *
 * Redirect chains are followed manually but ONLY while the next hop is itself
 * an allowlisted shortener (the extension only holds host permissions for the
 * eight). The first non-shortener destination ends the chain and is returned.
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
 *   "network"                 fetch threw (network error / DNS / CSP)
 *   "timeout"                 fetch aborted after timeoutMs
 *   "no_redirect"             response was not a 3xx with Location
 *   "missing_location"        3xx response had no Location header
 *   "oversize_location"       Location exceeded MAX_DESTINATION_LENGTH
 *   "invalid_url"             Location unparseable or non-http(s) scheme
 *   "private_address_blocked" destination resolved to a private/loopback host
 *   "redirect_loop"           the chain revisited a URL already seen
 *   "too_many_hops"           chain exceeded MAX_HOPS
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
  if (!isAllowlistedShortener(inputUrl.hostname)) {
    return { ok: false, reason: "not_shortener" };
  }

  const seen = new Set();
  let current = inputUrl.toString();

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(current)) {
      return { ok: false, reason: "redirect_loop" };
    }
    seen.add(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(current, {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "network" };
    } finally {
      clearTimeout(timer);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: false, reason: "no_redirect" };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { ok: false, reason: "missing_location" };
    }
    if (location.length > MAX_DESTINATION_LENGTH) {
      return { ok: false, reason: "oversize_location" };
    }

    // Resolve relative Locations against the current hop.
    let destUrl;
    try {
      destUrl = new URL(location, current);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (destUrl.protocol !== "http:" && destUrl.protocol !== "https:") {
      return { ok: false, reason: "invalid_url" };
    }
    if (isPrivateHost(destUrl.hostname)) {
      return { ok: false, reason: "private_address_blocked" };
    }

    // If the destination is itself an allowlisted shortener, follow it (we hold
    // the host permission). Otherwise the chain is done.
    if (isAllowlistedShortener(destUrl.hostname)) {
      current = destUrl.toString();
      continue;
    }

    // Final destination reached. Scheme (http/https) already validated above.
    return { ok: true, destination: destUrl.toString(), hops: hop + 1 };
  }

  return { ok: false, reason: "too_many_hops" };
}
