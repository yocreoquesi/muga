/**
 * MUGA — Domain-stats view-model (#1350, ADR-0011 Decision 3).
 *
 * Pure sort/slice/shape logic for the per-domain tracker-stats table.
 * Previously inlined inside the popup's `showDomainStats` (popup.js:920-966,
 * now removed); moved to Settings' Activity section as part of ADR-0011,
 * which classifies the table as "a ranked table answering 'where does the
 * noise come from over time' ... a question about history, asked
 * deliberately" rather than a popup glance.
 *
 * Why a separate module from the options glue: options.js/popup.js are
 * browser-only and cannot be exercised under node:test, so this branching
 * lived untested. Extracting it here mirrors the precedent set by
 * remote-rules-changelog-view.js and attribution-ledger-view.js.
 *
 * @param {Record<string, {params?: number, urls?: number}>|null|undefined} allStats
 *   The raw `domainStats` map from chrome.storage.local (see getDomainStats
 *   in storage.js). Per-domain entries are defensively validated: a
 *   malformed entry (null, non-object) is skipped rather than throwing.
 * @param {{limit?: number}} [options]
 * @returns {{empty: boolean, entries: Array<{domain: string, params: number, urls: number}>}}
 */
export function planDomainStatsView(allStats, { limit = 10 } = {}) {
  const stats = allStats && typeof allStats === "object" ? allStats : {};

  const entries = Object.entries(stats)
    .filter(([, data]) => data && typeof data === "object")
    .map(([domain, data]) => ({
      domain,
      params: typeof data.params === "number" ? data.params : 0,
      urls: typeof data.urls === "number" ? data.urls : 0,
    }))
    .sort((a, b) => b.params - a.params)
    .slice(0, limit);

  return { empty: entries.length === 0, entries };
}
