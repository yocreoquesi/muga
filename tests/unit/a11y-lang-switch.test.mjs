/**
 * MUGA — document.documentElement.lang regression test (Finding 2)
 *
 * Verifies that both popup.js and options.js update document.documentElement.lang
 * when the language changes, matching the pattern already used in onboarding.js.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

describe("document.documentElement.lang is updated on language change", () => {
  const files = [
    { name: "popup.js",      path: join(ROOT, "src/popup/popup.js") },
    { name: "options.js",    path: join(ROOT, "src/options/options.js") },
    { name: "onboarding.js", path: join(ROOT, "src/onboarding/onboarding.js") },
  ];

  for (const { name, path } of files) {
    test(`${name}: contains document.documentElement.lang assignment`, () => {
      const source = readFileSync(path, "utf8");
      assert.ok(
        source.includes("document.documentElement.lang"),
        `${name} must assign document.documentElement.lang when applying a language — ` +
        "screen readers rely on this to announce content with correct phonetics"
      );
    });
  }
});
