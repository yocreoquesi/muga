/**
 * MUGA — Workflow Hardening Guard Tests (#812)
 *
 * Guards for CI security patterns introduced in the #812 hardening wave:
 *
 *  G1 — All `uses:` in import-upstream.yml, publish-rules.yml,
 *       auto-ingest-rules.yml, and validate-rules.yml are SHA-pinned (40-char)
 *  G2 — import-upstream.yml uses --body-file (no `--body "$BODY"` interpolation)
 *  G3 — auto-ingest-rules.yml and publish-rules.yml mask PEM line-by-line
 *       (no `::add-mask::$(cat ...key.pem)`)
 *  G4 — publish-rules.yml uses the github-actions[bot] identity (not personal email)
 *
 * Uses string/regex assertions only — no external YAML parser.
 * Mirrors the pattern from tests/unit/ingestion-scheduled-workflow.test.mjs.
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

function readWorkflow(name) {
  return readFileSync(join(workflowsDir, name), "utf8");
}

// ---------------------------------------------------------------------------
// G1 — SHA pinning for all four target workflows
// ---------------------------------------------------------------------------
describe("G1 — SHA pinning across all hardened workflows", () => {
  const FILES = [
    "import-upstream.yml",
    "publish-rules.yml",
    "auto-ingest-rules.yml",
    "validate-rules.yml",
  ];

  for (const file of FILES) {
    test(`${file}: all 'uses:' lines reference a 40-char commit SHA`, () => {
      const content = readWorkflow(file);
      const lines = content.split("\n");
      const usesLines = lines.filter(l => /^\s+(-\s+)?uses:\s+\S/.test(l));

      assert.ok(
        usesLines.length > 0,
        `${file} has no 'uses:' lines — check the file is being read correctly`
      );

      for (const line of usesLines) {
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
// G2 — import-upstream.yml must use --body-file (no shell-injection vector)
// ---------------------------------------------------------------------------
describe("G2 — import-upstream.yml PR body safety", () => {
  test("does NOT contain '--body \"$BODY\"' inline interpolation", () => {
    const content = readWorkflow("import-upstream.yml");
    assert.ok(
      !/--body\s+"\$BODY"/.test(content),
      "import-upstream.yml must NOT use '--body \"$BODY\"' — this is a shell-injection vector. " +
      "Use --body-file with printf '%s\\n' \"$BODY\" > file instead."
    );
  });

  test("uses --body-file for both gh pr edit and gh pr create", () => {
    const content = readWorkflow("import-upstream.yml");
    assert.ok(
      /--body-file/.test(content),
      "import-upstream.yml must use --body-file for PR body (not inline --body interpolation)"
    );
  });
});

// ---------------------------------------------------------------------------
// G3 — PEM masking must be line-by-line (no collapsed newline risk)
// ---------------------------------------------------------------------------
describe("G3 — line-by-line PEM masking (no collapsed ::add-mask::$(cat ...))", () => {
  const FILES_WITH_PEM = ["auto-ingest-rules.yml", "publish-rules.yml"];

  for (const file of FILES_WITH_PEM) {
    test(`${file}: does NOT use '::add-mask::$(cat' (collapsed-newline masking)`, () => {
      const content = readWorkflow(file);
      assert.ok(
        !/::add-mask::\$\(cat/.test(content),
        `${file} uses '::add-mask::$(cat ...)' which collapses newlines and leaves individual ` +
        "PEM lines unmasked. Replace with line-by-line: " +
        "while IFS= read -r line; do echo \"::add-mask::$line\"; done < \"$RUNNER_TEMP/key.pem\""
      );
    });

    test(`${file}: uses line-by-line PEM masking (while IFS= read -r loop)`, () => {
      const content = readWorkflow(file);
      assert.ok(
        /while\s+IFS=\s+read\s+-r\s+line/.test(content) ||
        /while\s+IFS=\s*read\s+-r\s+line/.test(content),
        `${file} must mask PEM line-by-line using: ` +
        "while IFS= read -r line; do echo \"::add-mask::$line\"; done < \"$RUNNER_TEMP/key.pem\""
      );
    });
  }
});

// ---------------------------------------------------------------------------
// G4 — publish-rules.yml must use github-actions[bot] identity
// ---------------------------------------------------------------------------
describe("G4 — publish-rules.yml bot identity", () => {
  test("does NOT contain personal email (yocreoquesi@gmail.com)", () => {
    const content = readWorkflow("publish-rules.yml");
    assert.ok(
      !content.includes("yocreoquesi@gmail.com"),
      "publish-rules.yml must NOT use a personal email address for git config. " +
      "Use '41898282+github-actions[bot]@users.noreply.github.com' instead."
    );
  });

  test("uses github-actions[bot] as git user.name", () => {
    const content = readWorkflow("publish-rules.yml");
    assert.ok(
      /github-actions\[bot\]/.test(content),
      "publish-rules.yml must use 'github-actions[bot]' as the git commit identity"
    );
  });

  test("uses the canonical noreply address for github-actions[bot]", () => {
    const content = readWorkflow("publish-rules.yml");
    assert.ok(
      /41898282\+github-actions\[bot\]@users\.noreply\.github\.com/.test(content),
      "publish-rules.yml must use '41898282+github-actions[bot]@users.noreply.github.com' " +
      "as the git commit email"
    );
  });
});
