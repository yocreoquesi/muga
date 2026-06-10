/**
 * MUGA — moat-expansion report renderer (#793).
 *
 * Pure function that converts differ output into a human-readable Markdown
 * gap report. No I/O, no side effects, no Date.now() calls.
 *
 * Sections (always in this order):
 *   1. new-param-on-known-program — one entry per gap, with a copy-pasteable
 *      draft manifest entry block in the CAPS_DIRECT_INJECTION_PROGRAMS shape:
 *      { id, name, programType, domains[], param, valueShape, notes, references[] }
 *   2. unknown-provider — raw urlPattern shown verbatim, no domain inference
 *   3. already-covered — single count line, no enumeration
 *
 * Deterministic ordering:
 *   - new-param-on-known-program: sorted by programId, then param (both ASC)
 *     (differ pre-sorts; renderer trusts that order and does NOT re-sort)
 *   - unknown-provider: sorted by provider key ASC (differ pre-sorts)
 *
 * Clock contract: caller injects `meta.fetchedAt` (ISO string). The renderer
 * NEVER calls Date.now() or new Date() internally.
 *
 * Public API (named export only — no default):
 *   renderReport(diffResult, meta) → string
 */

// ── Name resolution ───────────────────────────────────────────────────────────

/**
 * Best-effort human-readable names for known programIds.
 * Used to populate the `name` field in draft manifest entries.
 * Add entries here when the lookup table gains new programs.
 *
 * @type {Record<string, string>}
 */
const PROGRAM_NAMES = {
  "amazon-associates": "Amazon Associates",
  "ebay-partner-network": "eBay Partner Network",
  "aliexpress-affiliate": "AliExpress Affiliate",
  "awin": "AWIN",
  "impact-radius": "Impact (Impact Radius)",
  "cj-affiliate": "CJ Affiliate (Commission Junction)",
};

/**
 * Resolve a human-readable name for a programId.
 * Falls back to a title-cased transformation of the id.
 *
 * @param {string} programId
 * @returns {string}
 */
function resolveProgramName(programId) {
  return PROGRAM_NAMES[programId] ?? programId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ── Draft manifest entry builder ──────────────────────────────────────────────

/**
 * Build a copy-pasteable draft manifest entry block as a JS code string.
 * Shape mirrors CAPS_DIRECT_INJECTION_PROGRAMS entries exactly:
 *   { id, name, programType, domains[], param, valueShape, notes, references[] }
 *
 * @param {{programId: string, domains: string[], param: string, provider: string}} entry
 * @returns {string} — Formatted JS object literal (without trailing comma)
 */
function buildDraftEntry(entry) {
  const { programId, domains, param, provider } = entry;
  const name = resolveProgramName(programId);
  const sortedDomains = domains.slice().sort();
  const domainsLines = sortedDomains
    .map((d) => `    "${d}"`)
    .join(",\n");

  return [
    `{`,
    `  id: "${programId}",`,
    `  name: "${name}",`,
    `  programType: "direct-injection",`,
    `  domains: [`,
    domainsLines,
    `  ],`,
    `  param: "${param}",`,
    `  valueShape: "non-empty",`,
    `  notes: "Gap detected via moat-expansion ClearURLs diff (provider: ${provider}). Verify param purpose before adding.",`,
    `  references: []`,
    `}`,
  ].join("\n");
}

// ── Section renderers ─────────────────────────────────────────────────────────

/**
 * Render the `new-param-on-known-program` section.
 *
 * Sorts by programId ASC then param ASC (defensive — trusts differ pre-sort
 * but re-sorts to guarantee determinism regardless of input order).
 *
 * @param {Array<{programId: string, domains: string[], param: string, provider: string}>} newOnKnown
 * @returns {string}
 */
function renderNewOnKnown(newOnKnown) {
  const heading = "## new-param-on-known-program  (ACTION: consider adding to moat)";

  if (newOnKnown.length === 0) {
    return [heading, "", "No new params detected on known programs this run.", ""].join("\n");
  }

  // Defensive sort — guarantees determinism even if differ output order changes.
  const sorted = newOnKnown.slice().sort((a, b) => {
    const cmp = a.programId.localeCompare(b.programId);
    return cmp !== 0 ? cmp : a.param.localeCompare(b.param);
  });

  const entries = sorted.map((entry) => {
    const draftBlock = buildDraftEntry(entry);
    return [
      `- provider \`${entry.provider}\` (\`${entry.programId}\`) param \`${entry.param}\``,
      `  Draft manifest entry:`,
      `  \`\`\`js`,
      draftBlock.split("\n").map((line) => `  ${line}`).join("\n"),
      `  \`\`\``,
    ].join("\n");
  });

  return [heading, "", ...entries, ""].join("\n");
}

/**
 * Render the `unknown-provider` section.
 *
 * Sorts by provider key ASC (defensive — guarantees determinism).
 *
 * @param {Array<{provider: string, urlPattern: string, referralMarketing: string[]}>} unknownProvider
 * @returns {string}
 */
function renderUnknownProvider(unknownProvider) {
  const heading = "## unknown-provider  (no lookup mapping — human-interpret urlPattern)";

  if (unknownProvider.length === 0) {
    return [heading, "", "No unknown providers detected this run.", ""].join("\n");
  }

  // Defensive sort — guarantees determinism even if differ output order changes.
  const sorted = unknownProvider.slice().sort((a, b) => a.provider.localeCompare(b.provider));

  const entries = sorted.map((entry) => {
    const params = entry.referralMarketing.join(", ");
    return `- provider \`${entry.provider}\` referralMarketing [${params}] urlPattern: \`${entry.urlPattern}\``;
  });

  return [heading, "", ...entries, ""].join("\n");
}

/**
 * Render the `already-covered` section.
 *
 * @param {number} count
 * @returns {string}
 */
function renderAlreadyCovered(count) {
  const heading = "## Already covered";
  const body = count === 0
    ? "0 params already in the moat."
    : `${count} param${count === 1 ? "" : "s"} already in the moat (suppressed to reduce noise).`;

  return [heading, "", body, ""].join("\n");
}

// ── Header ────────────────────────────────────────────────────────────────────

/**
 * Render the report header.
 *
 * @param {{fetchedAt: string, providerCount: number, paramCount: number}} meta
 * @param {{newOnKnown: Array<any>, unknownProvider: Array<any>}} diff
 * @returns {string}
 */
function renderHeader(meta, diff) {
  const { fetchedAt, providerCount, paramCount } = meta;
  const gapCount = diff.newOnKnown.length;
  const unknownCount = diff.unknownProvider.length;

  const statusLine = (gapCount === 0 && unknownCount === 0)
    ? "No new gaps this week — moat is current."
    : `${gapCount} new gap${gapCount === 1 ? "" : "s"} on known programs, ${unknownCount} unknown provider${unknownCount === 1 ? "" : "s"}.`;

  return [
    "# Moat-expansion discovery report",
    "",
    `Source: ClearURLs data.min.json (LGPL-3.0, signals-not-copies) | Fetched: ${fetchedAt}`,
    `Providers scanned: ${providerCount} | referralMarketing params: ${paramCount}`,
    "",
    `> ${statusLine}`,
    "",
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a Markdown gap report from differ output.
 *
 * Pure function — no I/O, no Date.now(), no side effects.
 * Caller is responsible for injecting the `fetchedAt` timestamp and counts.
 *
 * @param {{
 *   newOnKnown: Array<{programId: string, domains: string[], param: string, provider: string}>,
 *   unknownProvider: Array<{provider: string, urlPattern: string, referralMarketing: string[]}>,
 *   alreadyCoveredCount: number
 * }} diffResult - Output from diffMoat()
 * @param {{
 *   fetchedAt: string,
 *   providerCount: number,
 *   paramCount: number
 * }} meta - Injectable metadata (clock, scan counts)
 * @returns {string} Markdown report
 */
export function renderReport(diffResult, meta) {
  const { newOnKnown, unknownProvider, alreadyCoveredCount } = diffResult;

  const header = renderHeader(meta, diffResult);
  const s1 = renderNewOnKnown(newOnKnown);
  const s2 = renderUnknownProvider(unknownProvider);
  const s3 = renderAlreadyCovered(alreadyCoveredCount);

  return header + s1 + s2 + s3;
}
