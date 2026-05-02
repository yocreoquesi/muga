/**
 * MUGA: Wrapper Engine
 *
 * Detects and unwraps URL "wrappers" — affiliate redirect networks and link
 * shorteners that hide a destination URL inside their query string. When a
 * wrapper is detected and the destination can be extracted, the engine
 * returns the destination URL so downstream pipeline stages (cleaner.js)
 * can process the merchant URL directly without the user ever contacting
 * the wrapper server.
 *
 * Pure module — no DOM, no network, no clock. Deterministic over its inputs
 * and the WRAPPERS configuration table.
 *
 * ── Schema ────────────────────────────────────────────────────────────────
 * Each entry in WRAPPERS has the shape:
 *   {
 *     id:           string  — stable identifier, used in metrics and the
 *                              future caps-validator output. Never change.
 *     name:         string  — human-readable network name.
 *     hostPatterns: Array<string|RegExp>
 *                            — exact host (lowercase) or regex tested against
 *                              the URL's hostname.
 *     pathPatterns: Array<string> | null
 *                            — optional list of pathname prefixes. When null,
 *                              any path matches.
 *     extract:      (URL) => string | null
 *                            — given the parsed URL, returns the destination
 *                              URL string, or null when extraction fails
 *                              (missing or malformed parameter).
 *   }
 *
 * Worked example — Awin
 *   Input  : https://www.awin1.com/cread.php?awinmid=1&p=https%3A%2F%2Fmerchant.com%2Fp
 *   Match  : hostPatterns includes "awin1.com"; pathPatterns includes "/cread.php"
 *   Extract: searchParams.get("p") → "https://merchant.com/p" (URL-decoded by URL API)
 *   Result : { unwrapped: "https://merchant.com/p", hops: 1, networks: ["awin"] }
 *
 * ── Recursion ─────────────────────────────────────────────────────────────
 * unwrap() will follow nested wrappers up to maxHops (default 3) deep, with
 * explicit detection of loops (a URL appearing twice in the chain). Each
 * call to extract() counts as one hop. With 4+ levels of nesting and
 * maxHops=3, the engine returns the URL after 3 unwraps (still wrapped
 * one level) rather than recursing further.
 */

/**
 * The wrapper configuration table. Exported so tests and tooling can
 * inspect it without re-parsing the module. New networks (B2-B5) append
 * entries here without changing the engine logic.
 * @type {Array<{
 *   id: string,
 *   name: string,
 *   hostPatterns: Array<string|RegExp>,
 *   pathPatterns: Array<string>|null,
 *   extract: (url: URL) => string|null,
 * }>}
 */
/**
 * Builds a generic extract() that pulls `paramName` from the URL's query
 * string and validates the result is a well-formed HTTP(S) URL. Centralizes
 * the try/catch + protocol guard so each network entry stays declarative.
 * @param {string} paramName
 * @returns {(url: URL) => string|null}
 */
function extractFromParam(paramName) {
  return (url) => {
    const value = url.searchParams.get(paramName);
    if (!value) return null;
    try {
      const dest = new URL(value);
      if (dest.protocol !== "https:" && dest.protocol !== "http:") return null;
      return value;
    } catch {
      return null;
    }
  };
}

/**
 * Tries each query-parameter name in order and returns the first that yields
 * a well-formed http(s) URL. Returns null when none succeed. Used by short
 * URLs whose canonical destination lives behind an HTTP redirect (which the
 * engine cannot follow) but where the destination is sometimes attached as
 * a query fallback by upstream tooling.
 *
 * WHY: t.co is path-based (`/abcdef`) and the real destination only resolves
 * via a 301 the engine cannot perform. Per #440, we register the host so
 * detectWrapper() flags it, and try a small allowlist of conventional query
 * keys (`url`, `u`) before giving up. The host is still identified as a
 * wrapper (useful for caps-validator and metrics) even when extraction fails.
 * @param {string[]} paramNames
 * @returns {(url: URL) => string|null}
 */
function extractFromAnyParam(paramNames) {
  return (url) => {
    for (const name of paramNames) {
      const value = url.searchParams.get(name);
      if (!value) continue;
      try {
        const dest = new URL(value);
        if (dest.protocol !== "https:" && dest.protocol !== "http:") continue;
        return value;
      } catch {
        continue;
      }
    }
    return null;
  };
}

export const WRAPPERS = [
  {
    id: "awin",
    name: "Awin",
    hostPatterns: ["awin1.com", "www.awin1.com"],
    pathPatterns: ["/cread.php", "/awclick.php"],
    extract: extractFromParam("p"),
  },
  {
    id: "skimlinks",
    name: "Skimlinks",
    hostPatterns: ["go.redirectingat.com", "go.skimresources.com"],
    pathPatterns: null,
    extract: extractFromParam("url"),
  },
  {
    id: "shareasale",
    name: "ShareASale",
    hostPatterns: ["shareasale.com", "www.shareasale.com"],
    pathPatterns: ["/r.cfm"],
    extract: extractFromParam("urllink"),
  },
  {
    id: "rakuten",
    name: "Rakuten LinkShare",
    hostPatterns: ["click.linksynergy.com"],
    pathPatterns: ["/deeplink"],
    extract: extractFromParam("murl"),
  },
  {
    id: "tradetracker",
    name: "TradeTracker",
    hostPatterns: ["tc.tradetracker.net"],
    pathPatterns: null,
    extract: extractFromParam("u"),
  },
  {
    id: "tco",
    name: "Twitter t.co",
    // WHY exact host: t.co is the only label; subdomains like api.t.co are
    // unrelated services and must not be flagged as wrappers.
    hostPatterns: ["t.co"],
    pathPatterns: null,
    // WHY query fallback: t.co's canonical form is path-based and resolves
    // through an HTTP 301 the engine cannot follow. We try ?url= / ?u= which
    // some upstream tools attach, and otherwise return null gracefully.
    extract: extractFromAnyParam(["url", "u"]),
  },
  {
    id: "facebook-l",
    name: "Facebook Outbound (web)",
    // WHY only l.facebook.com (not facebook.com / www.facebook.com): the
    // outbound link wrapper lives exclusively on the l. subdomain. Matching
    // the parent would catch unrelated profile/post URLs.
    hostPatterns: ["l.facebook.com"],
    pathPatterns: ["/l.php"],
    extract: extractFromParam("u"),
  },
  {
    id: "facebook-lm",
    name: "Facebook Outbound (mobile)",
    // WHY separate id: l. and lm. carry the same wrapper schema but represent
    // different surfaces (web vs. mobile-web). Tracking them separately lets
    // metrics distinguish where outbound clicks originate.
    hostPatterns: ["lm.facebook.com"],
    pathPatterns: ["/l.php"],
    extract: extractFromParam("u"),
  },
  {
    id: "instagram-l",
    name: "Instagram Outbound",
    // WHY only l.instagram.com: parent instagram.com is the social network
    // itself and must never be flagged. The outbound wrapper has no fixed
    // path prefix — the destination travels in ?u= directly off the root.
    hostPatterns: ["l.instagram.com"],
    pathPatterns: null,
    extract: extractFromParam("u"),
  },
  {
    id: "impact",
    name: "Impact Radius",
    // WHY regex: Impact assigns brand-specific subdomains on pxf.io
    // (gohealth.pxf.io, target.pxf.io, …). Anchors require ≥1 subdomain
    // label and a literal ".pxf.io" suffix to block apex pxf.io and
    // suffix look-alikes (notpxf.io, pxf.iox).
    hostPatterns: [/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pxf\.io$/],
    pathPatterns: null,
    extract: extractFromParam("u"),
  },
];

/**
 * Returns the matching wrapper config for a URL, or null if none match.
 * Pure inspection — does not extract or unwrap.
 * @param {string} rawUrl
 * @returns {object|null}
 */
export function detectWrapper(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  for (const wrapper of WRAPPERS) {
    const hostMatch = wrapper.hostPatterns.some((p) =>
      typeof p === "string" ? host === p.toLowerCase() : p.test(host)
    );
    if (!hostMatch) continue;
    if (wrapper.pathPatterns) {
      const pathMatch = wrapper.pathPatterns.some((pp) =>
        url.pathname.startsWith(pp)
      );
      if (!pathMatch) continue;
    }
    return wrapper;
  }
  return null;
}

const DEFAULT_MAX_HOPS = 3;

/**
 * Unwraps a URL through any chain of recognized wrappers.
 *
 * @param {string} rawUrl
 * @param {{ maxHops?: number }} [opts]
 * @returns {{ unwrapped: string, hops: number, networks: string[] } | null}
 *   Returns null when rawUrl is not a recognized wrapper or when the first
 *   extraction fails. Otherwise returns the destination URL after up to
 *   maxHops unwraps. Loop-safe: if an extraction yields a URL already seen
 *   in the chain, the engine returns the last unique URL.
 */
export function unwrap(rawUrl, opts = {}) {
  const maxHops =
    Number.isInteger(opts.maxHops) && opts.maxHops > 0
      ? opts.maxHops
      : DEFAULT_MAX_HOPS;

  // Early exit: not a wrapper at all → null.
  if (!detectWrapper(rawUrl)) return null;

  let current = rawUrl;
  const seen = new Set([rawUrl]);
  const networks = [];
  let hops = 0;

  while (hops < maxHops) {
    const wrapper = detectWrapper(current);
    if (!wrapper) break; // Reached the merchant — no longer a wrapper.

    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      break;
    }

    const next = wrapper.extract(parsed);
    if (!next) break; // Extraction failed — keep the last successful unwrap.

    if (seen.has(next)) break; // Loop detected — return last unique URL.

    seen.add(next);
    networks.push(wrapper.id);
    current = next;
    hops++;
  }

  // No successful unwrap happened (extraction failed on first try).
  if (hops === 0) return null;

  return { unwrapped: current, hops, networks };
}
