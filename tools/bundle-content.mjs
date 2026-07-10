/**
 * MUGA: Content-script bundler (#356)
 *
 * Bundles src/content/cleaner-bundle-src.mjs (an ES module that imports
 * from src/lib/) into src/content/cleaner-bundle.js as an IIFE. The
 * generated file is committed to the repo (matching the pattern used by
 * `build:rules` for tracking-params.json) and loaded by the manifest as
 * the first content script. CI runs this and verifies the output is in
 * sync — see ci.yml.
 *
 * Why this file exists: MV3 content scripts cannot use ES module imports
 * portably across Chrome and Firefox MV2. The cleaning library lives as
 * ESM in src/lib/ for the service worker, popup, and tests; the content
 * script gets a bundled IIFE copy via this script.
 *
 * Run with: `npm run build:content`
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "..");
const ENTRY = join(ROOT, "src/content/cleaner-bundle-src.mjs");
const OUT   = join(ROOT, "src/content/cleaner-bundle.js");

// web-cleaner-tool (#1029, Phase 1): stamp the bundle with package.json's
// version so window.__mugaCleaner.__version__ lets consumers (the web/
// tool's adapter) detect which engine snapshot they are running against.
// Read once at build time — deterministic, changes only on a committed
// version bump, so the CI git-diff drift gate on the committed bundle holds.
const { version: MUGA_VERSION } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: "iife",
  define: {
    __MUGA_VERSION__: JSON.stringify(MUGA_VERSION),
  },
  // Targets: Chrome's MV3 baseline + Firefox's MV2-supporting Firefox 128+.
  // Both engines understand modern ES2022 cleanly; no transpilation needed.
  target: ["chrome111", "firefox128"],
  // Minify aggressively. The bundle ships in every page load; size is the
  // dominant cost. Source maps are NOT emitted — the source files are in
  // the same repo and a developer can debug from there directly.
  minify: true,
  // Keep names readable for stack traces in users' devtools. Tiny extra
  // bytes against the cost of opaque crash logs in bug reports.
  keepNames: true,
  legalComments: "none",
  charset: "utf8",
  logLevel: "info",
});

console.log(`[muga] content bundle written: ${OUT}`);
