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
 *   5. Scoped facts  — the (param, host) facts this run landed in the store
 *                     (#1239 surfaced them; #1229 made the landing automatic)
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

  // -- Section 5: the scoped facts this run landed (#1239, #1229) ------------
  // `scopedAutoMerge[]` used to be the one output a person had to act on: the
  // scoped path was deliberately unwired, so these facts reached the store only
  // when a maintainer ran land-scoped.mjs by hand. #1229 wired it, and the
  // workflow now runs land-scoped.mjs before it commits, so by the time anyone
  // reads this summary the facts are already in the diff below it.
  //
  // The section stays, and so does the verbatim block, for two reasons that did
  // NOT go away: the report file is gitignored and never uploaded, so it dies
  // with the runner, and this summary is still the only durable record of what
  // an unattended run decided. It is an audit trail now rather than a to-do
  // list, which is exactly why the wording had to stop saying ACTION REQUIRED
  // (#1263) -- an instruction nobody needs to follow trains a reader to skip
  // the section that says what changed.
  const scopedAutoMerge = Array.isArray(reportObj.scopedAutoMerge) ? reportObj.scopedAutoMerge : [];
  const scopedCount = reportObj.scopedAutoMergeCount ?? scopedAutoMerge.length;

  lines.push("### Host-Scoped Facts Landed This Run");
  lines.push("");
  lines.push(`**Gate-admitted (param, host) facts this run**: ${scopedCount}`);
  lines.push("");

  if (scopedAutoMerge.length === 0) {
    // Said out loud on purpose: an empty run and a section that stopped
    // rendering must never look the same from the outside (#1239).
    lines.push("_No scoped facts cleared the gates this run - nothing landed._");
  } else {
    lines.push(
      "> These facts are **already in this PR**. `land-scoped.mjs` ran earlier in " +
      "this same workflow and wrote them into `tools/rules-source/rules.json`, " +
      "which is committed below (#1229). No one has to land them, and no one " +
      "reviewed them: each was admitted by the gates on its own corroboration, " +
      "at SCOPED_MIN_SIGNALS, because a host-scoped fact's blast radius is one " +
      "site (ADR-0008). Re-landing is a byte-level no-op, so the block below " +
      "reproduces this run rather than instructing a landing."
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
        `> **TRUNCATED**: ${scopedRemaining} further fact(s) landed and are NOT ` +
        "listed below - this section caps its output so the summary stays under " +
        "GitHub's size limit. The complete set is the diff to " +
        "`tools/rules-source/rules.json` in this PR, which is authoritative."
      );
      lines.push("");
    }

    // Kept copy-pasteable: `land-scoped.mjs --report <file>` re-lands this exact
    // block as a byte-level no-op, which makes it a reproducible record of the
    // run rather than a pending action.
    lines.push("<details><summary>What landed (replayable via <code>land-scoped.mjs --report</code>)</summary>");
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
