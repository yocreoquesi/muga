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
 * ── Source of truth (issue #538) ─────────────────────────────────────────
 * The recipe table is no longer authored inline. It is sourced from the
 * caps-spec normative artifact (`wrappers.json`, Ed25519-signed) vendored at
 * `src/vendor/caps-spec/wrappers.data.js` so it ships with the extension. To
 * edit a wrapper recipe, change it in
 * caps-spec, re-sign, then run `npm run sync:wrappers` to refresh the vendor.
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
 * Worked example — Facebook l.facebook.com
 *   Input  : https://l.facebook.com/l.php?u=https%3A%2F%2Fmerchant.com%2Fp&h=abc
 *   Match  : hostPatterns includes "l.facebook.com"; pathPatterns includes "/l.php"
 *   Extract: searchParams.get("u") → "https://merchant.com/p" (URL-decoded by URL API)
 *   Result : { unwrapped: "https://merchant.com/p", hops: 1, networks: ["facebook-l"] }
 *
 * Note: Awin was previously listed here. Retired in #684 per ADR-0003 — Awin
 * is now passed through via AFFILIATE_REDIRECT_NETWORKS so the network's 30x
 * can populate awc/wt_mc at the merchant landing.
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

/**
 * Builds a generic extract() that pulls the destination URL embedded in the
 * URL's query string WITHOUT a key — the so-called "naked query" shape used
 * by privacy proxies like href.li and anonym.to:
 *
 *   https://href.li/?https://destination.example.com/article
 *   https://anonym.to/?https://destination.example.com/landing%20page
 *
 * In `new URL()` parsing, that destination ends up as `url.search`, beginning
 * with `?http`. We strip the leading `?` and validate the remainder as a
 * well-formed http(s) URL. URL-encoded characters in the destination
 * (`%20`, `%2F`, …) round-trip cleanly because `url.search` preserves the
 * raw text after `?` verbatim.
 *
 * WHY this is a separate helper (not extractFromParam): the destination has
 * no parameter name, so `searchParams.get(...)` cannot retrieve it. Encoding
 * this shape declaratively keeps wrapper entries one-line additions to the
 * WRAPPERS table — same authoring ergonomics as `extractFromParam('u')`.
 *
 * @returns {(url: URL) => string|null}
 */
function extractFromUrlAfterQuery() {
  return (url) => {
    // url.search includes the leading "?"; strip it. Empty (no query) → null.
    const raw = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    if (!raw) return null;
    // Cheap pre-check: must start with http:// or https:// to be a destination.
    // Avoids wasting a try/catch on tracker tokens like "?id=abc".
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
      const dest = new URL(raw);
      if (dest.protocol !== "https:" && dest.protocol !== "http:") return null;
      return raw;
    } catch {
      return null;
    }
  };
}

import { WRAPPERS_RAW } from "../vendor/caps-spec/wrappers.data.js";
import { isAffiliateRedirectNetwork } from "./opaque-networks.js";

/**
 * Wrapper schema mapping caps-spec/wrappers.json (the published normative
 * artifact) to the engine's internal table shape.
 *
 * INTENTIONAL CONSOLIDATION — `skimlinks-redirectingat` + `skimlinks-skimresources`:
 * The spec splits Skimlinks into two ids so a future consumer can attribute
 * metrics per surface. MUGA's engine, attribution-ledger, and prior chrome
 * storage all use a single `skimlinks` id. To preserve test behavior and
 * stored event compatibility (acceptance criterion of issue #538: behavior
 * unchanged), the mapper merges both spec entries back into a single engine
 * entry `id: "skimlinks"` with the union of hostPatterns. Re-introduce the
 * split when (and if) muga's attribution starts to depend on per-surface
 * granularity.
 */
const SKIMLINKS_SPEC_IDS = new Set([
  "skimlinks-redirectingat",
  "skimlinks-skimresources",
]);

/**
 * MUGA-side exclusions from the vendored caps-spec wrappers table.
 *
 * Entries listed here are dropped at WRAPPERS build time so MUGA does not
 * local-unwrap them. They are still legitimate redirect networks in
 * caps-spec; MUGA opts out because its 2.1 attribution policy requires the
 * network's 30x to execute in the browser (pass-through via
 * AFFILIATE_REDIRECT_NETWORKS in opaque-networks.js), with per-landing
 * preservation via getLandingPolicy (#656).
 *
 * Currently excluded:
 *   - `awin`: per ADR-0003 — Awin's attribution model appends `awc`/`wt_mc`
 *     at the 30x step, which local-unwrap silently drops. See
 *     docs/adr/0003-awin-redirect-model-resolution.md.
 *   - `impact`: per ADR-0003 follow-up (#692). Impact's `irclickid` family
 *     lands on the merchant via the network's 30x; local-unwrap of `*.pxf.io`
 *     would drop the click context before the merchant tag fires.
 *   - `rakuten`: per ADR-0003 follow-up (#692). The `ranmid`/`ransiteid`/
 *     `raneaid` family lands on the merchant via the network's 30x;
 *     `click.linksynergy.com` is now pass-through.
 *   - `tradetracker`: per ADR-0003 follow-up (#692). The `ttaid`/`ttrk`/
 *     `ttcid` family lands on the merchant via the network's 30x;
 *     `tc.tradetracker.net` is now pass-through.
 *
 * Upstream caps-spec is unchanged — the exclusion is MUGA-policy, not data.
 */
const MUGA_EXCLUDED_IDS = new Set(["awin", "impact", "rakuten", "tradetracker"]);

/**
 * Per-id compatibility overrides applied AFTER the spec→engine mapping.
 *
 * The caps-spec wrappers schema currently only supports a single `pathPrefix`
 * per entry. MUGA's pre-existing engine accepts multiple paths for some
 * networks. To preserve behaviour (issue #538 acceptance criterion: tests must
 * still pass) without forking the schema, we extend the engine table with the
 * extra prefix here and track a follow-up in caps-spec to allow multi-prefix
 * entries (then this override goes away).
 */
const PATH_PREFIX_EXTENSIONS = {};

function buildExtractor(extractor) {
  switch (extractor.kind) {
    case "fromParam":
      return extractFromParam(extractor.paramName);
    case "fromAnyParam":
      return extractFromAnyParam(extractor.paramName);
    case "fromUrlAfterQuery":
      return extractFromUrlAfterQuery();
    default:
      throw new Error(
        `wrapper-engine: unknown extractor kind "${extractor.kind}" in vendored wrappers.json`,
      );
  }
}

/**
 * Compile a hostPattern from the spec form (string) to the engine form
 * (string | RegExp). The spec wraps regex source strings in `^...$` per its
 * schema; everything else is a literal lowercase host.
 */
function buildHostPattern(p) {
  if (typeof p === "string" && p.startsWith("^") && p.endsWith("$")) {
    return new RegExp(p);
  }
  return p;
}

/**
 * Map the raw spec entries to the engine's WRAPPERS table.
 * Skimlinks consolidation is the only id-level transform.
 */
function buildWrappers(rawList) {
  const result = [];
  let skimlinksMerged = null;
  for (const entry of rawList) {
    if (MUGA_EXCLUDED_IDS.has(entry.id)) continue;
    const basePaths = entry.pathPrefix ? [entry.pathPrefix] : null;
    const extraPaths = PATH_PREFIX_EXTENSIONS[entry.id];
    const pathPatterns = extraPaths
      ? [...(basePaths ?? []), ...extraPaths]
      : basePaths;
    const wrapper = {
      id: entry.id,
      name: entry.label,
      hostPatterns: entry.hostPatterns.map(buildHostPattern),
      pathPatterns,
      extract: buildExtractor(entry.extractor),
    };
    if (SKIMLINKS_SPEC_IDS.has(entry.id)) {
      if (skimlinksMerged) {
        skimlinksMerged.hostPatterns = [
          ...skimlinksMerged.hostPatterns,
          ...wrapper.hostPatterns,
        ];
      } else {
        skimlinksMerged = {
          ...wrapper,
          id: "skimlinks",
          name: "Skimlinks",
        };
        result.push(skimlinksMerged);
      }
    } else {
      result.push(wrapper);
    }
  }
  return result;
}

export const WRAPPERS = buildWrappers(WRAPPERS_RAW);

/**
 * Allowlist of conventional redirect-style query parameter keys probed by the
 * generic wrapper code path (issue #531). Order matters — the first key whose
 * value passes ALL safety guards wins. Kept short on purpose: every additional
 * key widens the surface for false positives on legitimate non-redirect URLs.
 * @type {string[]}
 */
export const GENERIC_WRAPPER_PARAMS = [
  "url",
  "u",
  "redirect",
  "dest",
  "target",
];

/**
 * Maximum length of a destination URL accepted by the generic extractor.
 * Mirrors the cap used in canonical-extractor.js and content/cleaner.js so the
 * whole pipeline shares one consistent ceiling.
 */
const GENERIC_DEST_LENGTH_CAP = 2000;

/**
 * Substring fragments that, when present anywhere in the destination pathname,
 * make the generic path REFUSE to unwrap. These are the conventional shapes of
 * authentication, single-sign-on and checkout flows where the wrapper URL is
 * legitimately the entry point — not a tracking redirect — and unwrapping
 * would silently break login or payment.
 * @type {string[]}
 */
const GENERIC_AUTH_PATH_FRAGMENTS = [
  "/oauth",
  "/oauth2",
  "/auth",
  "/sso",
  "/callback",
  "/login",
  "/signin",
  "/checkout",
  "/payment",
  "/pay",
  "/saml",
  "/authorize",
];

/**
 * Returns the input host with a leading `www.` stripped, lowercased.
 * Used by the generic same-host guard so `www.example.com` and `example.com`
 * compare as equal — they are the same site for redirect-flow purposes.
 * @param {string} host
 * @returns {string}
 */
function effectiveHost(host) {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * Tries each `GENERIC_WRAPPER_PARAMS` key on `url` and returns the first value
 * that decodes to a well-formed http(s) URL passing every safety guard, plus
 * the matching key. Returns `null` when nothing qualifies.
 *
 * Guards (all MUST pass):
 *   - `new URL(value)` succeeds
 *   - protocol is `http:` or `https:` (no `javascript:`, `data:`, `mailto:`, …)
 *   - destination effective host (lowercased, `www.` stripped) DIFFERS from
 *     the wrapper effective host — protects OAuth return-to flows
 *   - destination pathname contains NONE of `GENERIC_AUTH_PATH_FRAGMENTS`
 *   - destination string length ≤ `GENERIC_DEST_LENGTH_CAP`
 *
 * @param {URL} url
 * @returns {{ value: string, paramName: string }|null}
 */
function tryGenericExtract(url) {
  const wrapperHost = effectiveHost(url.hostname);
  for (const name of GENERIC_WRAPPER_PARAMS) {
    const value = url.searchParams.get(name);
    if (!value) continue;
    if (value.length > GENERIC_DEST_LENGTH_CAP) continue;
    let dest;
    try {
      dest = new URL(value);
    } catch {
      continue;
    }
    if (dest.protocol !== "https:" && dest.protocol !== "http:") continue;
    if (effectiveHost(dest.hostname) === wrapperHost) continue;
    const path = dest.pathname.toLowerCase();
    if (GENERIC_AUTH_PATH_FRAGMENTS.some((frag) => path.includes(frag))) continue;
    return { value, paramName: name };
  }
  return null;
}

/**
 * Builds a generic wrapper entry compatible with the WRAPPERS schema so the
 * downstream `unwrap()` loop, processUrl integration and metrics treat it
 * exactly like an explicit per-host wrapper.
 *
 * The entry's `extract()` re-runs the same guards over a freshly parsed URL —
 * not a closure over the captured value — so it stays correct if the loop
 * later calls `extract()` on a different (but structurally identical) URL.
 *
 * @param {string} host    matched host (lowercased)
 * @param {string} paramName  the generic key that won
 * @returns {{
 *   id: string,
 *   isGeneric: true,
 *   hostPatterns: string[],
 *   pathPatterns: null,
 *   extract: (url: URL) => string|null,
 * }}
 */
function buildGenericWrapper(host, paramName) {
  return {
    id: `generic-${paramName}`,
    isGeneric: true,
    hostPatterns: [host],
    pathPatterns: null,
    extract: (url) => {
      const hit = tryGenericExtract(url);
      return hit ? hit.value : null;
    },
  };
}

/**
 * Returns the matching wrapper config for a URL, or null if none match.
 * Pure inspection — does not extract or unwrap.
 *
 * Precedence: explicit entries in WRAPPERS always win. Only when no explicit
 * host matches do we probe the generic redirect-param path (#531). This keeps
 * the 16 tested explicit wrappers authoritative — generic NEVER overrides.
 *
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
  // Pass-through guard (#692): hosts declared in AFFILIATE_REDIRECT_NETWORKS
  // are never wrappers, even if their query string happens to carry a key in
  // GENERIC_WRAPPER_PARAMS (e.g. `?u=` on *.pxf.io and tc.tradetracker.net).
  // The 30x must execute in the browser so the network can populate the
  // merchant's first-party cookie at landing.
  if (isAffiliateRedirectNetwork(host)) return null;
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
  // Generic fallback — only fires when no explicit wrapper matched.
  const generic = tryGenericExtract(url);
  if (generic) return buildGenericWrapper(host, generic.paramName);
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
