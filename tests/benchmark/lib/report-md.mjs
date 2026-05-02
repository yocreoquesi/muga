/**
 * MUGA: Benchmark Markdown report writer — A6 phase 3a (#507).
 *
 * Pure function: takes the report object produced by buildReport()
 * and returns a Markdown string. No I/O — the runner script does the
 * file write. The HTML writer (phase 3b) and CI workflow (phase 3c)
 * land in separate slices.
 *
 * Layout:
 *   # MUGA Benchmark Report
 *   <metadata: generatedAt, runner, totalEntries>
 *   ## Overall coverage
 *   <table: matched / mismatched / matchRate>
 *   ## By category
 *   <table: total / matched / mismatched / matchRate per category>
 *   ## By competitor   (only when byCompetitor is present)
 *   <table: total / withExpectedClean / matchedExpectedClean /
 *           changedFromInput / matchRate per adapter>
 *   ## Mismatches      (only when mismatches.length > 0)
 *   <list: per-URL diff>
 */

/**
 * Escape a value for use as a Markdown table cell. The pipe character
 * needs HTML-entity escaping; backticks confuse the eye but parse fine.
 */
function cell(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Render a table from a header row + an array of value rows. Returns the
 * Markdown lines as a single string with a trailing newline.
 */
function table(header, rows) {
  if (rows.length === 0) return "";
  const head = `| ${header.map(cell).join(" | ")} |`;
  const sep = `| ${header.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

/**
 * Build the full Markdown report. Output is deterministic given the
 * same input — no Date.now() inside; the report's generatedAt is used
 * verbatim so a regression test can assert on the exact string.
 *
 * @param {{generatedAt:string, runner:string, totalEntries:number, matched:number, mismatched:number, matchRate:number, byCategory: Record<string,{total:number,matched:number,mismatched:number,matchRate:number}>, byCompetitor?: Record<string,{total:number,withExpectedClean:number,changedFromInput:number,matchedExpectedClean:number,matchRate:number}>, mismatches: Array<{url:string,category:string,expected:object,actual:object,diff:string}>}} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const lines = [];

  lines.push(`# MUGA Benchmark Report`);
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Runner:** ${report.runner}`);
  lines.push(`- **Corpus size:** ${report.totalEntries} entries`);
  lines.push("");

  lines.push(`## Overall coverage`);
  lines.push("");
  lines.push(
    table(
      ["Matched", "Mismatched", "Match rate"],
      [[report.matched, report.mismatched, `${report.matchRate}%`]],
    ).trimEnd(),
  );
  lines.push("");

  lines.push(`## By category`);
  lines.push("");
  const categoryRows = Object.entries(report.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, b]) => [name, b.total, b.matched, b.mismatched, `${b.matchRate}%`]);
  lines.push(
    table(["Category", "Total", "Matched", "Mismatched", "Match rate"], categoryRows).trimEnd(),
  );
  lines.push("");

  if (report.byCompetitor && Object.keys(report.byCompetitor).length > 0) {
    lines.push(`## By competitor`);
    lines.push("");
    lines.push(
      `_matchRate = matchedExpectedClean / withExpectedClean × 100. Entries without \`expectedClean\` are unscoreable and excluded from the denominator._`,
    );
    lines.push("");
    const competitorRows = Object.entries(report.byCompetitor)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, b]) => [
        name,
        b.total,
        b.withExpectedClean,
        b.matchedExpectedClean,
        b.changedFromInput,
        `${b.matchRate}%`,
      ]);
    lines.push(
      table(
        ["Adapter", "Total", "Scoreable", "Matched", "Changed", "Match rate"],
        competitorRows,
      ).trimEnd(),
    );
    lines.push("");
  }

  if (report.mismatches.length > 0) {
    lines.push(`## Mismatches (${report.mismatches.length})`);
    lines.push("");
    for (const m of report.mismatches) {
      lines.push(`- **[${m.category}]** \`${m.url}\``);
      lines.push(`  - ${m.diff}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
