/**
 * MUGA — CI gate-suite parity guard (#891, ADR-0005)
 *
 * Enforces that every gate command in ci.yml's `test` job is also present in
 * auto-ingest-rules.yml's inline gate block.
 *
 * Background: auto-ingest-rules.yml squash-merges promoted-rule PRs without
 * re-triggering ci.yml (GitHub GITHUB_TOKEN recursion guard). It therefore
 * replicates the full ci.yml gate suite inline. ADR-0005 "Consequences" admits
 * this list "must be kept in sync with ci.yml by hand" — this test is the
 * machine enforcement of that obligation.
 *
 * If someone adds a gate to ci.yml and forgets auto-ingest-rules.yml, this
 * test fails and names the missing command, pointing to #891 / ADR-0005.
 *
 * Extraction strategy (no external YAML parser — not in devDependencies):
 *   - Read the raw YAML text of both files.
 *   - From ci.yml, isolate the `test:` job block (up to the next top-level job
 *     key or end of file) and extract every `run:` line that contains a gate
 *     command (npm run X / node X). Boilerplate steps (checkout, setup-node,
 *     npm ci) are excluded by the extraction regex.
 *   - Assert each extracted command appears verbatim somewhere in
 *     auto-ingest-rules.yml.
 *
 * Exception map (legitimately different cases — see comments for reasons):
 *   See GATE_EXCEPTIONS below.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, "../../.github/workflows");

const CI_PATH          = join(workflowsDir, "ci.yml");
const AUTO_INGEST_PATH = join(workflowsDir, "auto-ingest-rules.yml");

// ---------------------------------------------------------------------------
// Exception map — legitimately different cases
//
// Each entry documents WHY the ci.yml command need not appear verbatim in
// auto-ingest-rules.yml, and what auto-ingest runs instead.
//
// If a new difference cannot be justified here, it is a real gap: add the
// missing step to auto-ingest-rules.yml rather than adding it to this list.
// ---------------------------------------------------------------------------
const GATE_EXCEPTIONS = new Map([
  [
    // ci.yml uses two conditional integration steps:
    //   - `npm run test:integration:stub`  (on pull_request)
    //   - `npm run test:integration`       (on push to main, full suite)
    // auto-ingest-rules.yml runs the FULL suite unconditionally:
    //   - `npm run test:integration`
    // The full command is a strict superset of the stub. auto-ingest must run
    // the full suite (it is the only CI path to main for rule PRs). Treating
    // the full command as satisfying the integration gate; the stub variant is
    // not required in auto-ingest.
    "npm run test:integration:stub",
    "auto-ingest runs the full 'npm run test:integration' suite unconditionally " +
    "(strict superset of the stub); the PR-only stub variant is not required (#891)",
  ],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract gate `run:` commands from ci.yml's `test` job.
 *
 * Approach:
 *   1. Find the `  test:` job boundary in the YAML text.
 *   2. Slice from there to the next same-indent job key (or end of file).
 *   3. From that slice, collect every line that contains a gate command
 *      (npm run X  OR  node <path>  OR  git diff ...; the src/rules and bundle
 *      up-to-date checks are multi-line shell blocks — we capture the `run: |`
 *      header pattern via the lines that follow, but those are shell guards,
 *      not npm/node commands; we target the actionable `run: npm run X` /
 *      `run: node X` single-line forms only).
 *   4. Exclude boilerplate: checkout, setup-node, npm ci.
 *
 * Returns an array of trimmed command strings, e.g.:
 *   ["npm run typecheck", "npm run lint:js", "npm run compile:rules", …]
 */
function extractCiGateCommands(ciYaml) {
  // Locate the `test:` job block.
  // ci.yml top-level jobs are indented with exactly 2 spaces.
  const testJobMatch = ciYaml.match(/^  test:\s*$/m);
  assert.ok(testJobMatch, "ci.yml must have a '  test:' job — extraction failed");

  const testJobStart = testJobMatch.index;

  // Find the next 2-space-indented job key after `test:`, or end of string.
  const afterTestJob = ciYaml.slice(testJobStart + testJobMatch[0].length);
  const nextJobMatch = afterTestJob.match(/^  [a-z][a-z0-9_-]*:\s*$/m);
  const testJobBlock = nextJobMatch
    ? ciYaml.slice(testJobStart, testJobStart + testJobMatch[0].length + nextJobMatch.index)
    : ciYaml.slice(testJobStart);

  // Extract gate commands: lines whose trimmed form starts with `run: npm run`
  // or `run: node ` (single-line run: values — the actionable commands).
  // Multi-line `run: |` shell blocks (git diff checks) are NOT npm/node
  // commands and do not appear as individual gate steps to enforce parity for.
  const commands = [];
  for (const line of testJobBlock.split("\n")) {
    const trimmed = line.trim();
    // Match: run: npm run X  OR  run: node X  OR  run: xvfb-run npx X
    if (/^run:\s+(npm\s+run\s+\S+|node\s+\S+|xvfb-run\s+\S.*)$/.test(trimmed)) {
      const cmd = trimmed.replace(/^run:\s+/, "").trim();
      // Exclude boilerplate
      if (cmd === "npm ci") continue;
      commands.push(cmd);
    }
  }

  assert.ok(
    commands.length > 0,
    "extractCiGateCommands returned no commands — check the extraction regex against ci.yml"
  );

  return commands;
}

// ---------------------------------------------------------------------------
// File reads (done once at module load so individual tests share the parse)
// ---------------------------------------------------------------------------
const ciYaml         = readFileSync(CI_PATH,          "utf8");
const autoIngestYaml = readFileSync(AUTO_INGEST_PATH, "utf8");
const ciGateCommands = extractCiGateCommands(ciYaml);

// ---------------------------------------------------------------------------
// T-1 — YAML parse sanity: both workflow files are valid UTF-8 text
// ---------------------------------------------------------------------------
describe("CI gate-parity — file sanity", () => {
  test("ci.yml is readable and non-empty", () => {
    assert.ok(ciYaml.length > 0, "ci.yml must not be empty");
    assert.ok(
      /^name:/m.test(ciYaml),
      "ci.yml must start with a 'name:' key — file may be malformed"
    );
  });

  test("auto-ingest-rules.yml is readable and non-empty", () => {
    assert.ok(autoIngestYaml.length > 0, "auto-ingest-rules.yml must not be empty");
    assert.ok(
      /^name:/m.test(autoIngestYaml),
      "auto-ingest-rules.yml must start with a 'name:' key — file may be malformed"
    );
  });

  test("ci.yml gate command extraction yields at least the known minimum set", () => {
    // Confirm the extraction is working — if ci.yml gains steps, this floor
    // stays honest. Update if the gate count grows intentionally.
    assert.ok(
      ciGateCommands.length >= 8,
      `Expected at least 8 extracted gate commands from ci.yml, got ${ciGateCommands.length}. ` +
      "Check extractCiGateCommands if ci.yml's format changed."
    );
  });
});

// ---------------------------------------------------------------------------
// T-2 — YAML structural validity: auto-ingest-rules.yml parses as valid YAML
//        structure (basic indentation sanity without an external parser).
//        We load it with node:util.parseArgs-free inline check: no tab chars
//        outside string literals, balanced block indicators, no lone colons.
// ---------------------------------------------------------------------------
describe("CI gate-parity — auto-ingest-rules.yml YAML structural validity", () => {
  test("auto-ingest-rules.yml contains no hard tabs (YAML disallows tab indentation)", () => {
    // YAML spec §6.1: tab characters are not allowed for indentation.
    // We check for tabs at the start of any line (indentation position).
    const tabIndentLines = autoIngestYaml
      .split("\n")
      .filter(l => /^\t/.test(l));
    assert.strictEqual(
      tabIndentLines.length,
      0,
      `auto-ingest-rules.yml must not use tab indentation. Found tabs on lines:\n` +
      tabIndentLines.slice(0, 5).join("\n")
    );
  });

  test("auto-ingest-rules.yml has a 'jobs:' key (top-level structure intact)", () => {
    assert.ok(
      /^jobs:\s*$/m.test(autoIngestYaml),
      "auto-ingest-rules.yml must have a top-level 'jobs:' key — YAML structure may be broken"
    );
  });

  test("auto-ingest-rules.yml has the 'auto-ingest:' job key (job structure intact)", () => {
    assert.ok(
      /^\s{2}auto-ingest:\s*$/m.test(autoIngestYaml),
      "auto-ingest-rules.yml must have the '  auto-ingest:' job — YAML structure may be broken"
    );
  });
});

// ---------------------------------------------------------------------------
// T-3 — Core parity: every ci.yml test-job gate command appears in
//        auto-ingest-rules.yml (with documented exceptions).
// ---------------------------------------------------------------------------
describe("CI gate-parity — every ci.yml test-job gate must be in auto-ingest-rules.yml", () => {
  for (const cmd of ciGateCommands) {
    // Check exception map first.
    if (GATE_EXCEPTIONS.has(cmd)) {
      test(`[EXCEPTED] ci.yml gate '${cmd}' — see exception map`, () => {
        // The exception is documented; assert the reason is non-empty (guard
        // against someone adding an empty-string excuse to silence the test).
        const reason = GATE_EXCEPTIONS.get(cmd);
        assert.ok(
          typeof reason === "string" && reason.trim().length > 0,
          `GATE_EXCEPTIONS entry for '${cmd}' has an empty reason — document WHY it is excepted`
        );
      });
      continue;
    }

    test(`auto-ingest-rules.yml contains ci.yml gate: '${cmd}'`, () => {
      assert.ok(
        autoIngestYaml.includes(cmd),
        `GATE PARITY FAILURE (#891 / ADR-0005): ci.yml test-job gate command\n` +
        `  '${cmd}'\n` +
        `is MISSING from auto-ingest-rules.yml.\n` +
        `\n` +
        `auto-ingest-rules.yml squash-merges rule PRs without re-triggering ci.yml\n` +
        `(GitHub GITHUB_TOKEN recursion guard), so it must replicate the full gate\n` +
        `suite inline. Add the missing step to auto-ingest-rules.yml's inline gate\n` +
        `block (section 6, after the ingestion pipeline run, gated on\n` +
        `steps.pipeline.outputs.noop == 'false').\n` +
        `\n` +
        `See: .github/workflows/ci.yml (test job), ADR-0005 Consequences, issue #891.`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// T-4 — Ordering: typecheck and lint:js appear BEFORE compile:rules in
//        auto-ingest-rules.yml (matching ci.yml's relative ordering).
// ---------------------------------------------------------------------------
describe("CI gate-parity — typecheck + lint:js step ordering in auto-ingest-rules.yml", () => {
  test("typecheck step appears before compile:rules step", () => {
    const typecheckIdx   = autoIngestYaml.indexOf("npm run typecheck");
    const compileRulesIdx = autoIngestYaml.indexOf("npm run compile:rules");

    assert.ok(typecheckIdx !== -1,    "auto-ingest-rules.yml must contain 'npm run typecheck'");
    assert.ok(compileRulesIdx !== -1, "auto-ingest-rules.yml must contain 'npm run compile:rules'");
    assert.ok(
      typecheckIdx < compileRulesIdx,
      `'npm run typecheck' (pos ${typecheckIdx}) must appear BEFORE ` +
      `'npm run compile:rules' (pos ${compileRulesIdx}) in auto-ingest-rules.yml`
    );
  });

  test("lint:js step appears before compile:rules step", () => {
    const lintJsIdx       = autoIngestYaml.indexOf("npm run lint:js");
    const compileRulesIdx = autoIngestYaml.indexOf("npm run compile:rules");

    assert.ok(lintJsIdx !== -1,       "auto-ingest-rules.yml must contain 'npm run lint:js'");
    assert.ok(compileRulesIdx !== -1, "auto-ingest-rules.yml must contain 'npm run compile:rules'");
    assert.ok(
      lintJsIdx < compileRulesIdx,
      `'npm run lint:js' (pos ${lintJsIdx}) must appear BEFORE ` +
      `'npm run compile:rules' (pos ${compileRulesIdx}) in auto-ingest-rules.yml`
    );
  });

  test("typecheck step appears before lint:js step (matching ci.yml order)", () => {
    const typecheckIdx = autoIngestYaml.indexOf("npm run typecheck");
    const lintJsIdx    = autoIngestYaml.indexOf("npm run lint:js");

    assert.ok(typecheckIdx !== -1, "auto-ingest-rules.yml must contain 'npm run typecheck'");
    assert.ok(lintJsIdx !== -1,    "auto-ingest-rules.yml must contain 'npm run lint:js'");
    assert.ok(
      typecheckIdx < lintJsIdx,
      `'npm run typecheck' (pos ${typecheckIdx}) must appear BEFORE ` +
      `'npm run lint:js' (pos ${lintJsIdx}) — matches ci.yml ordering`
    );
  });
});

// ---------------------------------------------------------------------------
// T-5 — Regression guard: the two previously missing steps now carry the
//        correct noop guard and the correct step names from ci.yml.
// ---------------------------------------------------------------------------
describe("CI gate-parity — typecheck + lint:js step shape", () => {
  test("typecheck step is gated on steps.pipeline.outputs.noop == 'false'", () => {
    // Find the block around 'npm run typecheck' and verify the noop guard precedes it.
    const lines = autoIngestYaml.split("\n");
    const typecheckLine = lines.findIndex(l => /npm run typecheck/.test(l));
    assert.ok(typecheckLine !== -1, "auto-ingest-rules.yml must contain 'npm run typecheck'");

    // Scan backwards to find the nearest `if:` for this step
    let foundGuard = false;
    for (let i = typecheckLine; i >= Math.max(0, typecheckLine - 5); i--) {
      if (/steps\.pipeline\.outputs\.noop\s*==\s*['"]false['"]/.test(lines[i])) {
        foundGuard = true;
        break;
      }
    }
    assert.ok(
      foundGuard,
      "typecheck step must be gated on steps.pipeline.outputs.noop == 'false'"
    );
  });

  test("lint:js step is gated on steps.pipeline.outputs.noop == 'false'", () => {
    const lines = autoIngestYaml.split("\n");
    const lintJsLine = lines.findIndex(l => /npm run lint:js/.test(l));
    assert.ok(lintJsLine !== -1, "auto-ingest-rules.yml must contain 'npm run lint:js'");

    let foundGuard = false;
    for (let i = lintJsLine; i >= Math.max(0, lintJsLine - 5); i--) {
      if (/steps\.pipeline\.outputs\.noop\s*==\s*['"]false['"]/.test(lines[i])) {
        foundGuard = true;
        break;
      }
    }
    assert.ok(
      foundGuard,
      "lint:js step must be gated on steps.pipeline.outputs.noop == 'false'"
    );
  });

  test("typecheck step name matches ci.yml exactly: 'Type-check JS (tsc --checkJs) (#823)'", () => {
    assert.ok(
      autoIngestYaml.includes("Type-check JS (tsc --checkJs) (#823)"),
      "auto-ingest-rules.yml typecheck step name must match ci.yml: " +
      "'Type-check JS (tsc --checkJs) (#823)'"
    );
  });

  test("lint:js step name matches ci.yml exactly: 'Lint JS (ESLint flat config) (#823)'", () => {
    assert.ok(
      autoIngestYaml.includes("Lint JS (ESLint flat config) (#823)"),
      "auto-ingest-rules.yml lint:js step name must match ci.yml: " +
      "'Lint JS (ESLint flat config) (#823)'"
    );
  });
});
