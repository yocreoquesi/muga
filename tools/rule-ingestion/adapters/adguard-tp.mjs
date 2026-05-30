/**
 * MUGA rule-ingestion adapter: AdGuard URL Tracking Protection (Filter 17) (#773).
 *
 * License: GPL-3.0 (strong copyleft, compatible with MUGA's GPL v3).
 * Used as a SIGNAL only — we extract individual param-name facts (not the
 * curated compilation) and re-derive independently. See PROVENANCE.md (#774).
 *
 * Reuses `parseRemoveparamRules` from tools/import-upstream.mjs rather than
 * duplicating the Adblock-Plus $removeparam parser — one parser, one place.
 */

import { parseRemoveparamRules } from "../../import-upstream.mjs";

// Filter 17 = AdGuard URL Tracking Protection. The `safari` platform path was
// deprecated (404s); `chromium` serves the same list and is what we use here.
const SOURCE_URL =
  "https://filters.adtidy.org/extension/chromium/filters/17.txt";

const USER_AGENT =
  "muga-rule-ingestion/1.0 (+https://github.com/yocreoquesi/muga)";

/** @type {import("./index.mjs").Adapter} */
export const adguardTp = {
  id: "adguard-tp",
  name: "AdGuard URL Tracking Protection (Filter 17)",
  license: "GPL-3.0",
  url: SOURCE_URL,

  /**
   * Extract literal tracking param names from an AdGuard filter list.
   * @param {string} rawText Raw filter-list contents.
   * @returns {Set<string>} Lowercased param names.
   */
  parse(rawText) {
    return parseRemoveparamRules(rawText);
  },

  /**
   * Fetch the raw filter list. Returns the raw text so the caller can quarantine
   * it before parsing (raw bytes are ephemeral — never committed/bundled).
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetchImpl] Injectable fetch for testing.
   * @returns {Promise<string>}
   */
  async fetchRaw({ fetchImpl = fetch } = {}) {
    const res = await fetchImpl(SOURCE_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(
        `AdGuard TP fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.text();
  },
};
