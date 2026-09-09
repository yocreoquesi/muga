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

  // The assertion above passes on ONE assignment anywhere in the file, and that
  // is how options.js shipped three language paths with only one of them moving
  // the root's lang: init rendered every non-English locale under lang="en"
  // until the user touched the language <select>, and importing settings with a
  // language in them did the same (#1260).
  //
  // So the unit is the CALL SITE, not the file: rendering a language and
  // declaring it are one action, and a site that does the first without the
  // second announces Spanish copy with an English phonetic profile.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const { name, path } of files) {
    test(`${name}: every applyTranslations call site also sets the root lang`, () => {
      const source = stripComments(readFileSync(path, "utf8"));
      const sites = [...source.matchAll(/applyTranslations\(/g)].map((m) => m.index);
      assert.ok(sites.length > 0, `${name} should call applyTranslations at least once`);

      for (const at of sites) {
        const window = source.slice(Math.max(0, at - 400), at + 400);
        assert.ok(
          window.includes("document.documentElement.lang"),
          `${name}: an applyTranslations call site at offset ${at} renders a language ` +
            "without setting document.documentElement.lang near it. Every path that " +
            "changes the rendered language must move the root's lang with it."
        );
      }
    });
  }
});
