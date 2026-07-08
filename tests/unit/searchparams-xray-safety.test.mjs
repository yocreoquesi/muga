/**
 * MUGA — Firefox Xray searchParams-iteration guard (#1009)
 *
 * Firefox content scripts run in an Xray sandbox. The iterator objects
 * returned by `URLSearchParams.prototype.keys()/values()/entries()` — and the
 * default `URLSearchParams[Symbol.iterator]` used by `for..of` and `[...sp]` —
 * have their `Symbol.iterator` filtered by Firefox's Xray wrappers, so those
 * forms throw "X.searchParams.keys() is not iterable" in a content script. The
 * IDENTICAL code runs fine in the background (service worker / MV3), which is
 * why the bug only surfaced on Firefox: `processUrl` crashed content-side,
 * killing the self-clean that applies affiliate-tag injection and SPA reclean,
 * while the background network stripper kept working.
 *
 * Fix + rule: never iterate a URLSearchParams via keys()/values()/entries()/
 * spread/for-of in code that can run as a content script. Use `.forEach()`
 * (a plain callback method, unaffected by Xray) and collect into a plain array.
 *
 * This guard bans the unsafe forms in every src/lib and src/content source so a
 * regression cannot silently re-crash the content-side cleaner on Firefox.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// Generated/minified artifact — derived from src/lib, so it is covered
// transitively; scanning its minified body would only add false positives.
const EXCLUDE = new Set(["cleaner-bundle.js"]);

/** Recursively collect .js/.mjs files under a directory. */
function collectSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectSources(full));
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Strip block and line comments so prose that mentions the pattern is ignored. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const UNSAFE = [
  {
    label: "searchParams.keys()/values()/entries()",
    re: /\.searchParams\.(?:keys|values|entries)\s*\(/,
  },
  {
    label: "for..of over a URLSearchParams (Symbol.iterator)",
    re: /for\s*\([^)]*\bof\b[^)]*\.searchParams\s*\)/,
  },
  {
    label: "spread of a URLSearchParams / its iterator",
    re: /\[\s*\.\.\.[^\]]*\.searchParams\b[^\]]*\]/,
  },
];

test("no Xray-unsafe URLSearchParams iteration in src/lib or src/content (#1009)", () => {
  const files = [
    ...collectSources(join(ROOT, "src/lib")),
    ...collectSources(join(ROOT, "src/content")),
  ];
  assert.ok(files.length > 0, "expected to scan some source files");

  const violations = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const { label, re } of UNSAFE) {
        if (re.test(line)) {
          violations.push(`${file.replace(ROOT + "\\", "").replace(ROOT + "/", "")}:${i + 1} — ${label}\n    ${line.trim()}`);
        }
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    "URLSearchParams must be iterated with .forEach() (Firefox Xray safety, #1009), " +
    "never keys()/values()/entries()/spread/for-of. Offenders:\n" + violations.join("\n"),
  );
});
