/**
 * MUGA: with-firefox-manifest.sh early-exit safety (#1481 follow-up)
 *
 * `mktemp` creates the backup file immediately — empty, before the script's
 * own `cp "$SRC" "$BACKUP"` line ever runs. cleanup()'s original
 * `[ -f "$BACKUP" ]` check is therefore true from the moment `mktemp` runs,
 * not from the moment the backup actually happened: an early exit or
 * interrupt between those two lines made cleanup() restore that empty temp
 * file over src/manifest.json, destroying it.
 *
 * This test reproduces that window deterministically. Timing the real race
 * (kill the process at exactly that point) would be flaky by construction,
 * so instead it runs the real script with the real backup line replaced by
 * a forced early exit — the same failure mode an interrupt would cause,
 * without depending on OS-signal timing — against an isolated scratch
 * "repo" so a failure can never touch the real src/manifest.json.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const SCRIPT_PATH = join(ROOT, "scripts", "with-firefox-manifest.sh");
const BACKUP_LINE = 'cp "$SRC" "$BACKUP"';

/**
 * `bash` is not guaranteed to exist on every CI runner (e.g. a bare Windows
 * runner without Git Bash / WSL on PATH). Probe once and skip cleanly
 * rather than failing the whole suite when it is missing.
 *
 * @returns {boolean}
 */
function hasBash() {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("with-firefox-manifest.sh: an early exit before the backup copy leaves manifest.json untouched", (t) => {
  if (!hasBash()) {
    t.skip("bash is not available in this environment");
    return;
  }

  const script = readFileSync(SCRIPT_PATH, "utf8");
  assert.ok(
    script.includes(BACKUP_LINE),
    "with-firefox-manifest.sh no longer contains the expected backup line " +
    `(${BACKUP_LINE}) — update this test's injection point to match`
  );

  const scratch = mkdtempSync(join(tmpdir(), "muga-fx-manifest-"));
  try {
    mkdirSync(join(scratch, "src"), { recursive: true });
    mkdirSync(join(scratch, "scripts"), { recursive: true });

    const originalManifest = '{"marker":"ORIGINAL-MV3-MANIFEST"}\n';
    writeFileSync(join(scratch, "src", "manifest.json"), originalManifest);
    writeFileSync(join(scratch, "src", "manifest.v2.json"), '{"marker":"MV2-MANIFEST"}\n');

    // Force the script to exit right where an interrupt could land: after
    // `mktemp` (BACKUP now exists, empty) but before the real backup copy.
    const injected = script.replace(
      BACKUP_LINE,
      `exit 42 # test-injected early exit, before the real backup copy\n${BACKUP_LINE}`
    );
    const scratchScript = join(scratch, "scripts", "with-firefox-manifest.sh");
    writeFileSync(scratchScript, injected, { mode: 0o755 });

    let exitCode = 0;
    try {
      execFileSync("bash", ["scripts/with-firefox-manifest.sh", "true"], {
        cwd: scratch,
        stdio: "pipe",
      });
    } catch (err) {
      exitCode = err.status;
    }
    assert.equal(
      exitCode,
      42,
      "the test injection did not take effect as expected — cannot trust this test's result"
    );

    const manifestAfter = readFileSync(join(scratch, "src", "manifest.json"), "utf8");
    assert.equal(
      manifestAfter,
      originalManifest,
      "cleanup() overwrote src/manifest.json after an early exit that happened BEFORE the " +
      "real backup copy ran. mktemp creates BACKUP immediately (empty), so cleanup() must " +
      "gate the restore on a flag set only after a successful backup copy, not on " +
      '`[ -f "$BACKUP" ]` (#1481 follow-up).'
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("with-firefox-manifest.sh: a normal run swaps in MV2 and restores the original manifest", (t) => {
  if (!hasBash()) {
    t.skip("bash is not available in this environment");
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), "muga-fx-manifest-happy-"));
  try {
    mkdirSync(join(scratch, "src"), { recursive: true });
    mkdirSync(join(scratch, "scripts"), { recursive: true });

    const originalManifest = '{"marker":"ORIGINAL-MV3-MANIFEST"}\n';
    const mv2Manifest = '{"marker":"MV2-MANIFEST"}\n';
    writeFileSync(join(scratch, "src", "manifest.json"), originalManifest);
    writeFileSync(join(scratch, "src", "manifest.v2.json"), mv2Manifest);
    writeFileSync(
      join(scratch, "scripts", "with-firefox-manifest.sh"),
      readFileSync(SCRIPT_PATH, "utf8"),
      { mode: 0o755 }
    );

    // Have the wrapped command read manifest.json back out so we can assert
    // the swap happened WHILE the command ran, not just before/after it.
    const duringPath = join(scratch, "during.json");
    execFileSync(
      "bash",
      ["scripts/with-firefox-manifest.sh", "bash", "-c", `cp src/manifest.json "${duringPath}"`],
      { cwd: scratch, stdio: "pipe" }
    );

    assert.equal(
      readFileSync(duringPath, "utf8"),
      mv2Manifest,
      "src/manifest.json must hold the MV2 content while the wrapped command runs"
    );
    assert.equal(
      readFileSync(join(scratch, "src", "manifest.json"), "utf8"),
      originalManifest,
      "src/manifest.json must be restored to its original content after the wrapped command exits"
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
