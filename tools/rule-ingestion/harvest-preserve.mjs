/**
 * MUGA: harvest-preserve — domain-scoped preserve-param harvester.
 *
 * Run with: node tools/rule-ingestion/harvest-preserve.mjs
 * (also available as: npm run harvest:preserve)
 *
 * Reads two already-fetched, quarantined upstream sources and harvests
 * DOMAIN-SCOPED preserve params into src/rules/domain-rules.json:
 *
 *   1. tools/rule-ingestion/quarantine/adguard-tp.raw
 *      AdGuard "URL Tracking" filter. Exception rules of the form
 *      `@@||host^$removeparam=X` (or a path-based rule with a `domain=`
 *      modifier) declare "this site needs param X kept". Each such rule
 *      is a domain-scoped preserve signal.
 *
 *   2. tools/moat-expansion/quarantine/clearurls.raw
 *      ClearURLs `data.min.json`. Each provider's `referralMarketing`
 *      array lists params that carry referral/affiliate attribution for
 *      that specific site. We only harvest providers whose `urlPattern`
 *      resolves to a CONCRETE host (a literal domain, not a multi-TLD
 *      regex like `amazon(?:\.[a-z]{2,}){1,}` and not the `globalRules`
 *      catch-all with `urlPattern: ".*"`).
 *
 * CRITICAL SAFETY NOTE (read before touching this file):
 * A harvested preserve param that also happens to be a global tracking
 * param (e.g. `utm_campaign` preserved on one specific site) is CORRECT
 * and SAFE precisely BECAUSE it is domain-scoped: only that domain keeps
 * the param, every other site still has it stripped globally via
 * TRACKING_PARAMS. Domain-scoped preserve entries must NEVER be promoted
 * to any global list (TRACKING_PARAMS in src/lib/affiliates-data.js, or
 * AFFILIATE_PARAM_GUARD in src/lib/remote-rules.js). This script only
 * ever reads those modules for a coherence sanity check; it only ever
 * WRITES src/rules/domain-rules.json.
 *
 * Determinism / idempotency: parsing is a pure function of the raw
 * input text, and the merge step only ADDS missing (domain, param)
 * pairs (deduped, alphabetically sorted per entry). Running this script
 * twice against the same raw inputs produces zero further diff.
 *
 * Only preserves for params MUGA actually strips are kept: a domain-scoped
 * preserve for a param MUGA never strips is a no-op, so main() filters the
 * harvested pairs through isStrippedByMuga() before merging.
 *
 * Pure logic is exported for unit testing (tests/unit/harvest-preserve.test.mjs):
 *   - parseAdguardExceptions(rawText)
 *   - parseClearUrlsProviders(rawJsonText)
 *   - isStrippedByMuga(param, trackingParams, prefixes)
 *   - mergeIntoDomainRules(existingRules, harvestedEntries)
 *
 * main() does file I/O only and is guarded so importing this module for
 * tests never triggers the CLI run.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAMS, TRACKING_PREFIXES } from "../../src/lib/affiliates-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

const ADGUARD_RAW_PATH = join(REPO_ROOT, "tools/rule-ingestion/quarantine/adguard-tp.raw");
const CLEARURLS_RAW_PATH = join(REPO_ROOT, "tools/moat-expansion/quarantine/clearurls.raw");
const DOMAIN_RULES_PATH = join(REPO_ROOT, "src/rules/domain-rules.json");

const HARVEST_NOTE = "Preserve params harvested from AdGuard/ClearURLs exceptions";

// ── AdGuard exception parsing ─────────────────────────────────────────────────

/**
 * Resolve the domain(s) an AdGuard `@@` exception line applies to.
 *
 * Two host sources are combined (a rule may carry both):
 *   - An anchored `||HOST` prefix: the literal host chars right after `||`,
 *     up to the first delimiter (`^`, `/`, `?`, or `$`). Wildcard segments
 *     (`*`) inside the host break this match on purpose — a wildcard TLD
 *     like `amazon.*` is not a resolvable concrete domain.
 *   - A `domain=A|B|C` modifier: each pipe-separated entry is a host.
 *     Entries prefixed with `~` are negated (NOT this domain) and are
 *     skipped rather than resolved.
 *
 * @param {string} line A single raw filter line (already confirmed to start
 *   with `@@` and contain `removeparam=`).
 * @returns {string[]} Deduped, lowercased hosts. Empty when nothing resolves.
 */
function resolveAdguardHosts(line) {
  const hosts = new Set();

  const anchored = line.match(/^@@\|\|([a-z0-9.-]+)(?=[/^?$])/i);
  if (anchored) {
    hosts.add(anchored[1].toLowerCase());
  }

  const domainModifier = line.match(/[,$]domain=([^,]+)/);
  if (domainModifier) {
    for (const rawHost of domainModifier[1].split("|")) {
      const host = rawHost.trim();
      if (!host || host.startsWith("~")) continue;
      hosts.add(host.toLowerCase());
    }
  }

  return [...hosts];
}

/**
 * Parse AdGuard exception rules (`@@...removeparam=...`) into domain-scoped
 * preserve entries.
 *
 * @param {string} rawText Raw contents of the AdGuard filter list.
 * @returns {{ entries: Array<{domain: string, param: string}>, skipped: Array<{line: string, reason: string}> }}
 */
export function parseAdguardExceptions(rawText) {
  const entries = [];
  const skipped = [];

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("@@") || !line.includes("removeparam=")) continue;

    const paramMatch = line.match(/removeparam=([^,]+)/);
    if (!paramMatch || !paramMatch[1]) {
      skipped.push({ line, reason: "could not extract a removeparam value" });
      continue;
    }
    // domain-rules.json entries must be lowercase (the runtime loader
    // lowercases both preserveParams/stripParams at load time; keeping the
    // JSON in sync avoids confusing mixed-case entries, see #831 Item 5).
    const param = paramMatch[1].toLowerCase();

    const hosts = resolveAdguardHosts(line);
    if (hosts.length === 0) {
      skipped.push({
        line,
        reason: "no ||HOST^ or domain= modifier resolved to a concrete host (wildcard TLD segment or unsupported rule shape)",
      });
      continue;
    }

    for (const domain of hosts) {
      entries.push({ domain, param });
    }
  }

  return { entries, skipped };
}

// ── ClearURLs provider parsing ────────────────────────────────────────────────

/**
 * Try to extract a concrete (literal) host from a ClearURLs provider
 * `urlPattern` regex string.
 *
 * Only patterns anchored at `^https?://`, optionally followed by a generic
 * optional-subdomain group (e.g. `(?:[a-z0-9-]+\.)*?`), and then a fully
 * literal domain (letters/digits/hyphens joined by literal `\.`) count as
 * concrete. Patterns whose domain continues into a regex group (typically
 * a multi-TLD wildcard like `amazon(?:\.[a-z]{2,}){1,}`) are NOT concrete —
 * they match many possible hosts, not one.
 *
 * @param {string} urlPattern The provider's `urlPattern` regex source.
 * @returns {string | null} The concrete host, or null if unresolvable.
 */
export function extractConcreteHost(urlPattern) {
  if (!urlPattern || urlPattern === ".*") return null;

  let rest = urlPattern;
  const protocolPrefix = "^https?:\\/\\/";
  if (!rest.startsWith(protocolPrefix)) return null;
  rest = rest.slice(protocolPrefix.length);

  const optionalSubdomainPrefixes = [
    "(?:[a-z0-9-]+\\.)*?",
    "(?:[a-z0-9-]+\\.)*",
    "(?:www\\.)?",
  ];
  for (const prefix of optionalSubdomainPrefixes) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }

  // Match one-or-more "label\.label" segments, all literal chars.
  const labelMatch = rest.match(/^[a-z0-9-]+(?:\\\.[a-z0-9-]+)+/i);
  if (!labelMatch) return null;

  const matched = labelMatch[0];
  const trailing = rest.slice(matched.length);
  // A concrete host must end here, or hit a path/query boundary, or the
  // regex end. Anything else (a group opening, quantifier, etc.) means the
  // domain is not fully literal (e.g. a wildcard TLD group follows).
  if (trailing !== "" && !trailing.startsWith("\\/") && !trailing.startsWith("$")) {
    return null;
  }

  return matched.replace(/\\\./g, ".").toLowerCase();
}

/**
 * Parse ClearURLs `data.min.json` providers into domain-scoped preserve
 * entries, using each provider's `referralMarketing` list.
 *
 * The `globalRules` provider (a `.*` catch-all) is always skipped: its
 * referralMarketing tokens (e.g. `ref`, `referrer`) are generic and must
 * never be treated as domain-scoped (or worse, global) preserve params.
 *
 * @param {string} rawJsonText Raw contents of ClearURLs `data.min.json`.
 * @returns {{ entries: Array<{domain: string, param: string}>, skipped: Array<{provider: string, reason: string}> }}
 */
export function parseClearUrlsProviders(rawJsonText) {
  const data = JSON.parse(rawJsonText);
  const entries = [];
  const skipped = [];

  const providers = data.providers ?? {};
  for (const [name, provider] of Object.entries(providers)) {
    const referralMarketing = provider.referralMarketing ?? [];
    if (referralMarketing.length === 0) continue;

    if (name === "globalRules") {
      skipped.push({
        provider: name,
        reason: "globalRules is a generic catch-all (urlPattern: \".*\"); its referralMarketing tokens are not domain-scoped",
      });
      continue;
    }

    const host = extractConcreteHost(provider.urlPattern);
    if (!host) {
      skipped.push({
        provider: name,
        reason: `urlPattern "${provider.urlPattern}" does not resolve to a concrete host (likely a multi-TLD wildcard)`,
      });
      continue;
    }

    for (const param of referralMarketing) {
      // See the lowercase note in parseAdguardExceptions above: domain-rules.json
      // preserveParams entries must be lowercase to match the runtime loader.
      entries.push({ domain: host, param: param.toLowerCase() });
    }
  }

  return { entries, skipped };
}

// ── Relevance filter ──────────────────────────────────────────────────────────

/**
 * True when MUGA would otherwise strip `param` (exact TRACKING_PARAMS match or a
 * TRACKING_PREFIXES prefix match). A domain-scoped preserve only has an EFFECT
 * for such params: it stops the global strip on that host. Preserving a param
 * MUGA never strips is a no-op that only bloats domain-rules.json, so the
 * harvest drops those (they are re-evaluated every run as sources evolve).
 *
 * @param {string} param lowercase param name
 * @param {Set<string>} trackingParams lowercase TRACKING_PARAMS set
 * @param {string[]} prefixes lowercase TRACKING_PREFIXES
 * @returns {boolean}
 */
export function isStrippedByMuga(param, trackingParams, prefixes) {
  if (trackingParams.has(param)) return true;
  return prefixes.some((prefix) => param.startsWith(prefix));
}

// ── Merge into domain-rules.json ──────────────────────────────────────────────

/**
 * Merge harvested (domain, param) preserve entries into the existing
 * domain-rules array. Only ADDS missing preserve params:
 *   - Existing `stripParams` and existing hand-written `note` text are
 *     left untouched.
 *   - New params are appended to `preserveParams`, then the whole array is
 *     deduped and sorted alphabetically for stable diffs.
 *   - Brand-new domains get a fresh entry (empty `preserveParams` filled
 *     in) with `note: "${HARVEST_NOTE}"`, inserted in alphabetically
 *     sorted position relative to the surrounding entries.
 *
 * Pure and idempotent: calling this twice with the same inputs yields an
 * identical result the second time (no new additions, no diff).
 *
 * @param {Array<{domain: string, preserveParams?: string[], stripParams?: string[], note?: string}>} existingRules
 *   The current parsed contents of src/rules/domain-rules.json.
 * @param {Array<{domain: string, param: string}>} harvestedEntries
 *   Harvested (domain, param) pairs from parseAdguardExceptions /
 *   parseClearUrlsProviders.
 * @returns {{ rules: Array<object>, domainsTouched: number, paramsAdded: number }}
 */
export function mergeIntoDomainRules(existingRules, harvestedEntries) {
  const rules = existingRules.map((entry) => ({
    ...entry,
    preserveParams: entry.preserveParams ? [...entry.preserveParams] : [],
  }));

  const byDomain = new Map(rules.map((entry) => [entry.domain, entry]));

  // Group harvested params by domain for stable, single-pass merging.
  const harvestedByDomain = new Map();
  for (const { domain, param } of harvestedEntries) {
    if (!harvestedByDomain.has(domain)) harvestedByDomain.set(domain, new Set());
    harvestedByDomain.get(domain).add(param);
  }

  let domainsTouched = 0;
  let paramsAdded = 0;

  const sortedDomains = [...harvestedByDomain.keys()].sort();
  for (const domain of sortedDomains) {
    const params = harvestedByDomain.get(domain);
    let entry = byDomain.get(domain);
    let entryTouched = false;

    if (!entry) {
      entry = { domain, preserveParams: [], note: HARVEST_NOTE };
      byDomain.set(domain, entry);

      const insertAt = rules.findIndex((r) => r.domain > domain);
      if (insertAt === -1) rules.push(entry);
      else rules.splice(insertAt, 0, entry);
    }

    for (const param of params) {
      if (!entry.preserveParams.includes(param)) {
        entry.preserveParams.push(param);
        paramsAdded += 1;
        entryTouched = true;
      }
    }

    if (entryTouched) {
      entry.preserveParams.sort();
      domainsTouched += 1;
    }
  }

  return { rules, domainsTouched, paramsAdded };
}

// ── CLI runner ─────────────────────────────────────────────────────────────

function main() {
  const adguardRaw = readFileSync(ADGUARD_RAW_PATH, "utf8");
  const clearUrlsRaw = readFileSync(CLEARURLS_RAW_PATH, "utf8");
  const existingRules = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));

  const adguard = parseAdguardExceptions(adguardRaw);
  const clearUrls = parseClearUrlsProviders(clearUrlsRaw);

  // Keep only preserves that MUGA would actually strip (see isStrippedByMuga);
  // a preserve for a never-stripped param is a no-op that only bloats the file.
  const trackingParams = new Set([...TRACKING_PARAMS].map((p) => p.toLowerCase()));
  const prefixes = [...TRACKING_PREFIXES].map((p) => p.toLowerCase());
  const rawEntries = [...adguard.entries, ...clearUrls.entries];
  const harvestedEntries = rawEntries.filter((e) => isStrippedByMuga(e.param, trackingParams, prefixes));
  const droppedNoop = rawEntries.length - harvestedEntries.length;
  const { rules, domainsTouched, paramsAdded } = mergeIntoDomainRules(existingRules, harvestedEntries);

  const payload = JSON.stringify(rules, null, 2) + "\n";
  writeFileSync(DOMAIN_RULES_PATH + ".tmp", payload, "utf8");
  renameSync(DOMAIN_RULES_PATH + ".tmp", DOMAIN_RULES_PATH);

  console.log(`[harvest-preserve] domains touched: ${domainsTouched}`);
  console.log(`[harvest-preserve] params added: ${paramsAdded}`);
  console.log(`[harvest-preserve] no-op preserves dropped (param never stripped by MUGA): ${droppedNoop}`);
  console.log(`[harvest-preserve] rules skipped: ${adguard.skipped.length + clearUrls.skipped.length}`);
  for (const s of adguard.skipped) {
    console.log(`  - [adguard] ${s.reason}\n      ${s.line}`);
  }
  for (const s of clearUrls.skipped) {
    console.log(`  - [clearurls] provider "${s.provider}": ${s.reason}`);
  }
}

if (process.argv[1]?.endsWith("harvest-preserve.mjs")) {
  main();
}
