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
import { PATH_PREFIX_RE } from "./rules-store.mjs";

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
 * obs #1513).
 *
 * `@@` exception lines (AdGuard's `@@` inverts a rule: "preserve this
 * parameter here", not "strip it") are excluded from BOTH the scoped path
 * (C2, obs #1523) and the global `params` path (fix for issue #1234 — the
 * global path used to read an exception as a strip fact, the exact inverse
 * of upstream intent). An exception line is not a malformed spec, so it is
 * counted in its own `exceptionsSkipped` field rather than folded into
 * `skipped` — conflating the two hid this bug for as long as it existed.
 *
 * A `||`-prefixed line takes exactly one of THREE anchor shapes, not two:
 *   `||host^...`            — HOST anchor: the whole line is scoped to `host`.
 *   `...,domain=h1|h2...`   — an explicit domain modifier, pipe-separated,
 *                              `~`-prefixed entries are negated (excluded).
 *                              Independent of `||` — it may appear on a line
 *                              that never starts with `||` at all.
 *   `||host/path...`        — PATH (or query) anchor: `||` followed by
 *                              anything that is neither a clean `^`-terminated
 *                              host nor a `domain=` modifier — e.g.
 *                              `||host/path$removeparam=x` or
 *                              `||host&query=v$removeparam=x`. Narrower than a
 *                              host, and unlike a host anchor it has no
 *                              smaller landing spot in this channel: a
 *                              path/query predicate cannot enter `scoped[]`
 *                              (ADR-0010 decision 5 keeps path predicates out
 *                              of the signed payload entirely — they are a
 *                              BUNDLED-only mechanism), and design correction
 *                              C1's "anchored ⇒ still global" argument does
 *                              NOT cover this shape: C1 measured that
 *                              excluding HOST anchors from `params` would
 *                              amputate 85% of real auto-merge reach, because
 *                              a host anchor still has `scoped[]` to land in
 *                              ("not global" means relocated, not discarded).
 *                              A path anchor has nowhere smaller to relocate
 *                              to, so landing it in `params` is not a
 *                              fallback, it is an over-claim with no smaller
 *                              option — the exact #1212/#1217/#1326 failure
 *                              class. Such a line contributes to NEITHER
 *                              `params` NOR `scoped`; it is counted in its
 *                              own `pathAnchorSkipped` field, the same way an
 *                              `@@` exception gets its own `exceptionsSkipped`
 *                              rather than being folded into `skipped` (a
 *                              path anchor is not a malformed spec either).
 *
 * Slice 3 (#1326) addition: a `||host/path...` line — the subset of a path
 * anchor that names an actual literal host AND an actual literal path, as
 * opposed to a query anchor (`||host&query=...`) or a wildcarded/TLD-family
 * host (e.g. the `google` family anchored to a `/search` path) — additionally
 * lands its (param, host, pathPrefix) fact in the new `pathAnchored` array.
 * This is PURELY ADDITIVE,
 * mirroring how Slice 2 added `scoped` without touching `params`/`skipped`:
 * `pathAnchorSkipped` keeps counting exactly what it counted before (every
 * path/query-anchored line, landable or not), so nothing about its existing
 * meaning changes. `pathAnchored` is a strict subset of what `pathAnchorSkipped`
 * counts — a query anchor, a wildcarded host, or a path segment that is not a
 * literal prefix (contains upstream's own `*`/regex punctuation) contributes to
 * the count but not to this array, because ADR-0010 decision 2 accepts only a
 * literal path prefix (`tools/rules-store.mjs`'s `PATH_PREFIX_RE`), never a
 * regex or a host wildcard — reused here rather than re-derived, so the two
 * validators cannot silently drift apart.
 *
 * @param {string} text The raw filter list contents.
 * @returns {{ params: Set<string>, skipped: number, exceptionsSkipped: number, scoped: Array<{param: string, scope: string}>, scopeSkipped: number, pathAnchorSkipped: number, pathAnchored: Array<{param: string, host: string, pathPrefix: string}> }}
 *   Lowercased parameter names, skip count, count of `@@` exception lines excluded from `params`,
 *   host-anchored (param, host) facts, a count of lines skipped from the scoped path because
 *   they carried both anchor forms at once (ambiguous), a count of `||`-prefixed lines
 *   anchored to a path or query rather than a whole host (excluded from both `params` and `scoped`),
 *   and the literal (param, host, pathPrefix) subset of those lines that ADR-0010's schema can
 *   actually express.
 */
export function parseRemoveparamRules(text) {
  const params = new Set();
  const scoped = [];
  const pathAnchored = [];
  let skipped = 0;
  let exceptionsSkipped = 0;
  let scopeSkipped = 0;
  let pathAnchorSkipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("!")) continue; // comment
    if (line.startsWith("[")) continue; // section header

    // AdGuard exception syntax: `@@` inverts a rule's meaning (preserve, not
    // strip). Excluded from both the global `params` path (issue #1234) and
    // the scoped path (C2, obs #1523) below.
    const isException = line.startsWith("@@");

    // Find the $removeparam modifier; multiple modifiers may be present so we
    // search anywhere on the line and stop at the next `,` or end-of-line.
    const match = /\$.*?removeparam=([^,$]+)/i.exec(line);
    if (!match) continue;

    if (isException) { exceptionsSkipped++; continue; }

    const spec = match[1].trim();
    if (!spec) { skipped++; continue; }

    // Skip regex specs and negations: those need rule-by-rule handling.
    // NIT: skip granularity is per-spec (one whole $removeparam= value), NOT per-piece
    // for pipe-separated multi-regex specs — a spec like "/regex1/|/regex2/" counts as 1 skip.
    if (spec.startsWith("/") || spec.startsWith("~")) { skipped++; continue; }

    // Anchor classification, computed BEFORE the name extraction below so a
    // path/query anchor can be excluded from the global candidate pool
    // rather than silently falling into it (#1326).
    // The capture stops at `/`, `?`, `&` and `=`: none can appear in a host,
    // and upstream path anchors end in `^` too (`||ca.indeed.com/viewjob^`),
    // so `[^^]*` alone let them pass as a whole host (#1357).
    const anchorMatch = /^\|\|([^^/?&=]*)\^/.exec(line);
    const domainMatch = /[$,]domain=([^,$]+)/i.exec(line);
    // A `||`-prefixed line that matches neither a clean host anchor nor a
    // `domain=` modifier is anchored to a path or a query, never to a whole
    // host — see the docblock above for why that must not reach `params`.
    const isPathAnchored = line.startsWith("||") && !anchorMatch && !domainMatch;

    const names = [];
    for (const piece of spec.split("|")) {
      const name = piece.trim().toLowerCase();
      if (!name) { skipped++; continue; }
      if (!PARAM_NAME_RE.test(name)) { skipped++; continue; }
      names.push(name);
    }

    if (isPathAnchored) {
      // Neither destination applies: not `params` (no smaller landing spot
      // exists, so global would over-claim) and not `scoped` (the payload
      // cannot express a path predicate at all). Names are still validated
      // above so a malformed name is still counted in `skipped`, not here.
      pathAnchorSkipped++;

      // Slice 3 (#1326): additionally try to land the literal (host,
      // pathPrefix) fact ADR-0010 can actually express. `[^^/?&=]*` mirrors
      // `anchorMatch`'s own host-character class; the difference is the
      // trailing literal `/` instead of `^`, which is exactly the shape that
      // makes a line "path-anchored" rather than "host-anchored" in the first
      // place. `[^$,^]*` stops the path capture at the next option separator
      // (`$`/`,`) or an embedded `^` (#1357's caret-terminated path, e.g.
      // `||ca.indeed.com/viewjob^$removeparam=cmp`) — never at `?`/`&`, which
      // stay IN the captured token so a trailing query string can be trimmed
      // below rather than swallowed by the host-side character class meant
      // for `anchorMatch`.
      const hostPathMatch = /^\|\|([^^/?&=]*)\/([^$,^]*)/.exec(line);
      const host = hostPathMatch ? normalizeHost(hostPathMatch[1]) : null;
      if (host) {
        const queryAt = hostPathMatch[2].indexOf("?");
        const pathToken = queryAt === -1 ? hostPathMatch[2] : hostPathMatch[2].slice(0, queryAt);
        const pathPrefix = `/${pathToken}`;
        // A wildcard or otherwise non-literal path (upstream's own `*`, or a
        // stray `&`/`=` a query-shaped line leaves in the token) fails
        // PATH_PREFIX_RE and is left out of `pathAnchored` — ADR-0010 ships no
        // regex/wildcard path predicate, so such a line stays UNLANDABLE, not
        // coerced into something narrower than what upstream actually said.
        //
        // A bare "/" (e.g. `||host/?cmd=x$removeparam=cmd` — the path token is
        // empty, only the query survives) is REJECTED even though it passes
        // PATH_PREFIX_RE: it matches every path on the host, so landing it
        // would be exactly the host-wide over-claim ADR-0010 exists to avoid,
        // not a narrower one. Upstream's real predicate here is on the QUERY
        // key, which this mechanism does not express at all — the fact stays
        // UNLANDABLE, the same posture as a wildcard path.
        if (pathPrefix.length > 1 && PATH_PREFIX_RE.test(pathPrefix)) {
          for (const name of names) pathAnchored.push({ param: name, host, pathPrefix });
        }
      }
      continue;
    }

    for (const name of names) params.add(name);

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
  return { params, skipped, exceptionsSkipped, scoped, scopeSkipped, pathAnchorSkipped, pathAnchored };
}

/**
 * Fetches the raw AdGuard Filter 17 text. Exported (#1326 slice 3) so
 * `tools/import-path-anchors.mjs` fetches the exact same upstream list the
 * same way, rather than a second copy of this request.
 *
 * @returns {Promise<string>}
 */
export async function fetchAdGuardFilter17() {
  const response = await fetch(ADGUARD_FILTER_17_URL, {
    headers: { "User-Agent": "muga-import-upstream/1.0 (+https://github.com/yocreoquesi/muga)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch AdGuard Filter 17: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function main() {
  const text = await fetchAdGuardFilter17();

  const { params: upstreamParams, skipped, exceptionsSkipped, pathAnchorSkipped } = parseRemoveparamRules(text);
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
    exceptionsSkipped,
    pathAnchorSkipped,
  };

  const outPath = process.env.IMPORT_REPORT_PATH || "/tmp/import-report.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`[import-upstream] parseRemoveparamRules: skipped ${skipped} non-literal removeparam spec(s), ${exceptionsSkipped} @@ exception line(s), ${pathAnchorSkipped} path/query-anchored line(s) excluded from the global pool (#1326)`);
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
