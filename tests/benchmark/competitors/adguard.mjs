/**
 * MUGA: AdGuard URL Tracking Protection adapter — A6 phase 2c (#506).
 *
 * Loads the vendored AdGuard URL Tracking filter (filter #17) from
 * data/adguard.txt and applies its `$removeparam` rules to a single
 * URL. The benchmark uses this to score MUGA against AdGuard's
 * dedicated tracking-param strip filter on a shared corpus.
 *
 * Source: https://filters.adtidy.org/extension/chromium/filters/17.txt
 * Vendored under data/adguard.txt — refresh via
 * `npm run benchmark:refresh-competitors`.
 *
 * AdGuard filter syntax (the slice this adapter handles):
 *
 *   Generic plain:        $removeparam=NAME
 *   Generic regex:        $removeparam=/REGEX/
 *   Generic w/ domain mod: $removeparam=NAME,domain=foo.com|bar.com
 *   Domain-scoped:        ||example.com^$removeparam=NAME
 *   Strip-all on domain:  ||example.com^$removeparam
 *   Negative domain:      $removeparam=NAME,domain=~excluded.com|target.com
 *
 * What this adapter does NOT handle (skipped at parse time):
 *
 *   - Path-scoped patterns (||example.com/path/$removeparam=...) —
 *     the benchmark scores against URL-navigation, not specific
 *     resource paths. Fewer than ~5% of filter rules.
 *   - Resource-type modifiers (xmlhttprequest, script, image, ...)
 *     — these gate on the request type, which doesn't apply to
 *     URL-cleaning at navigation time.
 *   - csp= / redirect= modifiers — different feature surface.
 *   - Cosmetic rules (`##`, `#?#`) — irrelevant to URL strip.
 *   - Invert param syntax (`$removeparam=~name`) — rare; would
 *     change the rule from "strip name" to "strip everything except
 *     name", which is structurally different. Skipped to keep the
 *     adapter small.
 *
 * Coverage of the filter at parse time is reported via the
 * `_parseStats` export for tests and visibility.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "data", "adguard.txt");

const _raw = readFileSync(DATA_PATH, "utf8");

/**
 * Parse a single AdGuard filter line into a normalised rule, or null
 * if the rule is out of scope for this adapter.
 *
 * Rule shape:
 *   {
 *     domains:       string[]  // host suffix-match list (empty = generic)
 *     invertDomains: string[]  // hostnames where the rule must NOT apply
 *     paramSpec:     { type: "name", name: string }
 *                  | { type: "regex", regex: RegExp }
 *                  | { type: "all" }
 *   }
 */
function parseRule(line) {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("!")) return null;
  // Cosmetic rules and exception cosmetic rules are out of scope.
  if (trimmed.includes("##") || trimmed.includes("#@#") || trimmed.includes("#?#")) return null;

  // Locate $removeparam. Use indexOf on the full token to avoid false
  // positives from any earlier `$` in URL patterns (rare but possible).
  const removeIdx = trimmed.indexOf("$removeparam");
  if (removeIdx === -1) return null;

  const leftRaw = trimmed.slice(0, removeIdx);
  // After "$removeparam": "" (strip all) | "=NAME..." | "=/REGEX/..."
  const rightRaw = trimmed.slice(removeIdx + "$removeparam".length);

  // ── Parse the param spec + trailing modifiers ────────────────────
  let paramSpec, modifiers = "";
  if (rightRaw === "") {
    paramSpec = { type: "all" };
  } else if (!rightRaw.startsWith("=")) {
    // Modifiers without a value (e.g. `$removeparam,domain=foo.com`)
    if (rightRaw.startsWith(",")) {
      paramSpec = { type: "all" };
      modifiers = rightRaw.slice(1);
    } else {
      return null;
    }
  } else {
    const rest = rightRaw.slice(1);
    if (rest.startsWith("/")) {
      // Regex param spec — find the closing `/` honouring backslash
      // escapes. Any trailing flags / modifiers come after.
      const closeIdx = findClosingSlash(rest);
      if (closeIdx < 1) return null;
      const regexSrc = rest.slice(1, closeIdx);
      let regex;
      try { regex = new RegExp(regexSrc, "i"); } catch { return null; }
      paramSpec = { type: "regex", regex };
      const after = rest.slice(closeIdx + 1);
      modifiers = after.startsWith(",") ? after.slice(1) : after;
    } else {
      // Name spec; modifiers separated by the FIRST comma. AdGuard
      // does not allow commas in param names.
      const commaIdx = rest.indexOf(",");
      const name = (commaIdx === -1 ? rest : rest.slice(0, commaIdx)).trim();
      if (!name) return null;
      // Skip invert syntax — out of scope per docblock.
      if (name.startsWith("~")) return null;
      paramSpec = { type: "name", name };
      modifiers = commaIdx === -1 ? "" : rest.slice(commaIdx + 1);
    }
  }

  // ── Skip out-of-scope modifiers ──────────────────────────────────
  // Resource-type / CSP / redirect modifiers don't apply at URL
  // navigation time. Filter them out entirely.
  if (modifiers && /\b(xmlhttprequest|script|image|stylesheet|object|subdocument|websocket|popup|csp=|redirect=|removeheader=)/i.test(modifiers)) {
    return null;
  }

  // ── Parse left-side URL pattern ──────────────────────────────────
  const domains = [];
  const invertDomains = [];
  if (leftRaw === "" || leftRaw === "*") {
    // Generic — applies to every URL (subject to domain modifier).
  } else if (leftRaw.startsWith("||")) {
    // ||host^ or ||host (no anchor) — domain pattern.
    // Path-scoped patterns are out of scope.
    const m = leftRaw.match(/^\|\|([^/^*]+)/);
    if (!m) return null;
    if (/\|\|[^/^]+\//.test(leftRaw)) return null; // has path
    domains.push(m[1].toLowerCase());
  } else {
    // Plain URL or other left-side syntax — out of scope for the
    // strip-param benchmark. Skip.
    return null;
  }

  // ── Parse domain= modifier ───────────────────────────────────────
  const domMatch = modifiers.match(/(?:^|,)domain=([^,]+)/i);
  if (domMatch) {
    for (const d of domMatch[1].split("|")) {
      const trimmedD = d.trim().toLowerCase();
      if (!trimmedD) continue;
      if (trimmedD.startsWith("~")) invertDomains.push(trimmedD.slice(1));
      else domains.push(trimmedD);
    }
  }

  return { domains, invertDomains, paramSpec };
}

/**
 * Locate the index of the closing `/` in a string that begins with `/`,
 * honouring `\/` escapes. Returns -1 if no closing slash is found.
 */
function findClosingSlash(s) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; } // skip escaped char
    if (s[i] === "/") return i;
  }
  return -1;
}

// Pre-compile the entire filter once at module load.
const { rules: _rules, stats: _parseStats } = (() => {
  const lines = _raw.split(/\r?\n/);
  const rules = [];
  let total = 0;
  let parsed = 0;
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("!")) continue;
    if (line.indexOf("$removeparam") === -1) continue;
    total++;
    const rule = parseRule(line);
    if (rule) { rules.push(rule); parsed++; }
    else skipped++;
  }
  return { rules, stats: { total, parsed, skipped } };
})();

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

/**
 * @param {string} rawUrl
 * @returns {string} cleaned URL, or rawUrl unchanged when no rule applied
 */
function cleanAdGuard(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

  const hostname = url.hostname.toLowerCase();
  let changed = false;

  for (const rule of _rules) {
    // Domain gating
    if (rule.domains.length > 0) {
      if (!rule.domains.some((d) => hostMatches(hostname, d))) continue;
    }
    if (rule.invertDomains.length > 0) {
      if (rule.invertDomains.some((d) => hostMatches(hostname, d))) continue;
    }

    // Apply the param spec
    if (rule.paramSpec.type === "all") {
      const keys = [...url.searchParams.keys()];
      for (const k of keys) url.searchParams.delete(k);
      if (keys.length > 0) changed = true;
    } else if (rule.paramSpec.type === "name") {
      if (url.searchParams.has(rule.paramSpec.name)) {
        url.searchParams.delete(rule.paramSpec.name);
        changed = true;
      }
    } else if (rule.paramSpec.type === "regex") {
      const keys = [...url.searchParams.keys()];
      for (const k of keys) {
        if (rule.paramSpec.regex.test(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      }
    }
  }

  return changed ? url.toString() : rawUrl;
}

export const adguardAdapter = {
  name: "adguard",
  label: "AdGuard URL Tracking Protection (filter #17 default)",
  source: "https://filters.adtidy.org/extension/chromium/filters/17.txt",
  version: "vendored",
  clean: cleanAdGuard,
};

// Exposed for tests. Not part of the public adapter contract.
export { _parseStats, _rules as _rulesForTests, parseRule as _parseRuleForTests };
