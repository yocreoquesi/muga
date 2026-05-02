/**
 * MUGA: Benchmark HTML report writer — A6 phase 3b (#507).
 *
 * Pure function: takes the report object produced by buildReport()
 * and returns a self-contained HTML string. No external CSS, no
 * external JS, no external assets — the file works offline from any
 * browser. CSS is inlined; dark-mode friendly via prefers-color-scheme.
 *
 * Layout mirrors the Markdown writer (phase 3a / PR #525):
 *   <h1> + metadata
 *   "Overall coverage" table
 *   "By category" table (sorted alphabetically)
 *   "By competitor" table (only when byCompetitor non-empty)
 *   "Mismatches" details/summary (only when mismatches.length > 0)
 *
 * The runner script does the file write — this module is I/O-free.
 */

/**
 * Escape a value for safe HTML text content. Handles all five
 * canonical XML special characters. Returns "" for null/undefined.
 */
function esc(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a `<table>` element from a header row + array of value rows.
 * Empty rows array returns "" (no orphan empty tables).
 */
function table(headers, rows) {
  if (rows.length === 0) return "";
  const head = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

/**
 * Inlined stylesheet. Minimal, readable, dark-mode friendly. Tables
 * have alternating row backgrounds for skim-ability.
 */
const STYLE = `
:root {
  color-scheme: light dark;
  --fg: #111;
  --bg: #fff;
  --muted: #555;
  --border: #ddd;
  --row-alt: #f6f8fa;
  --accent: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6edf3;
    --bg: #0d1117;
    --muted: #8b949e;
    --border: #30363d;
    --row-alt: #161b22;
    --accent: #58a6ff;
  }
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
  max-width: 960px;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.5;
}
h1 { margin-top: 0; }
h2 { margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: .25rem; }
.meta { color: var(--muted); font-size: .9em; }
.meta span + span::before { content: " · "; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
  font-size: .95em;
}
th, td {
  text-align: left;
  padding: .4rem .6rem;
  border-bottom: 1px solid var(--border);
}
th { font-weight: 600; }
tbody tr:nth-child(even) { background: var(--row-alt); }
.note { color: var(--muted); font-size: .9em; font-style: italic; }
details { margin-top: 1rem; }
summary { cursor: pointer; font-weight: 600; }
.mismatch { border-left: 3px solid var(--accent); padding: .25rem .75rem; margin: .5rem 0; background: var(--row-alt); }
.mismatch code { background: transparent; }
code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: .9em;
  background: var(--row-alt);
  padding: .1em .35em;
  border-radius: 3px;
}
`;

/**
 * Build the full HTML report. Output is deterministic given the same
 * input — no Date.now() inside, no Math.random(). The report's
 * generatedAt is used verbatim so a regression test can assert on
 * the exact output.
 *
 * @param {{generatedAt:string, runner:string, totalEntries:number, matched:number, mismatched:number, matchRate:number, byCategory: Record<string,{total:number,matched:number,mismatched:number,matchRate:number}>, byCompetitor?: Record<string,{total:number,withExpectedClean:number,changedFromInput:number,matchedExpectedClean:number,matchRate:number}>, mismatches: Array<{url:string,category:string,expected:object,actual:object,diff:string}>}} report
 * @returns {string}
 */
export function renderHtml(report) {
  const sections = [];

  sections.push(`<h1>MUGA Benchmark Report</h1>`);
  sections.push(
    `<p class="meta">` +
      `<span>Generated: ${esc(report.generatedAt)}</span>` +
      `<span>Runner: ${esc(report.runner)}</span>` +
      `<span>Corpus: ${esc(report.totalEntries)} entries</span>` +
      `</p>`,
  );

  sections.push(`<h2>Overall coverage</h2>`);
  sections.push(
    table(
      ["Matched", "Mismatched", "Match rate"],
      [[report.matched, report.mismatched, `${report.matchRate}%`]],
    ),
  );

  sections.push(`<h2>By category</h2>`);
  const catRows = Object.entries(report.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, b]) => [name, b.total, b.matched, b.mismatched, `${b.matchRate}%`]);
  sections.push(
    table(["Category", "Total", "Matched", "Mismatched", "Match rate"], catRows),
  );

  if (report.byCompetitor && Object.keys(report.byCompetitor).length > 0) {
    sections.push(`<h2>By competitor</h2>`);
    sections.push(
      `<p class="note">matchRate = matchedExpectedClean / withExpectedClean × 100. Entries without <code>expectedClean</code> are unscoreable and excluded from the denominator.</p>`,
    );
    const compRows = Object.entries(report.byCompetitor)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, b]) => [
        name,
        b.total,
        b.withExpectedClean,
        b.matchedExpectedClean,
        b.changedFromInput,
        `${b.matchRate}%`,
      ]);
    sections.push(
      table(
        ["Adapter", "Total", "Scoreable", "Matched", "Changed", "Match rate"],
        compRows,
      ),
    );
  }

  if (report.mismatches.length > 0) {
    sections.push(
      `<details open><summary>Mismatches (${report.mismatches.length})</summary>`,
    );
    for (const m of report.mismatches) {
      sections.push(
        `<div class="mismatch">` +
          `<div><strong>[${esc(m.category)}]</strong> <code>${esc(m.url)}</code></div>` +
          `<div>${esc(m.diff)}</div>` +
          `</div>`,
      );
    }
    sections.push(`</details>`);
  }

  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>MUGA Benchmark Report — ${esc(report.generatedAt)}</title>`,
    `<style>${STYLE}</style>`,
    `</head>`,
    `<body>`,
    sections.join("\n"),
    `</body>`,
    `</html>`,
    "",
  ].join("\n");
}
