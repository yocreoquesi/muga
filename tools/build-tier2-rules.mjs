/**
 * MUGA: Offline Consent-O-Matic -> Tier 2 rule transform tool (#1027 Phase 4)
 *
 * A MAINTAINER tool, mirroring `tools/probe-shortener-redirect.mjs` and
 * `tools/probe-cmp-surface.mjs`: NOT shipped with the extension, NOT
 * imported by any `src/` module, and NOT wired into CI. It is the pipeline
 * for FUTURE Tier 2 rule additions -- see `src/lib/cmp-tier2-rules.js`'s
 * docblock for the shipped rule format `{id, present, reject, openSettings}`
 * this tool produces, and `docs/DESIGN-cookie-consent-tier2.md` for why
 * Slice 1 only supports direct single/two-step click rules (no multi-step
 * toggle+save flows -- see the SKIP note in `main()` below).
 *
 * ── The never-accept invariant, enforced at the TOOL boundary too ──────────
 *
 * `reduceTier2Rule` is a pure, HARD FIELD-ALLOWLIST reducer: the output
 * object is built key-by-key from four named output fields (`id`, `present`,
 * `reject`, `openSettings`), each populated by its own narrow extraction
 * helper that reads from exactly one source location. Nothing on the input
 * is ever spread or copied wholesale. Concretely, this reducer NEVER reads:
 *   - `trueAction` (Consent-O-Matic's accept-branch action on a consent
 *     matcher),
 *   - any `DO_CONSENT` toggle/consent matcher (that is the accept-granting
 *     and multi-step-toggle path, not a reject control),
 *   - `SAVE_CONSENT` (persists whatever toggle state is currently set --
 *     not an unambiguous reject action; MUGA's shipped rule format has no
 *     `save` concept at all),
 *   - a generic `acceptSelector`-style field.
 * So even a source file that carries every one of those fields cannot leak
 * a single accept-path token into the emitted rule -- there is no code path
 * that reads them. This mirrors the never-accept-by-construction model
 * documented in `src/lib/cmp-tier2-rules.js`'s own docblock (a rule literally
 * cannot express an accept action, because no field exists to hold one).
 *
 * ── I/O boundary (why importing this module for unit tests is pure) ────────
 *
 * `reduceTier2Rule` and its extraction helpers perform ZERO I/O -- pure
 * functions over a plain object, exhaustively unit-tested in
 * `tests/unit/build-tier2-rules.test.mjs`. All I/O (`readdirSync`,
 * `readFileSync`, `console.log`) lives inside `main()`, which only runs
 * behind the `process.argv[1]` entry-guard at the bottom of this file --
 * the same guard `tools/probe-shortener-redirect.mjs` uses. `main()` never
 * WRITES a file: it only reads the maintainer-supplied Consent-O-Matic rule
 * directory and prints formatted, ready-to-review rule literals to stdout.
 * A maintainer must manually verify each selector on a live page (this tool
 * cannot confirm a selector is a real reject control -- see the existing
 * verification-spike precedent in `src/lib/cmp-tier2-rules.js`'s docblock)
 * and hand-merge the reviewed entry into `src/lib/cmp-tier2-rules.js`. The
 * two existing hand-curated seed rules (`complianz`, `cookie-notice`) are
 * therefore never at risk of being clobbered by running this tool.
 *
 * Run with: node tools/build-tier2-rules.mjs <path-to-consent-o-matic-rules-dir>
 * The Consent-O-Matic repository (cavi-au/Consent-O-Matic, MIT) is NOT
 * vendored into MUGA -- point this at a local checkout's `rules/` directory.
 * See THIRD_PARTY_NOTICES.md for the required attribution.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} SourceDetector
 * @property {{target?: {selector?: string}}} [presentMatcher] Banner-anchor
 *   matcher; only `.target.selector` is read.
 *
 * @typedef {object} SourceMethod
 * @property {string} [name] e.g. "DO_CONSENT" | "SAVE_CONSENT" |
 *   "OPEN_OPTIONS" | "HIDE_CMP". Only a method literally named
 *   `"OPEN_OPTIONS"` is ever read by this reducer.
 * @property {{click?: {selector?: string}}} [action]
 * @property {Array<object>} [consents] Accept/toggle-consent matchers --
 *   NEVER read by this reducer.
 * @property {object} [trueAction] Accept-branch action -- NEVER read.
 *
 * @typedef {object} SourceRule
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [name]
 * @property {Array<SourceDetector>} [detectors]
 * @property {Array<SourceMethod>} [methods]
 * @property {string} [declineSelector] The ONLY field this reducer accepts
 *   as a confirmed direct reject/necessary-only control. A maintainer must
 *   populate this (by hand, from the vetted upstream rule) before running
 *   the tool for a rule to survive with a non-empty `reject`.
 * @property {string} [acceptSelector] Accept-path field -- NEVER read.
 */

/**
 * @param {SourceRule|null|undefined} sourceRule
 * @returns {string}
 */
function extractId(sourceRule) {
  if (typeof sourceRule?.id === "string" && sourceRule.id) return sourceRule.id;
  if (typeof sourceRule?.slug === "string" && sourceRule.slug) return sourceRule.slug;
  if (typeof sourceRule?.name === "string" && sourceRule.name) {
    return sourceRule.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  return "";
}

/**
 * Reads ONLY `detectors[].presentMatcher.target.selector`. This is the
 * banner-anchor / presence signal, symmetric with MUGA's `present` field --
 * it carries no accept/reject semantics of its own.
 *
 * @param {SourceRule|null|undefined} sourceRule
 * @returns {string[]}
 */
function extractPresentSelectors(sourceRule) {
  const detectors = Array.isArray(sourceRule?.detectors) ? sourceRule.detectors : [];
  const out = [];
  for (const d of detectors) {
    const selector = d?.presentMatcher?.target?.selector;
    if (typeof selector === "string" && selector) out.push(selector);
  }
  return out;
}

/**
 * Reads ONLY the top-level `declineSelector` string -- the single field this
 * reducer treats as a maintainer-vetted, confirmed direct reject control.
 * Deliberately does NOT read `methods[].name === "DO_CONSENT"` /
 * `"SAVE_CONSENT"`, any `trueAction`/`consents`/toggle field, or a generic
 * `acceptSelector` -- those are accept-path or multi-step-toggle concepts
 * this reducer must never surface into MUGA's reject-only, single/two-step
 * click schema (see the file docblock).
 *
 * @param {SourceRule|null|undefined} sourceRule
 * @returns {string[]}
 */
function extractRejectSelectors(sourceRule) {
  const selector = sourceRule?.declineSelector;
  return typeof selector === "string" && selector ? [selector] : [];
}

/**
 * Reads ONLY `methods[]` entries whose `name` is literally `"OPEN_OPTIONS"`,
 * extracting `.action.click.selector`. Never reads `DO_CONSENT`,
 * `SAVE_CONSENT`, or `trueAction` -- those never populate `openSettings`.
 *
 * @param {SourceRule|null|undefined} sourceRule
 * @returns {string[]}
 */
function extractOpenSettingsSelectors(sourceRule) {
  const methods = Array.isArray(sourceRule?.methods) ? sourceRule.methods : [];
  const out = [];
  for (const m of methods) {
    if (m?.name !== "OPEN_OPTIONS") continue;
    const selector = m?.action?.click?.selector;
    if (typeof selector === "string" && selector) out.push(selector);
  }
  return out;
}

/**
 * Pure reducer: transforms one raw Consent-O-Matic-shaped source rule into
 * MUGA's Tier 2 reject-only rule shape. See the file docblock for the
 * HARD FIELD-ALLOWLIST guarantee this function provides. Never throws --
 * garbage/`null`/`undefined` input produces the allowlisted shape with
 * empty arrays and an empty `id`.
 *
 * @param {SourceRule|null|undefined} sourceRule
 * @returns {{id: string, present: ReadonlyArray<string>, reject: ReadonlyArray<string>, openSettings: ReadonlyArray<string>}}
 */
export function reduceTier2Rule(sourceRule) {
  return Object.freeze({
    id: extractId(sourceRule),
    present: Object.freeze(extractPresentSelectors(sourceRule)),
    reject: Object.freeze(extractRejectSelectors(sourceRule)),
    openSettings: Object.freeze(extractOpenSettingsSelectors(sourceRule)),
  });
}

/**
 * Formats a reduced Tier 2 rule as a ready-to-review JS literal matching
 * `src/lib/cmp-tier2-rules.js`'s existing `Object.freeze({...})` entry
 * shape, so a maintainer can visually diff and hand-paste it in.
 *
 * @param {{id: string, present: ReadonlyArray<string>, reject: ReadonlyArray<string>, openSettings: ReadonlyArray<string>}} rule
 * @returns {string}
 */
export function formatRuleForReview(rule) {
  return [
    "  Object.freeze({",
    `    id: ${JSON.stringify(rule.id)},`,
    `    present: Object.freeze(${JSON.stringify(rule.present)}),`,
    `    reject: Object.freeze(${JSON.stringify(rule.reject)}),`,
    `    openSettings: Object.freeze(${JSON.stringify(rule.openSettings)}),`,
    "  }),",
  ].join("\n");
}

/**
 * Reads every `*.json` file in the given directory, reduces each through
 * `reduceTier2Rule`, and prints a maintainer-review report to stdout. Never
 * writes a file -- see the file docblock's I/O boundary section.
 *
 * @param {string} rulesDir
 */
function main(rulesDir = process.argv[2]) {
  if (!rulesDir) {
    console.error("[muga] build-tier2-rules — maintainer transform tool (#1027 Phase 4)\n");
    console.error("Usage: node tools/build-tier2-rules.mjs <path-to-consent-o-matic-rules-dir>");
    console.error(
      "  Point this at a local checkout of cavi-au/Consent-O-Matic's rules/ directory " +
        "(NOT vendored into MUGA). This tool reads that directory only -- it never writes " +
        "any file. See THIRD_PARTY_NOTICES.md for the required attribution."
    );
    process.exitCode = 1;
    return;
  }

  let files;
  try {
    files = readdirSync(rulesDir).filter((f) => extname(f) === ".json");
  } catch (err) {
    console.error(`[muga] build-tier2-rules: could not read "${rulesDir}": ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("[muga] build-tier2-rules — maintainer transform tool (#1027 Phase 4)\n");
  console.log(`Read ${files.length} candidate rule file(s) from ${rulesDir}\n`);
  console.log(
    "Review each entry below, VERIFY the selectors on a live page (this tool cannot confirm a\n" +
      "selector is a real reject control -- see src/lib/cmp-tier2-rules.js's verification-spike\n" +
      "precedent), then hand-merge into src/lib/cmp-tier2-rules.js. This tool never writes any file.\n"
  );

  let emitted = 0;
  for (const file of files) {
    let sourceRule;
    try {
      sourceRule = JSON.parse(readFileSync(join(rulesDir, file), "utf8"));
    } catch (err) {
      console.log(`  SKIP ${file}: not valid JSON (${err.message})`);
      continue;
    }

    const rule = reduceTier2Rule(sourceRule);
    if (!rule.reject.length) {
      // Most Consent-O-Matic rules express reject via a multi-step
      // DO_CONSENT-toggle-off + SAVE_CONSENT flow, which MUGA's shipped
      // rule format does not model (see docs/DESIGN-cookie-consent-tier2.md
      // §6 -- multi-step save flows are explicitly out of scope). Only
      // rules with a maintainer-curated `declineSelector` (a confirmed
      // direct reject control) survive this tool; everything else is
      // honestly reported as skipped rather than silently guessed at.
      console.log(
        `  SKIP ${file}: no vetted "declineSelector" direct-reject field found (this tool only ` +
          "derives single/two-step click rules; multi-step toggle+save CMPs are out of scope for " +
          "MUGA's shipped rule format)."
      );
      continue;
    }

    console.log(`// ---- ${file} ----`);
    console.log(formatRuleForReview(rule));
    console.log("");
    emitted += 1;
  }

  console.log(`Done. ${emitted}/${files.length} file(s) produced a reviewable rule.`);
}

// Only run the filesystem-reading/stdout main() when invoked directly, so
// the pure reducer can be imported by unit tests without touching the
// filesystem (mirrors tools/probe-shortener-redirect.mjs's entry-guard).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
