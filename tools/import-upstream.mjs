/**
 * MUGA: Auto-importer for upstream tracking parameter sources.
 *
 * Fetches AdGuard Filter 17 (URL Tracking Protection) and diffs the parsed
 * removeparam rules against MUGA's TRACKING_PARAMS list. Writes a JSON report
 * to /tmp/import-report.json with the new candidates that a human reviewer
 * should triage into the appropriate TRACKING_PARAM_CATEGORIES group.
 *
 * Run with: node tools/import-upstream.mjs
 *
 * Designed to run from a GitHub Actions cron. The workflow is responsible for:
 *   - reading /tmp/import-report.json
 *   - opening a PR with the candidates if any are present
 *   - never auto-merging — every change requires human judgment
 *
 * Why AdGuard Filter 17 only (in this initial version):
 *   - It is the most actively maintained upstream URL-tracking list at the
 *     scale MUGA cares about (verified by millions of users via AdGuard).
 *   - License (GPL-3.0) is compatible with MUGA's GPL v3.
 *   - Format is well-documented and stable (Adblock Plus syntax with
 *     $removeparam modifier).
 *
 * ClearURLs is intentionally NOT imported here:
 *   - License (LGPL-3.0+) would be technically compatible, but ClearURLs
 *     uses a JSON ruleset with regex per provider rather than a flat param
 *     list; the import shape does not fit MUGA's TRACKING_PARAMS array.
 *   - Adding ClearURLs support is a follow-up if reviewer demand justifies it.
 */

import { TRACKING_PARAMS } from "../src/lib/affiliates.js";
import { writeFileSync } from "node:fs";

// The `safari` platform path was deprecated by AdGuard and now 404s; `chromium`
// serves the same Filter 17 (URL Tracking Protection) list.
const ADGUARD_FILTER_17_URL =
  "https://filters.adtidy.org/extension/chromium/filters/17.txt";

// Conservative param-name validation: alphanumeric + _ - . only. Shared by
// both the global and scoped extraction paths so a mixed-case name (e.g.
// `NaPm`, obs #1513) cannot be scoped under one spelling and globalised under
// another.
const PARAM_NAME_RE = /^[a-z0-9_\-.]{1,64}$/;

// A host is lowercase, dotted, and made of domain-safe characters only. A
// wildcard (`google.*`) or a path/query anchor (`host/path^`) fails this and
// is deliberately treated as "not a whole-host fact" (design table) rather
// than guessed at.
const HOST_RE = /^[a-z0-9.-]{1,253}$/;

/**
 * Normalizes a candidate host string for the scoped-extraction path.
 *
 * @param {string} raw Raw host token (may be malformed/wildcarded/empty).
 * @returns {string|null} Lowercased, validated host, or null when invalid.
 */
function normalizeHost(raw) {
  const host = String(raw).trim().toLowerCase();
  if (!HOST_RE.test(host)) return null;
  if (!host.includes(".")) return null;
  return host;
}

/**
 * Parses an Adblock Plus filter list and extracts every removeparam parameter
 * name. Pipe-separated multi-param rules are split. Regex-based removeparam
 * rules (those starting with `/` or `~`) are skipped — those need different
 * handling than a flat name list.
 *
 * Slice 2 (rules-scope-normalization) addition: also extracts the upstream
 * host anchor, when present, as a separate `scoped` list of `{param, scope}`
 * facts. This is purely ADDITIVE — the bare global param in `params` keeps
 * flowing exactly as before (design correction C1; an "anchored ⇒ not
 * global" rule was measured to amputate 85% of today's auto-merge reach, see
 * obs #1513). `@@` exception lines are excluded from the scoped path only
 * (AdGuard's `@@` means "preserve", the opposite of a strip fact — obs
 * #1523); the pre-existing leak of `@@` lines into the GLOBAL `params` set is
 * untouched here, it is a separate, already-filed defect.
 *
 * @param {string} text The raw filter list contents.
 * @returns {{ params: Set<string>, skipped: number, scoped: Array<{param: string, scope: string}>, scopeSkipped: number }}
 *   Lowercased parameter names, skip count, host-anchored (param, host) facts, and a count of
 *   lines skipped from the scoped path because they carried both anchor forms at once (ambiguous).
 */
export function parseRemoveparamRules(text) {
  const params = new Set();
  const scoped = [];
  let skipped = 0;
  let scopeSkipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("!")) continue; // comment
    if (line.startsWith("[")) continue; // section header

    // AdGuard exception syntax: `@@` inverts a rule's meaning (preserve, not
    // strip). The GLOBAL path below does not skip these today (pre-existing
    // leak, obs #1523, out of scope for this slice) — only the scoped path
    // below is guarded against it.
    const isException = line.startsWith("@@");

    // Find the $removeparam modifier; multiple modifiers may be present so we
    // search anywhere on the line and stop at the next `,` or end-of-line.
    const match = /\$.*?removeparam=([^,$]+)/i.exec(line);
    if (!match) continue;

    const spec = match[1].trim();
    if (!spec) { skipped++; continue; }

    // Skip regex specs and negations: those need rule-by-rule handling.
    // NIT: skip granularity is per-spec (one whole $removeparam= value), NOT per-piece
    // for pipe-separated multi-regex specs — a spec like "/regex1/|/regex2/" counts as 1 skip.
    if (spec.startsWith("/") || spec.startsWith("~")) { skipped++; continue; }

    const names = [];
    for (const piece of spec.split("|")) {
      const name = piece.trim().toLowerCase();
      if (!name) { skipped++; continue; }
      if (!PARAM_NAME_RE.test(name)) { skipped++; continue; }
      params.add(name);
      names.push(name);
    }

    if (isException) continue; // no scoped emission for exception lines (C2)

    // Two independent anchor forms, either of which may be present:
    //   `||host^...`            — the whole line is scoped to `host`.
    //   `...,domain=h1|h2...`   — an explicit domain modifier, pipe-separated,
    //                              `~`-prefixed entries are negated (excluded).
    // The `domain=` scan is independent of the removeparam match because
    // either modifier may appear first on the line.
    const anchorMatch = /^\|\|([^^]*)\^/.exec(line);
    const domainMatch = /[$,]domain=([^,$]+)/i.exec(line);

    if (anchorMatch && domainMatch) {
      // AdGuard semantics intersect the two forms; guessing risks
      // double-counting. Skip the scoped path entirely (measured ~1 line).
      scopeSkipped++;
      continue;
    }

    if (anchorMatch) {
      const host = normalizeHost(anchorMatch[1]);
      if (host) {
        for (const name of names) scoped.push({ param: name, scope: host });
      }
      continue;
    }

    if (domainMatch) {
      for (const rawHost of domainMatch[1].split("|")) {
        const trimmed = rawHost.trim();
        if (!trimmed || trimmed.startsWith("~")) continue; // negated or empty
        const host = normalizeHost(trimmed);
        if (!host) continue;
        for (const name of names) scoped.push({ param: name, scope: host });
      }
    }
  }
  return { params, skipped, scoped, scopeSkipped };
}

async function main() {
  const response = await fetch(ADGUARD_FILTER_17_URL, {
    headers: { "User-Agent": "muga-import-upstream/1.0 (+https://github.com/yocreoquesi/muga)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch AdGuard Filter 17: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  const { params: upstreamParams, skipped } = parseRemoveparamRules(text);
  const existing = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  const candidates = [...upstreamParams].filter((p) => !existing.has(p));
  candidates.sort();

  const report = {
    source: "AdGuard Filter 17 (URL Tracking Protection)",
    source_url: ADGUARD_FILTER_17_URL,
    fetched_at: new Date().toISOString(),
    total_in_source: upstreamParams.size,
    total_in_muga: existing.size,
    new_candidates_count: candidates.length,
    new_candidates: candidates,
    skipped,
  };

  const outPath = process.env.IMPORT_REPORT_PATH || "/tmp/import-report.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`[import-upstream] parseRemoveparamRules: skipped ${skipped} non-literal removeparam spec(s)`);
  console.log(`AdGuard Filter 17: ${upstreamParams.size} params parsed`);
  console.log(`MUGA TRACKING_PARAMS: ${existing.size} entries`);
  console.log(`New candidates: ${candidates.length}`);
  console.log(`Report written: ${outPath}`);
}

// Only run when invoked directly (not when imported by tests). Guard is
// defensive against process.argv[1] being undefined (node -e, REPL, etc.).
if (process.argv[1]?.endsWith("import-upstream.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
