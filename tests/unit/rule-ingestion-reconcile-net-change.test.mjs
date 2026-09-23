/**
 * MUGA — `reconcile-net-change.mjs` tests (#1344 T3.1: steady-state churn guard)
 *
 * Measured directly (scratch worktree, week-1/week-2 repro): once #1344's
 * candidates are relocated, EVERY subsequent weekly run repeats the same
 * cycle — promote re-adds the same 62 params (`noop: false`), then
 * `--prefer-anchors` relocates the same 62 back out (`changed: true`) — while
 * the NET committed content (`params[]`, `scoped[]`, the whole store) stays
 * byte-identical. Only `params.json`'s `version`/`published` moved, and moved
 * TWICE (promote's own bump, then prefer-anchors's own bump on top).
 *
 * `runReconcile` is the step that looks at the run's NET effect against what
 * is actually committed (`HEAD`), rather than any one step's own before/after,
 * and fixes both symptoms: restores the working tree when nothing publishable
 * moved, and collapses a stacked bump to exactly one when something did.
 *
 * All I/O is injectable so these tests never touch the filesystem, `git`, or
 * the real committed store.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeParamsForCompare,
  computeNetChange,
  withVersion,
  toRepoRelativePath,
  runReconcile,
  DEFAULT_PARAMS_PATH,
} from "../../tools/rule-ingestion/reconcile-net-change.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "tools", "rule-ingestion", "reconcile-net-change.mjs");

// ── toRepoRelativePath ─────────────────────────────────────────────────

describe("toRepoRelativePath", () => {
  test("the real DEFAULT_PARAMS_PATH derives to the forward-slashed repo-relative path", () => {
    assert.equal(toRepoRelativePath(DEFAULT_PARAMS_PATH), "tools/rules-source/params.json");
  });
});

// ── normalizeParamsForCompare ─────────────────────────────────────────

describe("normalizeParamsForCompare", () => {
  test("drops version, published and sig", () => {
    const normalized = normalizeParamsForCompare({
      version: 19,
      published: "2026-09-24T00:00:00.000Z",
      sig: "deadbeef",
      params: ["a", "b"],
      scoped: [{ param: "c", hosts: ["example.com"] }],
    });
    assert.deepEqual(normalized, {
      params: ["a", "b"],
      scoped: [{ param: "c", hosts: ["example.com"] }],
    });
  });

  test("an absent scoped section normalizes to []", () => {
    const normalized = normalizeParamsForCompare({ version: 1, published: "x", params: ["a"] });
    assert.deepEqual(normalized, { params: ["a"], scoped: [] });
  });

  test("an absent scoped section and an explicit empty one compare equal", () => {
    const a = normalizeParamsForCompare({ version: 1, published: "x", params: ["a"] });
    const b = normalizeParamsForCompare({ version: 2, published: "y", params: ["a"], scoped: [] });
    assert.deepEqual(a, b);
  });
});

// ── computeNetChange ───────────────────────────────────────────────────

describe("computeNetChange", () => {
  test("identical params[]/scoped[] and identical store — changed:false even with different version/published", () => {
    const headParamsText = JSON.stringify({ version: 17, published: "2026-09-20T00:00:00.000Z", params: ["a"], scoped: [{ param: "b", hosts: ["x.com"] }] });
    const currentParamsText = JSON.stringify({ version: 19, published: "2026-09-27T00:00:00.000Z", params: ["a"], scoped: [{ param: "b", hosts: ["x.com"] }] });
    const storeText = '{"schemaVersion":1,"entries":[]}\n';

    const result = computeNetChange({
      headParamsText,
      currentParamsText,
      headStoreText: storeText,
      currentStoreText: storeText,
    });

    assert.deepEqual(result, { changed: false });
  });

  test("a genuinely different params[] — changed:true", () => {
    const headParamsText = JSON.stringify({ version: 17, published: "x", params: ["a"] });
    const currentParamsText = JSON.stringify({ version: 18, published: "y", params: ["a", "b"] });
    const storeText = "same\n";

    const result = computeNetChange({
      headParamsText,
      currentParamsText,
      headStoreText: storeText,
      currentStoreText: storeText,
    });

    assert.deepEqual(result, { changed: true });
  });

  test("params[] identical but the store differs — changed:true", () => {
    const paramsText = JSON.stringify({ version: 17, published: "x", params: ["a"] });

    const result = computeNetChange({
      headParamsText: paramsText,
      currentParamsText: paramsText,
      headStoreText: "before\n",
      currentStoreText: "after\n",
    });

    assert.deepEqual(result, { changed: true });
  });
});

// ── withVersion ────────────────────────────────────────────────────────

describe("withVersion", () => {
  test("rewrites the top-level version field, nothing else", () => {
    const text = [
      "{",
      '  "version": 17,',
      '  "published": "2026-09-20T00:00:00.000Z",',
      '  "params": [',
      '    "a"',
      "  ]",
      "}",
      "",
    ].join("\n");

    const next = withVersion(text, 18);

    assert.match(next, /^\s*"version": 18,/m);
    assert.equal(
      next.replace('"version": 18,', '"version": 17,'),
      text,
      "every other byte must be untouched"
    );
  });

  test("does not confuse a scoped fact whose OWN param is literally \"version\"", () => {
    // Real committed shape: {"param":"version","hosts":["tally.so"]} — compact,
    // no space after the colon, and "version" is a VALUE here, not a key.
    const text = [
      "{",
      '  "version": 17,',
      '  "published": "x",',
      '  "params": [],',
      '  "scoped": [',
      '    {"param":"version","hosts":["tally.so"]}',
      "  ]",
      "}",
      "",
    ].join("\n");

    const next = withVersion(text, 18);

    assert.match(next, /^\s*"version": 18,/m);
    assert.match(next, /\{"param":"version","hosts":\["tally\.so"\]\}/, "the scoped fact must survive untouched");
  });

  test("throws when there is no top-level version field to rewrite", () => {
    assert.throws(() => withVersion('{"params":[]}\n', 5), /could not find/);
  });
});

// ── runReconcile ─────────────────────────────────────────────────────────

function harness({ headParamsText, currentParamsText, headStoreText = "s\n", currentStoreText = "s\n" }) {
  const writes = [];
  let restoredPaths = null;
  const result = runReconcile({
    paramsPath: "unused-params-path",
    storePath: "unused-store-path",
    // Explicit, not derived: this fixture's paths are bare fixture names, not
    // real repo-relative paths, so toRepoRelativePath's default derivation
    // would produce nonsense here — exactly the "take it as a parameter"
    // escape hatch it documents.
    headParamsPath: "tools/rules-source/params.json",
    headStorePath: "tools/rules-source/rules.json",
    readFile: (path) => (path === "unused-params-path" ? currentParamsText : currentStoreText),
    writeFile: (path, text) => writes.push({ path, text }),
    readHead: (relativePath) =>
      relativePath.endsWith("params.json") ? headParamsText : headStoreText,
    restore: (relativePaths) => {
      restoredPaths = relativePaths;
    },
  });
  return { result, writes, restoredPaths };
}

describe("runReconcile", () => {
  test("net-unchanged (the T3.1 steady-state case): restores, writes nothing, reports changed:false", () => {
    // Mirrors the measured week-2 repro exactly: HEAD is v17, the working
    // tree (after promote + land-scoped + --prefer-anchors) is v19 with the
    // SAME params[]/scoped[] content.
    const headParamsText = JSON.stringify({ version: 17, published: "2026-09-20T00:00:00.000Z", params: ["a"], scoped: [{ param: "igsh", hosts: ["instagram.com"] }] });
    const currentParamsText = JSON.stringify({ version: 19, published: "2026-09-27T00:00:00.000Z", params: ["a"], scoped: [{ param: "igsh", hosts: ["instagram.com"] }] });

    const { result, writes, restoredPaths } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: false });
    assert.deepEqual(writes, [], "must not write params.json in the net-unchanged case");
    assert.deepEqual(
      restoredPaths,
      ["tools/rules-source/params.json", "tools/rules-source/rules.json"],
      "must restore EXACTLY the two compared files, never a wider directory checkout"
    );
  });

  test("net-changed with a STACKED double bump: collapses to exactly HEAD version + 1", () => {
    // Reproduces the measured bug directly: promote bumped 15->16, then
    // --prefer-anchors bumped 16->17 in the SAME run, on top of a genuine
    // content change. The published version must be 16 (15 + 1), not 17.
    const headParamsText = JSON.stringify({ version: 15, published: "2026-09-10T00:00:00.000Z", params: ["a"] });
    // Pretty-printed (null, 2), matching renderParamsFile's real format —
    // withVersion's line-anchored regex targets that shape, not compact JSON.
    const currentParamsText = JSON.stringify(
      { version: 17, published: "2026-09-27T00:00:00.000Z", params: ["a", "b"] },
      null,
      2
    );

    const { result, writes, restoredPaths } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restoredPaths, null, "must not restore when the net content genuinely changed");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "unused-params-path");
    assert.match(writes[0].text, /"version": 16,/);
    assert.match(writes[0].text, /"published": "2026-09-27T00:00:00\.000Z"/, "published is left as the run's own timestamp");
  });

  test("net-changed and already exactly HEAD version + 1: does not rewrite the file at all", () => {
    const headParamsText = JSON.stringify({ version: 15, published: "x", params: ["a"] });
    const currentParamsText = JSON.stringify({ version: 16, published: "y", params: ["a", "b"] });

    const { result, writes, restoredPaths } = harness({ headParamsText, currentParamsText });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restoredPaths, null);
    assert.deepEqual(writes, [], "already correct — nothing to rewrite");
  });

  test("net-changed via the STORE alone (params[]/scoped[] identical, rules.json differs)", () => {
    const paramsText = JSON.stringify({ version: 15, published: "x", params: ["a"] });

    const { result, restoredPaths } = harness({
      headParamsText: paramsText,
      currentParamsText: JSON.stringify({ version: 16, published: "y", params: ["a"] }),
      headStoreText: "before\n",
      currentStoreText: "after\n",
    });

    assert.deepEqual(result, { changed: true, version: 16 });
    assert.equal(restoredPaths, null);
  });
});

// ── CLI: real `node reconcile-net-change.mjs` subprocess, real `git` ──────
//
// The CLI resolves REPO_ROOT and its default paths from the SCRIPT'S OWN
// location (`import.meta.url`), not from `process.cwd()` or an argument —
// so it cannot be redirected at a fixture just by chdir'ing into one. What
// DOES work: copy the script itself into a throwaway git repo laid out with
// the same `tools/rules-source/` + `tools/rule-ingestion/` shape, so its own
// `__dirname`-derived REPO_ROOT resolves to the fixture, and run it there —
// a real `node` process, a real `git` repo, `GITHUB_OUTPUT` a real temp file.
// Never the real repo's committed tree.

/**
 * A `process.env` with every `GIT_*` variable stripped (`GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_AUTHOR_*`, ... — anything an
 * enclosing git hook, `git rebase`, or a CI wrapper might have set on THIS
 * process and that a naive inherited env would otherwise leak into the
 * fixture's own git subprocesses, silently redirecting them at the wrong
 * repo, index or worktree), plus `GIT_CONFIG_NOSYSTEM=1` and an isolated
 * `HOME`/`USERPROFILE` so no machine-level `~/.gitconfig` (a signing key, an
 * alias, a credential helper) can influence a throwaway fixture.
 *
 * @param {string} isolatedHome
 * @returns {NodeJS.ProcessEnv}
 */
function isolatedGitEnv(isolatedHome) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.HOME = isolatedHome;
  env.USERPROFILE = isolatedHome;
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}

/** Asserts a spawned git command exited 0, surfacing stderr on failure. */
function assertGitOk(result, label) {
  assert.equal(result.status, 0, `${label} failed (exit ${result.status}): ${result.stderr}`);
  return result;
}

function makeCliFixture() {
  const repoDir = mkdtempSync(join(tmpdir(), "reconcile-cli-fixture-"));
  const isolatedHome = mkdtempSync(join(tmpdir(), "reconcile-cli-home-"));
  // core.hooksPath -> a real, empty directory. No hook files in it, so every
  // hook is a guaranteed no-op — safer than an empty-string value, which git
  // treats inconsistently across platforms/versions.
  const emptyHooksDir = mkdtempSync(join(tmpdir(), "reconcile-cli-hooks-"));
  const gitEnv = isolatedGitEnv(isolatedHome);

  const run = (args) => spawnSync("git", args, { cwd: repoDir, encoding: "utf8", env: gitEnv });

  assertGitOk(run(["init", "-q"]), "git init");
  assertGitOk(run(["config", "user.email", "fixture@local.test"]), "git config user.email");
  assertGitOk(run(["config", "user.name", "Fixture"]), "git config user.name");
  assertGitOk(run(["config", "commit.gpgsign", "false"]), "git config commit.gpgsign");
  assertGitOk(run(["config", "core.hooksPath", emptyHooksDir]), "git config core.hooksPath");

  mkdirSync(join(repoDir, "tools", "rules-source"), { recursive: true });
  mkdirSync(join(repoDir, "tools", "rule-ingestion"), { recursive: true });
  writeFileSync(
    join(repoDir, "tools", "rule-ingestion", "reconcile-net-change.mjs"),
    readFileSync(CLI_PATH, "utf8"),
    "utf8"
  );

  return { repoDir, run, gitEnv };
}

function writeAndCommit(repoDir, run, { version, published, params, message, extraFiles = {} }) {
  writeFileSync(
    join(repoDir, "tools", "rules-source", "params.json"),
    JSON.stringify({ version, published, params }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(repoDir, "tools", "rules-source", "rules.json"),
    '{"schemaVersion":1,"entries":[]}\n',
    "utf8"
  );
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(repoDir, "tools", "rules-source", name), content, "utf8");
  }
  assertGitOk(run(["add", "-A"]), "git add");
  assertGitOk(run(["commit", "-q", "-m", message]), "git commit");
}

function runCli(repoDir, gitEnv, githubOutputPath) {
  return spawnSync(
    process.execPath,
    [join(repoDir, "tools", "rule-ingestion", "reconcile-net-change.mjs")],
    {
      cwd: repoDir,
      encoding: "utf8",
      // The isolated git env, not raw process.env — the CLI's OWN internal
      // `execFileSync("git", ...)` calls inherit whatever env this subprocess
      // runs with, so this is what keeps THOSE calls isolated too, not just
      // the fixture's own setup commands above.
      env: { ...gitEnv, GITHUB_OUTPUT: githubOutputPath },
    }
  );
}

describe("CLI (real subprocess, real git, throwaway fixture repo)", () => {
  test("net-unchanged: exits 0, emits changed=false, restores ONLY the two compared files", () => {
    const { repoDir, run, gitEnv } = makeCliFixture();
    writeAndCommit(repoDir, run, {
      version: 5,
      published: "2026-09-01T00:00:00.000Z",
      params: ["a", "b"],
      message: "committed",
      // A THIRD tracked file under rules-source/ that reconcile never looks
      // at — proves the restore is narrowed to exactly params.json/rules.json
      // (R3.2's fix), not a directory-wide `git checkout -- tools/rules-source`
      // that would silently wipe an in-progress local edit to this file too.
      extraFiles: { "notes.txt": "original\n" },
    });

    // Simulate the exact T3.1 symptom: version/published moved (a stacked
    // bump), content did not — plus an unrelated LOCAL, uncommitted edit to
    // the third tracked file that a narrowed restore must leave alone.
    writeFileSync(
      join(repoDir, "tools", "rules-source", "params.json"),
      JSON.stringify({ version: 7, published: "2026-09-08T00:00:00.000Z", params: ["a", "b"] }, null, 2) + "\n",
      "utf8"
    );
    writeFileSync(join(repoDir, "tools", "rules-source", "notes.txt"), "locally modified, must survive\n", "utf8");

    const githubOutputPath = join(repoDir, "github-output.txt");
    const proc = runCli(repoDir, gitEnv, githubOutputPath);

    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /net content identical to HEAD/);
    assert.ok(existsSync(githubOutputPath));
    assert.equal(readFileSync(githubOutputPath, "utf8"), "changed=false\n");

    const restored = JSON.parse(readFileSync(join(repoDir, "tools", "rules-source", "params.json"), "utf8"));
    assert.equal(restored.version, 5, "must be restored to HEAD's committed version");

    const notes = readFileSync(join(repoDir, "tools", "rules-source", "notes.txt"), "utf8");
    assert.equal(
      notes,
      "locally modified, must survive\n",
      "an unrelated tracked file under rules-source/ must NOT be restored — only params.json/rules.json are"
    );
  });

  test("net-changed: exits 0, emits changed=true, writes exactly HEAD version + 1", () => {
    const { repoDir, run, gitEnv } = makeCliFixture();
    writeAndCommit(repoDir, run, {
      version: 5,
      published: "2026-09-01T00:00:00.000Z",
      params: ["a"],
      message: "committed",
    });

    // A genuinely new param, with a stacked double bump on top (5 -> 7).
    writeFileSync(
      join(repoDir, "tools", "rules-source", "params.json"),
      JSON.stringify({ version: 7, published: "2026-09-08T00:00:00.000Z", params: ["a", "b"] }, null, 2) + "\n",
      "utf8"
    );

    const githubOutputPath = join(repoDir, "github-output.txt");
    const proc = runCli(repoDir, gitEnv, githubOutputPath);

    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /version set to 6/);
    assert.equal(readFileSync(githubOutputPath, "utf8"), "changed=true\n");

    const written = JSON.parse(readFileSync(join(repoDir, "tools", "rules-source", "params.json"), "utf8"));
    assert.equal(written.version, 6, "a single bump over HEAD's 5, not the stacked 7");
    assert.deepEqual(written.params, ["a", "b"]);
  });
});
