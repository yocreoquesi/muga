/**
 * MUGA — Workflow npm-run script existence guard (#870)
 *
 * Every `npm run <script>` (or `npm run-script <script>`) reference in any
 * `.github/workflows/*.yml` file must resolve to a key in package.json
 * `scripts`. A workflow that references a retired or misspelled script silently
 * fails on every trigger — the "zombie workflow" class documented in #708 and #870.
 *
 * Exclusions (not `npm run`):
 *   - `npm ci`   — installs deps, not a user-defined script
 *   - `npm test` — shorthand for the built-in test lifecycle, not `npm run test`
 *
 * Patterns matched (per line, after splitting multiline run: blocks):
 *   npm run <script>
 *   npm run <script> -- <args>
 *   npm run-script <script>
 *   npm run-script <script> -- <args>
 *
 * Uses string/regex assertions only — no external YAML parser.
 * Follows the convention from workflow-hardening.test.mjs and workflows-hardened.test.mjs.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, "../../.github/workflows");
const packageJsonPath = join(__dirname, "../../package.json");

// ---------------------------------------------------------------------------
// Load known scripts from package.json
// ---------------------------------------------------------------------------
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const knownScripts = new Set(Object.keys(packageJson.scripts || {}));

// ---------------------------------------------------------------------------
// Discover all workflow files dynamically
// ---------------------------------------------------------------------------
const workflowFiles = readdirSync(workflowsDir).filter(f => f.endsWith(".yml"));

// ---------------------------------------------------------------------------
// Extract all `npm run <script>` references from a workflow file's content.
// Splits multiline `run:` blocks by newline and scans each line individually.
// Returns an array of script names referenced via `npm run` / `npm run-script`.
// ---------------------------------------------------------------------------
function extractNpmRunScripts(content) {
  const scripts = [];
  const lines = content.split("\n");
  // Matches: npm run <name> or npm run-script <name>
  // Captures the script name (first token after run/run-script, stops at whitespace or --)
  const NPM_RUN_RE = /\bnpm\s+run(?:-script)?\s+([a-zA-Z0-9:_.-]+)/g;

  for (const line of lines) {
    let match;
    while ((match = NPM_RUN_RE.exec(line)) !== null) {
      scripts.push(match[1]);
    }
    // Reset lastIndex for the regex (shared instance, used in loop)
    NPM_RUN_RE.lastIndex = 0;
  }

  return scripts;
}

// ---------------------------------------------------------------------------
// Guard: every npm run <script> in every workflow file must exist in package.json
// ---------------------------------------------------------------------------
describe("workflow npm-run script existence guard (#870)", () => {
  for (const file of workflowFiles) {
    test(`${file}: all 'npm run <script>' references exist in package.json scripts`, () => {
      const content = readFileSync(join(workflowsDir, file), "utf8");
      const referenced = extractNpmRunScripts(content);

      // Skip files with no npm run references (e.g. discovered-validate.yml)
      if (referenced.length === 0) return;

      const missing = referenced.filter(s => !knownScripts.has(s));

      assert.deepStrictEqual(
        missing,
        [],
        `${file} references npm scripts that do not exist in package.json:\n` +
        missing.map(s => `  - "npm run ${s}"`).join("\n") + "\n" +
        "Either add the script to package.json or remove/update the workflow step.\n" +
        "Known scripts: " + [...knownScripts].sort().join(", ")
      );
    });
  }
});
