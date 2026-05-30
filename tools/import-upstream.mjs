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

/**
 * Parses an Adblock Plus filter list and extracts every removeparam parameter
 * name. Pipe-separated multi-param rules are split. Regex-based removeparam
 * rules (those starting with `/` or `~`) are skipped — those need different
 * handling than a flat name list.
 *
 * @param {string} text The raw filter list contents.
 * @returns {Set<string>} Lowercased parameter names found in $removeparam rules.
 */
export function parseRemoveparamRules(text) {
  const params = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("!")) continue; // comment
    if (line.startsWith("[")) continue; // section header

    // Find the $removeparam modifier; multiple modifiers may be present so we
    // search anywhere on the line and stop at the next `,` or end-of-line.
    const match = /\$.*?removeparam=([^,$]+)/i.exec(line);
    if (!match) continue;

    const spec = match[1].trim();
    if (!spec) continue;

    // Skip regex specs and negations: those need rule-by-rule handling.
    if (spec.startsWith("/") || spec.startsWith("~")) continue;

    for (const piece of spec.split("|")) {
      const name = piece.trim().toLowerCase();
      if (!name) continue;
      // Conservative param-name validation: alphanumeric + _ - . only.
      if (!/^[a-z0-9_\-.]{1,64}$/.test(name)) continue;
      params.add(name);
    }
  }
  return params;
}

async function main() {
  const response = await fetch(ADGUARD_FILTER_17_URL, {
    headers: { "User-Agent": "muga-import-upstream/1.0 (+https://github.com/yocreoquesi/muga)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch AdGuard Filter 17: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  const upstreamParams = parseRemoveparamRules(text);
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
  };

  const outPath = process.env.IMPORT_REPORT_PATH || "/tmp/import-report.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
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
