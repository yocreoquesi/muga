/**
 * MUGA — hot-path STRIP table codegen drift guard (#1005, spin-off from #723)
 *
 * strip-table-parity.test.mjs pins that the five hand-copied STRIP tables
 * stay byte-identical to EACH OTHER. This test pins the stronger invariant:
 * each of the five tables must match what tools/generate-strip-table.mjs
 * would generate from the single source of truth, src/lib/hot-path-strip.js.
 * Without this, all five files could drift together (e.g. a manual edit
 * applied to all five by hand) and strip-table-parity.test.mjs would stay
 * green while src/lib/hot-path-strip.js silently went stale.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { HOT_PATH_STRIP_ROWS } from "../../src/lib/hot-path-strip.js";
import { buildManagedBlock } from "../../tools/generate-strip-table.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "dom-link-rewriter.js",
  "dom-link-rewriter-click.js",
  "history-defuser-mainworld.js",
  "window-name-defuser-mainworld.js",
  "window-name-defuser.js",
];

/**
 * Extracts the `Object.freeze({ ... })` object literal that follows
 * `const STRIP =` in a piece of source text, brace-matched so the full
 * table (including trailing entries) is captured verbatim. Mirrors
 * strip-table-parity.test.mjs's extractStripTable, generalised to accept
 * either a file's full source or the freshly generated managed block.
 *
 * @param {string} src
 * @param {string} label — for assertion messages
 * @returns {string}
 */
function extractStripTable(src, label) {
  const decl = src.indexOf("const STRIP = Object.freeze({");
  assert.ok(decl !== -1, `${label} must declare const STRIP = Object.freeze({ ... })`);
  const open = src.indexOf("{", decl);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(i < src.length, `${label}: unbalanced braces in STRIP table`);
  return src.slice(open, i + 1);
}

function readContentScript(relPath) {
  return readFileSync(join(__dirname, "../../src/content", relPath), "utf8");
}

test("HOT_PATH_STRIP_ROWS has no duplicate param across all rows", () => {
  const seen = new Map(); // name -> row index of first occurrence
  const dupes = [];
  HOT_PATH_STRIP_ROWS.forEach((row, rowIndex) => {
    for (const name of row) {
      if (seen.has(name)) {
        dupes.push(`"${name}" appears in row ${seen.get(name)} and row ${rowIndex}`);
      } else {
        seen.set(name, rowIndex);
      }
    }
  });
  assert.deepEqual(
    dupes,
    [],
    `HOT_PATH_STRIP_ROWS must not repeat a param across rows:\n  ${dupes.join("\n  ")}`,
  );
});

test("generated STRIP block is non-empty and well-formed", () => {
  const expected = extractStripTable(buildManagedBlock(), "generated managed block");
  assert.ok(expected.startsWith("{"));
  assert.ok(expected.endsWith("}"));
  assert.ok(expected.length > 0);
});

for (const file of FILES) {
  test(`src/content/${file} STRIP table matches src/lib/hot-path-strip.js (npm run build:strip)`, () => {
    const expected = extractStripTable(buildManagedBlock(), "generated managed block");
    const actual = extractStripTable(readContentScript(file), `src/content/${file}`);
    assert.equal(
      actual,
      expected,
      `src/content/${file} has drifted from src/lib/hot-path-strip.js. ` +
      `Run \`npm run build:strip\` to regenerate the five content-script ` +
      `STRIP tables from the single source of truth, or \`npm run check:strip\` ` +
      `to see this diff without writing.`,
    );
  });
}
