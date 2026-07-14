/**
 * MUGA — Source guard: the five synchronous content-script cleanUrl copies
 * must NOT rebuild the query with URLSearchParams (audit-2026-07 S3).
 *
 * Rebuilding via `searchParams.delete()` + `.toString()` re-encodes every
 * surviving param and can corrupt a signature/token computed over exact
 * bytes. The fix replaces that with a raw-query splice mirroring
 * src/lib/hot-path-strip.js `stripHotPathQuery`. This pins the corrupting
 * pattern out so a future edit can't silently reintroduce it.
 *
 * Behavioural coverage of the splice algorithm itself lives in
 * hot-path-strip-query.test.mjs; the real IIFE runtime path is covered by
 * the browser/e2e layer.
 */

import { test, describe } from "node:test";
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
  "window-name-defuser.js",
];

describe("hot-path cleanUrl copies use a byte-preserving splice, not URLSearchParams", () => {
  for (const file of FILES) {
    const src = readFileSync(join(__dirname, "../../src/content", file), "utf8");

    test(`${file} does not rebuild the query via searchParams.delete`, () => {
      assert.ok(
        !src.includes("searchParams.delete"),
        `${file} must not re-serialize the query with URLSearchParams — use the raw splice`
      );
    });

    test(`${file} carries the S3 splice marker`, () => {
      assert.ok(
        src.includes("audit-2026-07 S3"),
        `${file} must contain the raw-query splice (mirroring stripHotPathQuery)`
      );
    });
  }
});
