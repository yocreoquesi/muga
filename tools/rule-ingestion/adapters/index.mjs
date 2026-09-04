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
 * @property {(rawText: string) => { params: Set<string>, skipped?: number, affiliateExcluded?: number, scopedParams?: Array<{param: string, scope: string}> }} parse  Raw → literal param names with exclusion counts. `scopedParams` (Slice 2, rules-scope-normalization) is an OPTIONAL list of host-anchored (param, host) facts; an adapter that omits it emits no scoped facts.
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
 *
 * REGISTRY POLICY — ADAPTER INDEPENDENCE (#821):
 * Each entry in ENABLED_ADAPTERS MUST be independently maintained by a separate
 * team or organisation with its own review and update cadence. Two adapters that
 * consume the same upstream dataset (even via different download URLs or formats)
 * count as ONE effective signal, not two. Adding such a "mirror" adapter would
 * silently corrupt the corroboration guarantee in corroboration-gate.mjs.
 *
 * Before adding a new adapter, verify:
 *   1. The upstream source is maintained independently (separate team, separate
 *      issue tracker, separate review process).
 *   2. The license is compatible with MUGA's GPL v3 (see PROVENANCE.md, #774).
 *   3. The adapter is listed in PROVENANCE.md with license, URL, and rationale.
 *
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
