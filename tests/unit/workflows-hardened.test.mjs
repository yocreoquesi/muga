/**
 * MUGA — Workflow Hardening Regression Tests
 *
 * Invariants that prevent CI security regressions from being silently
 * re-introduced: silenced lint, floating action tags, and missing
 * workflow-level permissions blocks.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, "../../.github/workflows");

// health-check.yml was removed (audit wave 4 – finding 4): it only ran
// npm test, duplicating PR CI with no additional signal. A meaningful
// canary will be re-added when a stable fixture set is available.
// validate-rules.yml and publish-rules.yml added in Phase 6 (T6.2, T6.3).
const WORKFLOW_FILES = ["ci.yml", "release.yml", "validate-rules.yml", "publish-rules.yml"];

function readWorkflow(name) {
  return readFileSync(join(workflowsDir, name), "utf8");
}

// ---------------------------------------------------------------------------
// Silenced lint guard
// ---------------------------------------------------------------------------
describe("silenced lint guard", () => {
  test("ci.yml does not silence web-ext lint with || true", () => {
    const content = readWorkflow("ci.yml");
    // Match any variant: "npm run lint || true", "npm run lint|| true", etc.
    const silenced = /npm\s+run\s+lint\s*\|\|\s*true/.test(content);
    assert.ok(
      !silenced,
      "ci.yml silences 'npm run lint' with '|| true' — remove the || true so lint failures are visible"
    );
  });
});

// ---------------------------------------------------------------------------
// SHA pinning — every `uses:` must reference a full 40-char commit SHA
// ---------------------------------------------------------------------------
describe("action SHA pinning", () => {
  for (const file of WORKFLOW_FILES) {
    test(`${file}: all 'uses:' lines reference a 40-char commit SHA`, () => {
      const content = readWorkflow(file);
      const lines = content.split("\n");
      const usesLines = lines.filter(l => /^\s+(-\s+)?uses:\s+\S/.test(l));

      assert.ok(
        usesLines.length > 0,
        `${file} has no 'uses:' lines — check the file is being read correctly`
      );

      for (const line of usesLines) {
        // Must match: uses: owner/repo@<40 hex chars>  (optional trailing comment)
        const pinned = /uses:\s+[a-zA-Z0-9/_.-]+@[a-f0-9]{40}(\s.*)?$/.test(line.trim());
        assert.ok(
          pinned,
          `${file} has an unpinned action: "${line.trim()}"\n` +
          "All 'uses:' references must use a 40-character commit SHA, not a tag or branch."
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Workflow-level permissions block
// ---------------------------------------------------------------------------
describe("workflow-level permissions block", () => {
  for (const file of WORKFLOW_FILES) {
    test(`${file}: has a workflow-level 'permissions:' block`, () => {
      const content = readWorkflow(file);
      // A workflow-level permissions block appears at the top level (no leading spaces)
      // before the first 'jobs:' key.
      const jobsIndex = content.indexOf("\njobs:");
      const preJobs = jobsIndex === -1 ? content : content.slice(0, jobsIndex);
      const hasPermissions = /^permissions:/m.test(preJobs);
      assert.ok(
        hasPermissions,
        `${file} is missing a workflow-level 'permissions:' block.\n` +
        "Add 'permissions: { contents: read }' at the top level (before 'jobs:') to apply least-privilege defaults."
      );
    });
  }
});
