/**
 * MUGA — report-formatter.mjs (EPIC C, issue #782, v2.3.0)
 *
 * Pure formatter: quarantine-report.json + promote skips → markdown string.
 * ZERO I/O. Named export only. No default export.
 *
 * Public API:
 *   formatQuarantineReport(reportObj, { promoteSkipped?, topN? }) → string
 *
 * Output sections:
 *   1. Ingest stats  — per-adapter table + merged totals (null-safe)
 *   2. Quarantine    — total count + gate breakdown + top-N params ("+N more")
 *   3. Promote skips — param + reason list ("+N more" when over topN)
 *   4. Auto-merge    — autoMergeCount summary line
 *   5. Scoped facts  — scopedAutoMerge candidates awaiting a MANUAL landing
 *                     (#1239: this summary is their only channel to a human)
 *
 * Size bound: topN cap (default 20) keeps output well under GitHub's ~1 MB
 * step-summary limit even with thousands of quarantine entries.
 */

/**
 * Escapes backticks and pipe characters in an upstream-derived string so it
 * renders safely inside markdown code-spans and table cells.
 *
 * - Backtick (`) → escaped as `` \` `` inside inline code is not possible with
 *   standard markdown, so we replace it with its HTML entity &#96; to prevent
 *   breaking code-span delimiters.
 * - Pipe (|)     → &#124; prevents the character from splitting table cells.
 *
 * @param {string} str  Raw upstream-derived string.
 * @returns {string}    Safe string for use in markdown.
 */
function escMd(str) {
  if (typeof str !== "string") return str;
  return str.replace(/`/g, "&#96;").replace(/\|/g, "&#124;");
}

/**
 * Format a quarantine report into a markdown string suitable for
 * $GITHUB_STEP_SUMMARY or a PR body.
 *
 * @param {object} reportObj         quarantine-report.json shape.
 * @param {object} [opts]
 * @param {Array<{param:string, reason:string}>} [opts.promoteSkipped=[]]
 * @param {number} [opts.topN=20]    Maximum entries to list per section before truncating.
 * @returns {string} Markdown string.
 */
export function formatQuarantineReport(reportObj, { promoteSkipped = [], topN = 20 } = {}) {
  const lines = [];

  lines.push("## Quarantine Review Summary");
  lines.push("");
  lines.push(`_Generated at: ${reportObj.generatedAt ?? "unknown"}_`);
  lines.push("");

  // ── Section 1: Ingest stats ────────────────────────────────────────────────
  lines.push("### Ingest Stats");
  lines.push("");

  const ingestStats = reportObj.ingestStats ?? null;
  if (!ingestStats) {
    lines.push("_(no ingest stats — legacy run)_");
  } else {
    const adapters = Array.isArray(ingestStats.adapters) ? ingestStats.adapters : [];
    const failedAdapters = ingestStats.failedAdapters ?? adapters.filter((a) => a.status === "failed").length;

    // Surface adapter failures prominently so the GitHub step summary makes
    // silent all-zero runs visible (#813).
    if (failedAdapters > 0) {
      lines.push(
        `> **WARNING**: ${failedAdapters} adapter(s) failed — ` +
        (failedAdapters === adapters.length
          ? "ALL adapters failed; this run produced NO candidates."
          : "partial failure; only surviving adapters contributed candidates.")
      );
      lines.push("");
    }

    // Slice 2 (rules-scope-normalization): `scopedAdmitted` is read defensively
    // (?? 0) so an adapter stat recorded before this slice — with no such
    // field at all — still renders instead of showing "undefined".
    lines.push("| Adapter | Status | Admitted | Scoped-Admitted | Skipped | Affiliate-Excluded | Error |");
    lines.push("|---------|--------|----------|------------------|---------|-------------------|-------|");

    for (const a of adapters) {
      const status = a.status === "failed" ? "FAILED" : "ok";
      const errorCell = a.status === "failed" ? escMd(a.error ?? "unknown error") : "";
      lines.push(
        `| ${escMd(a.adapterId ?? "?")} | ${status} | ${a.admitted ?? 0} | ${a.scopedAdmitted ?? 0} | ${a.skipped ?? 0} | ${a.affiliateExcluded ?? 0} | ${errorCell} |`
      );
    }

    lines.push("");
    const merged = ingestStats.merged ?? {};
    lines.push(
      `**Merged**: ${merged.total ?? 0} unique candidates` +
      (merged.emptyDropped ? ` (${merged.emptyDropped} empty dropped)` : "")
    );
  }
  lines.push("");

  // ── Section 2: Quarantine ─────────────────────────────────────────────────
  lines.push("### Quarantine");
  lines.push("");

  const quarantineCount = reportObj.quarantineCount ?? 0;
  lines.push(`**Total quarantined**: ${quarantineCount}`);
  lines.push("");

  const quarantine = Array.isArray(reportObj.quarantine) ? reportObj.quarantine : [];

  if (quarantine.length > 0) {
    // Gate breakdown: count rejections per gate
    const gateCounts = new Map();
    for (const entry of quarantine) {
      const rejections = Array.isArray(entry.rejections) ? entry.rejections : [];
      for (const rej of rejections) {
        const gate = rej.gate ?? "UNKNOWN";
        gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
      }
    }

    if (gateCounts.size > 0) {
      lines.push("**By gate:**");
      for (const [gate, count] of [...gateCounts.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${escMd(gate)}: ${count}`);
      }
      lines.push("");
    }

    // Top-N param listing
    const toShow = quarantine.slice(0, topN);
    const remaining = quarantine.length - toShow.length;

    lines.push("**Top quarantined params:**");
    for (const entry of toShow) {
      const primaryRejection = Array.isArray(entry.rejections) && entry.rejections.length > 0
        ? entry.rejections[0]
        : null;
      const reason = primaryRejection
        ? `${escMd(primaryRejection.gate)}: ${escMd(primaryRejection.reason)}`
        : "unknown";
      lines.push(`- \`${escMd(entry.candidate?.param ?? entry.param)}\` — ${reason}`);
    }

    if (remaining > 0) {
      lines.push(`- _+${remaining} more_`);
    }
  } else {
    lines.push("_No quarantined params this run._");
  }
  lines.push("");

  // ── Section 3: Promote skips ──────────────────────────────────────────────
  lines.push("### Promote Skips");
  lines.push("");

  const skips = Array.isArray(promoteSkipped) ? promoteSkipped : [];
  if (skips.length === 0) {
    lines.push("_No promote skips this run._");
  } else {
    lines.push(`**Total skipped by promote**: ${skips.length}`);
    lines.push("");

    const toShowSkips = skips.slice(0, topN);
    const remainingSkips = skips.length - toShowSkips.length;

    for (const s of toShowSkips) {
      lines.push(`- \`${escMd(s.param)}\` — ${escMd(s.reason)}`);
    }

    if (remainingSkips > 0) {
      lines.push(`- _+${remainingSkips} more_`);
    }
  }
  lines.push("");

  // ── Section 4: Auto-merge count ───────────────────────────────────────────
  lines.push("### Auto-Merge");
  lines.push("");
  lines.push(`**Params promoted this run**: ${reportObj.autoMergeCount ?? 0}`);
  lines.push("");

  // -- Section 5: Scoped facts awaiting a manual landing (#1239) -------------
  // `scopedAutoMerge[]` is the ONLY output of a run that a human is supposed
  // to review before it can reach the store (ADR-0008 Path A), and this
  // summary is the ONLY channel that reaches one: the report file it comes
  // from lives under a gitignored directory and is never uploaded, so it dies
  // with the runner. Rendering a bare count would leave the facts visible but
  // unlandable -- land-scoped.mjs takes a report FILE -- so the candidates are
  // also emitted verbatim, in exactly the shape that tool reads, for a
  // maintainer to copy back out of the PR body.
  const scopedAutoMerge = Array.isArray(reportObj.scopedAutoMerge) ? reportObj.scopedAutoMerge : [];
  const scopedCount = reportObj.scopedAutoMergeCount ?? scopedAutoMerge.length;

  lines.push("### Scoped Facts Awaiting Manual Landing");
  lines.push("");
  lines.push(`**Gate-admitted (param, host) facts this run**: ${scopedCount}`);
  lines.push("");

  if (scopedAutoMerge.length === 0) {
    // Said out loud on purpose: an empty run and a section that stopped
    // rendering must never look the same from the outside (#1239).
    lines.push("_No scoped facts cleared the gates this run - nothing to land._");
  } else {
    lines.push(
      "> **ACTION REQUIRED**: these facts are **not included in this PR**. " +
      "A host-scoped fact never lands automatically (ADR-0008 Path A) - it reaches " +
      "the store only when a maintainer reviews it and runs " +
      "`node tools/rule-ingestion/land-scoped.mjs --report <file>`."
    );
    lines.push("");

    const scopedToShow = scopedAutoMerge.slice(0, topN);
    const scopedRemaining = scopedAutoMerge.length - scopedToShow.length;

    lines.push("| Param | Scope | Signals |");
    lines.push("|-------|-------|---------|");
    for (const c of scopedToShow) {
      const signals = Array.isArray(c?.signals) ? c.signals.map((s) => escMd(String(s))).join(", ") : "";
      lines.push(`| \`${escMd(c?.param ?? "?")}\` | \`${escMd(c?.scope ?? "?")}\` | ${signals} |`);
    }
    lines.push("");

    if (scopedRemaining > 0) {
      lines.push(
        `> **PARTIAL**: ${scopedRemaining} further candidate(s) were admitted and are ` +
        "NOT in the block below. Re-run ingestion locally to obtain the complete " +
        "`quarantine-report.json` before landing."
      );
      lines.push("");
    }

    // Copy-pasteable: save the block as report.json, then
    //   node tools/rule-ingestion/land-scoped.mjs --report report.json
    lines.push("<details><summary>Landing input (copy to a file, pass to <code>--report</code>)</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({ scopedAutoMerge: scopedToShow }, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");

  return lines.join("\n");
}
