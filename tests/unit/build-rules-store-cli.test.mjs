/**
 * MUGA — `build-rules-store.mjs --prefer-anchors` CLI tests (#1344 T3.1)
 *
 * `node tools/build-rules-store.mjs --prefer-anchors`'s CLI branch (only
 * reachable via `isMain`, not via the exported `runPreferAnchors()`) emits
 * `changed=<bool>` to `$GITHUB_OUTPUT` — the signal the auto-ingest workflow's
 * `prefer_anchors` step exposes as `steps.prefer_anchors.outputs.changed`.
 *
 * `changed:false` (the no-op branch) is spawn-tested here as a REAL
 * subprocess against the REAL committed repo: on this branch's committed
 * tree, every #1344 candidate is already relocated (T2), so a fresh
 * `--prefer-anchors` run is a genuine, provable no-op — `runPreferAnchors`
 * writes nothing when `relocated.length === 0` (see its own doc in
 * tools/build-rules-store.mjs).
 *
 * That precondition is checked BEFORE the subprocess is spawned, via the
 * pure `computeAnchorPreference` dry-run against the real committed store —
 * never assumed, and never only checked after the fact. If this branch's
 * committed tree ever regains a relocatable candidate (main drifted, or this
 * test runs on the wrong branch), the assertion fails here and the real CLI
 * is never spawned at all, so a failing precondition can never itself mutate
 * the developer's working tree. `git status --short` before/after the actual
 * spawn is kept as a second, independent proof.
 *
 * `changed:true` (the relocating branch) is NOT covered by a subprocess test
 * here. Unlike reconcile-net-change.mjs (a single file with no internal
 * imports, cheaply copyable into a throwaway git-repo fixture whose own
 * directory layout makes its `__dirname`-derived paths resolve correctly),
 * `build-rules-store.mjs` pulls in `./rules-store.mjs`,
 * `../src/lib/affiliates-data.js` and `../src/lib/remote-rules.js` — each with
 * its own further imports and real behavioural content (TRACKING_PARAMS,
 * AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST) that the relocation predicate
 * itself depends on. Faithfully reproducing that graph in a fixture risks
 * silently drifting from the real modules and asserting against a strawman;
 * triggering it against the real repo would require un-relocating a real
 * committed param first, i.e. mutating the real tree, which this suite must
 * not do. `computeAnchorPreference`'s relocating behavior (including the
 * `changed:true`-equivalent case) is already exhaustively covered, at the
 * pure-function level, by tests/unit/channel-prefers-anchors.test.mjs — this
 * file covers only the CLI's own `$GITHUB_OUTPUT` emission wiring, and only
 * the branch that can be proven safe against the real tree.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadStore, computeAnchorPreference, PARAMS_PATH } from "../../tools/build-rules-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CLI_PATH = join(REPO_ROOT, "tools", "build-rules-store.mjs");

describe("CLI: node tools/build-rules-store.mjs --prefer-anchors (real subprocess, real repo)", () => {
  test("on the real committed tree (already fully relocated), it is a proven no-op that emits changed=false", () => {
    // Precondition FIRST, via the pure function, before anything is spawned.
    // A failing assertion here stops the test cold — the real CLI subprocess
    // below is unreachable code once this throws, so a broken precondition
    // can never itself mutate the working tree.
    const dryRun = computeAnchorPreference(loadStore(), readFileSync(PARAMS_PATH, "utf8"));
    assert.equal(
      dryRun.relocated.length,
      0,
      "precondition failed: the real committed tree has relocatable #1344 candidate(s) " +
        `(${dryRun.relocated.join(", ")}) — refusing to spawn the real CLI against it, since ` +
        "that would relocate them for real and mutate the working tree. This test only runs " +
        "safely when the tree is already fully relocated."
    );

    const before = spawnSync("git", ["status", "--short"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(before.status, 0, before.stderr);

    const githubOutputPath = join(mkdtempSync(join(tmpdir(), "prefer-anchors-cli-")), "github-output.txt");

    const proc = spawnSync(process.execPath, [CLI_PATH, "--prefer-anchors"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: githubOutputPath },
    });

    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /nothing relocated/);
    assert.ok(existsSync(githubOutputPath), "GITHUB_OUTPUT file must exist after the CLI runs");
    assert.equal(readFileSync(githubOutputPath, "utf8"), "changed=false\n");

    // The safety proof, not an assumption: the real committed tree must come
    // out exactly as it went in.
    const after = spawnSync("git", ["status", "--short"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(after.status, 0, after.stderr);
    assert.equal(
      after.stdout,
      before.stdout,
      "the real committed tree must be unchanged by this run — it must have been a true no-op"
    );
  });
});
