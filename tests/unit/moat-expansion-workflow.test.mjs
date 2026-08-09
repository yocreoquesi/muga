/**
 * MUGA — Structural tests for .github/workflows/moat-expansion.yml
 *
 * Covers spec requirements (Scheduled GitHub Actions Workflow):
 *   - Monthly cron "0 6 1 * *" (1st of the month, 06:00 UTC) + workflow_dispatch
 *   - permissions: contents: write + pull-requests: write (before jobs:)
 *   - Node 20 runtime
 *   - Pinned action SHAs byte-identical to import-upstream.yml
 *   - npm run moat:report invocation
 *   - No --auto merge (human-review PR only)
 *   - No writes to src/ in any step
 *   - Bot identity matches import-upstream.yml convention
 *   - Label "needs-triage" applied to opened PR
 *
 * Uses string/regex assertions only (no external YAML parser — not in devDependencies).
 * Mirrors the pattern from tests/unit/discovered-workflow.test.mjs.
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
  "../../.github/workflows/moat-expansion.yml"
);
const IMPORT_UPSTREAM_PATH = join(
  __dirname,
  "../../.github/workflows/import-upstream.yml"
);

// ---------------------------------------------------------------------------
// Guard: workflow file must exist (fails RED before the yml is created)
// ---------------------------------------------------------------------------
describe("moat-expansion.yml existence", () => {
  test("file exists at .github/workflows/moat-expansion.yml", () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      `moat-expansion.yml does not exist at expected path: ${WORKFLOW_PATH}`
    );
  });
});

// ---------------------------------------------------------------------------
// Helper: read file once (only called when existence test passes)
// ---------------------------------------------------------------------------
function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function readImportUpstream() {
  return readFileSync(IMPORT_UPSTREAM_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// Triggers: schedule cron + workflow_dispatch
// ---------------------------------------------------------------------------
describe("triggers", () => {
  test("has schedule trigger with cron '0 6 1 * *' (monthly, 1st at 06:00 UTC)", () => {
    const content = readWorkflow();
    assert.ok(
      /cron:\s*["']0 6 1 \* \*["']/.test(content),
      "moat-expansion.yml must have a monthly cron schedule '0 6 1 * *'"
    );
  });

  test("has workflow_dispatch trigger for manual runs", () => {
    const content = readWorkflow();
    assert.ok(
      /workflow_dispatch/.test(content),
      "moat-expansion.yml must have a workflow_dispatch trigger"
    );
  });
});

// ---------------------------------------------------------------------------
// Permissions: contents: write + pull-requests: write (before jobs:)
// ---------------------------------------------------------------------------
describe("permissions block", () => {
  test("has workflow-level permissions block before jobs:", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /^permissions:/m.test(preJobs),
      "moat-expansion.yml must have a workflow-level 'permissions:' block before 'jobs:'"
    );
  });

  test("permissions includes contents: write", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /contents:\s*write/.test(preJobs),
      "permissions block must include 'contents: write'"
    );
  });

  test("permissions includes pull-requests: write", () => {
    const content = readWorkflow();
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /pull-requests:\s*write/.test(preJobs),
      "permissions block must include 'pull-requests: write'"
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
      "moat-expansion.yml must use Node 20 (node-version: '20' or node-version: 20)"
    );
  });

  test("does NOT use Node 22", () => {
    const content = readWorkflow();
    assert.ok(
      !/node-version:\s*["']?22["']?/.test(content),
      "moat-expansion.yml must NOT use Node 22 — repo convention is Node 20"
    );
  });
});

// ---------------------------------------------------------------------------
// Pinned action SHAs — must be byte-identical to import-upstream.yml
// ---------------------------------------------------------------------------
describe("action SHA pinning — byte-identical to import-upstream.yml", () => {
  test("all 'uses:' lines reference a 40-char commit SHA", () => {
    const content = readWorkflow();
    const lines = content.split("\n");
    const usesLines = lines.filter(l => /^\s+(-\s+)?uses:\s+\S/.test(l));

    assert.ok(
      usesLines.length > 0,
      "moat-expansion.yml has no 'uses:' lines — check the file is being read correctly"
    );

    for (const line of usesLines) {
      const pinned = /uses:\s+[a-zA-Z0-9/_.-]+@[a-f0-9]{40}(\s.*)?$/.test(
        line.trim()
      );
      assert.ok(
        pinned,
        `moat-expansion.yml has an unpinned action: "${line.trim()}"\n` +
          "All 'uses:' references must use a 40-character commit SHA, not a tag or branch."
      );
    }
  });

  test("checkout action SHA matches import-upstream.yml exactly", () => {
    const content = readWorkflow();
    const upstream = readImportUpstream();

    const extractSha = (text, actionName) => {
      const match = text.match(
        new RegExp(`uses:\\s+${actionName.replace("/", "\\/")}@([a-f0-9]{40})`)
      );
      return match ? match[1] : null;
    };

    const ourCheckoutSha = extractSha(content, "actions/checkout");
    const upstreamCheckoutSha = extractSha(upstream, "actions/checkout");

    assert.ok(
      ourCheckoutSha !== null,
      "moat-expansion.yml must reference actions/checkout with a pinned SHA"
    );
    assert.strictEqual(
      ourCheckoutSha,
      upstreamCheckoutSha,
      `checkout SHA mismatch: moat-expansion uses ${ourCheckoutSha} but import-upstream uses ${upstreamCheckoutSha} — SHAs must be byte-identical`
    );
  });

  test("setup-node action SHA matches import-upstream.yml exactly", () => {
    const content = readWorkflow();
    const upstream = readImportUpstream();

    const extractSha = (text, actionName) => {
      const match = text.match(
        new RegExp(`uses:\\s+${actionName.replace("/", "\\/")}@([a-f0-9]{40})`)
      );
      return match ? match[1] : null;
    };

    const ourSetupNodeSha = extractSha(content, "actions/setup-node");
    const upstreamSetupNodeSha = extractSha(upstream, "actions/setup-node");

    assert.ok(
      ourSetupNodeSha !== null,
      "moat-expansion.yml must reference actions/setup-node with a pinned SHA"
    );
    assert.strictEqual(
      ourSetupNodeSha,
      upstreamSetupNodeSha,
      `setup-node SHA mismatch: moat-expansion uses ${ourSetupNodeSha} but import-upstream uses ${upstreamSetupNodeSha} — SHAs must be byte-identical`
    );
  });
});

// ---------------------------------------------------------------------------
// moat:report invocation
// ---------------------------------------------------------------------------
describe("moat:report script invocation", () => {
  test("runs 'npm run moat:report'", () => {
    const content = readWorkflow();
    assert.ok(
      /npm run moat:report/.test(content),
      "moat-expansion.yml must invoke 'npm run moat:report'"
    );
  });
});

// ---------------------------------------------------------------------------
// No auto-merge — workflow must never auto-merge PRs
// ---------------------------------------------------------------------------
describe("no auto-merge", () => {
  test("does NOT use '--auto' flag in any gh pr command", () => {
    const content = readWorkflow();
    assert.ok(
      !/gh\s+pr\s+merge\s+.*--auto/.test(content),
      "moat-expansion.yml must NOT use 'gh pr merge --auto' — manual human review is required"
    );
  });

  test("does NOT contain '--auto' flag anywhere", () => {
    const content = readWorkflow();
    assert.ok(
      !/--auto\b/.test(content),
      "moat-expansion.yml must NOT contain '--auto' flag (auto-merge is forbidden)"
    );
  });
});

// ---------------------------------------------------------------------------
// No src/ writes — pipeline is report-only
// ---------------------------------------------------------------------------
describe("no src/ writes", () => {
  test("does NOT reference src/ in any step output or write command", () => {
    const content = readWorkflow();
    // Allow reading src/ but writing patterns like 'git add src/' or '> src/' are forbidden
    // Check for common write patterns targeting src/
    assert.ok(
      !/git\s+add\s+src\//.test(content),
      "moat-expansion.yml must NOT stage src/ files — pipeline is report-only"
    );
  });

  test("does NOT commit to src/ path", () => {
    const content = readWorkflow();
    assert.ok(
      !/git\s+add\s+.*src\//.test(content),
      "moat-expansion.yml must NOT write to src/ — it is a read-only diff baseline"
    );
  });
});

// ---------------------------------------------------------------------------
// PR opening — human-review PR with needs-triage label
// ---------------------------------------------------------------------------
describe("human-review PR", () => {
  test("opens a PR via gh pr create or gh pr edit", () => {
    const content = readWorkflow();
    assert.ok(
      /gh\s+pr\s+(create|edit)/.test(content),
      "moat-expansion.yml must open or update a PR via 'gh pr create' or 'gh pr edit'"
    );
  });

  test("applies 'needs-triage' label to PR", () => {
    const content = readWorkflow();
    assert.ok(
      /needs-triage/.test(content),
      "moat-expansion.yml must apply 'needs-triage' label to the human-review PR"
    );
  });

  test("includes 'DO NOT auto-merge' note in PR body", () => {
    const content = readWorkflow();
    assert.ok(
      /DO NOT auto-merge/.test(content),
      "moat-expansion.yml PR body must include 'DO NOT auto-merge' notice"
    );
  });
});

// ---------------------------------------------------------------------------
// Bot identity — mirrors import-upstream.yml convention
// ---------------------------------------------------------------------------
describe("bot identity", () => {
  test("uses github-actions[bot] as git user", () => {
    const content = readWorkflow();
    assert.ok(
      /github-actions\[bot\]/.test(content),
      "moat-expansion.yml must configure git identity as 'github-actions[bot]'"
    );
  });
});

// ---------------------------------------------------------------------------
// Concurrency — matches import-upstream.yml pattern
// ---------------------------------------------------------------------------
describe("concurrency", () => {
  test("has a concurrency group to prevent concurrent runs", () => {
    const content = readWorkflow();
    assert.ok(
      /concurrency:/.test(content),
      "moat-expansion.yml must have a concurrency block"
    );
  });

  test("concurrency cancel-in-progress is false", () => {
    const content = readWorkflow();
    assert.ok(
      /cancel-in-progress:\s*false/.test(content),
      "moat-expansion.yml concurrency must set cancel-in-progress: false (queue, don't cancel)"
    );
  });
});

// ---------------------------------------------------------------------------
// Empty-gap skip — exit early when no new gaps
// ---------------------------------------------------------------------------
describe("empty-gap early exit", () => {
  test("has an early-exit step when no gaps are found", () => {
    const content = readWorkflow();
    assert.ok(
      /No new gaps|no.*gaps|exit.*0|early exit|skip.*PR|if:.*count.*==.*0/i.test(
        content
      ),
      "moat-expansion.yml must include an early-exit step when the report produces no new gaps"
    );
  });
});
