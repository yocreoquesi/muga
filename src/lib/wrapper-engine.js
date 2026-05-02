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
