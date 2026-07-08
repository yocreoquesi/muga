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
