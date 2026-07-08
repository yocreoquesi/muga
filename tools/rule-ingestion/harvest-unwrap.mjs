/**
 * MUGA: harvest-unwrap — wrapper (redirect-unwrap) recipe harvester.
 *
 * Run with: node tools/rule-ingestion/harvest-unwrap.mjs
 * (also available as: npm run harvest:unwrap)
 *
 * Reads the already-fetched, quarantined ClearURLs `data.min.json`
 * (tools/moat-expansion/quarantine/clearurls.raw) and harvests its provider
 * `redirections` entries into src/rules/wrappers.json — the signed wrapper
 * recipe table that src/lib/wrapper-engine.js unwraps client-side, so the
 * user never contacts the redirect host and the destination URL is reached
 * (and cleaned) directly.
 *
 * A ClearURLs `redirections` entry is a regex over the FULL URL whose first
 * capture group is the embedded destination, e.g.
 *   ^https?:\/\/out\.reddit\.com\/.*?url=([^&]*)
 *   ^https?:\/\/href\.li\/\?(http.+)
 * We translate only the entries we can represent FAITHFULLY and SAFELY as a
 * MUGA wrapper recipe (concrete literal host + one of the three engine
 * extractor kinds). Everything else is skipped and logged.
 *
 * ── SAFETY GATES (read before touching this file) ─────────────────────────
 * A harvested wrapper causes MUGA to LOCAL-UNWRAP the host — it replaces the
 * redirect with its embedded destination and never lets the redirect's 30x
 * execute. That is exactly wrong for affiliate networks (the click IS the
 * attribution event, #815 / ADR-0003 / ADR-0005). So a candidate is emitted
 * only when ALL of these hold:
 *
 *   1. Concrete literal host. extractConcreteHost() (reused from
 *      harvest-preserve.mjs) rejects multi-TLD wildcards
 *      (`amazon(?:\.[a-z]{2,}){1,}`), unanchored patterns, and `[^/]+`-host
 *      shapes. Only a fully literal host survives.
 *   2. NOT an affiliate redirect network. collidesWithAffiliateNetwork()
 *      rejects a host that equals, is a subdomain of, OR is a PARENT of any
 *      AFFILIATE_REDIRECT_NETWORKS entry. The parent check is load-bearing:
 *      ClearURLs anchors on the registrable domain (`linksynergy.com`) while
 *      MUGA's affiliate list holds the specific subdomain
 *      (`click.linksynergy.com`); an exact-only check would let the parent
 *      through and MUGA would unwrap Rakuten.
 *   3. NOT a ClearURLs test fixture (its `ClearURLsTest*` providers and their
 *      throwaway hosts are not real redirectors).
 *   4. NOT on HOST_DENYLIST — hosts MUGA has a documented decision against
 *      (apex `vk.com`: the sanctioned wrapper is `away.vk.com`, and flagging
 *      the apex social host is explicitly forbidden in wrappers.json).
 *   5. A representable destination shape (mapRedirectionToExtractor):
 *      keyed `?key=(…)` → fromParam, alternated `(?:a|b)=(…)` → fromAnyParam,
 *      naked tail `?(http…)` → fromUrlAfterQuery. A destination embedded in a
 *      PATH segment or an opaque token cannot be expressed by any engine
 *      extractor and is skipped.
 *   6. The destination key is NOT a SUSPICIOUS_PARAM (ad-click / affiliate
 *      deeplink markers such as `adurl`, `ckurl`, `deeplinkurl`, `ued`,
 *      `ulp`). These are routed to the `review` bucket, never auto-emitted:
 *      unwrapping an ad-click or affiliate deeplink is a policy call a human
 *      must make (and sign off) rather than the harvester making it silently.
 *
 * The destination-length cap (#730, GENERIC_DEST_LENGTH_CAP=2000) and the
 * http(s)-only guard are enforced by the runtime extractors in
 * wrapper-engine.js, so harvested entries stay declarative and inherit them.
 *
 * ── DETERMINISM / IDEMPOTENCY ─────────────────────────────────────────────
 * Parsing is a pure function of the raw input. The merge only ADDS wrapper
 * entries whose id AND host are both new; it never mutates the existing 17
 * hand-authored recipes. Running twice against the same raw input produces
 * zero further diff.
 *
 * ── SIGNING (user-gated) ──────────────────────────────────────────────────
 * This script writes the UNSIGNED candidate src/rules/wrappers.json and its
 * ESM mirror src/rules/wrappers.data.js. It does NOT sign. wrappers.json.sig
 * is an Ed25519 signature over the raw bytes of wrappers.json under the
 * worker key (src/rules/worker-pubkey.txt) — a maintainer secret. After a
 * harvest, re-sign with `node tools/sign-wrappers.mjs` (see that file) and
 * commit the refreshed .sig, or tests/unit/rules-wrappers-sync.test.mjs (and
 * CI) will fail on the stale signature.
 *
 * Pure logic is exported for unit testing (tests/unit/harvest-unwrap.test.mjs):
 *   - mapRedirectionToExtractor(regexTail)
 *   - derivePathPrefix(regexTail)
 *   - parseRedirection(regexSource)
 *   - collidesWithAffiliateNetwork(host)
 *   - parseClearUrlsRedirections(rawJsonText)
 *   - mergeIntoWrappers(existingWrappers, harvestedEntries)
 *
 * main() does file I/O only and is guarded so importing this module for tests
 * never triggers the CLI run.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extractConcreteHost } from "./harvest-preserve.mjs";
import {
  AFFILIATE_REDIRECT_NETWORKS,
  isAffiliateRedirectNetwork,
} from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

const CLEARURLS_RAW_PATH = join(REPO_ROOT, "tools/moat-expansion/quarantine/clearurls.raw");
const WRAPPERS_JSON_PATH = join(REPO_ROOT, "src/rules/wrappers.json");
const WRAPPERS_DATA_PATH = join(REPO_ROOT, "src/rules/wrappers.data.js");

// Bumped into `addedIn` on every harvested entry so the provenance/version is
// auditable in the artifact. Read from package.json at run time in main().
const WRAPPERS_DATA_HEADER =
  "// muga rule artifact: wrapper recipe table (#715). Ed25519-signed (see wrappers.json.sig).\n" +
  "// DO NOT EDIT BY HAND. Regenerate via the rules pipeline.\n";

/**
 * Destination keys we refuse to AUTO-emit. These mark an ad-click redirect
 * (`adurl`, `ckurl`) or an affiliate deeplink (`deeplinkurl`, `ued`, `ulp`,
 * `trg`, `wgtarget`, `murl`, `htmlurl`, `_td_deeplink`). Unwrapping either is
 * a policy decision (it bypasses ad accounting or drops affiliate click
 * context) and must be made — and signed off — by a human, so these land in
 * the `review` bucket rather than the harvested set.
 * @type {Set<string>}
 */
export const SUSPICIOUS_PARAMS = new Set([
  "adurl",
  "ckurl",
  "deeplinkurl",
  "ued",
  "ulp",
  "trg",
  "wgtarget",
  "murl",
  "htmlurl",
  "_td_deeplink",
]);

/**
 * Hosts MUGA has a documented decision NOT to flag, even though ClearURLs
 * lists a redirection for them. `vk.com`: the sanctioned outbound wrapper is
 * `away.vk.com` (see the vk-away entry in wrappers.json); flagging the apex
 * social host is explicitly forbidden there.
 * @type {Set<string>}
 */
export const HOST_DENYLIST = new Set(["vk.com"]);

/**
 * Hosts that pass every structural gate but must NOT be AUTO-emitted because
 * the local-unwrap (and its bounce-state storage wipe) has a plausible
 * user-facing risk that only a human can clear. These land in the `review`
 * bucket, never the harvested set.
 *
 * SHARED-ORIGIN CONTENT HOSTS (`youtube.com`, `duckduckgo.com`,
 * `steamcommunity.com`, `curseforge.com`): their redirect interstitial lives
 * on the SAME ORIGIN as the user's logged-in session / settings. Web Storage
 * is per-origin, not per-path, so bounce-state-cleaner.js (which wipes
 * localStorage + sessionStorage when it detects a wrapper on the current
 * page) would destroy legitimate first-party state — e.g. DuckDuckGo keeps
 * every preference in localStorage with no account, so a result-click through
 * `duckduckgo.com/l/` would reset all settings. Every SAFE auto-harvested
 * wrapper is instead a DEDICATED redirector host (a `*.` redirect subdomain
 * or a redirect-only apex like `gate.sc`) that holds no user state. Unwrapping
 * these content hosts is still valuable, but it needs a bounce-state
 * exemption (unwrap-without-storage-wipe) before it can ship — a follow-up.
 *
 * `tokopedia.com`: same shared-origin concern, and its ClearURLs redirect is
 * scoped to `/promo` (plausibly a real content section) with a single-letter
 * `r` key.
 * @type {Set<string>}
 */
export const REVIEW_HOSTS = new Set([
  "youtube.com",
  "duckduckgo.com",
  "steamcommunity.com",
  "curseforge.com",
  "tokopedia.com",
]);

/**
 * ClearURLs ships test-fixture providers whose hosts are not real redirectors
 * (they exercise ClearURLs' own regex engine). Skip them by provider name and
 * by their throwaway hosts.
 */
const TEST_PROVIDER_NAME = /clearurls?test/i;
const TEST_HOSTS = new Set(["test.clearurls.xyz", "kevinroebert.gitlab.io"]);

const HARVEST_NOTE = "Harvested from ClearURLs redirections";

// ── Affiliate-network collision guard ─────────────────────────────────────

/**
 * True when `host` must NOT be locally unwrapped because it is (or belongs to,
 * or contains) an affiliate redirect network. Three relations are rejected:
 *   - exact / wildcard match (isAffiliateRedirectNetwork covers `*.pxf.io` etc.)
 *   - `host` is a SUBDOMAIN of an affiliate host
 *   - `host` is a PARENT of an affiliate host (ClearURLs anchors on the
 *     registrable domain; the affiliate list holds the subdomain)
 *
 * @param {string} host lowercase concrete host
 * @returns {boolean}
 */
export function collidesWithAffiliateNetwork(host) {
  if (!host) return false;
  if (isAffiliateRedirectNetwork(host)) return true;
  for (const entry of AFFILIATE_REDIRECT_NETWORKS) {
    const affiliateHost = entry.replace(/^\*\./, "");
    if (host === affiliateHost) return true;
    if (host.endsWith("." + affiliateHost)) return true; // host under affiliate
    if (affiliateHost.endsWith("." + host)) return true; // affiliate under host
  }
  return false;
}

// ── Regex-tail parsing (pure) ─────────────────────────────────────────────

/**
 * Derive a literal pathname prefix from the regex tail that follows the host.
 * The tail begins right after the (escaped) host in a ClearURLs redirection
 * regex — extractConcreteHost only accepts a host followed by `\/…`, `$`, or
 * end, so a real path prefix always starts with an escaped slash `\/`.
 *
 * Walks the literal run (decoding `\/`→`/`, `\.`→`.`, `\-`→`-`, and bare
 * `[a-z0-9_-]`) and stops at the first regex metacharacter. A bare `/`
 * (i.e. the pattern immediately went wild: `\/.*?`) yields null — a `/`
 * prefix matches everything, so it is equivalent to no path constraint.
 *
 * @param {string} tail regex source after the host
 * @returns {string|null} pathname prefix (e.g. "/l.php") or null (host-only)
 */
export function derivePathPrefix(tail) {
  if (typeof tail !== "string" || !tail.startsWith("\\/")) return null;
  let out = "";
  let i = 0;
  while (i < tail.length) {
    if (tail[i] === "\\") {
      const next = tail[i + 1];
      if (next === "/") { out += "/"; i += 2; continue; }
      if (next === ".") { out += "."; i += 2; continue; }
      if (next === "-") { out += "-"; i += 2; continue; }
      break; // escaped metachar (\?, \(, …) — end of literal path
    }
    if (/[a-z0-9_-]/i.test(tail[i])) { out += tail[i]; i += 1; continue; }
    break; // bare metachar (?, *, ., (, [, …) — end of literal path
  }
  if (out === "" || out === "/") return null;
  return out;
}

/**
 * True when the capture group opened at `openParenIdx` in `tail` is the
 * TERMINAL element of the regex — i.e. nothing but an optional `$` anchor
 * follows its closing paren. A trailing literal (e.g. ClearURLs' disq.us
 * `url=([^&]*)%3A`, which trims a `:hash` suffix) means the capture is only a
 * SUBSTRING of the param value, so `searchParams.get(key)` would return more
 * than the regex captured — an over-capture no extractor kind can faithfully
 * express. Such shapes are unrepresentable and must be skipped, not emitted.
 *
 * @param {string} tail
 * @param {number} openParenIdx index of the capture group's `(`
 * @returns {boolean}
 */
function captureIsTerminal(tail, openParenIdx) {
  const closeIdx = tail.indexOf(")", openParenIdx);
  if (closeIdx < 0) return false; // malformed — treat as not representable
  const after = tail.slice(closeIdx + 1);
  return after === "" || after === "$";
}

/**
 * Map the regex tail (portion after the host) to a MUGA extractor descriptor,
 * or null when the destination shape is not representable by any engine
 * extractor kind (fromParam / fromAnyParam / fromUrlAfterQuery). Param-name
 * case is PRESERVED — URL query keys are case-sensitive, so a camelCase key
 * like `remoteUrl` must round-trip verbatim.
 *
 * Precedence:
 *   1. naked tail  `\?(http…)`         → fromUrlAfterQuery
 *   2. alternated  `(?:a|b|c)=(…)`     → fromAnyParam [a,b,c]
 *   3. keyed       `key=(…)`           → fromParam key (last key before capture)
 *
 * @param {string} tail regex source after the host
 * @returns {{ kind: string, paramName?: string|string[] }|null}
 */
export function mapRedirectionToExtractor(tail) {
  if (typeof tail !== "string") return null;

  // Naked query proxy: destination travels directly after `?`, capture starts
  // with http (optionally wrapped in a non-capturing group).
  if (/\\\?\((?:\?:)?https?/i.test(tail)) {
    return { kind: "fromUrlAfterQuery" };
  }

  // Alternated keys sharing one capture: (?:url|u)=(…)
  const alt = tail.match(/\(\?:([a-z0-9_|]+)\)=\(/i);
  if (alt) {
    // The alternation's shared capture `(` is the last char of the match.
    const openParenIdx = alt.index + alt[0].length - 1;
    if (!captureIsTerminal(tail, openParenIdx)) return null;
    const keys = alt[1].split("|").filter(Boolean);
    if (keys.length === 1) return { kind: "fromParam", paramName: keys[0] };
    if (keys.length > 1) return { kind: "fromAnyParam", paramName: keys };
    return null;
  }

  // Keyed: key=(…). Take the LAST match — that is the key attached to the
  // capture group (earlier `x=` fragments belong to the `.*?` prefix).
  const keyed = [...tail.matchAll(/([a-z0-9_]+)=\(/gi)];
  if (keyed.length) {
    const last = keyed[keyed.length - 1];
    const openParenIdx = last.index + last[0].length - 1;
    if (!captureIsTerminal(tail, openParenIdx)) return null;
    return { kind: "fromParam", paramName: last[1] };
  }

  return null;
}

/**
 * @typedef {Object} ParsedRedirection
 * @property {string|null} host concrete literal host, or null when skipped
 * @property {string|null} pathPrefix pathname prefix or null (host-only)
 * @property {object|null} extractor engine extractor descriptor, or null
 * @property {string|null} skip non-null reason string when the entry is rejected
 */

/**
 * Parse a single ClearURLs redirection regex into the host + path + extractor
 * a wrapper recipe needs. Always returns every key (like resolveAdguardScope
 * in harvest-preserve.mjs) so callers narrow on `skip`.
 *
 * @param {string} regexSource ClearURLs redirection regex source string
 * @returns {ParsedRedirection}
 */
export function parseRedirection(regexSource) {
  const host = extractConcreteHost(regexSource);
  if (!host) {
    return { host: null, pathPrefix: null, extractor: null, skip: "no concrete host (multi-TLD wildcard, unanchored, or non-literal host)" };
  }

  const hostEscaped = host.replace(/\./g, "\\.");
  const idx = regexSource.lastIndexOf(hostEscaped);
  if (idx < 0) {
    return { host: null, pathPrefix: null, extractor: null, skip: "internal: host not locatable in regex" };
  }
  const tail = regexSource.slice(idx + hostEscaped.length);

  const extractor = mapRedirectionToExtractor(tail);
  if (!extractor) {
    return { host: null, pathPrefix: null, extractor: null, skip: "destination shape not representable (path-embedded or opaque)" };
  }

  return { host, pathPrefix: derivePathPrefix(tail), extractor, skip: null };
}

// ── Entry construction (pure) ─────────────────────────────────────────────

/** Deterministic id from a host: dots → hyphens (e.g. l.messenger.com → l-messenger-com). */
export function hostToId(host) {
  return host.replace(/\./g, "-");
}

/**
 * Host patterns for a concrete host. For an apex (exactly two labels) we also
 * emit the `www.` variant so the common `www.` traffic is covered — MUGA does
 * literal exact-host matching, unlike ClearURLs' `(?:[a-z0-9-]+\.)*?` prefix.
 * A dead `www.` variant (host that never serves `www`) is harmless: it only
 * matches an exact host that would still be correct to unwrap.
 * @param {string} host
 * @returns {string[]}
 */
export function hostPatternsFor(host) {
  const labels = host.split(".").filter(Boolean);
  return labels.length === 2 ? [host, `www.${host}`] : [host];
}

/** Returns the destination key(s) a fromParam/fromAnyParam extractor reads, lowercased. */
function extractorKeys(extractor) {
  if (extractor.kind === "fromParam") return [String(extractor.paramName).toLowerCase()];
  if (extractor.kind === "fromAnyParam") return extractor.paramName.map((k) => k.toLowerCase());
  return [];
}

function buildEntry(provider, host, pathPrefix, extractor, version) {
  const entry = {
    id: hostToId(host),
    label: `${host} (ClearURLs redirect)`,
    hostPatterns: hostPatternsFor(host),
  };
  if (pathPrefix) entry.pathPrefix = pathPrefix;
  entry.extractor = extractor;
  entry.notes = `${HARVEST_NOTE} (provider: ${provider}). Auto-harvested; verify before release.`;
  entry.addedIn = version;
  return entry;
}

// ── ClearURLs provider parsing ────────────────────────────────────────────

/**
 * Parse ClearURLs `data.min.json` provider `redirections` into wrapper recipe
 * candidates, applying every safety gate (see the file header).
 *
 * @param {string} rawJsonText Raw contents of ClearURLs `data.min.json`.
 * @param {string} version value used for each entry's `addedIn`.
 * @returns {{
 *   entries: Array<object>,
 *   skipped: Array<{ provider: string, host?: string, reason: string }>,
 *   review: Array<{ provider: string, host: string, key: string, reason: string }>,
 * }}
 */
export function parseClearUrlsRedirections(rawJsonText, version = "0.0.0") {
  const data = JSON.parse(rawJsonText);
  const entries = [];
  const skipped = [];
  const review = [];
  const seenHosts = new Set();

  const providers = data.providers ?? {};
  for (const [name, provider] of Object.entries(providers)) {
    const redirections = provider.redirections ?? [];
    if (redirections.length === 0) continue;

    if (name === "globalRules") {
      skipped.push({ provider: name, reason: "globalRules catch-all is not host-scoped" });
      continue;
    }
    if (TEST_PROVIDER_NAME.test(name)) {
      skipped.push({ provider: name, reason: "ClearURLs test-fixture provider" });
      continue;
    }

    for (const regexSource of redirections) {
      const parsed = parseRedirection(regexSource);
      if (parsed.skip) {
        skipped.push({ provider: name, reason: parsed.skip });
        continue;
      }
      const { host, pathPrefix, extractor } = parsed;

      if (TEST_HOSTS.has(host)) {
        skipped.push({ provider: name, host, reason: "ClearURLs test-fixture host" });
        continue;
      }
      if (HOST_DENYLIST.has(host)) {
        skipped.push({ provider: name, host, reason: "host denylisted (documented MUGA decision)" });
        continue;
      }
      if (collidesWithAffiliateNetwork(host)) {
        skipped.push({ provider: name, host, reason: "affiliate redirect network — must pass through, never unwrap" });
        continue;
      }

      if (REVIEW_HOSTS.has(host)) {
        review.push({ provider: name, host, key: extractorKeys(extractor)[0] ?? "", reason: "review host (content-path / bounce-state risk)" });
        continue;
      }

      const suspicious = extractorKeys(extractor).find((k) => SUSPICIOUS_PARAMS.has(k));
      if (suspicious) {
        review.push({ provider: name, host, key: suspicious, reason: "ad-click / affiliate deeplink key" });
        continue;
      }

      if (seenHosts.has(host)) {
        skipped.push({ provider: name, host, reason: "duplicate host within harvest" });
        continue;
      }
      seenHosts.add(host);
      entries.push(buildEntry(name, host, pathPrefix, extractor, version));
    }
  }

  return { entries, skipped, review };
}

// ── Merge into wrappers.json ──────────────────────────────────────────────

/**
 * Merge harvested wrapper entries into the existing table. Add-only: an entry
 * is added only when BOTH its id and every one of its literal host patterns
 * are new. New entries are inserted in codepoint-sorted `id` position (the
 * order the existing artifact is authored in) for stable diffs.
 *
 * Pure and idempotent: the existing entries are never mutated, and a second
 * run with the same inputs yields an identical array.
 *
 * @param {Array<object>} existingWrappers current parsed wrappers.json
 * @param {Array<object>} harvestedEntries from parseClearUrlsRedirections
 * @returns {{ wrappers: Array<object>, added: string[], skippedDup: Array<{id: string, reason: string}> }}
 */
export function mergeIntoWrappers(existingWrappers, harvestedEntries) {
  const wrappers = existingWrappers.map((e) => ({ ...e }));
  const existingIds = new Set(wrappers.map((e) => e.id));
  const existingHosts = new Set(
    wrappers.flatMap((e) =>
      (e.hostPatterns ?? [])
        .filter((p) => typeof p === "string")
        .map((p) => p.toLowerCase()),
    ),
  );

  const added = [];
  const skippedDup = [];

  // Stable order: harvest already yields id-sorted-ish input, but sort to be safe.
  const sorted = [...harvestedEntries].sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));

  for (const entry of sorted) {
    if (existingIds.has(entry.id)) {
      skippedDup.push({ id: entry.id, reason: "id already present" });
      continue;
    }
    const hosts = (entry.hostPatterns ?? [])
      .filter((p) => typeof p === "string")
      .map((p) => p.toLowerCase());
    const clashing = hosts.find((h) => existingHosts.has(h));
    if (clashing) {
      skippedDup.push({ id: entry.id, reason: `host already present (${clashing})` });
      continue;
    }

    const insertAt = wrappers.findIndex((r) => r.id > entry.id);
    if (insertAt === -1) wrappers.push(entry);
    else wrappers.splice(insertAt, 0, entry);

    existingIds.add(entry.id);
    hosts.forEach((h) => existingHosts.add(h));
    added.push(entry.id);
  }

  return { wrappers, added, skippedDup };
}

// ── Serialization ─────────────────────────────────────────────────────────

/** Inline array literal: `["a", "b"]` (matches the hand-authored artifact). */
function inlineArray(arr) {
  return "[" + arr.map((x) => JSON.stringify(x)).join(", ") + "]";
}

/** Inline object literal: `{ "kind": "fromParam", "paramName": "u" }`. */
function inlineObject(obj) {
  const parts = Object.entries(obj).map(([k, v]) =>
    `${JSON.stringify(k)}: ${Array.isArray(v) ? inlineArray(v) : JSON.stringify(v)}`,
  );
  return "{ " + parts.join(", ") + " }";
}

/**
 * Serialize the wrapper table in the EXACT hand-authored format of
 * src/rules/wrappers.json: each entry is multi-line (4-space fields), but
 * `hostPatterns` arrays and `extractor` objects are rendered INLINE. This
 * keeps existing entries byte-identical so a harvest diff shows only the new
 * entries — critical because wrappers.json is a signed, reviewed artifact.
 *
 * @param {Array<object>} wrappers
 * @returns {string} JSON text ending in a trailing newline
 */
export function serializeWrappersJson(wrappers) {
  const entries = wrappers.map((entry) => {
    const fields = Object.entries(entry).map(([key, value]) => {
      let rendered;
      if (key === "hostPatterns" && Array.isArray(value)) rendered = inlineArray(value);
      else if (key === "extractor" && value && typeof value === "object") rendered = inlineObject(value);
      else rendered = JSON.stringify(value);
      return `    ${JSON.stringify(key)}: ${rendered}`;
    });
    return "  {\n" + fields.join(",\n") + "\n  }";
  });
  return "[\n" + entries.join(",\n") + "\n]\n";
}

// ── CLI runner ─────────────────────────────────────────────────────────────

function main() {
  const version = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  const clearUrlsRaw = readFileSync(CLEARURLS_RAW_PATH, "utf8");
  const existingWrappers = JSON.parse(readFileSync(WRAPPERS_JSON_PATH, "utf8"));

  const { entries, skipped, review } = parseClearUrlsRedirections(clearUrlsRaw, version);
  const { wrappers, added, skippedDup } = mergeIntoWrappers(existingWrappers, entries);

  const jsonPayload = serializeWrappersJson(wrappers);
  writeFileSync(WRAPPERS_JSON_PATH + ".tmp", jsonPayload, "utf8");
  renameSync(WRAPPERS_JSON_PATH + ".tmp", WRAPPERS_JSON_PATH);

  const dataPayload =
    WRAPPERS_DATA_HEADER +
    "export const WRAPPERS_RAW = " +
    JSON.stringify(wrappers, null, 2) +
    ";\n";
  writeFileSync(WRAPPERS_DATA_PATH + ".tmp", dataPayload, "utf8");
  renameSync(WRAPPERS_DATA_PATH + ".tmp", WRAPPERS_DATA_PATH);

  console.log(`[harvest-unwrap] wrappers added: ${added.length}${added.length ? " (" + added.join(", ") + ")" : ""}`);
  console.log(`[harvest-unwrap] harvested candidates: ${entries.length}, dup-skipped at merge: ${skippedDup.length}`);
  console.log(`[harvest-unwrap] review candidates (NOT auto-added): ${review.length}`);
  for (const r of review) {
    console.log(`  - [review] ${r.host} (provider "${r.provider}", key "${r.key}"): ${r.reason}`);
  }
  console.log(`[harvest-unwrap] redirections skipped: ${skipped.length}`);
  if (added.length) {
    console.log("[harvest-unwrap] NOTE: wrappers.json changed — re-sign with `node tools/sign-wrappers.mjs` before commit/CI.");
  }
}

if (process.argv[1]?.endsWith("harvest-unwrap.mjs")) {
  main();
}
