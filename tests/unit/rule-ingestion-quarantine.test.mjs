/**
 * MUGA — Quarantine gate tests for the rule-ingestion clean-room scaffold (#772).
 *
 * Locks the three invariants that keep raw upstream signals out of the repo and
 * the distributed bundle:
 *   1. nothing is git-tracked under the quarantine dir,
 *   2. the quarantine path is gitignored,
 *   3. the quarantine path lives outside src/ (the bundle source root).
 *
 * The first two assert against the REAL repo state, so a future commit that
 * accidentally stages a raw upstream file or drops the .gitignore line fails
 * here as well as in the standalone CI gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUARANTINE_PATH,
  isGitignored,
  isOutsideSrc,
  listTrackedQuarantineFiles,
} from "../../tools/rule-ingestion/verify-quarantine.mjs";

test("QUARANTINE_PATH is the rule-ingestion quarantine dir", () => {
  assert.equal(QUARANTINE_PATH, "tools/rule-ingestion/quarantine/");
});

test("isOutsideSrc: quarantine path is not under src/", () => {
  assert.equal(isOutsideSrc(), true);
});

test("isOutsideSrc: a path under src/ is flagged as bundle-reachable", () => {
  assert.equal(isOutsideSrc("src/rules/quarantine/"), false);
  assert.equal(isOutsideSrc("/src/anything"), false);
});

test("isGitignored: matches the directory with or without slashes/anchor", () => {
  assert.equal(isGitignored("tools/rule-ingestion/quarantine/"), true);
  assert.equal(isGitignored("tools/rule-ingestion/quarantine"), true);
  assert.equal(isGitignored("/tools/rule-ingestion/quarantine/"), true);
});

test("isGitignored: ignores comments and unrelated entries", () => {
  const gitignore = [
    "# tools/rule-ingestion/quarantine/",
    "node_modules/",
    "dist/",
  ].join("\n");
  assert.equal(isGitignored(gitignore), false);
});

test("the real .gitignore lists the quarantine path", () => {
  const gitignore = readFileSync(
    new URL("../../.gitignore", import.meta.url),
    "utf8",
  );
  assert.equal(isGitignored(gitignore), true);
});

test("no raw upstream is git-tracked under the quarantine dir", () => {
  assert.deepEqual(listTrackedQuarantineFiles(), []);
});
