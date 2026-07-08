/**
 * MUGA: Hot-path STRIP table codegen (#1005)
 *
 * The hot-path UTM/click-id STRIP subset (src/lib/hot-path-strip.js) is
 * hand-copied byte-for-byte into five content scripts because content
 * scripts can't import ES modules cross-browser (Chrome MV3 main-world /
 * Firefox MV2 page-world scripts are loaded as classic scripts, not
 * modules). strip-table-parity.test.mjs (#723) pins the five copies as
 * byte-identical; this tool is what actually keeps them that way instead of
 * a contributor hand-editing five files in lockstep.
 *
 * Usage:
 *   node tools/generate-strip-table.mjs           — rewrite the five files
 *   node tools/generate-strip-table.mjs --check   — CI drift guard: does NOT
 *                                                    write, exits 1 if any
 *                                                    file has drifted
 *   npm run build:strip
 *   npm run check:strip
 *
 * Every file in this repo uses CRLF line endings. This tool reads/writes
 * with "utf8" (no newline translation) and emits CRLF explicitly so the
 * generated region matches the rest of each file byte-for-byte.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { HOT_PATH_STRIP_ROWS } from "../src/lib/hot-path-strip.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONTENT_DIR = resolve(ROOT, "src/content");

const CRLF = "\r\n";

const FILES = [
  "dom-link-rewriter.js",
  "dom-link-rewriter-click.js",
  "history-defuser-mainworld.js",
  "window-name-defuser-mainworld.js",
  "window-name-defuser.js",
];

const MARKER =
  "  // @generated hot-path STRIP subset - edit src/lib/hot-path-strip.js then run `npm run build:strip`";

/**
 * Matches an optional existing managed marker line followed by the
 * `const STRIP = Object.freeze({ ... });` statement (brace content matched
 * non-greedily up to the closing `  });` at 2-space indent — the same shape
 * strip-table-parity.test.mjs brace-matches at runtime, but a regex is
 * sufficient here because the generated body never contains a `}` of its
 * own).
 */
const STRIP_BLOCK_RE =
  /(  \/\/ @generated hot-path[^\r\n]*\r?\n)?  const STRIP = Object\.freeze\(\{[\s\S]*?\r?\n  \}\);/;

/**
 * Builds the STRIP declaration body (object literal rows) from
 * HOT_PATH_STRIP_ROWS, CRLF-joined, matching the hand-written original
 * exactly: 4-space inner indent, `name: 1` entries joined by ", ", each row
 * ends with a trailing comma.
 *
 * @returns {string}
 */
export function buildStripRows() {
  return HOT_PATH_STRIP_ROWS.map(
    (row) => "    " + row.map((name) => `${name}: 1`).join(", ") + ","
  ).join(CRLF);
}

/**
 * Builds the full managed region: marker line + `const STRIP = Object.freeze({...});`.
 *
 * @returns {string}
 */
export function buildManagedBlock() {
  const rows = buildStripRows();
  return (
    MARKER + CRLF +
    "  const STRIP = Object.freeze({" + CRLF +
    rows + CRLF +
    "  });"
  );
}

/**
 * Applies the managed block to a file's source text. Returns the new
 * source text, or throws if the file has no `const STRIP = Object.freeze({...})`
 * statement to anchor on.
 *
 * @param {string} src
 * @param {string} relPath — for error messages
 * @returns {string}
 */
function applyToSource(src, relPath) {
  if (!STRIP_BLOCK_RE.test(src)) {
    throw new Error(
      `${relPath}: could not locate "const STRIP = Object.freeze({ ... });" to replace`
    );
  }
  return src.replace(STRIP_BLOCK_RE, buildManagedBlock());
}

/**
 * Rewrites the five content scripts in place. Prints which files changed.
 */
function run() {
  let changed = 0;
  for (const file of FILES) {
    const path = resolve(CONTENT_DIR, file);
    const before = readFileSync(path, "utf8");
    const after = applyToSource(before, `src/content/${file}`);
    if (after !== before) {
      writeFileSync(path, after, "utf8");
      console.log(`updated src/content/${file}`);
      changed++;
    }
  }
  if (changed === 0) {
    console.log("all five content-script STRIP tables already up to date");
  }
}

/**
 * CI drift guard: regenerates in memory and compares to disk. Does NOT
 * write. Exits 1 (after printing the offending file(s)) on any drift.
 */
function check() {
  let drifted = false;
  for (const file of FILES) {
    const path = resolve(CONTENT_DIR, file);
    const before = readFileSync(path, "utf8");
    const after = applyToSource(before, `src/content/${file}`);
    if (after !== before) {
      console.error(
        `generate-strip-table.mjs --check: src/content/${file} has drifted from src/lib/hot-path-strip.js — run \`npm run build:strip\``
      );
      drifted = true;
    }
  }
  if (drifted) {
    process.exit(1);
  }
  console.log("all five content-script STRIP tables match src/lib/hot-path-strip.js");
}

// Only run when executed directly (not when imported by tests) — mirrors
// tools/generate-rules.mjs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const isCheck = process.argv.includes("--check");
  if (isCheck) {
    check();
  } else {
    run();
  }
}
