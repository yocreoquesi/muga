/**
 * MUGA: Web-cleaner-tool build script (#1029, Phase 2 + Phase 4)
 *
 * Regenerates the vendored engine copies consumed by the standalone
 * web/ tool from their sources of truth in src/:
 *
 *   1. src/content/cleaner-bundle.js     -> web/engine/cleaner-bundle.js
 *   2. src/rules/domain-rules.json       -> web/engine/domain-rules.json
 *   3. src/rules/domain-rules.json       -> web/engine/domain-rules.gen.mjs
 *   4. src/lib/param-breakdown-view.js   -> web/engine/param-breakdown-view.gen.mjs
 *   5. src/lib/affiliates-data.js's
 *      TRACKING_PARAM_CATEGORIES         -> web/engine/param-categories.gen.mjs
 *   6. src/rules/path-strip-rules.json   -> web/engine/path-strip-rules.json
 *   7. src/rules/path-strip-rules.json   -> web/engine/path-strip-rules.gen.mjs
 *
 * (6) and (7) fix a bug where the web tool never applied Amazon-style
 * path-strip (product-name slug removal): web/engine/adapter.js called
 * processUrl() without a pathStripRules argument, so it silently
 * defaulted to `[]`. They follow the exact (2)/(3) pattern (a byte-copy
 * JSON mirror plus a named-export ES module mirror, `PATH_STRIP_RULES`),
 * for the same import-attribute-compat reason (3) exists. Only
 * pathStripRules is wired this way; pathAffiliateRules (processUrl's 8th
 * argument) is deliberately out of scope here and stays deferred.
 *
 * (4) and (5), added for the web-cleaning-insight slice (Slice 1), let
 * web/param-insight.js build the same per-parameter what/why breakdown
 * the popup shows (#986), without web/ importing from src/ (design D1/D2,
 * sdd/web-cleaning-insight/design). (4) is a byte copy (the module has
 * zero imports and is fully self-contained); (5) follows the same
 * generated-named-export-module convention as (3).
 *
 * (2) is an addition beyond the original design's engine copy alone: it
 * lets the web adapter reach full per-domain preserveParams parity in a
 * later phase by passing the same domain-rules.json MUGA's core uses as
 * processUrl's domainRules argument, instead of hand-copying rules that
 * could silently drift. Treated identically to the bundle copy: a
 * second generated, drift-gated artifact (see web-engine-mirror.test.mjs
 * and ci.yml).
 *
 * (3) resolves a browser-compat gap found in Phase 4: `import ... with
 * { type: "json" }` (used by web/engine/adapter.js against (2)) requires
 * import-attribute support, which is limited on older browsers. (3) is a
 * plain named-export ES module (same JSON data, `DOMAIN_RULES` array)
 * that every module-supporting browser can load with a normal `import`,
 * no attribute syntax needed. Follows the existing repo convention for
 * JSON-to-JS data modules (see src/rules/manifest.data.js,
 * src/rules/wrappers.data.js): a `DO NOT EDIT BY HAND` header + one
 * `export const NAME = [...]`. (2) is kept alongside (3), unchanged, so
 * existing byte-copy drift tests (web-engine-mirror.test.mjs) still hold.
 *
 * Then mirrors the entire web/ tree into landing/clean/, which the
 * Cloudflare Pages build already picks up (it deploys the whole `landing/`
 * trigger includes `landing/**`). See design ADR-2
 * (sdd/web-cleaner-tool/design).
 *
 * Deterministic plain file copies/transforms only — no bundler. CI
 * re-runs this and git-diffs the result to catch drift (see ci.yml).
 *
 * Run with: `npm run build:web`
 */
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAM_CATEGORIES } from "../src/lib/affiliates-data.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

const SRC_BUNDLE = join(ROOT, "src/content/cleaner-bundle.js");
const SRC_DOMAIN_RULES = join(ROOT, "src/rules/domain-rules.json");
const SRC_PARAM_BREAKDOWN_VIEW = join(ROOT, "src/lib/param-breakdown-view.js");
const SRC_PATH_STRIP_RULES = join(ROOT, "src/rules/path-strip-rules.json");

const WEB_DIR = join(ROOT, "web");
const WEB_ENGINE_DIR = join(WEB_DIR, "engine");
const WEB_BUNDLE = join(WEB_ENGINE_DIR, "cleaner-bundle.js");
const WEB_DOMAIN_RULES = join(WEB_ENGINE_DIR, "domain-rules.json");
const WEB_DOMAIN_RULES_MODULE = join(WEB_ENGINE_DIR, "domain-rules.gen.mjs");
const WEB_PARAM_BREAKDOWN_VIEW_MODULE = join(WEB_ENGINE_DIR, "param-breakdown-view.gen.mjs");
const WEB_PARAM_CATEGORIES_MODULE = join(WEB_ENGINE_DIR, "param-categories.gen.mjs");
const WEB_PATH_STRIP_RULES = join(WEB_ENGINE_DIR, "path-strip-rules.json");
const WEB_PATH_STRIP_RULES_MODULE = join(WEB_ENGINE_DIR, "path-strip-rules.gen.mjs");

const LANDING_CLEAN_DIR = join(ROOT, "landing/clean");

/**
 * Renders `web/engine/domain-rules.gen.mjs`'s deterministic content from
 * the parsed domain-rules array. Exported so tests can regenerate the
 * expected content and byte-compare it against the committed file
 * (mirrors the drift-gate pattern used across the repo's other generated
 * artifacts) without re-running the whole build script as a side effect.
 *
 * @param {Array<object>} domainRules Parsed src/rules/domain-rules.json.
 * @returns {string} Full file contents, including the DO NOT EDIT header.
 */
export function renderDomainRulesModule(domainRules) {
  return (
    "/** MUGA: Generated ES module mirror of src/rules/domain-rules.json (#1029, Phase 4).\n" +
    " *\n" +
    " * A plain named-export copy of the JSON domain rules used by\n" +
    " * web/engine/adapter.js, so the web tool can `import { DOMAIN_RULES }\n" +
    " * from \"./domain-rules.gen.mjs\"` instead of a JSON module import with\n" +
    " * an import attribute, which has limited support in older browsers.\n" +
    " *\n" +
    " * DO NOT EDIT BY HAND. Regenerate via `npm run build:web`\n" +
    " * (tools/build-web.mjs), sourced from src/rules/domain-rules.json.\n" +
    " */\n" +
    `export const DOMAIN_RULES = ${JSON.stringify(domainRules, null, 2)};\n`
  );
}

/**
 * Renders `web/engine/param-categories.gen.mjs`'s deterministic content
 * from the parsed `TRACKING_PARAM_CATEGORIES` taxonomy
 * (src/lib/affiliates-data.js). Exported so tests can regenerate the
 * expected content and byte-compare it against the committed file,
 * mirroring `renderDomainRulesModule`'s drift-gate pattern.
 *
 * @param {object} categories `TRACKING_PARAM_CATEGORIES` from src/lib/affiliates-data.js.
 * @returns {string} Full file contents, including the DO NOT EDIT header.
 */
export function renderParamCategoriesModule(categories) {
  return (
    "/** MUGA: Generated ES module mirror of TRACKING_PARAM_CATEGORIES\n" +
    " * (src/lib/affiliates-data.js), for the web-cleaning-insight slice.\n" +
    " *\n" +
    " * A plain named-export copy of the tracking-param taxonomy used by\n" +
    " * web/param-insight.js to build the per-parameter what/why breakdown,\n" +
    " * without web/ importing from src/ directly (design ADR, see\n" +
    " * sdd/web-cleaning-insight/design D1/D2).\n" +
    " *\n" +
    " * DO NOT EDIT BY HAND. Regenerate via `npm run build:web`\n" +
    " * (tools/build-web.mjs), sourced from src/lib/affiliates-data.js.\n" +
    " */\n" +
    `export const TRACKING_PARAM_CATEGORIES = ${JSON.stringify(categories, null, 2)};\n`
  );
}

/**
 * Renders `web/engine/path-strip-rules.gen.mjs`'s deterministic content
 * from the parsed path-strip rules array. Exported so tests can
 * regenerate the expected content and byte-compare it against the
 * committed file, mirroring `renderDomainRulesModule`'s drift-gate
 * pattern.
 *
 * @param {Array<object>} pathStripRules Parsed src/rules/path-strip-rules.json.
 * @returns {string} Full file contents, including the DO NOT EDIT header.
 */
export function renderPathStripRulesModule(pathStripRules) {
  return (
    "/** MUGA: Generated ES module mirror of src/rules/path-strip-rules.json.\n" +
    " *\n" +
    " * A plain named-export copy of the path-strip rules used by\n" +
    " * web/engine/adapter.js, so the web tool can `import { PATH_STRIP_RULES }\n" +
    " * from \"./path-strip-rules.gen.mjs\"` instead of a JSON module import with\n" +
    " * an import attribute, which has limited support in older browsers.\n" +
    " *\n" +
    " * DO NOT EDIT BY HAND. Regenerate via `npm run build:web`\n" +
    " * (tools/build-web.mjs), sourced from src/rules/path-strip-rules.json.\n" +
    " */\n" +
    `export const PATH_STRIP_RULES = ${JSON.stringify(pathStripRules, null, 2)};\n`
  );
}

function main() {
  mkdirSync(WEB_ENGINE_DIR, { recursive: true });

  copyFileSync(SRC_BUNDLE, WEB_BUNDLE);
  copyFileSync(SRC_DOMAIN_RULES, WEB_DOMAIN_RULES);
  copyFileSync(SRC_PARAM_BREAKDOWN_VIEW, WEB_PARAM_BREAKDOWN_VIEW_MODULE);
  copyFileSync(SRC_PATH_STRIP_RULES, WEB_PATH_STRIP_RULES);

  const domainRules = JSON.parse(readFileSync(SRC_DOMAIN_RULES, "utf8"));
  writeFileSync(WEB_DOMAIN_RULES_MODULE, renderDomainRulesModule(domainRules));
  writeFileSync(WEB_PARAM_CATEGORIES_MODULE, renderParamCategoriesModule(TRACKING_PARAM_CATEGORIES));

  const pathStripRules = JSON.parse(readFileSync(SRC_PATH_STRIP_RULES, "utf8"));
  writeFileSync(WEB_PATH_STRIP_RULES_MODULE, renderPathStripRulesModule(pathStripRules));

  // Mirror the whole authored+vendored web/ tree into landing/clean/ so
  // relative asset paths (./engine/cleaner-bundle.js, ./adapter.js, ...)
  // resolve identically under web/ and under landing/clean/.
  cpSync(WEB_DIR, LANDING_CLEAN_DIR, { recursive: true });

  console.log(`[muga] web engine copies written: ${WEB_BUNDLE}`);
  console.log(`[muga]                            ${WEB_DOMAIN_RULES}`);
  console.log(`[muga]                            ${WEB_DOMAIN_RULES_MODULE}`);
  console.log(`[muga]                            ${WEB_PARAM_BREAKDOWN_VIEW_MODULE}`);
  console.log(`[muga]                            ${WEB_PARAM_CATEGORIES_MODULE}`);
  console.log(`[muga]                            ${WEB_PATH_STRIP_RULES}`);
  console.log(`[muga]                            ${WEB_PATH_STRIP_RULES_MODULE}`);
  console.log(`[muga] landing mirror written: ${LANDING_CLEAN_DIR}`);
}

if (process.argv[1]?.endsWith("build-web.mjs")) {
  main();
}
