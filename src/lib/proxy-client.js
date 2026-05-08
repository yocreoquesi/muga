/** MUGA: Privacy Proxy client — calls unwrap.muga.app and verifies Ed25519 signature */
//
// Sends opaque affiliate redirect URLs to the Cloudflare Worker at
// unwrap.muga.app for resolution, then verifies the Ed25519 signature
// on the response before the browser navigates anywhere.
//
// Security invariants:
//   - Every response is verified before use. A tampered response is rejected.
//   - Destination must be http:// or https:// — no other schemes allowed.
//   - Destination length capped at 2000 chars.
//   - Private/loopback/link-local destinations are rejected.
//   - Fetch is aborted after timeoutMs (default 5000ms).
//   - No credentials, no cache, redirect: "error".

import { PROXY_TRUSTED_PUBLIC_KEYS } from "./remote-rules-keys.js";

/** Proxy endpoint — compile-time constant, NOT user-configurable. */
export const PROXY_URL = "https://unwrap.muga.app/v1/unwrap";

/** Default fetch timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Maximum destination URL length accepted from the Worker response.
 * Mirrors the cleaner.js 2000-char cap.
 */
const MAX_DESTINATION_LENGTH = 2000;

/**
 * Required fields in a valid unwrap response payload (besides signature).
 * The canonical signed input is built exclusively from these fields.
 */
const REQUIRED_FIELDS = ["cached", "destination", "hops", "network"];

// ── canonicalJSON ────────────────────────────────────────────────────────────

/**
 * Serialises a value to canonical JSON with ASCII-sorted object keys,
 * no whitespace, and recursive handling of nested objects.
 * Arrays preserve element order. Primitives are serialised verbatim.
 *
 * This is a pure serialiser: it does NOT strip any fields.
 * Use `canonicalUnwrapInput()` to build the canonical signed input
 * for a proxy response (which restricts to `REQUIRED_FIELDS` only).
 *
 * @param {unknown} value - The value to serialise.
 * @returns {string} Canonical JSON string.
 */
export function canonicalJSON(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  // Object: sort keys ASCII-alphabetically
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJSON(value[k])).join(",") + "}";
}

/**
 * Builds the canonical signed input for an unwrap response payload.
 * Only the four required fields are included; `signature` and any
 * unknown/extra fields are excluded. Keys are sorted by canonicalJSON.
 *
 * @param {object} payload - The full response payload.
 * @returns {Uint8Array} UTF-8 bytes of the canonical JSON string.
 */
function canonicalUnwrapInput(payload) {
  const subset = {};
  for (const field of REQUIRED_FIELDS) {
    subset[field] = payload[field];
  }
  return new TextEncoder().encode(canonicalJSON(subset));
}

// ── verifyUnwrapResponse ─────────────────────────────────────────────────────

/**
 * Verifies the Ed25519 signature on an unwrap response.
 *
 * The canonical input is `canonicalUnwrapInput(payload)` — only the four
 * required fields (`cached`, `destination`, `hops`, `network`) are signed.
 * The `signature` field and any extra unknown fields are excluded.
 *
 * @param {object}    payload   - Full response object including `signature`.
 * @param {CryptoKey} publicKey - An Ed25519 CryptoKey with `["verify"]` usage.
 * @returns {Promise<boolean>} `true` if the signature is valid, `false` otherwise.
 */
export async function verifyUnwrapResponse(payload, publicKey) {
  try {
    // Validate required fields are present
    for (const field of REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) return false;
    }

    // Signature must be present and be a non-empty string
    const sigB64url = payload.signature;
    if (typeof sigB64url !== "string" || sigB64url.length === 0) return false;

    // Decode base64url → standard base64 with padding, then to bytes
    const stdB64 = sigB64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = stdB64 + "=".repeat((4 - stdB64.length % 4) % 4);
    const sigBytes = Uint8Array.from(
      typeof atob === "function"
        ? atob(padded).split("").map(c => c.charCodeAt(0))
        : Buffer.from(padded, "base64")
    );

    // Build canonical input bytes
    const msgBytes = canonicalUnwrapInput(payload);

    // Verify
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, sigBytes, msgBytes);
  } catch {
    return false;
  }
}

// ── Private-host detection ───────────────────────────────────────────────────

/**
 * Returns true if the hostname is a private/loopback/link-local/cloud-metadata
 * address that should never be a valid affiliate redirect destination.
 *
 * Covers:
 *   - 127.0.0.0/8      — IPv4 loopback
 *   - 10.0.0.0/8       — RFC 1918 private
 *   - 192.168.0.0/16   — RFC 1918 private
 *   - 172.16-31.0.0/12 — RFC 1918 private
 *   - 169.254.0.0/16   — link-local / APIPA
 *   - ::1              — IPv6 loopback
 *   - [::1]            — IPv6 loopback in bracket notation
 *   - fe80::/10        — IPv6 link-local
 *   - 169.254.169.254  — Cloud instance metadata (AWS, GCP, Azure)
 *   - metadata.google.internal — GCP metadata
 *   - localhost        — common loopback hostname
 *
 * @param {string} hostname - Hostname from URL.hostname (lower-cased by URL parser).
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  if (!hostname) return false;

  // Strip brackets from IPv6 literals like [::1]
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

  if (h === "localhost") return true;
  if (h === "::1") return true;
  if (h === "metadata.google.internal") return true;
  if (h === "169.254.169.254") return true;

  // IPv6 link-local: fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;

  // IPv4 checks
  const parts = h.split(".");
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 127) return true;                        // 127.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16-31.0.0/12
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local)
  }

  return false;
}

// ── Cached production CryptoKey import ──────────────────────────────────────

/** Module-scope cache for imported production CryptoKeys. */
let _cachedProductionKeys = null;
let _cachedProductionKeysSig = null;

/**
 * Imports production base64-encoded raw Ed25519 public keys to CryptoKey objects.
 * Results are cached for the service-worker lifetime.
 *
 * @param {string[]} base64Keys - Base64-encoded raw 32-byte Ed25519 public keys.
 * @returns {Promise<CryptoKey[]>}
 */
async function importProductionKeys(base64Keys) {
  const sig = base64Keys.join("|");
  if (_cachedProductionKeys && _cachedProductionKeysSig === sig) {
    return _cachedProductionKeys;
  }
  const keys = await Promise.all(
    base64Keys.map(async (b64) => {
      const raw = Uint8Array.from(
        typeof atob === "function"
          ? atob(b64).split("").map(c => c.charCodeAt(0))
          : Buffer.from(b64, "base64")
      );
      return crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    })
  );
  _cachedProductionKeys = keys;
  _cachedProductionKeysSig = sig;
  return keys;
}

// ── fetchUnwrap ──────────────────────────────────────────────────────────────

/**
 * Calls the Privacy Proxy Worker to resolve an opaque affiliate redirect URL.
 *
 * Security checks applied before returning a successful result:
 *   1. HTTP status mapped to reason on non-2xx responses.
 *   2. JSON parse failure → "network".
 *   3. Ed25519 signature verification against PROXY_TRUSTED_PUBLIC_KEYS → "signature".
 *   4. Destination scheme must be http or https → "invalid_url".
 *   5. Destination length ≤ 2000 chars → "invalid_url".
 *   6. Destination hostname must not be a private/loopback address → "private_address_blocked".
 *
 * @param {string}   url              - The opaque affiliate redirect URL to resolve.
 * @param {object}   [opts]           - Optional options.
 * @param {number}   [opts.timeoutMs] - Fetch timeout in milliseconds (default 5000).
 * @returns {Promise<
 *   { ok: true, destination: string, hops: number, cached: boolean } |
 *   { ok: false, reason: string }
 * >}
 */
export async function fetchUnwrap(url, opts) {
  const timeoutMs = (opts && typeof opts.timeoutMs === "number") ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let responseBody;
  try {
    const endpoint = new URL(PROXY_URL);
    endpoint.searchParams.set("url", url);

    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });

    if (!response.ok) {
      return { ok: false, reason: _statusToReason(response.status) };
    }

    responseBody = await response.json();
  } catch (err) {
    if (err && (err.name === "AbortError" || (err instanceof DOMException && err.name === "AbortError"))) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }

  // ── Destination validation (before sig check for scheme/length) ──

  const destination = responseBody && responseBody.destination;

  // Length cap — checked before expensive sig verification
  if (typeof destination === "string" && destination.length > MAX_DESTINATION_LENGTH) {
    return { ok: false, reason: "invalid_url" };
  }

  // Scheme validation
  let destUrl;
  try {
    destUrl = new URL(destination);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (destUrl.protocol !== "http:" && destUrl.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }

  // ── Signature verification ──

  let sigValid = false;
  try {
    if (!PROXY_TRUSTED_PUBLIC_KEYS || PROXY_TRUSTED_PUBLIC_KEYS.length === 0) {
      return { ok: false, reason: "signature" };
    }
    const cryptoKeys = await importProductionKeys([...PROXY_TRUSTED_PUBLIC_KEYS]);
    for (const key of cryptoKeys) {
      const ok = await verifyUnwrapResponse(responseBody, key);
      if (ok) { sigValid = true; break; }
    }
  } catch {
    return { ok: false, reason: "signature" };
  }

  if (!sigValid) {
    return { ok: false, reason: "signature" };
  }

  // ── Private-host check (after sig, before navigation) ──

  if (isPrivateHost(destUrl.hostname)) {
    return { ok: false, reason: "private_address_blocked" };
  }

  return {
    ok: true,
    destination,
    hops: responseBody.hops,
    cached: responseBody.cached,
  };
}

/**
 * Maps HTTP error status codes to fetchUnwrap reason strings.
 *
 * @param {number} status - HTTP response status code.
 * @returns {string} Reason string.
 */
function _statusToReason(status) {
  switch (status) {
    case 400: return "invalid_url";
    case 403: return "forbidden_origin";
    case 404: return "domain_not_allowlisted";
    case 429: return "rate_limited";
    default:  return "network";
  }
}
