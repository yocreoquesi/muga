/**
 * scripts/generate-dnr-rules.mjs
 *
 * Build-time generator for the wrapper unwrap DNR ruleset.  Reads the WRAPPERS
 * table from src/lib/wrapper-engine.js, runs it through the pure builder in
 * src/lib/wrapper-dnr-builder.js, and writes the result to
 * src/rules/wrapper-dnr-rules.json.  The MV3 manifest references that file
 * via declarative_net_request.rule_resources so the browser performs the
 * unwrap before the wrapper server is contacted.
 *
 * Usage:
 *   node scripts/generate-dnr-rules.mjs
 *   npm run build:dnr
 *
 * Idempotent: running twice produces byte-identical output.  The generated
 * file is committed to the repo so the manifest can reference it without a
 * build step in dev mode.
 *
 * URL-decode caveat (issue #449, deferred Playwright validation):
 *   Chromium's regexSubstitution copies the captured group verbatim — it does
 *   not URL-decode.  When a wrapper carries the destination as ?p=https%3A%2F
 *   %2Fmerchant.com%2Fpath, the redirect target is the percent-encoded URL.
 *   Browsers re-parse that target and most servers tolerate the encoding,
 *   but the empirical confirmation belongs to a future Playwright network
 *   test.  Until then the runtime engine remains the safety net for the same
 *   wrappers.
 *
 * Resolves a chunk of issue #449.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { WRAPPERS } from "../src/lib/wrapper-engine.js";
import {
  buildDnrRules,
  validateDnrRules,
} from "../src/lib/wrapper-dnr-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, "../src/rules/wrapper-dnr-rules.json");

const rules = buildDnrRules(WRAPPERS);
const { ok, warnings } = validateDnrRules(rules);

for (const warning of warnings) {
  process.stderr.write(`[generate-dnr-rules] ${warning}\n`);
}
if (!ok) {
  process.stderr.write("[generate-dnr-rules] validation failed — refusing to write output\n");
  process.exit(1);
}

const serialized = JSON.stringify(rules, null, 2) + "\n";

// Idempotency check: if the file already contains the same bytes, skip the
// write so file mtime stays stable for downstream watchers.
let existing = null;
try {
  existing = readFileSync(outputPath, "utf8");
} catch {
  // First run — file does not exist yet.
}

if (existing !== serialized) {
  writeFileSync(outputPath, serialized, "utf8");
  process.stdout.write(`[generate-dnr-rules] wrote ${rules.length} rules to ${outputPath}\n`);
} else {
  process.stdout.write(
    `[generate-dnr-rules] ${rules.length} rules already up to date at ${outputPath}\n`,
  );
}
