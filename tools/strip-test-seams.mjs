/**
 * MUGA: strip-test-seams — build-time test/production boundary enforcer (#827)
 *
 * Copies the extension source directory to a temporary directory, rewrites
 * `lib/test-fixtures.js` to an inert stub (and optionally neutralises the
 * `__MUGA_TRUSTED_KEYS__` seam in `background/service-worker.js`), then
 * delegates to `web-ext build` from that temporary copy.  The original
 * `src/` tree is never modified, so the dev and e2e workflows remain intact.
 *
 * Why a copy + stub rather than dynamic import() or --ignore-files?
 *
 *   - MV3 service workers only support STATIC imports (the SW module graph is
 *     resolved at install time by the browser).  Dynamic `import()` is not
 *     allowed in a MV3 SW context, so a "try dynamic import, return null on
 *     failure" loader does not work on the SW path.
 *
 *   - web-ext `--ignore-files` EXCLUDES the file from the zip entirely.
 *     `storage.js`, `popup.js`, and `onboarding.js` all contain a static
 *     `import { getTestFixtures } from "./test-fixtures.js"` — removing the
 *     file would cause a module-not-found at runtime in the shipped extension.
 *
 *   - Rewriting the file to a no-op stub keeps the import graph intact while
 *     shipping zero test logic in store artifacts.
 *
 * Usage (invoked by build:chrome / build:firefox in package.json):
 *
 *   node tools/strip-test-seams.mjs \
 *     --source-dir src/ \
 *     --artifacts-dir dist/chrome/ \
 *     --overwrite-dest \
 *     --ignore-files <...>
 *
 * All flags after `--source-dir <dir>` are forwarded verbatim to `web-ext build`.
 *
 * Exported for unit testing:
 *   rewriteTestFixtures(content: string) -> string
 */

import { mkdtempSync, cpSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ── Exported for unit testing ───────────────────────────────────────────────

/**
 * Absolute path to web-ext's executable script, via Node module resolution.
 *
 * `exports` in web-ext's package.json blocks `require.resolve("web-ext/package.json")`,
 * so resolve the package entry and walk up to the directory whose package.json
 * declares the package, then read its `bin`. Both steps are the ordinary
 * resolution rules, which is the whole point: wherever Node can import web-ext,
 * this finds its binary.
 *
 * @returns {string} absolute path to the bin script
 * @throws {Error} naming the missing install, not a path that does not exist
 */
export function resolveWebExtBin() {
  const require = createRequire(import.meta.url);
  let entry;
  try {
    entry = require.resolve("web-ext");
  } catch {
    throw new Error(
      "[strip-test-seams] web-ext is not installed anywhere Node can resolve it from " +
        `${dirname(fileURLToPath(import.meta.url))}. Run \`npm ci\` in this checkout, ` +
        "or in the parent checkout if this is a git worktree (#1329).",
    );
  }

  let dir = dirname(entry);
  for (;;) {
    const manifest = join(dir, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      pkg = null;
    }
    if (pkg?.name === "web-ext") {
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["web-ext"];
      if (!bin) {
        throw new Error(
          `[strip-test-seams] web-ext at ${dir} declares no "web-ext" bin; cannot build (#1329).`,
        );
      }
      return join(dir, bin);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `[strip-test-seams] resolved web-ext to ${entry} but found no package.json ` +
          "declaring it; the install looks corrupt. Reinstall it (#1329).",
      );
    }
    dir = parent;
  }
}


/**
 * Returns the inert stub content for test-fixtures.js.
 * Called with the ORIGINAL file content so future callers could inspect it,
 * though the rewrite is always unconditional (the stub is canonical).
 *
 * The stub preserves:
 *   - The same named export signature so all importers (storage.js,
 *     popup.js, onboarding.js) continue to resolve without errors.
 *   - No references to `__muga_test_mode`, `__muga_test_fixtures`, or
 *     `chrome.storage.local` — none of those strings appear in store artifacts.
 *
 * @param {string} _originalContent - Original file content (unused; kept for API symmetry).
 * @returns {string} Inert stub source.
 */
export function rewriteTestFixtures(_originalContent) {
  return [
    "/**",
    " * MUGA: test-fixtures stub — store artifact (#827)",
    " *",
    " * This file is rewritten at build time by tools/strip-test-seams.mjs.",
    " * The original src/lib/test-fixtures.js is preserved for dev and e2e use.",
    " * Store artifacts must not contain test infrastructure; this stub ensures",
    " * getTestFixtures() always returns null in shipped builds.",
    " */",
    "",
    "/** @returns {Promise<null>} Always null in store artifacts. */",
    "export async function getTestFixtures() {",
    "  return null;",
    "}",
    "",
  ].join("\n");
}

/**
 * Returns a neutralised version of service-worker.js with the
 * `__MUGA_TRUSTED_KEYS__` override removed (defense-in-depth, #827 optional).
 *
 * The pattern that is stripped:
 *
 *   const trustedKeys =
 *     Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0
 *       ? globalThis.__MUGA_TRUSTED_KEYS__
 *       : TRUSTED_PUBLIC_KEYS;
 *
 * Replaced with the safe one-liner:
 *
 *   const trustedKeys = TRUSTED_PUBLIC_KEYS; // test seam removed (#827)
 *
 * Uses a literal string match so the replacement is zero-regex-ambiguity.
 * If the pattern is NOT found (already removed or restructured), the content
 * is returned unchanged so the build does not fail silently on drift.
 *
 * @param {string} content - Original service-worker.js content.
 * @returns {{ content: string, patched: boolean }}
 */
export function neutraliseTrustedKeysSeam(content) {
  // Match the seam regardless of line endings (CRLF on Windows, LF elsewhere).
  // The four-line pattern is matched as a literal string in both forms.
  const SEAM_LF =
    "  const trustedKeys =\n" +
    "    Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0\n" +
    "      ? globalThis.__MUGA_TRUSTED_KEYS__\n" +
    "      : TRUSTED_PUBLIC_KEYS;";
  const SEAM_CRLF =
    "  const trustedKeys =\r\n" +
    "    Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0\r\n" +
    "      ? globalThis.__MUGA_TRUSTED_KEYS__\r\n" +
    "      : TRUSTED_PUBLIC_KEYS;";
  const REPLACEMENT =
    "  const trustedKeys = TRUSTED_PUBLIC_KEYS; // test seam removed (#827)";

  if (content.includes(SEAM_CRLF)) {
    return { content: content.replace(SEAM_CRLF, REPLACEMENT), patched: true };
  }
  if (content.includes(SEAM_LF)) {
    return { content: content.replace(SEAM_LF, REPLACEMENT), patched: true };
  }
  return { content, patched: false };
}

// ── CLI entry point ─────────────────────────────────────────────────────────

// Only run when invoked directly (not when imported by tests).
const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);

  // Parse --source-dir <path>; everything else is forwarded to web-ext build.
  const sdIdx = args.indexOf("--source-dir");
  if (sdIdx === -1 || !args[sdIdx + 1]) {
    console.error("[strip-test-seams] ERROR: --source-dir <path> is required");
    process.exit(1);
  }

  const sourceDir = resolve(args[sdIdx + 1]);
  // Remove --source-dir and its value from the forwarded args (web-ext will get
  // its own --source-dir pointing at the temp copy).
  const webExtArgs = [...args.slice(0, sdIdx), ...args.slice(sdIdx + 2)];

  // Create a temp directory and copy the extension source into it.
  const tmpBase = mkdtempSync(join(tmpdir(), "muga-build-"));
  const tmpSrc  = join(tmpBase, "src");

  try {
    console.log(`[strip-test-seams] Copying ${sourceDir} → ${tmpSrc}`);
    cpSync(sourceDir, tmpSrc, { recursive: true });

    // 1. Rewrite lib/test-fixtures.js to the inert stub.
    const fixturesPath = join(tmpSrc, "lib", "test-fixtures.js");
    const originalFixtures = readFileSync(fixturesPath, "utf8");
    writeFileSync(fixturesPath, rewriteTestFixtures(originalFixtures), "utf8");
    console.log("[strip-test-seams] Rewrote lib/test-fixtures.js → inert stub");

    // 2. Neutralise __MUGA_TRUSTED_KEYS__ seam in service-worker.js (defense-in-depth).
    const swPath = join(tmpSrc, "background", "service-worker.js");
    const swContent = readFileSync(swPath, "utf8");
    const { content: swPatched, patched } = neutraliseTrustedKeysSeam(swContent);
    if (patched) {
      writeFileSync(swPath, swPatched, "utf8");
      console.log("[strip-test-seams] Neutralised __MUGA_TRUSTED_KEYS__ seam in service-worker.js");
    } else {
      console.log("[strip-test-seams] NOTE: __MUGA_TRUSTED_KEYS__ seam not found (already removed or restructured)");
    }

    // 3. Resolve web-ext's entry script through Node's own module resolution.
    //
    //    This used to hardcode `../node_modules/.bin/web-ext[.cmd]` relative to
    //    this file. That is not where Node looks, and it is wrong in the one
    //    place parallel work on this repo happens: a `git worktree` has no
    //    `node_modules` of its own, so the path simply does not exist and the
    //    build died on an ENOENT naming a path rather than a missing install
    //    (#1329). Node's resolution walks up from the requiring file, so a
    //    worktree finds the parent checkout's install the way every other
    //    import in this repo already does.
    //
    //    Running the bin's JS with process.execPath also retires the Windows
    //    branch: no .bin shim, so no .cmd, so no cmd.exe /c and no DEP0190
    //    shell:true workaround. One code path on every platform.
    const webExtBin = resolveWebExtBin();

    // 4. Run web-ext build from the temp copy.
    const buildArgs = ["build", "--source-dir", tmpSrc, ...webExtArgs];
    console.log(`[strip-test-seams] Running: web-ext ${buildArgs.join(" ")}`);
    execFileSync(process.execPath, [webExtBin, ...buildArgs], { stdio: "inherit" });

  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
    console.log(`[strip-test-seams] Cleaned up ${tmpBase}`);
  }
}
