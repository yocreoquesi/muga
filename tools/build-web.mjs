/**
 * MUGA: Web-cleaner-tool build script (#1029, Phase 2 + Phase 4)
 *
 * Regenerates the vendored engine copies consumed by the standalone
 * web/ tool from their sources of truth in src/:
 *
 *   1. src/content/cleaner-bundle.js -> web/engine/cleaner-bundle.js
 *   2. src/rules/domain-rules.json   -> web/engine/domain-rules.json
 *   3. src/rules/domain-rules.json   -> web/engine/domain-rules.gen.mjs
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
 * existing deploy-landing.yml workflow already picks up (its `paths:`
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

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

const SRC_BUNDLE = join(ROOT, "src/content/cleaner-bundle.js");
const SRC_DOMAIN_RULES = join(ROOT, "src/rules/domain-rules.json");

const WEB_DIR = join(ROOT, "web");
const WEB_ENGINE_DIR = join(WEB_DIR, "engine");
const WEB_BUNDLE = join(WEB_ENGINE_DIR, "cleaner-bundle.js");
const WEB_DOMAIN_RULES = join(WEB_ENGINE_DIR, "domain-rules.json");
const WEB_DOMAIN_RULES_MODULE = join(WEB_ENGINE_DIR, "domain-rules.gen.mjs");

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

function main() {
  mkdirSync(WEB_ENGINE_DIR, { recursive: true });

  copyFileSync(SRC_BUNDLE, WEB_BUNDLE);
  copyFileSync(SRC_DOMAIN_RULES, WEB_DOMAIN_RULES);

  const domainRules = JSON.parse(readFileSync(SRC_DOMAIN_RULES, "utf8"));
  writeFileSync(WEB_DOMAIN_RULES_MODULE, renderDomainRulesModule(domainRules));

  // Mirror the whole authored+vendored web/ tree into landing/clean/ so
  // relative asset paths (./engine/cleaner-bundle.js, ./adapter.js, ...)
  // resolve identically under web/ and under landing/clean/.
  cpSync(WEB_DIR, LANDING_CLEAN_DIR, { recursive: true });

  console.log(`[muga] web engine copies written: ${WEB_BUNDLE}`);
  console.log(`[muga]                            ${WEB_DOMAIN_RULES}`);
  console.log(`[muga]                            ${WEB_DOMAIN_RULES_MODULE}`);
  console.log(`[muga] landing mirror written: ${LANDING_CLEAN_DIR}`);
}

if (process.argv[1]?.endsWith("build-web.mjs")) {
  main();
}
