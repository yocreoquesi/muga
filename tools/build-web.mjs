/**
 * MUGA: Web-cleaner-tool build script (#1029, Phase 2)
 *
 * Regenerates the vendored engine copies consumed by the standalone
 * web/ tool from their sources of truth in src/:
 *
 *   1. src/content/cleaner-bundle.js -> web/engine/cleaner-bundle.js
 *   2. src/rules/domain-rules.json   -> web/engine/domain-rules.json
 *
 * (2) is an addition beyond the original design's engine copy alone: it
 * lets the web adapter reach full per-domain preserveParams parity in a
 * later phase by passing the same domain-rules.json MUGA's core uses as
 * processUrl's domainRules argument, instead of hand-copying rules that
 * could silently drift. Treated identically to the bundle copy: a
 * second generated, drift-gated artifact (see web-engine-mirror.test.mjs
 * and ci.yml).
 *
 * Then mirrors the entire web/ tree into landing/clean/, which the
 * existing deploy-landing.yml workflow already picks up (its `paths:`
 * trigger includes `landing/**`). See design ADR-2
 * (sdd/web-cleaner-tool/design).
 *
 * Deterministic plain file copies only — no bundler, no transform. CI
 * re-runs this and git-diffs the result to catch drift (see ci.yml).
 *
 * Run with: `npm run build:web`
 */
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
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

const LANDING_CLEAN_DIR = join(ROOT, "landing/clean");

mkdirSync(WEB_ENGINE_DIR, { recursive: true });

copyFileSync(SRC_BUNDLE, WEB_BUNDLE);
copyFileSync(SRC_DOMAIN_RULES, WEB_DOMAIN_RULES);

// Mirror the whole authored+vendored web/ tree into landing/clean/ so
// relative asset paths (./engine/cleaner-bundle.js, ./adapter.js, ...)
// resolve identically under web/ and under landing/clean/.
cpSync(WEB_DIR, LANDING_CLEAN_DIR, { recursive: true });

console.log(`[muga] web engine copies written: ${WEB_BUNDLE}`);
console.log(`[muga]                            ${WEB_DOMAIN_RULES}`);
console.log(`[muga] landing mirror written: ${LANDING_CLEAN_DIR}`);
