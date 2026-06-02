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
 *
 * Size bound: topN cap (default 20) keeps output well under GitHub's ~1 MB
 * step-summary limit even with thousands of quarantine entries.
 */

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
    lines.push("| Adapter | Admitted | Skipped | Affiliate-Excluded |");
    lines.push("|---------|----------|---------|-------------------|");

    const adapters = Array.isArray(ingestStats.adapters) ? ingestStats.adapters : [];
    for (const a of adapters) {
      lines.push(
        `| ${a.adapterId ?? "?"} | ${a.admitted ?? 0} | ${a.skipped ?? 0} | ${a.affiliateExcluded ?? 0} |`
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
        lines.push(`- ${gate}: ${count}`);
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
      const reason = primaryRejection ? `${primaryRejection.gate}: ${primaryRejection.reason}` : "unknown";
      lines.push(`- \`${entry.candidate?.param ?? entry.param}\` — ${reason}`);
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
      lines.push(`- \`${s.param}\` — ${s.reason}`);
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

  return lines.join("\n");
}
