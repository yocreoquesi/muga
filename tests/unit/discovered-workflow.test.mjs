/**
 * MUGA — Structural tests for .github/workflows/discovered-validate.yml
 *
 * Covers spec Domain 4 requirements:
 *   - Trigger paths include discovered/** and discovered.schema.json
 *   - permissions: contents: read appears before jobs:
 *   - Node 20 runtime
 *   - No --auto on any gh pr merge-style line
 *   - CODEOWNERS file exists at .github/CODEOWNERS with /discovered/ entry
 *
 * Uses string/regex assertions only (no external YAML parser — not in devDependencies).
 * Mirrors the pattern from tests/unit/ingestion-scheduled-workflow.test.mjs.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = join(
  __dirname,
  "../../.github/workflows/discovered-validate.yml"
);
const CODEOWNERS_PATH = join(__dirname, "../../.github/CODEOWNERS");

// ---------------------------------------------------------------------------
// Guard: workflow file must exist (fails RED before the yml is created)
// ---------------------------------------------------------------------------
describe("discovered-validate.yml existence", () => {
  test("file exists at .github/workflows/discovered-validate.yml", () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      `discovered-validate.yml does not exist at expected path: ${WORKFLOW_PATH}`
    );
  });
});

// ---------------------------------------------------------------------------
// Helper: read file once (only called when existence test passes)
// ---------------------------------------------------------------------------
function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// Trigger paths — must include discovered/** and discovered.schema.json
// ---------------------------------------------------------------------------
describe("trigger paths", () => {
  test("triggers on pull_request event", () => {
    const content = readWorkflow();
    assert.ok(
      /pull_request/.test(content),
      "discovered-validate.yml must have a pull_request trigger"
    );
  });

  test("triggers on push event", () => {
    const content = readWorkflow();
    assert.ok(
      /\bpush\b/.test(content),
      "discovered-validate.yml must have a push trigger"
    );
  });

  test("trigger paths include 'discovered/**'", () => {
    const content = readWorkflow();
    assert.ok(
      /discovered\/\*\*/.test(content),
      "discovered-validate.yml trigger paths must include 'discovered/**'"
    );
  });

  test("trigger paths include 'discovered.schema.json'", () => {
    const content = readWorkflow();
    assert.ok(
      /discovered\.schema\.json/.test(content),
      "discovered-validate.yml trigger paths must include 'discovered.schema.json'"
    );
  });

  test("trigger paths include tools/rule-ingestion/discovered-verify.mjs", () => {
    const content = readWorkflow();
    assert.ok(
      /tools\/rule-ingestion\/discovered-verify\.mjs/.test(content),
      "discovered-validate.yml trigger paths must include 'tools/rule-ingestion/discovered-verify.mjs'"
    );
  });

  test("trigger paths include tools/rule-ingestion/crawler-pubkey.txt", () => {
    const content = readWorkflow();
    assert.ok(
      /tools\/rule-ingestion\/crawler-pubkey\.txt/.test(content),
      "discovered-validate.yml trigger paths must include 'tools/rule-ingestion/crawler-pubkey.txt'"
    );
  });

  test("trigger paths include .github/workflows/discovered-validate.yml", () => {
    const content = readWorkflow();
    assert.ok(
      /\.github\/workflows\/discovered-validate\.yml/.test(content),
      "discovered-validate.yml trigger paths must include '.github/workflows/discovered-validate.yml'"
    );
  });
});

// ---------------------------------------------------------------------------
// Permissions: contents: read (and only that — no write permissions)
// ---------------------------------------------------------------------------
describe("permissions — contents: read only", () => {
  test("has workflow-level permissions block before jobs:", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /^permissions:/m.test(preJobs),
      "discovered-validate.yml must have a workflow-level 'permissions:' block before 'jobs:'"
    );
  });

  test("permissions includes contents: read", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /contents:\s*read/.test(preJobs),
      "permissions block must include 'contents: read'"
    );
  });

  test("permissions does NOT include contents: write", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      !/contents:\s*write/.test(preJobs),
      "permissions block must NOT include 'contents: write' — read-only is required"
    );
  });

  test("permissions does NOT include pull-requests: write", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      !/pull-requests:\s*write/.test(preJobs),
      "permissions block must NOT include 'pull-requests: write'"
    );
  });
});

// ---------------------------------------------------------------------------
// Node 20 runtime
// ---------------------------------------------------------------------------
describe("Node runtime version", () => {
  test("uses Node 20", () => {
    const content = readWorkflow();
    assert.ok(
      /node-version:\s*["']?20["']?/.test(content),
      "discovered-validate.yml must use Node 20 (node-version: '20' or node-version: 20)"
    );
  });

  test("does NOT use Node 22", () => {
    const content = readWorkflow();
    assert.ok(
      !/node-version:\s*["']?22["']?/.test(content),
      "discovered-validate.yml must NOT use Node 22 — repo convention is Node 20"
    );
  });
});

// ---------------------------------------------------------------------------
// No auto-merge — workflow must never auto-merge PRs
// ---------------------------------------------------------------------------
describe("no auto-merge", () => {
  test("does NOT use '--auto' flag in any gh pr merge command", () => {
    const content = readWorkflow();
    assert.ok(
      !/gh\s+pr\s+merge\s+.*--auto/.test(content),
      "discovered-validate.yml must NOT use 'gh pr merge --auto' — manual human review is required"
    );
  });

  test("does NOT contain 'auto-merge' as a workflow action", () => {
    const content = readWorkflow();
    // Check for any auto-merge mechanism (--auto flag style)
    assert.ok(
      !/--auto\b/.test(content),
      "discovered-validate.yml must NOT contain '--auto' flag (auto-merge is forbidden)"
    );
  });
});

// ---------------------------------------------------------------------------
// SHA pinning — all uses: lines must reference 40-char commit SHAs
// ---------------------------------------------------------------------------
describe("action SHA pinning", () => {
  test("all 'uses:' lines reference a 40-char commit SHA", () => {
    const content = readWorkflow();
    const lines = content.split("\n");
    const usesLines = lines.filter(l => /^\s+(-\s+)?uses:\s+\S/.test(l));

    assert.ok(
      usesLines.length > 0,
      "discovered-validate.yml has no 'uses:' lines — check the file is being read correctly"
    );

    for (const line of usesLines) {
      const pinned = /uses:\s+[a-zA-Z0-9/_.-]+@[a-f0-9]{40}(\s.*)?$/.test(line.trim());
      assert.ok(
        pinned,
        `discovered-validate.yml has an unpinned action: "${line.trim()}"\n` +
        "All 'uses:' references must use a 40-character commit SHA, not a tag or branch."
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Verifier step — node tools/rule-ingestion/discovered-verify.mjs must be present
// ---------------------------------------------------------------------------
describe("verifier step", () => {
  test("runs node tools/rule-ingestion/discovered-verify.mjs", () => {
    const content = readWorkflow();
    assert.ok(
      /node\s+tools\/rule-ingestion\/discovered-verify\.mjs/.test(content),
      "discovered-validate.yml must have a step that runs 'node tools/rule-ingestion/discovered-verify.mjs'"
    );
  });
});

// ---------------------------------------------------------------------------
// CODEOWNERS — .github/CODEOWNERS must exist with /discovered/ entry
// ---------------------------------------------------------------------------
describe("CODEOWNERS file", () => {
  test("CODEOWNERS file exists at .github/CODEOWNERS", () => {
    assert.ok(
      existsSync(CODEOWNERS_PATH),
      `.github/CODEOWNERS does not exist at expected path: ${CODEOWNERS_PATH}`
    );
  });

  test("CODEOWNERS contains /discovered/ entry", () => {
    const content = readFileSync(CODEOWNERS_PATH, "utf8");
    assert.ok(
      /^\/discovered\//m.test(content),
      "CODEOWNERS must contain a '/discovered/' ownership entry"
    );
  });
});
