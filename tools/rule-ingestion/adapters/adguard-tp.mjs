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
   *
   * Forwards the host-anchored `(param, host)` pairs from
   * `parseRemoveparamRules` as `scopedParams` (Slice 2, rules-scope-
   * normalization) — additive alongside `params`, never a replacement (see
   * `parseRemoveparamRules` docblock for the full extraction contract).
   *
   * @param {string} rawText Raw filter-list contents.
   * @returns {{ params: Set<string>, skipped: number, affiliateExcluded: number, scopedParams: Array<{param: string, scope: string}> }}
   */
  parse(rawText) {
    const { params, skipped, scoped } = parseRemoveparamRules(rawText);
    return { params, skipped, affiliateExcluded: 0, scopedParams: scoped };
  },

  /**
   * Fetch the raw filter list. Returns the raw text so the caller can quarantine
   * it before parsing (raw bytes are ephemeral — never committed/bundled).
   *
   * A 30-second AbortController timeout is applied by default to prevent a
   * hung connection from blocking the CI run until the 6h Actions limit
   * (#813). Override via timeoutMs for tests (use a short value like 50ms).
   *
   * On abort, throws: `ADAPTER_TIMEOUT: adguard-tp after <ms>ms`
   *
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetchImpl] Injectable fetch for testing.
   * @param {number} [opts.timeoutMs=30000] Abort timeout in ms. Injectable for tests.
   * @returns {Promise<string>}
   */
  async fetchRaw({ fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
    const controller = new AbortController();

    // Race the fetch against an explicit timeout promise so that hung
    // connections — including test fakes that ignore the abort signal —
    // are forcibly cut off after timeoutMs (#813).
    let timer;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(`ADAPTER_TIMEOUT: adguard-tp after ${timeoutMs}ms`);
        err.name = "AdapterTimeoutError";
        reject(err);
      }, timeoutMs);
    });

    try {
      const res = await Promise.race([
        fetchImpl(SOURCE_URL, {
          headers: { "User-Agent": USER_AGENT },
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      if (!res.ok) {
        throw new Error(
          `AdGuard TP fetch failed: ${res.status} ${res.statusText}`,
        );
      }
      return res.text();
    } catch (err) {
      // Re-throw timeout errors and AbortErrors with the canonical ADAPTER_TIMEOUT message.
      if (err.name === "AdapterTimeoutError" || err.name === "AbortError" || controller.signal.aborted) {
        const timeoutErr = new Error(`ADAPTER_TIMEOUT: adguard-tp after ${timeoutMs}ms`);
        timeoutErr.name = "AdapterTimeoutError";
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
};
