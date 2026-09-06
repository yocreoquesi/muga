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
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../src/lib/remote-rules.js";
import {
  DNR_STATIC_RULE_ID,
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
  DNR_SIGNED_URL_ALLOW_RULE_ID,
  DNR_SIGNED_URL_ALLOW_PRIORITY,
} from "../src/lib/dnr-ids.js";
import { SIGNED_URL_REGEX_FILTER } from "../src/lib/signed-url.js";

/** Amazon marketplace hosts we scope the internal-nav strip rule to. */
const AMAZON_HOST_RE = /(^|\.)amazon\./;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DOMAIN_RULES_PATH    = resolve(ROOT, "src/rules/domain-rules.json");
const PATH_STRIP_PATH      = resolve(ROOT, "src/rules/path-strip-rules.json");
const PATH_AFFILIATE_PATH  = resolve(ROOT, "src/rules/path-affiliate-rules.json");
const MANIFEST_PATH        = resolve(ROOT, "src/rules/rules-manifest.json");
const DNR_PATH             = resolve(ROOT, "src/rules/tracking-params.json");
// #1221: derived guard set — the union of every domain entry's preserveParams,
// lowercased. Generated (never hand-edited) so the signing tool and the runtime
// check the SAME set the extension actually ships, and so the existing
// `compile:rules` + `git diff --exit-code -- src/rules/` gate keeps it fresh.
const PRESERVE_PARAMS_PATH = resolve(ROOT, "src/rules/preserve-params.data.js");
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
 * RegExp. Exits non-zero on any violation.
 *
 * drop-affiliate-injection (PR 1a): injectPath/injectParam/injectValue are
 * NO LONGER required (or read) — MUGA never injects its own affiliate tag
 * anymore, so this file only carries creator-referral detection/unwrap
 * fields (domain, referralPaths, unwrapReferral).
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
 * Pure function — no file I/O beyond reading domain-rules.json.
 *
 * Chrome applies AT MOST ONE redirect rule per request: redirect actions do NOT
 * cascade and the request is NOT re-evaluated after a rewrite (confirmed against
 * Chrome's declarativeNetRequest docs). So every host must match exactly ONE
 * param-stripping rule, and that rule must remove the COMPLETE set of params
 * applicable to that host. The earlier design split params across a global rule
 * plus per-domain/Amazon rules that all matched the same host; Chrome fired only
 * one, leaving mixed-param URLs half-cleaned.
 *
 * Design (one complete rule per host):
 *   - Global rule (id 1): removeParams = all TRACKING_PARAMS. Matches every host
 *     EXCEPT domains that need a tailored set (excludedRequestDomains), so those
 *     never double-match the global rule.
 *   - Per-domain-profile rules (id 300+i): requestDomains-scoped. removeParams =
 *     the COMPLETE set for that profile = TRACKING_PARAMS minus the domain's
 *     preserveParams, plus any domain-specific extra strips (Amazon internal-nav
 *     params that are unsafe to strip site-wide). Domains sharing an identical
 *     set share one rule.
 *
 * No guard/denylist filtering on the TRACKING_PARAMS base: DNR must mirror the
 * runtime cleaner, which strips all of TRACKING_PARAMS. Guard/deny only gate the
 * EXTRA domain strips so a future domain-rules edit can never leak an
 * affiliate/nav key into a DNR strip.
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

  const guard = new Set([...AFFILIATE_PARAM_GUARD].map((s) => s.toLowerCase()));
  const deny = new Set([...REMOTE_PARAM_DENYLIST].map((s) => s.toLowerCase()));
  const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  // Codepoint comparator — locale-independent so rule ordering (and thus the
  // 300+i ids) is byte-identical across environments, keeping the compile:rules
  // clean-diff CI gate stable. Never use String.localeCompare here.
  const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // True when `child` is a proper subdomain of `parent`. Mirrors Chrome's
  // requestDomains/excludedRequestDomains matching (a rule scoped to D matches D
  // and every subdomain of D).
  const isProperSubdomain = (child, parent) =>
    child !== parent && child.endsWith("." + parent);

  // Compute each domain's tailored removeParams. A domain is "tailored" (and so
  // excluded from the global rule) iff its set differs from the global
  // TRACKING_PARAMS: it preserves a tracked param (a subset) and/or contributes
  // extra strips not already global (a superset). Domains matching neither stay
  // under the global rule.
  const tailoredDomains = new Set(); // every tailored domain — all excluded from global
  const perDomain = []; // { domain, removeParams } — only those with something to strip
  for (const rule of domainRules) {
    if (typeof rule.domain !== "string") continue;
    const preserveLc = new Set((rule.preserveParams ?? []).map((p) => p.toLowerCase()));
    const preservesTracked = [...preserveLc].some((p) => trackingLc.has(p));

    // Extra strips: Amazon internal-nav params the cleaner strips on Amazon but
    // that are unsafe site-wide (absent from TRACKING_PARAMS), minus anything
    // preserved/guarded/denied. Guard/deny are safety nets against a future edit
    // leaking an affiliate/nav key.
    let extraStrips = [];
    if (AMAZON_HOST_RE.test(rule.domain)) {
      extraStrips = (rule.stripParams ?? []).filter((p) => {
        const lc = p.toLowerCase();
        return !trackingLc.has(lc) && !preserveLc.has(lc) && !guard.has(lc) && !deny.has(lc);
      });
    }

    if (!preservesTracked && extraStrips.length === 0) continue; // global covers it

    // Tailored: must be excluded from the global rule so it never double-matches.
    tailoredDomains.add(rule.domain);

    // Complete set for this host: all TRACKING_PARAMS minus its preserves, then
    // its extra strips. TRACKING_PARAMS source order is preserved for byte
    // stability; extras are sorted+deduped and are disjoint from the base (they
    // are, by construction, not in TRACKING_PARAMS).
    const base = TRACKING_PARAMS.filter((p) => !preserveLc.has(p.toLowerCase()));
    const removeParams = [...base, ...[...new Set(extraStrips)].sort(byCodepoint)];
    // A domain that preserves EVERY tracking param (and adds no extra strips) has
    // nothing to strip: it stays excluded from the global rule (above) but gets no
    // profile rule, so NO DNR rule matches it and all its params survive. Emitting
    // an empty-removeParams rule would be invalid DNR; falling back to the global
    // rule would strip exactly what it wanted to preserve.
    if (removeParams.length === 0) continue;
    perDomain.push({ domain: rule.domain, removeParams });
  }

  // Group domains that share an identical removeParams set into one rule.
  const bySig = new Map(); // JSON(removeParams) -> { removeParams, domains: Set }
  for (const { domain, removeParams } of perDomain) {
    const sig = JSON.stringify(removeParams);
    if (!bySig.has(sig)) bySig.set(sig, { removeParams, domains: new Set() });
    bySig.get(sig).domains.add(domain);
  }
  const allTailored = [...tailoredDomains];
  const groups = [...bySig.values()]
    .map((g) => {
      const domains = [...g.domains].sort(byCodepoint);
      // ONE-RULE-PER-REQUEST across profile rules: a tailored domain that is a
      // proper subdomain of one of THIS group's domains, but lives in a DIFFERENT
      // group (different removeParams), would otherwise match both rules — Chrome
      // fires one, half-cleaning it. Exclude such descendants so the more specific
      // rule is the only match on that host. Same-group descendants share our
      // removeParams, so they need no exclusion.
      const excluded = allTailored
        .filter((d) => !g.domains.has(d) && domains.some((base) => isProperSubdomain(d, base)))
        .sort(byCodepoint);
      return { removeParams: g.removeParams, domains, excluded };
    })
    .sort((a, b) => byCodepoint(a.domains[0], b.domains[0]));

  if (groups.length > DNR_DOMAIN_PRESERVE_MAX_RULES) {
    process.stderr.write(
      `generate-rules.mjs: ${groups.length} domain-profile DNR rule groups exceeds ` +
      `DNR_DOMAIN_PRESERVE_MAX_RULES (${DNR_DOMAIN_PRESERVE_MAX_RULES}). Raise the cap ` +
      `(and its ID range in dnr-ids.js) or reduce distinct preserve/strip profiles.\n`
    );
    process.exit(1);
  }

  // Every tailored domain is excluded from the global rule so each host matches
  // exactly one param-stripping rule.
  const excludedRequestDomains = allTailored.sort(byCodepoint);

  /**
   * DNR condition shape. The global rule uses urlFilter + excludedRequestDomains;
   * profile rules use requestDomains. Fields are optional so both shapes share
   * one type (and the rules array stays homogeneously typed for checkJs).
   * @typedef {object} DnrCondition
   * @property {string} [urlFilter]
   * @property {string[]} [requestDomains]
   * @property {string[]} [excludedRequestDomains]
   * @property {string[]} resourceTypes
   */

  /** @type {DnrCondition} */
  const globalCondition = {
    urlFilter: "*",
    resourceTypes: ["main_frame"],
  };
  if (excludedRequestDomains.length > 0) {
    globalCondition.excludedRequestDomains = excludedRequestDomains;
  }

  const rules = [
    {
      // Signed-URL guard (#1200). Emitted FIRST so it is impossible to read
      // this file without seeing that every strip rule below is subject to it.
      // A presigned URL's signature covers its query fields, so stripping one
      // returns 403 — see src/lib/signed-url.js for the full rationale and the
      // shared detection rule this regex mirrors.
      id: DNR_SIGNED_URL_ALLOW_RULE_ID,
      priority: DNR_SIGNED_URL_ALLOW_PRIORITY,
      action: { type: "allow" },
      condition: {
        regexFilter: SIGNED_URL_REGEX_FILTER,
        resourceTypes: ["main_frame"],
      },
    },
    {
      id: DNR_STATIC_RULE_ID,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              removeParams: [...TRACKING_PARAMS],
            },
          },
        },
      },
      condition: globalCondition,
    },
  ];

  groups.forEach((group, i) => {
    /** @type {DnrCondition} */
    const condition = {
      requestDomains: group.domains,
      resourceTypes: ["main_frame"],
    };
    // Only present when a tailored descendant must be carved out (nested-domain
    // guard). Rare, but keeps each host matching exactly one profile rule.
    if (group.excluded.length > 0) {
      condition.excludedRequestDomains = group.excluded;
    }
    rules.push({
      id: DNR_DOMAIN_PRESERVE_RULE_ID_BASE + i,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              removeParams: group.removeParams,
            },
          },
        },
      },
      condition,
    });
  });

  return rules;
}

/**
 * Builds the source text of `src/rules/preserve-params.data.js` (#1221).
 *
 * The set is the union of every domain entry's `preserveParams`, lowercased and
 * sorted. It exists so the invariant "a fact learned about one host must never
 * be applied to another" can be enforced STRUCTURALLY: a name a host declares it
 * needs must not be publishable to the global remote channel, which has no way
 * to say where it applies.
 *
 * Emitted as a JS module rather than read from JSON at runtime because
 * `src/lib/remote-rules.js` runs in the service worker, where the domain rules
 * are fetched asynchronously (service-worker.js:73 — import assertions are
 * incompatible with Firefox). A guard that depended on that fetch would be absent
 * exactly when the fetch failed, which is the wrong direction to fail.
 *
 * @returns {string} Module source text, ending in a newline.
 */
export function buildPreserveParamsModule() {
  let domainRules;
  try {
    domainRules = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(
      `generate-rules.mjs: failed to parse src/rules/domain-rules.json: ${err.message}\n`
    );
    process.exit(1);
  }

  const preserved = new Set();
  for (const rule of domainRules) {
    for (const p of rule.preserveParams ?? []) preserved.add(p.toLowerCase());
  }
  const sorted = [...preserved].sort((a, b) => a.localeCompare(b));

  return (
    "// muga rule artifact: params some host explicitly preserves (#1221).\n" +
    "// DO NOT EDIT BY HAND. Derived from src/rules/domain-rules.json by\n" +
    "// `npm run compile:rules`; CI re-runs it and diffs src/rules/.\n" +
    "//\n" +
    "// A name in here must never be published to the GLOBAL remote channel: that\n" +
    "// channel cannot express a host scope, so publishing one strips it on the very\n" +
    "// hosts that declared they need it — #1212's failure class, reached through the\n" +
    "// signed payload instead of through ingestion.\n" +
    "export const PRESERVED_PARAMS = " + JSON.stringify(sorted, null, 2) + ";\n"
  );
}

/**
 * Writes the output files when the script is run directly.
 */
function main() {
  const manifest = buildManifest();
  const dnrRules = buildDnrRules();

  // Look the global rule up by ID rather than by position: the signed-URL
  // allow rule (#1200) is emitted ahead of it, so index 0 is not the strip rule.
  const globalRule = dnrRules.find((r) => r.id === DNR_STATIC_RULE_ID);
  const globalCount = globalRule.action.redirect.transform.queryTransform.removeParams.length;
  const profileRules = dnrRules.filter(
    (r) => r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE && r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES
  );
  const profileDomains = profileRules.reduce(
    (n, r) => n + (r.condition.requestDomains?.length ?? 0),
    0
  );

  const preserveModule = buildPreserveParamsModule();

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(DNR_PATH, JSON.stringify(dnrRules, null, 2) + "\n", "utf8");
  writeFileSync(PRESERVE_PARAMS_PATH, preserveModule, "utf8");

  console.log(
    `Generated rules-manifest.json (${manifest.tracking.length} params, ${manifest.prefix_rules.length} prefixes) and tracking-params.json (${globalCount} global DNR params; ${profileRules.length} per-domain-profile rules covering ${profileDomains} domains)`
  );
}

// Only run main() when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
