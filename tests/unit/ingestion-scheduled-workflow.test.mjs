/**
 * MUGA — Structural tests for .github/workflows/auto-ingest-rules.yml
 *
 * Covers spec requirements R5-A, R5-B, R5-C, R8-A:
 *   R5-A  — cron "0 4 * * 0" + workflow_dispatch present
 *   R5-B  — permissions contents:write + pull-requests:write + concurrency block
 *   R5-C  — gates step appears BEFORE publish/sign step in file order
 *   R8-A  — gates step appears BEFORE branch/commit step in file order
 *
 * Additional structural assertions (R4-B, R6, R7 partial):
 *   - Key written to RUNNER_TEMP + ::add-mask:: present
 *   - Cleanup step with `if: always()` removes key
 *   - All `uses:` lines reference a 40-char commit SHA (belt-and-suspenders; authoritative in workflows-hardened)
 *   - No-op skip step gated on steps.pipeline.outputs.noop == 'true'
 *   - `gh pr merge --squash` present, `--auto` absent
 *   - `[skip ci]` present in commit message
 *   - Only tools/rules-source/params.json + docs/rules/v1/params.json added to git
 *
 * Uses string/regex assertions only (no external YAML parser — not in devDependencies).
 * Mirrors the pattern from tests/unit/workflows-hardened.test.mjs.
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
  "../../.github/workflows/auto-ingest-rules.yml"
);

// ---------------------------------------------------------------------------
// Guard: file must exist (fails RED before the yml is created)
// ---------------------------------------------------------------------------
describe("auto-ingest-rules.yml existence", () => {
  test("file exists at .github/workflows/auto-ingest-rules.yml", () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      `auto-ingest-rules.yml does not exist at expected path: ${WORKFLOW_PATH}`
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
// R5-A — Triggers: schedule cron + workflow_dispatch
// ---------------------------------------------------------------------------
describe("R5-A — triggers", () => {
  test("has schedule trigger with cron '0 4 * * 0' (weekly Sun 04:00 UTC)", () => {
    const content = readWorkflow();
    assert.ok(
      /cron:\s*["']0 4 \* \* 0["']/.test(content),
      "auto-ingest-rules.yml must have schedule cron '0 4 * * 0'"
    );
  });

  test("has workflow_dispatch trigger", () => {
    const content = readWorkflow();
    assert.ok(
      /workflow_dispatch/.test(content),
      "auto-ingest-rules.yml must have workflow_dispatch trigger"
    );
  });
});

// ---------------------------------------------------------------------------
// R5-B — Top-level permissions block
// ---------------------------------------------------------------------------
describe("R5-B — permissions", () => {
  test("has workflow-level permissions: contents: write", () => {
    const content = readWorkflow();
    // The permissions block appears before 'jobs:' at top level
    const jobsIdx = content.indexOf("\njobs:");
    const preJobs = jobsIdx === -1 ? content : content.slice(0, jobsIdx);
    assert.ok(
      /^permissions:/m.test(preJobs),
      "auto-ingest-rules.yml must have a workflow-level 'permissions:' block before 'jobs:'"
    );
    assert.ok(
      /contents:\s*write/.test(preJobs),
      "permissions block must include 'contents: write'"
    );
    assert.ok(
      /pull-requests:\s*write/.test(preJobs),
      "permissions block must include 'pull-requests: write'"
    );
  });
});

// ---------------------------------------------------------------------------
// R5-B — Concurrency block
// ---------------------------------------------------------------------------
describe("R5-B — concurrency", () => {
  test("has concurrency group 'auto-ingest-rules'", () => {
    const content = readWorkflow();
    assert.ok(
      /group:\s*auto-ingest-rules/.test(content),
      "auto-ingest-rules.yml must have concurrency group 'auto-ingest-rules'"
    );
  });

  test("concurrency cancel-in-progress: false", () => {
    const content = readWorkflow();
    assert.ok(
      /cancel-in-progress:\s*false/.test(content),
      "auto-ingest-rules.yml must have cancel-in-progress: false"
    );
  });
});

// ---------------------------------------------------------------------------
// SHA pinning (belt-and-suspenders; authoritative check is in workflows-hardened)
// ---------------------------------------------------------------------------
describe("action SHA pinning", () => {
  test("all 'uses:' lines reference a 40-char commit SHA", () => {
    const content = readWorkflow();
    const lines = content.split("\n");
    const usesLines = lines.filter(l => /^\s+(-\s+)?uses:\s+\S/.test(l));

    assert.ok(
      usesLines.length > 0,
      "auto-ingest-rules.yml has no 'uses:' lines — check the file is being read correctly"
    );

    for (const line of usesLines) {
      const pinned = /uses:\s+[a-zA-Z0-9/_.-]+@[a-f0-9]{40}(\s.*)?$/.test(line.trim());
      assert.ok(
        pinned,
        `auto-ingest-rules.yml has an unpinned action: "${line.trim()}"\n` +
        "All 'uses:' references must use a 40-character commit SHA, not a tag or branch."
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Key masking and cleanup (R4)
// ---------------------------------------------------------------------------
describe("signing key security — write, mask, cleanup", () => {
  test("writes signing key to RUNNER_TEMP", () => {
    const content = readWorkflow();
    assert.ok(
      /RUNNER_TEMP.*key\.pem|key\.pem.*RUNNER_TEMP/.test(content),
      "workflow must write key to $RUNNER_TEMP/key.pem"
    );
  });

  test("masks the key value with ::add-mask::", () => {
    const content = readWorkflow();
    assert.ok(
      /::add-mask::/.test(content),
      "workflow must use ::add-mask:: to redact the key from logs"
    );
  });

  test("cleanup step uses 'if: always()' to remove key.pem", () => {
    const content = readWorkflow();
    // The if: always() guard and the rm command must both be present
    assert.ok(
      /if:\s*always\(\)/.test(content),
      "workflow must have a cleanup step with 'if: always()'"
    );
    assert.ok(
      /rm\s+-f.*key\.pem/.test(content),
      "cleanup step must remove $RUNNER_TEMP/key.pem with 'rm -f'"
    );
  });
});

// ---------------------------------------------------------------------------
// No-op early exit (R2)
// ---------------------------------------------------------------------------
describe("no-op early exit", () => {
  test("has a step gated on steps.pipeline.outputs.noop == 'true'", () => {
    const content = readWorkflow();
    assert.ok(
      /steps\.pipeline\.outputs\.noop\s*==\s*['"]true['"]/.test(content),
      "workflow must have a step with if: steps.pipeline.outputs.noop == 'true' for early exit"
    );
  });

  test("subsequent steps are gated on steps.pipeline.outputs.noop == 'false'", () => {
    const content = readWorkflow();
    assert.ok(
      /steps\.pipeline\.outputs\.noop\s*==\s*['"]false['"]/.test(content),
      "workflow must gate publish/commit/PR steps on steps.pipeline.outputs.noop == 'false'"
    );
  });
});

// ---------------------------------------------------------------------------
// R5-C / R8-A — Gate ordering: gates BEFORE publish/sign step
// ---------------------------------------------------------------------------
describe("R5-C / R8-A — step ordering: gates before publish and commit", () => {
  test("npm test step appears before sign-rules.mjs publish step", () => {
    const content = readWorkflow();
    const npmTestIdx = content.indexOf("npm test");
    const signRulesIdx = content.indexOf("sign-rules.mjs");

    assert.ok(npmTestIdx !== -1, "workflow must include 'npm test' gate step");
    assert.ok(signRulesIdx !== -1, "workflow must include 'node tools/sign-rules.mjs' publish step");
    assert.ok(
      npmTestIdx < signRulesIdx,
      `'npm test' gate (pos ${npmTestIdx}) must appear BEFORE 'sign-rules.mjs' publish step (pos ${signRulesIdx})`
    );
  });

  test("npm test step appears before branch/commit step", () => {
    const content = readWorkflow();
    const npmTestIdx = content.indexOf("npm test");
    // Branch step creates auto-ingest/ branch
    const branchIdx = content.indexOf("auto-ingest/");

    assert.ok(npmTestIdx !== -1, "workflow must include 'npm test' gate step");
    assert.ok(branchIdx !== -1, "workflow must include a branch creation step with 'auto-ingest/'");
    assert.ok(
      npmTestIdx < branchIdx,
      `'npm test' gate (pos ${npmTestIdx}) must appear BEFORE branch creation (pos ${branchIdx})`
    );
  });

  test("sign-rules.mjs publish step appears before gh pr create step", () => {
    const content = readWorkflow();
    const signRulesIdx = content.indexOf("sign-rules.mjs");
    const prCreateIdx = content.indexOf("gh pr create");

    assert.ok(signRulesIdx !== -1, "workflow must include 'node tools/sign-rules.mjs' publish step");
    assert.ok(prCreateIdx !== -1, "workflow must include 'gh pr create' step");
    assert.ok(
      signRulesIdx < prCreateIdx,
      `publish step (pos ${signRulesIdx}) must appear BEFORE 'gh pr create' (pos ${prCreateIdx})`
    );
  });
});

// ---------------------------------------------------------------------------
// PR merge: --squash --auto (R5, PAT + auto-merge design decision)
// The PR is created via MUGA_PR_TOKEN (fine-grained PAT), which triggers
// ci.yml. --auto merges once required checks (test, e2e) pass, satisfying
// main's branch protection. --squash keeps the history clean.
// ---------------------------------------------------------------------------
describe("PR merge flags", () => {
  test("uses 'gh pr merge --squash'", () => {
    const content = readWorkflow();
    assert.ok(
      /gh\s+pr\s+merge\s+.*--squash/.test(content),
      "workflow must use 'gh pr merge --squash'"
    );
  });

  test("uses 'gh pr merge --auto' (PAT-created PR triggers ci.yml; --auto waits for required checks)", () => {
    const content = readWorkflow();
    assert.ok(
      /gh\s+pr\s+merge\s+.*--auto/.test(content),
      "workflow must use '--auto' with gh pr merge — the PR is created via MUGA_PR_TOKEN " +
      "(fine-grained PAT) which triggers ci.yml; --auto merges once test + e2e pass, " +
      "satisfying main's branch protection"
    );
  });
});

// ---------------------------------------------------------------------------
// Commit message contains [skip ci]
// ---------------------------------------------------------------------------
describe("commit message", () => {
  test("params commit does NOT use [skip ci] (would block the required PR checks)", () => {
    const content = readWorkflow();
    // Resolves the contradiction with the `--auto` contract above: branch
    // protection on main requires the test + e2e checks, and `gh pr merge
    // --auto` only completes once they pass. [skip ci] on the PR-branch commit
    // skips ci.yml → the checks never report → the PR stays BLOCKED forever.
    // A CI loop is NOT a risk: the post-merge push re-runs ci.yml (read-only)
    // and publish-rules.yml (idempotent no-op guard; its own commit carries
    // [skip ci]), so nothing re-triggers the ingestion workflow.
    assert.ok(
      !/git commit -m "chore\(rules\): auto-ingest params[^"]*\[skip ci\]/.test(content),
      "the auto-ingest params commit must NOT carry [skip ci] — it skips the " +
      "required PR checks and blocks the --auto merge forever"
    );
  });
});

// ---------------------------------------------------------------------------
// Only two params.json files are committed (explicit add — no broad staging)
// ---------------------------------------------------------------------------
describe("clean PR diff — only params.json files committed", () => {
  test("git add line explicitly names tools/rules-source/params.json", () => {
    const content = readWorkflow();
    // Must be a real `git add <files>` command, not just a path appearing in
    // a comment or body string — bare-path matches are tautological.
    assert.ok(
      /git add\s+.*tools\/rules-source\/params\.json/.test(content),
      "workflow must have an explicit 'git add ... tools/rules-source/params.json' command"
    );
  });

  test("git add line explicitly names docs/rules/v1/params.json", () => {
    const content = readWorkflow();
    assert.ok(
      /git add\s+.*docs\/rules\/v1\/params\.json/.test(content),
      "workflow must have an explicit 'git add ... docs/rules/v1/params.json' command"
    );
  });

  test("both params.json files appear on the same git add line", () => {
    const content = readWorkflow();
    // Verifies the commit scope is a single targeted add, not two separate adds
    // that could still accidentally admit a `git add -A` somewhere else.
    const line = content
      .split("\n")
      .find(l => /git add\s/.test(l) && /tools\/rules-source\/params\.json/.test(l));
    assert.ok(
      line !== undefined,
      "could not find a git add line containing tools/rules-source/params.json"
    );
    assert.ok(
      /docs\/rules\/v1\/params\.json/.test(line),
      `the git add line must also include docs/rules/v1/params.json. Found: "${line?.trim()}"`
    );
  });

  test("workflow does NOT use 'git add -A' (broad staging forbidden)", () => {
    const content = readWorkflow();
    assert.ok(
      !/git add\s+-A/.test(content),
      "workflow must NOT use 'git add -A' — commit scope must be explicit"
    );
  });

  test("workflow does NOT use 'git add .' (broad staging forbidden)", () => {
    const content = readWorkflow();
    assert.ok(
      !/git add\s+\.(\s|$)/.test(content),
      "workflow must NOT use 'git add .' — commit scope must be explicit"
    );
  });

  test("workflow does NOT use 'git commit -am' (broad staging forbidden)", () => {
    const content = readWorkflow();
    assert.ok(
      !/git commit\s+-[a-zA-Z]*a[a-zA-Z]*m|git commit\s+-[a-zA-Z]*m[a-zA-Z]*a/.test(content),
      "workflow must NOT use 'git commit -am' or 'git commit -ma' — commit scope must be explicit"
    );
  });
});

// ---------------------------------------------------------------------------
// Pipeline step uses npm run pipeline:rules script
// ---------------------------------------------------------------------------
describe("pipeline invocation", () => {
  test("runs pipeline via 'npm run pipeline:rules'", () => {
    const content = readWorkflow();
    assert.ok(
      /npm\s+run\s+pipeline:rules/.test(content),
      "workflow must invoke the pipeline via 'npm run pipeline:rules'"
    );
  });
});

// ---------------------------------------------------------------------------
// T-20 [RED] — quarantine review summary step (ADR-7)
// ---------------------------------------------------------------------------
describe("T-20 — quarantine review summary step", () => {
  test("workflow has an 'Emit quarantine review summary' step (or equivalent) that writes to $GITHUB_STEP_SUMMARY", () => {
    const content = readWorkflow();
    // Step must reference $GITHUB_STEP_SUMMARY (the GHA step summary sink)
    assert.ok(
      /GITHUB_STEP_SUMMARY/.test(content),
      "workflow must reference $GITHUB_STEP_SUMMARY for the quarantine review summary step"
    );
    // Step must invoke the format-surface formatter (via node or npm script)
    assert.ok(
      /format-surface\.mjs/.test(content),
      "workflow must invoke format-surface.mjs for the quarantine summary step"
    );
  });

  test("summary step is gated on steps.pipeline.conclusion == 'success' (NOT noop == false)", () => {
    const content = readWorkflow();
    // The summary step's if: condition must be the conclusion check
    assert.ok(
      /steps\.pipeline\.conclusion\s*==\s*['"]success['"]/.test(content),
      "summary step must use 'steps.pipeline.conclusion == \"success\"' (fires on both noop and non-noop success)"
    );
    // The summary step must NOT be gated on noop == 'false' (that would skip it on noop runs)
    // We check by ensuring the format-surface line does NOT appear in a block that ONLY has noop==false
    // Approach: confirm no 'if:' line immediately preceding format-surface.mjs references noop == 'false'
    const lines = content.split("\n");
    const surfaceLineIdx = lines.findIndex(l => /format-surface\.mjs/.test(l));
    assert.ok(surfaceLineIdx !== -1, "format-surface.mjs must be present in workflow");

    // Scan backwards from the format-surface line to find the nearest `if:` line
    let nearestIfLine = null;
    for (let i = surfaceLineIdx - 1; i >= 0; i--) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("if:")) {
        nearestIfLine = trimmed;
        break;
      }
      // Stop if we hit a `name:` or `run:` that indicates a different step boundary
      if (trimmed.startsWith("- name:")) break;
    }
    // The nearest if: must NOT gate on noop == 'false' (which would skip noop runs)
    if (nearestIfLine !== null) {
      assert.ok(
        !/noop\s*==\s*['"]false['"]/.test(nearestIfLine),
        `summary step 'if:' must NOT gate on noop == 'false'. Found: "${nearestIfLine}"`
      );
    }
  });

  test("summary step does NOT carry if: always() — only the key cleanup step does", () => {
    const content = readWorkflow();
    // This test is already enforced by the existing 'if:always() usage' describe block,
    // but we verify explicitly that adding the summary step does not add a second always().
    const lines = content.split("\n");
    const alwaysLines = lines.filter(l => {
      const trimmed = l.trimStart();
      return trimmed.startsWith("if:") && /if:\s*always\(\)/.test(trimmed);
    });
    assert.strictEqual(
      alwaysLines.length,
      1,
      `Exactly 1 YAML step field may be 'if: always()' (the cleanup step). Found ${alwaysLines.length}: ` +
      JSON.stringify(alwaysLines)
    );
  });

  test("PR-body step uses --body-file (not inline --body interpolation)", () => {
    const content = readWorkflow();
    // Must use --body-file for both gh pr create and gh pr edit
    assert.ok(
      /--body-file/.test(content),
      "workflow must use --body-file for PR body (not inline --body interpolation)"
    );
    // Must cat summary.md into the body file
    assert.ok(
      /cat\s+tools\/rule-ingestion\/quarantine\/summary\.md/.test(content),
      "workflow must concatenate summary.md into the PR body file"
    );
    // OLD inline pattern must be GONE: --body "$BODY" or --body "$...{BODY}"
    assert.ok(
      !/--body\s+"\$BODY"/.test(content),
      "workflow must NOT use '--body \"$BODY\"' inline interpolation (shell injection vector)"
    );
  });

  test("summary step has continue-on-error: true (off-critical-path backstop)", () => {
    const content = readWorkflow();
    // The summary step must have continue-on-error: true as belt-and-suspenders
    assert.ok(
      /continue-on-error:\s*true/.test(content),
      "Emit quarantine review summary step must have 'continue-on-error: true'"
    );
  });
});

// ---------------------------------------------------------------------------
// publish step must NOT carry if:always() — only cleanup does
// ---------------------------------------------------------------------------
describe("if:always() usage — only cleanup step", () => {
  test("only one non-comment line uses if: always() — the key cleanup step", () => {
    const content = readWorkflow();
    // Only count lines where `if: always()` appears as actual YAML (not in # comments).
    // A real YAML `if:` key appears on a line whose non-whitespace content starts with `if:`.
    const lines = content.split("\n");
    const alwaysLines = lines.filter(l => {
      const trimmed = l.trimStart();
      return trimmed.startsWith("if:") && /if:\s*always\(\)/.test(trimmed);
    });
    assert.strictEqual(
      alwaysLines.length,
      1,
      `Exactly 1 YAML step field may be 'if: always()' (the cleanup step). Found ${alwaysLines.length}: ` +
      JSON.stringify(alwaysLines) +
      ". Publish/PR steps must NOT have if:always() — gate failures must block them."
    );
  });
});
