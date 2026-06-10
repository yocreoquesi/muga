/**
 * MUGA: Unified rules generator
 *
 * Reads TRACKING_PARAMS, TRACKING_PARAM_CATEGORIES, and TRACKING_PREFIXES from
 * src/lib/affiliates-data.js (via affiliates.js re-exports) plus domain-rules.json,
 * path-strip-rules.json, and
 * path-affiliate-rules.json and writes:
 *   - src/rules/rules-manifest.json  — documentation-grade manifest (v2 schema)
 *   - src/rules/tracking-params.json — DNR rule file (Chrome MV3 format)
 *
 * Usage:
 *   node tools/generate-rules.mjs
 *   npm run compile:rules
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import {
  TRACKING_PARAMS,
  TRACKING_PARAM_CATEGORIES,
  TRACKING_PREFIXES,
} from "../src/lib/affiliates.js";
import { DNR_STATIC_RULE_ID } from "../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DOMAIN_RULES_PATH    = resolve(ROOT, "src/rules/domain-rules.json");
const PATH_STRIP_PATH      = resolve(ROOT, "src/rules/path-strip-rules.json");
const PATH_AFFILIATE_PATH  = resolve(ROOT, "src/rules/path-affiliate-rules.json");
const MANIFEST_PATH        = resolve(ROOT, "src/rules/rules-manifest.json");
const DNR_PATH             = resolve(ROOT, "src/rules/tracking-params.json");
// #826: TRACKING_PARAMS/TRACKING_PREFIXES/TRACKING_PARAM_CATEGORIES moved to
// affiliates-data.js. The path below now points at the data module for
// source-text extraction (prefix inline comments). affiliates.js re-exports
// everything so runtime imports are unchanged.
const AFFILIATES_PATH      = resolve(ROOT, "src/lib/affiliates-data.js");

/**
 * Extracts inline `// comment` text next to each entry in the TRACKING_PREFIXES
 * literal in src/lib/affiliates-data.js. Returns a Map<prefix, note>.
 *
 * Build-time only — at runtime the comments are gone, but this is a generator.
 * Matches lines of the form `  "prefix",   // note text` inside the
 * `TRACKING_PREFIXES = [ ... ];` block. Lines without an inline comment yield
 * no entry; an entry without a note is a fatal build error per #642 acceptance.
 *
 * @returns {Map<string,string>}
 */
function extractPrefixNotes() {
  const source = readFileSync(AFFILIATES_PATH, "utf8");
  const blockMatch = source.match(
    /export\s+const\s+TRACKING_PREFIXES\s*=\s*\[([\s\S]*?)\];/
  );
  if (!blockMatch) {
    process.stderr.write(
      "generate-rules.mjs: could not locate TRACKING_PREFIXES block in src/lib/affiliates-data.js — has the literal moved?\n"
    );
    process.exit(1);
  }
  const body = blockMatch[1];
  const notes = new Map();
  // "prefix",  // note text
  const lineRe = /^\s*"([^"]+)"\s*,\s*\/\/\s*(.+?)\s*$/gm;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    notes.set(m[1], m[2]);
  }
  return notes;
}

// Deterministic category priority for tie-break (specificity-first).
const CATEGORY_PRIORITY = ["utm", "ads", "email", "social", "platform_noise", "generic"];

/**
 * Resolves the canonical category for a param using priority order.
 * Emits a warning to stderr when the param appears in multiple categories.
 * Returns null if the param is not covered by any category (fatal caller).
 *
 * @param {string} param
 * @param {object} categoriesMap — TRACKING_PARAM_CATEGORIES
 * @returns {string|null}
 */
function resolveCategory(param, categoriesMap) {
  const hits = CATEGORY_PRIORITY.filter(
    (cat) => categoriesMap[cat]?.params.includes(param)
  );
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    process.stderr.write(
      `warning: "${param}" is in [${hits.join(", ")}]; picking "${hits[0]}"\n`
    );
  }
  return hits[0];
}

/**
 * Convenience: write a fatal error message to stderr and exit non-zero.
 * @param {string} msg
 */
function fatal(msg) {
  process.stderr.write(`generate-rules.mjs: ${msg}\n`);
  process.exit(1);
}

/**
 * Reads and validates src/rules/path-strip-rules.json.
 * Validates: required fields present, arrays equal-length, all regex strings
 * compile without error.  Exits non-zero on any violation.
 *
 * @returns {Array} parsed path-strip rules array
 */
function readAndValidatePathStrip() {
  let rules;
  try {
    rules = JSON.parse(readFileSync(PATH_STRIP_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      process.stderr.write(
        `generate-rules.mjs: path-strip-rules.json not found at ${PATH_STRIP_PATH}\n`
      );
      process.exit(1);
    }
    fatal(`failed to parse path-strip-rules.json: ${err.message}`);
  }
  if (!Array.isArray(rules)) fatal("path-strip-rules.json: root must be an array");
  for (const [i, r] of rules.entries()) {
    if (typeof r.domain !== "string")
      fatal(`path-strip-rules[${i}]: "domain" string required`);
    if (typeof r.domainPattern !== "string")
      fatal(`path-strip-rules[${i}]: "domainPattern" string required`);
    try { new RegExp(r.domainPattern); } catch {
      fatal(`path-strip-rules[${i}].domainPattern is not a valid regex: ${r.domainPattern}`);
    }
    if (!Array.isArray(r.pathPatterns))
      fatal(`path-strip-rules[${i}].pathPatterns must be an array`);
    if (!Array.isArray(r.replacements))
      fatal(`path-strip-rules[${i}].replacements must be an array`);
    if (r.pathPatterns.length !== r.replacements.length)
      fatal(
        `path-strip-rules[${i}]: pathPatterns (${r.pathPatterns.length}) and ` +
        `replacements (${r.replacements.length}) must have the same length`
      );
    for (const [j, p] of r.pathPatterns.entries()) {
      try { new RegExp(p); } catch {
        fatal(`path-strip-rules[${i}].pathPatterns[${j}] is not a valid regex: ${p}`);
      }
    }
  }
  return rules;
}

/**
 * Reads and validates src/rules/path-affiliate-rules.json.
 * Validates: required fields present, all referralPaths strings compile as
 * RegExp, injectPath/Param/Value are strings.  Exits non-zero on any violation.
 *
 * @returns {Array} parsed path-affiliate rules array
 */
function readAndValidatePathAffiliate() {
  let rules;
  try {
    rules = JSON.parse(readFileSync(PATH_AFFILIATE_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      process.stderr.write(
        `generate-rules.mjs: path-affiliate-rules.json not found at ${PATH_AFFILIATE_PATH}\n`
      );
      process.exit(1);
    }
    fatal(`failed to parse path-affiliate-rules.json: ${err.message}`);
  }
  if (!Array.isArray(rules)) fatal("path-affiliate-rules.json: root must be an array");
  for (const [i, r] of rules.entries()) {
    if (typeof r.domain !== "string")
      fatal(`path-affiliate-rules[${i}]: "domain" string required`);
    if (!Array.isArray(r.referralPaths))
      fatal(`path-affiliate-rules[${i}].referralPaths must be an array`);
    for (const [j, p] of r.referralPaths.entries()) {
      try { new RegExp(p); } catch {
        fatal(`path-affiliate-rules[${i}].referralPaths[${j}] is not a valid regex: ${p}`);
      }
    }
    if (typeof r.injectPath !== "string")
      fatal(`path-affiliate-rules[${i}]: "injectPath" string required`);
    if (typeof r.injectParam !== "string")
      fatal(`path-affiliate-rules[${i}]: "injectParam" string required`);
    if (typeof r.injectValue !== "string")
      fatal(`path-affiliate-rules[${i}]: "injectValue" string required`);
  }
  return rules;
}

/**
 * Builds the v2 rules manifest as a plain object.
 * Pure function — reads from module-level imports and disk path constants
 * but performs no file I/O itself.
 *
 * @returns {object} manifest object (not serialised)
 */
export function buildManifest() {
  // Validate all categories have a params array.
  for (const [cat, catData] of Object.entries(TRACKING_PARAM_CATEGORIES)) {
    if (!Array.isArray(catData.params)) {
      process.stderr.write(
        `generate-rules.mjs: TRACKING_PARAM_CATEGORIES.${cat} missing params[]\n`
      );
      process.exit(1);
    }
  }

  // Build preservedOnDomains reverse index: param -> [domain, ...]
  let domainRules;
  try {
    domainRules = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(
      `generate-rules.mjs: failed to parse src/rules/domain-rules.json: ${err.message}\n`
    );
    process.exit(1);
  }

  const preservedOnDomains = new Map(); // param (lowercase) -> Set<domain>
  for (const rule of domainRules) {
    for (const p of rule.preserveParams ?? []) {
      const key = p.toLowerCase();
      if (!preservedOnDomains.has(key)) preservedOnDomains.set(key, new Set());
      preservedOnDomains.get(key).add(rule.domain);
    }
  }

  // Build tracking[] sorted alphabetically by param.
  const uncategorized = [];
  const tracking = [...TRACKING_PARAMS]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((param) => {
      const category = resolveCategory(param, TRACKING_PARAM_CATEGORIES);
      if (category === null) {
        uncategorized.push(param);
        return null;
      }
      const domains = preservedOnDomains.get(param.toLowerCase());
      const entry = { param, category };
      if (domains && domains.size > 0) {
        entry.preservedOnDomains = [...domains].sort();
      }
      return entry;
    })
    .filter(Boolean);

  if (uncategorized.length > 0) {
    process.stderr.write(
      `generate-rules.mjs: uncategorized params (run npm run add-rule or extend TRACKING_PARAM_CATEGORIES): ${uncategorized.join(", ")}\n`
    );
    process.exit(1);
  }

  // Build prefix_rules[] in source order (semantic ordering intentional).
  // Each entry carries the inline comment from src/lib/affiliates-data.js as its
  // `note` field (#642). This is build-time parsing — runtime imports lose
  // comments, but the generator reads the file as text.
  const prefixNotes = extractPrefixNotes();
  const missingNotes = TRACKING_PREFIXES.filter((p) => !prefixNotes.has(p));
  if (missingNotes.length > 0) {
    process.stderr.write(
      `generate-rules.mjs: TRACKING_PREFIXES entries missing inline // note in affiliates-data.js: ${missingNotes.join(", ")}\n` +
      `  Each prefix must have a trailing comment explaining what it tracks. See #642.\n`
    );
    process.exit(1);
  }
  const prefix_rules = TRACKING_PREFIXES.map((prefix) => ({
    prefix,
    note: prefixNotes.get(prefix),
  }));

  // Manifest is byte-deterministic — no timestamps, no SHAs. CI gate (#626)
  // re-runs `compile:rules` and asserts `git diff --exit-code -- src/rules/`
  // is clean. Any volatile field added here would defeat that gate.
  const manifest = {
    manifestVersion: 2,
    version: 2,
    tracking,
    prefix_rules,
    domains: domainRules,
    path_strip_rules:     readAndValidatePathStrip(),
    path_affiliate_rules: readAndValidatePathAffiliate(),
    // path_rules removed — v1 placeholder retired (#625)
  };

  return manifest;
}

/**
 * Builds the DNR rule array (tracking-params.json format).
 * Output uses the same filter logic as the previous DNR generator.
 * Pure function — no file I/O.
 *
 * @returns {Array} DNR rule array
 */
export function buildDnrRules() {
  let domainRules;
  try {
    domainRules = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(
      `generate-rules.mjs: failed to parse src/rules/domain-rules.json: ${err.message}\n`
    );
    process.exit(1);
  }

  const preservedByDomain = new Set();
  for (const rule of domainRules) {
    for (const p of rule.preserveParams ?? []) {
      preservedByDomain.add(p);
    }
  }

  const filtered = TRACKING_PARAMS.filter((p) => !preservedByDomain.has(p));

  const dnrRule = [
    {
      id: DNR_STATIC_RULE_ID,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              removeParams: filtered,
            },
          },
        },
      },
      condition: {
        urlFilter: "*",
        resourceTypes: ["main_frame"],
      },
    },
  ];

  return dnrRule;
}

/**
 * Writes both output files when the script is run directly.
 */
function main() {
  const manifest = buildManifest();
  const dnrRules = buildDnrRules();

  const excluded = TRACKING_PARAMS.length - dnrRules[0].action.redirect.transform.queryTransform.removeParams.length;

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(DNR_PATH, JSON.stringify(dnrRules, null, 2) + "\n", "utf8");

  console.log(
    `Generated rules-manifest.json (${manifest.tracking.length} params, ${manifest.prefix_rules.length} prefixes) and tracking-params.json (${dnrRules[0].action.redirect.transform.queryTransform.removeParams.length} DNR params, ${excluded} excluded)`
  );
}

// Only run main() when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
