/**
 * MUGA — Workflow Hardening Guard Tests (#812, #814)
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
 * G5 — release.yml gates store publishing on unit + integration + E2E jobs (#814)
 *       The publish job must declare `needs: [test, e2e]` so that both gate jobs
 *       must pass before AMO / CWS submissions are attempted.
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
    "cmp-canary.yml",
    // firefox-smoke.yml added with the Firefox WebExtension smoke harness CI
    // gate (#1128) — a new workflow must never escape this hardening net.
    "firefox-smoke.yml",
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

// ---------------------------------------------------------------------------
// G5 — release.yml: store publishing gated on unit + integration + E2E (#814)
//
// The release workflow must have three jobs:
//   test         — runs npm test (unit) AND npm run test:integration
//   e2e          — runs the full Playwright suite via xvfb-run
//   build-and-release — the publish job; must declare needs: [test, e2e]
//
// This structural assertion prevents silent regressions where a runtime-only
// bug (DNR propagation, content-script injection, consent gating) could ship
// to AMO / CWS because the release path only ran unit tests.
// ---------------------------------------------------------------------------
describe("G5 — release.yml: publish gated on unit + integration + E2E jobs", () => {
  test("release.yml has a 'test' job", () => {
    const content = readWorkflow("release.yml");
    // A job key appears as "  <name>:" at 2-space indent under "jobs:"
    assert.ok(
      /^\s{2}test:\s*$/m.test(content),
      "release.yml must have a 'test' job (unit + integration gate)"
    );
  });

  test("release.yml has an 'e2e' job", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /^\s{2}e2e:\s*$/m.test(content),
      "release.yml must have an 'e2e' job (Playwright gate)"
    );
  });

  test("release.yml has a 'build-and-release' publish job", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /^\s{2}build-and-release:\s*$/m.test(content),
      "release.yml must have a 'build-and-release' publish job"
    );
  });

  test("build-and-release job declares needs: [test, e2e]", () => {
    const content = readWorkflow("release.yml");
    // needs must list both gate jobs — order-independent match
    assert.ok(
      /needs:\s*\[test,\s*e2e\]/.test(content) ||
      /needs:\s*\[e2e,\s*test\]/.test(content),
      "build-and-release job must declare 'needs: [test, e2e]' so publishing " +
      "is impossible if either gate job fails"
    );
  });

  test("release.yml 'test' job runs npm run test:integration", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /npm\s+run\s+test:integration/.test(content),
      "release.yml 'test' job must run 'npm run test:integration' — " +
      "unit stubs alone cannot catch live Worker contract regressions"
    );
  });

  test("release.yml 'test' job runs npm test (unit suite)", () => {
    const content = readWorkflow("release.yml");
    // npm test appears standalone (not as part of test:integration)
    assert.ok(
      /run:\s*npm\s+test\s*$/.test(content) ||
      /run:\s*npm\s+test\b(?!:)/.test(content),
      "release.yml 'test' job must run 'npm test' for the unit suite"
    );
  });

  test("release.yml 'e2e' job runs Playwright via xvfb-run", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /xvfb-run\s+npx\s+playwright\s+test/.test(content),
      "release.yml 'e2e' job must run Playwright via xvfb-run (mirrors ci.yml e2e setup)"
    );
  });

  test("release.yml 'e2e' job installs Playwright browsers with --with-deps", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /npx\s+playwright\s+install\s+--with-deps/.test(content),
      "release.yml 'e2e' job must install Playwright browsers with --with-deps chromium"
    );
  });

  test("release.yml 'e2e' job references #825 TODO for live Worker stub", () => {
    const content = readWorkflow("release.yml");
    assert.ok(
      /#825/.test(content),
      "release.yml must carry a #825 reference marking the future stub/decommission " +
      "decision for the live unwrap.muga.app integration hit"
    );
  });

  test("npm run test:integration appears BEFORE build/publish steps in file order", () => {
    const content = readWorkflow("release.yml");
    const integrationIdx = content.indexOf("npm run test:integration");
    // build:chrome is the first publish-path step
    const buildChromeIdx = content.indexOf("npm run build:chrome");

    assert.ok(integrationIdx !== -1, "release.yml must include 'npm run test:integration'");
    assert.ok(buildChromeIdx !== -1, "release.yml must include 'npm run build:chrome'");
    assert.ok(
      integrationIdx < buildChromeIdx,
      `'npm run test:integration' (pos ${integrationIdx}) must appear BEFORE ` +
      `'npm run build:chrome' (pos ${buildChromeIdx}) in release.yml`
    );
  });

  test("xvfb-run Playwright invocation appears BEFORE build/publish steps in file order", () => {
    const content = readWorkflow("release.yml");
    const e2eIdx = content.indexOf("xvfb-run npx playwright test");
    const buildChromeIdx = content.indexOf("npm run build:chrome");

    assert.ok(e2eIdx !== -1, "release.yml must include 'xvfb-run npx playwright test'");
    assert.ok(buildChromeIdx !== -1, "release.yml must include 'npm run build:chrome'");
    assert.ok(
      e2eIdx < buildChromeIdx,
      `E2E invocation (pos ${e2eIdx}) must appear BEFORE ` +
      `'npm run build:chrome' (pos ${buildChromeIdx}) in release.yml`
    );
  });
});

// ---------------------------------------------------------------------------
// G6 — ci.yml PR gate must use stub-only integration (#825)
//
// The PR-triggered integration step must invoke `test:integration:stub` (not
// `test:integration` or `test:integration:live`) so that transient
// unwrap.muga.app / CDN hiccups cannot hard-fail unrelated contributor PRs.
// The full live-Worker contract run is reserved for push-to-main only.
// ---------------------------------------------------------------------------
describe("G6 — ci.yml PR gate uses stub-only integration (#825)", () => {
  test("ci.yml PR integration step invokes test:integration:stub", () => {
    const content = readWorkflow("ci.yml");
    assert.ok(
      /npm\s+run\s+test:integration:stub/.test(content),
      "ci.yml must invoke 'npm run test:integration:stub' for the PR gate — " +
      "the full live-Worker suite must not run on pull_request triggers (#825)"
    );
  });

  test("ci.yml PR integration step is conditional on pull_request event", () => {
    const content = readWorkflow("ci.yml");
    // The stub step must carry an `if: github.event_name == 'pull_request'` guard
    assert.ok(
      /if:\s*github\.event_name\s*==\s*['"]pull_request['"]/.test(content),
      "ci.yml must guard the stub integration step with " +
      "\"if: github.event_name == 'pull_request'\" (#825)"
    );
  });

  test("ci.yml main-push integration step sets MUGA_LIVE_TESTS=1", () => {
    const content = readWorkflow("ci.yml");
    assert.ok(
      /MUGA_LIVE_TESTS:\s*["']?1["']?/.test(content),
      "ci.yml must set MUGA_LIVE_TESTS: \"1\" on the push-to-main integration step " +
      "so the live Worker contract tests actually execute (#825)"
    );
  });

  test("ci.yml main-push integration step is conditional on push event", () => {
    const content = readWorkflow("ci.yml");
    assert.ok(
      /if:\s*github\.event_name\s*==\s*['"]push['"]/.test(content),
      "ci.yml must guard the live integration step with " +
      "\"if: github.event_name == 'push'\" (#825)"
    );
  });
});
