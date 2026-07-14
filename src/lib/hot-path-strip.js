/**
 * MUGA: Hot-path STRIP table — single source of truth (#1005)
 *
 * The hot-path UTM/click-id strip subset used by the five synchronous
 * content scripts (they can't import ES modules — see below) was hand-copied
 * byte-for-byte into each file:
 *
 *   - src/content/dom-link-rewriter.js
 *   - src/content/dom-link-rewriter-click.js
 *   - src/content/history-defuser-mainworld.js
 *   - src/content/window-name-defuser-mainworld.js
 *   - src/content/window-name-defuser.js
 *
 * strip-table-parity.test.mjs (#723) pins that the five copies stay
 * byte-identical, but nothing generated them — a new tracker meant editing
 * five files in lockstep by hand. This module is now the single source of
 * truth for that subset. Regenerate the five copies with:
 *
 *   npm run build:strip
 *
 * `npm run check:strip` (tools/generate-strip-table.mjs --check) is the CI
 * drift guard: it fails if any of the five files' STRIP block no longer
 * matches what this module would generate.
 *
 * Why codegen (inject the literal) instead of a shared import: content
 * scripts can't import ES modules cross-browser — Chrome MV3 main-world
 * scripts and Firefox MV2 page-world wraps are both loaded as classic
 * scripts, not modules. So the literal itself must live in each file; this
 * module + the codegen tool remove the hand-copying, not the duplication.
 *
 * HOT_PATH_STRIP_ROWS preserves the historical grouping (one array per
 * source-code row) so the generated object literal's line breaks match the
 * hand-written original exactly, keeping the diff introducing this file
 * a no-op inside the STRIP braces (only a generated-marker comment is added).
 */

/** @type {ReadonlyArray<ReadonlyArray<string>>} */
export const HOT_PATH_STRIP_ROWS = Object.freeze([
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"],
  ["utm_source_platform", "utm_creative_format", "utm_marketing_tactic"],
  ["fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "tclid", "twclid"],
  ["mc_cid", "mc_eid", "igshid", "igsh"],
  ["_hsenc", "_hsmi", "mkt_tok"],
  ["yclid", "ysclid", "_openstat"],
  ["irclickid", "cjevent", "awc"],
  ["ttclid", "sccid", "rdt_cid"],
  ["_branch_match_id", "_branch_referrer"],
  ["pk_campaign", "pk_kwd", "pk_source", "pk_medium"],
  ["mtm_campaign", "mtm_source", "mtm_medium", "mtm_content"],
  ["hsctatracking"],
  ["__s", "_ga", "_gl", "_gac"],
  ["ved", "ei", "sca_esv", "sxsrf"],
  ["mibextid", "share_id"],
  ["_pos", "_ss", "_psq", "_sid", "_fid"],
  ["pr_prod_strat", "pr_rec_id", "pr_ref_pid", "pr_rec_pid", "pr_seq"],
].map((row) => Object.freeze(row)));

/**
 * Every hot-path STRIP param name, flattened. Order-preserving (first
 * occurrence wins on duplicates, though HOT_PATH_STRIP_ROWS must not
 * contain any — see strip-table-generated.test.mjs).
 * @type {ReadonlySet<string>}
 */
export const HOT_PATH_STRIP = Object.freeze(
  new Set(HOT_PATH_STRIP_ROWS.flat())
);

/**
 * Surgically removes the hot-path tracking params from a URL's query string
 * WITHOUT re-serializing the surviving params.
 *
 * The five synchronous content-script copies historically parsed with
 * `new URL()` and rebuilt the query via `URLSearchParams.toString()`. That
 * re-encodes EVERY surviving param, not just the stripped ones: a space that
 * arrived as `%20` comes back as `+`, and `!()~*` get percent-encoded. When a
 * non-tracking param carries a signature/HMAC/JWT computed over exact bytes,
 * stripping a neighbouring `utm_*` silently invalidated it. (audit-2026-07 S3)
 *
 * This operates on the RAW query bytes: it splits on `&`, drops only the pairs
 * whose (decoded) key is in the strip set, and rejoins the survivors verbatim.
 * Non-query parts (scheme, host, path, fragment) are preserved byte-for-byte,
 * so the result keeps the caller's exact shape (absolute stays absolute,
 * relative stays relative) — no normalization, minimal mutation.
 *
 * @param {string} rawUrl - The URL string (absolute or relative).
 * @param {ReadonlySet<string>|Record<string,unknown>} [strip=HOT_PATH_STRIP]
 *        The strip set (or a plain object used as a lookup table, matching the
 *        `const STRIP = { name: 1 }` shape the content scripts inline).
 * @returns {string} The cleaned URL, or the original string when nothing
 *        changed, the input is not a string, or it has no query.
 */
export function stripHotPathQuery(rawUrl, strip = HOT_PATH_STRIP) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
  const qIndex = rawUrl.indexOf("?");
  if (qIndex < 0) return rawUrl;

  const has = strip instanceof Set
    ? (k) => strip.has(k)
    : (k) => Object.prototype.hasOwnProperty.call(strip, k);

  // Fragment starts at the first '#' AFTER the query marker; a '#' before '?'
  // cannot exist here (the query marker is the first '?').
  const hashIndex = rawUrl.indexOf("#", qIndex);
  const prefix = rawUrl.slice(0, qIndex);
  const query = hashIndex < 0 ? rawUrl.slice(qIndex + 1) : rawUrl.slice(qIndex + 1, hashIndex);
  const hash = hashIndex < 0 ? "" : rawUrl.slice(hashIndex);

  let changed = false;
  const kept = [];
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    let key = rawKey;
    try { key = decodeURIComponent(rawKey); } catch { /* malformed %-escape: match on raw bytes */ }
    if (has(key)) { changed = true; continue; }
    kept.push(pair);
  }

  if (!changed) return rawUrl;
  const newQuery = kept.join("&");
  return newQuery ? `${prefix}?${newQuery}${hash}` : `${prefix}${hash}`;
}
