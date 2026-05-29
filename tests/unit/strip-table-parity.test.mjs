/**
 * MUGA — STRIP table parity guard (#723, spin-off from #709 item 1)
 *
 * The hot-path UTM/click-id strip subset is hand-copied into four
 * content scripts (content scripts can't import ES modules):
 *
 *   - src/content/dom-link-rewriter.js
 *   - src/content/dom-link-rewriter-click.js
 *   - src/content/history-defuser-mainworld.js
 *   - src/content/window-name-defuser-mainworld.js
 *
 * Each comment claims "kept in sync" but nothing enforced it — adding a new
 * high-volume tracker meant editing four files in lockstep. This test pins
 * that the four `const STRIP = Object.freeze({ ... })` literals are
 * byte-identical, the same way cleaner-bundle-sync / sign-rules-denylist-sync
 * pin their respective duplications.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "dom-link-rewriter.js",
  "dom-link-rewriter-click.js",
  "history-defuser-mainworld.js",
  "window-name-defuser-mainworld.js",
];

/**
 * Extracts the `Object.freeze({ ... })` object literal that follows
 * `const STRIP =` in a content-script source file, brace-matched so the
 * full table (including trailing entries) is captured verbatim.
 */
function extractStripTable(relPath) {
  const src = readFileSync(join(__dirname, "../../src/content", relPath), "utf8");
  const decl = src.indexOf("const STRIP = Object.freeze({");
  assert.ok(decl !== -1, `${relPath} must declare const STRIP = Object.freeze({ ... })`);
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
  assert.ok(i < src.length, `${relPath}: unbalanced braces in STRIP table`);
  return src.slice(open, i + 1);
}

test("all four content-script STRIP tables are byte-identical (#723)", () => {
  const tables = FILES.map((f) => ({ file: f, body: extractStripTable(f) }));
  const reference = tables[0];

  for (const { file, body } of tables.slice(1)) {
    if (body !== reference.body) {
      assert.fail(
        `STRIP table in src/content/${file} has drifted from ` +
          `src/content/${reference.file}.\n\n` +
          `--- ${reference.file} ---\n${reference.body}\n\n` +
          `--- ${file} ---\n${body}\n\n` +
          `Add new trackers to ALL FOUR files in lockstep, or the hot-path ` +
          `cleaners diverge silently.`,
      );
    }
  }
});
