/**
 * MUGA — Suspicious-params Settings view-model (#1351, ADR-0011 Decision 3).
 *
 * Pure row-shaping logic for the FREQUENCY subgroup of the popup's old
 * "Suspicious params" section (cross-site frequency flags, B16/#446).
 * Previously inlined inside the popup's `showSuspiciousParams`
 * (popup.js:983-1397, now entropy-only); moved to Settings' Activity
 * section per the 2026-09-24 maintainer decision on #1351: the ENTROPY
 * subgroup stays in the popup as read-only current-page information (it has
 * no equivalent "current page" once opened from Settings), while the
 * FREQUENCY subgroup — storage-backed, no page dependency — and every
 * action that writes `userCustomRules` (the global strip rule) move here.
 *
 * Why a separate module from the options glue: options.js/popup.js are
 * browser-only and cannot be exercised under node:test, so this branching
 * lived untested. Extracting it here mirrors the precedent set by
 * domain-stats-view.js, remote-rules-changelog-view.js and
 * attribution-ledger-view.js.
 *
 * @param {object} [input]
 * @param {Array<{param?: string, domains?: number, values?: number}>} [input.frequencyFlags]
 *   Raw output of the cross-site-frequency tracker's `getFlagged()`.
 * @param {string[]} [input.userCustomRules]
 *   Current `prefs.userCustomRules` — used to derive `isPromoted` so the
 *   "Strip everywhere" action can render its idempotent done state.
 * @param {Record<string, string>} [input.submittedParams]
 *   `chrome.storage.local.submittedParams` map ({ [param]: "YYYY-MM-DD" })
 *   — used to derive `reportedDate` so "Report upstream" can render its
 *   idempotent "already reported" state.
 * @returns {{empty: boolean, rows: Array<{param: string, domains: number, values: number, isPromoted: boolean, reportedDate: string|null}>}}
 */
export function planSuspiciousParamsSettingsView(input) {
  const { frequencyFlags, userCustomRules, submittedParams } = input && typeof input === "object" ? input : {};
  const flags = Array.isArray(frequencyFlags) ? frequencyFlags : [];

  const promotedLower = new Set(
    (Array.isArray(userCustomRules) ? userCustomRules : [])
      .filter((p) => typeof p === "string")
      .map((p) => p.toLowerCase()),
  );

  const submitted = submittedParams && typeof submittedParams === "object" ? submittedParams : {};

  const rows = flags
    .filter((flag) => flag && typeof flag === "object" && typeof flag.param === "string")
    .map((flag) => ({
      param: flag.param,
      domains: typeof flag.domains === "number" ? flag.domains : 0,
      values: typeof flag.values === "number" ? flag.values : 0,
      isPromoted: promotedLower.has(flag.param.toLowerCase()),
      reportedDate: typeof submitted[flag.param] === "string" ? submitted[flag.param] : null,
    }));

  return { empty: rows.length === 0, rows };
}
