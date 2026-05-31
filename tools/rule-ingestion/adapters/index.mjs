/**
 * MUGA rule-ingestion adapter registry (#773, #776).
 *
 * Lists the license-compatible signal sources MUGA ingests, and records the
 * sources DELIBERATELY EXCLUDED so the exclusion is visible in code review, not
 * just in a doc.
 *
 * @typedef {object} Adapter
 * @property {string} id            Stable adapter id (used in candidate.signals).
 * @property {string} name          Human-readable source name.
 * @property {string} license       SPDX-ish license id of the source data.
 * @property {string} url           Source URL.
 * @property {(rawText: string) => Set<string>} parse  Raw → literal param names.
 * @property {(opts?: {fetchImpl?: typeof fetch}) => Promise<string>} fetchRaw
 */

import { adguardTp } from "./adguard-tp.mjs";
import { clearurls } from "./clearurls.mjs";

/**
 * Enabled, license-compatible signal sources.
 * - AdGuard TP: GPL-3.0 (compatible with MUGA's GPL v3) — a large, consolidated,
 *   well-maintained list. First signal source.
 * - ClearURLs: LGPL-3.0 (library copyleft — ships alongside MUGA without
 *   relicensing the extension) — second independent source that makes
 *   cross-source corroboration real. A param appearing in BOTH AdGuard TP AND
 *   ClearURLs accumulates signals.length === 2, passing GATE 2 (corroboration-
 *   gate, #776). Single-source params remain at signals.length === 1 and are
 *   quarantined (recoverable false-positive guard).
 * @type {Adapter[]}
 */
export const ENABLED_ADAPTERS = [adguardTp, clearurls];

/**
 * Sources excluded ON PURPOSE — do NOT add adapters for these.
 *
 * DuckDuckGo (tracker-radar / tracker-blocklists) is licensed CC BY-NC-SA 4.0.
 * The NonCommercial clause forbids use in MUGA, a commercial extension, without
 * a separately negotiated license. Excluding it is a legal requirement, not a
 * preference. Full ledger: tools/rule-ingestion/PROVENANCE.md (#774).
 *
 * @type {Array<{id: string, license: string, reason: string}>}
 */
export const EXCLUDED_SOURCES = [
  {
    id: "duckduckgo",
    license: "CC BY-NC-SA 4.0",
    reason:
      "NonCommercial clause — off-limits for a commercial extension without a negotiated license.",
  },
];
