/**
 * MUGA — Regression test for the #703 fix (dom-link-rewriter).
 *
 * Both `src/content/dom-link-rewriter.js` and
 * `src/content/dom-link-rewriter-click.js` call the bundled
 * `window.__mugaCleaner.processUrl(raw)` and consume the result. The
 * bundled API returns `{ cleanUrl, ... }` — see `src/lib/cleaner.js`
 * `processUrl` JSDoc and the IIFE bundle. Before the #703 fix both files
 * read `out.url`, a property that does not exist, so the bundled cleaner
 * was silently ignored and the inline UTM-subset ran instead at click
 * time. DNR still caught most cases on navigation, but the click path
 * lost the full 459-pattern cleaner.
 *
 * This test pins the correct property name at the source level so a
 * future contributor cannot reintroduce the bug.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REWRITER_PATHS = [
  join(__dirname, "../../src/content/dom-link-rewriter.js"),
  join(__dirname, "../../src/content/dom-link-rewriter-click.js"),
];

describe("#703 — dom-link-rewriter consumes the bundled cleaner correctly", () => {
  for (const path of REWRITER_PATHS) {
    const source = readFileSync(path, "utf8");
    const fileLabel = path.replace(/^.*[\\/]/, "");

    test(`${fileLabel} reads out.cleanUrl, not out.url`, () => {
      assert.ok(
        source.includes("out.cleanUrl"),
        `${fileLabel} must consume the bundled processUrl's cleanUrl property`,
      );
      assert.ok(
        !/\bout\.url\b/.test(source),
        `${fileLabel} must not read out.url — that property does not exist on the bundled processUrl result and silently ignores the bundle`,
      );
    });
  }
});
