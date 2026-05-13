#!/usr/bin/env node
/**
 * CAPS test-vector runner.
 *
 * Loads the shared manifest and the per-level vector files (basic / full /
 * strict / contextual), runs each vector through the reference validator,
 * and reports any mismatches.
 *
 * Exits 0 if all vectors at the requested level pass, 1 otherwise.
 *
 * Usage:
 *   node runner.mjs                       # runs all levels
 *   node runner.mjs basic                 # positional — single level
 *   node runner.mjs basic full            # positional — multiple
 *   node runner.mjs --level=contextual    # flag form — single
 *   node runner.mjs --level=basic --level=contextual   # flag form — multiple
 *
 * The `contextual` level passes `level: "contextual"` to validate(), enabling
 * the Contextual conformance extension defined in SPEC §4.4.
 *
 * Used by:
 *   - The validator package's own test suite
 *   - CI on every push to caps-spec/main
 *   - Adopters who want to claim conformance — drop this script into their
 *     project, point it at their implementation, and verify they pass every
 *     vector for the level they claim.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "../validator/dist/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = __dir;

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

const ALL_LEVELS = ["basic", "full", "strict", "contextual"];

const rawArgs = process.argv.slice(2);
const flagged = rawArgs
  .filter((a) => a.startsWith("--level="))
  .map((a) => a.slice("--level=".length));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const requested = [...flagged, ...positional];
const levels = requested.length > 0 ? requested : ALL_LEVELS;

for (const lv of levels) {
  if (!ALL_LEVELS.includes(lv)) {
    console.error(`Unknown level: ${lv}. Valid: ${ALL_LEVELS.join(", ")}`);
    process.exit(2);
  }
}

let totalPass = 0;
let totalFail = 0;
const failures = [];

function deepEqualSorted(a, b) {
  // For decision arrays: order-insensitive comparison.
  // For preservedParams / removedParams: order matters (first-by-position rule).
  return JSON.stringify(a) === JSON.stringify(b);
}

for (const level of levels) {
  const vectors = JSON.parse(readFileSync(join(ROOT, `${level}.json`), "utf8"));
  console.log(`\n[${level}] running ${vectors.length} vectors`);
  for (const vector of vectors) {
    const result = validate({
      url: vector.input.url,
      manifest: MANIFEST,
      ownerTag: vector.input.ownerTag,
      // Contextual extension is opt-in per SPEC §4.4. The runner forwards the
      // "contextual" level to the validator only when this vector file is the
      // contextual one — every other level uses the default Basic behaviour.
      level: level === "contextual" ? "contextual" : undefined,
    });
    // The validator emits notes; vectors do not assert on notes.
    const observed = {
      decision: [...result.decision].sort(),
      preservedParams: result.preservedParams,
      removedParams: result.removedParams,
    };
    const expected = {
      decision: [...vector.expected.decision].sort(),
      preservedParams: vector.expected.preservedParams,
      removedParams: vector.expected.removedParams,
    };

    if (deepEqualSorted(observed, expected)) {
      totalPass++;
      console.log(`  ✔ ${vector.name}`);
    } else {
      totalFail++;
      failures.push({ level, vector, observed, expected });
      console.log(`  ✘ ${vector.name}`);
    }
  }
}

console.log(`\n${totalPass} passing, ${totalFail} failing.`);

if (totalFail > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`\n[${f.level}] ${f.vector.name}`);
    console.log(`  expected:`, JSON.stringify(f.expected, null, 2).split("\n").join("\n  "));
    console.log(`  observed:`, JSON.stringify(f.observed, null, 2).split("\n").join("\n  "));
  }
  process.exit(1);
}
