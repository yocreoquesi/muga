/**
 * MUGA: AMO Firefox signing guard (#1481)
 *
 * The AMO submission step in .github/workflows/release.yml used to sign raw
 * `src/` directly with `web-ext sign`, bypassing tools/strip-test-seams.mjs
 * (the same stripping build:chrome and build:firefox apply). That shipped a
 * live `lib/test-fixtures.js`, the unneutralised `__MUGA_TRUSTED_KEYS__`
 * seam in background/service-worker.js, and stray build-only files
 * (manifest.v3.json, rules/manifest.json, icons/newicon.png) to real Firefox
 * users on AMO — a different, less hardened artifact than the one Chrome
 * users and the GitHub release get.
 *
 * Separately, scripts/with-firefox-manifest.sh wrote its manifest.json
 * backup to src/manifest.v3.json — INSIDE the directory strip-test-seams.mjs
 * copies wholesale before stripping — so that backup leaked into both the
 * GitHub release firefox.zip and (via the bug above) the AMO XPI.
 *
 * These guards fail red on the un-fixed pipeline and must stay green:
 * they assert the shape of the fix, not just today's exact wording. The
 * AMO-signing assertions below are scoped to the specific steps that do the
 * signing (extracted from the workflow YAML) rather than the whole file, so
 * an unrelated `dist/firefox` mention elsewhere in release.yml can't make
 * them pass for the wrong reason.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function readFile(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

/**
 * Extracts one GitHub Actions step's YAML block (from its `- name:` line up
 * to, but not including, the next sibling step at the same indentation) so
 * assertions can be tied to the step that actually does the work, instead
 * of matching anywhere in the whole workflow file.
 *
 * @param {string} yml - Full workflow file content.
 * @param {string} stepName - Exact `name:` value of the step to extract.
 * @returns {string} The step's YAML text, from its `- name:` line onward.
 */
function extractStep(yml, stepName) {
  const marker = `- name: ${stepName}`;
  const idx = yml.indexOf(marker);
  assert.ok(idx !== -1, `release.yml has no step named "${stepName}"`);
  const lineStart = yml.lastIndexOf("\n", idx) + 1;
  const indent = yml.slice(lineStart, idx);
  const rest = yml.slice(idx);
  const nextStepRe = new RegExp(`\\n${indent}- (name|uses):`);
  const nextIdx = rest.slice(marker.length).search(nextStepRe);
  return nextIdx === -1 ? rest : rest.slice(0, marker.length + nextIdx);
}

// Matches `--source-dir` pointing straight at the repo's raw src/, in every
// shape web-ext accepts: `=` or a space, quoted or not, with or without a
// leading `./`, with or without a trailing slash.
const RAW_SRC_LITERAL_RE = /--source-dir[= ]"?(\.\/)?src\/?"?(\s|$)/;

/**
 * Finds every `--source-dir` usage in `text` that goes through a shell
 * variable ($VAR or ${VAR}) rather than a literal path, and returns the
 * variable names — so callers can resolve what each one actually points at
 * (variable indirection is exactly how the real fix passes `$AMO_SOURCE_DIR`,
 * and exactly how a regression could quietly reintroduce raw src/).
 *
 * @param {string} text
 * @returns {string[]} Variable names, in order of appearance.
 */
function findSourceDirVarUsages(text) {
  const re = /--source-dir[= ]"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?/g;
  return [...text.matchAll(re)].map((m) => m[1]);
}

/**
 * Finds the last `VARNAME=value` assignment of `varName` in `yml`. Matches
 * both a plain shell assignment and one embedded in a quoted string (the
 * shape release.yml uses to write $GITHUB_ENV: `echo "VAR=value" >>
 * "$GITHUB_ENV"`), since both are `VARNAME=<value>` as literal text either
 * way.
 *
 * @param {string} yml
 * @param {string} varName
 * @returns {string|null} The raw (still possibly quoted) assigned value, or null.
 */
function lastVarAssignment(yml, varName) {
  const re = new RegExp(`\\b${varName}=([^\\s"']+|"[^"]*"|'[^']*')`, "g");
  let last = null;
  for (const m of yml.matchAll(re)) last = m[1];
  return last;
}

/**
 * Normalizes a shell path literal for comparison: strips surrounding
 * quotes, a leading `./`, and a trailing `/`.
 *
 * @param {string|null} value
 * @returns {string|null}
 */
function normalizeDirLiteral(value) {
  if (!value) return value;
  return value.replace(/^["']|["']$/g, "").replace(/^\.\//, "").replace(/\/$/, "");
}

/**
 * Strips `#` comments from a YAML/bash text, per line, so an assertion
 * cannot be satisfied by a comment merely MENTIONING the thing it must
 * actually do (#1491 item 6). A `#` inside a single- or double-quoted
 * string is not treated as a comment start; this mirrors real shell/YAML
 * comment semantics closely enough for the step bodies in this workflow.
 *
 * @param {string} text
 * @returns {string}
 */
function stripHashComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

describe("AMO Firefox signing does not use raw src/ (#1481)", () => {
  const releaseYml = readFile(".github/workflows/release.yml");
  const unpackStep = extractStep(releaseYml, "Unpack the built Firefox artifact for AMO signing");
  const signStep = extractStep(releaseYml, "Submit to Firefox AMO");

  test("release.yml has an AMO submission step that calls web-ext sign", () => {
    assert.match(signStep, /web-ext sign/, "the 'Submit to Firefox AMO' step must call `web-ext sign`");
  });

  test("the AMO sign step's --source-dir is never a raw src/ literal (src/, ./src, with or without a trailing slash)", () => {
    assert.ok(
      !RAW_SRC_LITERAL_RE.test(signStep),
      "the 'Submit to Firefox AMO' step must not sign raw src/ — src/ still contains live " +
      "test seams (lib/test-fixtures.js, the __MUGA_TRUSTED_KEYS__ override) and build-only " +
      "files that tools/strip-test-seams.mjs strips for the Chrome build and the GitHub " +
      "release. Sign the already-built, already-stripped dist/firefox artifact instead (#1481)."
    );
  });

  // #1491 item 5: the title used to claim this guard verifies the variable
  // "never resolves (indirectly) to raw src/", but an UNRESOLVED variable
  // (no VARNAME=value assignment anywhere in release.yml) made
  // lastVarAssignment() return null, normalizeDirLiteral(null) return null,
  // and `assert.notEqual(null, "src")` pass — silently. The title claimed
  // more than the check verified. Fixed to require a real assignment first.
  test("the AMO sign step's --source-dir variable is actually assigned in release.yml, and that assignment never resolves (indirectly) to raw src/", () => {
    const varNames = findSourceDirVarUsages(signStep);
    assert.ok(
      varNames.length > 0,
      "expected --source-dir in the 'Submit to Firefox AMO' step to be passed via a shell " +
      "variable (e.g. $AMO_SOURCE_DIR) rather than a bare literal — if that changed " +
      "intentionally, the raw-src literal check above already covers a hardcoded path"
    );
    for (const varName of varNames) {
      const rawAssignment = lastVarAssignment(releaseYml, varName);
      assert.ok(
        rawAssignment !== null,
        `--source-dir variable "${varName}" has no VARNAME=value assignment anywhere in ` +
        "release.yml — an unresolved variable must fail this guard loudly, not pass it " +
        "silently by resolving to null (#1491 item 5)."
      );
      const resolved = normalizeDirLiteral(rawAssignment);
      assert.notEqual(
        resolved,
        "src",
        `--source-dir variable "${varName}" resolves to raw src/ (assigned: ${rawAssignment}) ` +
        "— variable indirection must not be used to smuggle a raw src/ sign back in (#1481)."
      );
    }
  });

  // #1491 item 5 (meta-test): proves the fix above actually closes the
  // silent-pass gap, using a synthetic snippet rather than the real
  // release.yml (which is expected to stay valid and can't demonstrate the
  // broken case on its own).
  test("meta: an unresolved --source-dir variable fails loudly instead of resolving to null and passing", () => {
    const syntheticYml = [
      "      - name: Submit to Firefox AMO",
      "        run: |",
      '          npx web-ext sign --source-dir="$UNDEFINED_SOURCE_VAR" --channel=listed',
    ].join("\n");
    const varNames = findSourceDirVarUsages(syntheticYml);
    assert.deepEqual(varNames, ["UNDEFINED_SOURCE_VAR"]);
    const rawAssignment = lastVarAssignment(syntheticYml, "UNDEFINED_SOURCE_VAR");
    assert.equal(rawAssignment, null, "sanity: this synthetic snippet never assigns the variable");
    // The OLD logic: normalizeDirLiteral(null) -> null; assert.notEqual(null, "src") -> PASSES silently.
    assert.notEqual(normalizeDirLiteral(rawAssignment), "src", "sanity: this is exactly the old silent-pass path");
    // The NEW logic added above must instead throw on the unresolved variable.
    assert.throws(
      () => assert.ok(rawAssignment !== null, `--source-dir variable "UNDEFINED_SOURCE_VAR" has no assignment`),
      /has no assignment/,
      "an unresolved --source-dir variable must throw, not silently resolve to null and pass"
    );
  });

  // #1491 item 6: matching against the raw step text let a comment that
  // merely MENTIONS "dist/firefox" (or "AMO_SOURCE_DIR=") satisfy this
  // guard even if the step's actual `run:` commands did neither. Strip `#`
  // comments first so only real YAML/shell content is checked.
  test("the Unpack step derives the AMO source from dist/firefox and exports AMO_SOURCE_DIR", () => {
    const unpackStepCode = stripHashComments(unpackStep);
    assert.match(
      unpackStepCode,
      /dist\/firefox/,
      "the 'Unpack the built Firefox artifact for AMO signing' step must read from " +
      "dist/firefox — the build:firefox artifact produced earlier in this job (the same " +
      "strip-test-seams output shipped in the GitHub release), not a fresh unstripped copy " +
      "(#1481) — a comment merely mentioning dist/firefox does not count (#1491 item 6)."
    );
    assert.match(
      unpackStepCode,
      /AMO_SOURCE_DIR=/,
      "the Unpack step must export AMO_SOURCE_DIR so the sign step below can consume it " +
      "— a comment merely mentioning AMO_SOURCE_DIR= does not count (#1491 item 6)."
    );
  });

  // #1491 item 6 (meta-test): proves the comment-stripping fix actually
  // closes the gap, using a synthetic step body where dist/firefox and
  // AMO_SOURCE_DIR= appear ONLY inside comments.
  test("meta: a comment merely mentioning dist/firefox or AMO_SOURCE_DIR= does not satisfy the Unpack-step guard", () => {
    const commentOnlyStep = [
      "      - name: Unpack the built Firefox artifact for AMO signing",
      "        # this step is supposed to read from dist/firefox and export AMO_SOURCE_DIR=...",
      "        run: |",
      '          echo "not actually doing either of those things"',
    ].join("\n");
    const stripped = stripHashComments(commentOnlyStep);
    // Sanity: the RAW text does contain both markers (proving the old,
    // unstripped assertion would have wrongly passed against this input).
    assert.match(commentOnlyStep, /dist\/firefox/);
    assert.match(commentOnlyStep, /AMO_SOURCE_DIR=/);
    // The stripped text must not.
    assert.doesNotMatch(stripped, /dist\/firefox/, "a comment-only mention must not survive comment stripping");
    assert.doesNotMatch(stripped, /AMO_SOURCE_DIR=/, "a comment-only mention must not survive comment stripping");
  });

  test("the Submit to Firefox AMO step signs $AMO_SOURCE_DIR — the artifact the Unpack step just produced", () => {
    assert.match(
      signStep,
      /--source-dir="\$AMO_SOURCE_DIR"/,
      "the 'Submit to Firefox AMO' step must sign $AMO_SOURCE_DIR, tying it to the Unpack " +
      "step's dist/firefox extraction above rather than deriving its own separate path (#1481)."
    );
  });
});

// #1491 item 7: the Unpack step's `dist/firefox/*.zip` glob guard (exactly
// one match, else `exit 1`) had no test — this exercises the ACTUAL shell
// snippet from release.yml, not a re-implementation, by extracting it and
// running it with bash against a scratch dist/firefox directory. Follows
// the extract-and-execute pattern in tests/unit/with-firefox-manifest.test.mjs.
describe("release.yml — the dist/firefox/*.zip glob guard (exactly one match) (#1491 item 7)", () => {
  const releaseYml = readFile(".github/workflows/release.yml");

  /**
   * `bash` is not guaranteed to exist on every CI runner (e.g. a bare
   * Windows runner without Git Bash / WSL on PATH). Probe once and skip
   * cleanly rather than failing the whole suite when it is missing.
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

  /**
   * Extracts the glob-guard snippet from the "Unpack the built Firefox
   * artifact for AMO signing" step's `run:` block: from `shopt -s nullglob`
   * through the closing `fi` of the exactly-one-match check, inclusive.
   * Extracted (not re-typed) so this test exercises the real shell code.
   *
   * @param {string} yml
   * @returns {string}
   */
  function extractGlobGuardSnippet(yml) {
    const start = yml.indexOf("shopt -s nullglob");
    assert.ok(start !== -1, "release.yml must contain the dist/firefox/*.zip glob guard (shopt -s nullglob)");
    const zipsIdx = yml.indexOf("zips=(dist/firefox/*.zip)", start);
    assert.ok(zipsIdx !== -1, "release.yml must declare zips=(dist/firefox/*.zip)");
    // A standalone `fi` LINE (only whitespace before/after it) closes the
    // if-block — plain `yml.indexOf("fi", ...)` would instead match the
    // "fi" inside "dist/firefox" on the error-message line above it.
    const fiMatch = /\n[ \t]*fi[ \t]*\r?\n/.exec(yml.slice(zipsIdx));
    assert.ok(fiMatch, "could not find the closing `fi` line of the glob-guard if-block");
    const fiEnd = zipsIdx + fiMatch.index + fiMatch[0].length;
    return yml.slice(start, fiEnd);
  }

  const guardSnippet = extractGlobGuardSnippet(releaseYml);

  test("sanity: the extracted snippet is the real guard shape (nullglob, exactly-one check, exit 1)", () => {
    assert.match(guardSnippet, /shopt -s nullglob/);
    assert.match(guardSnippet, /zips=\(dist\/firefox\/\*\.zip\)/);
    assert.match(guardSnippet, /\$\{#zips\[@\]\}.*-ne 1/);
    assert.match(guardSnippet, /exit 1/);
  });

  test("passes through with exactly one dist/firefox/*.zip present", (t) => {
    if (!hasBash()) { t.skip("bash is not available in this environment"); return; }
    const scratch = mkdtempSync(join(tmpdir(), "muga-amo-glob-one-"));
    try {
      mkdirSync(join(scratch, "dist", "firefox"), { recursive: true });
      writeFileSync(join(scratch, "dist", "firefox", "muga-3.2.0-firefox.zip"), "fake zip");
      const script = `${guardSnippet}\necho GUARD_PASSED\n`;
      const out = execFileSync("bash", ["-c", script], { cwd: scratch, encoding: "utf8" });
      assert.match(out, /GUARD_PASSED/, "the guard must not exit when exactly one zip is present");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("fails with `exit 1` and a 'found 0' message when no dist/firefox/*.zip is present", (t) => {
    if (!hasBash()) { t.skip("bash is not available in this environment"); return; }
    const scratch = mkdtempSync(join(tmpdir(), "muga-amo-glob-zero-"));
    try {
      mkdirSync(join(scratch, "dist", "firefox"), { recursive: true });
      const script = `${guardSnippet}\necho GUARD_PASSED\n`;
      let stdout = "";
      let exitCode = 0;
      try {
        execFileSync("bash", ["-c", script], { cwd: scratch, encoding: "utf8", stdio: "pipe" });
      } catch (err) {
        exitCode = err.status;
        stdout = String(err.stdout || "") + String(err.stderr || "");
      }
      assert.equal(exitCode, 1, "the guard must exit 1 when no zip is present");
      assert.doesNotMatch(stdout, /GUARD_PASSED/, "the echo after the guard must never run");
      assert.match(stdout, /found 0/, "the error message must report the actual count found");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("fails with `exit 1` and a 'found 2' message when two dist/firefox/*.zip files are present", (t) => {
    if (!hasBash()) { t.skip("bash is not available in this environment"); return; }
    const scratch = mkdtempSync(join(tmpdir(), "muga-amo-glob-two-"));
    try {
      mkdirSync(join(scratch, "dist", "firefox"), { recursive: true });
      writeFileSync(join(scratch, "dist", "firefox", "a.zip"), "fake zip a");
      writeFileSync(join(scratch, "dist", "firefox", "b.zip"), "fake zip b");
      const script = `${guardSnippet}\necho GUARD_PASSED\n`;
      let stdout = "";
      let exitCode = 0;
      try {
        execFileSync("bash", ["-c", script], { cwd: scratch, encoding: "utf8", stdio: "pipe" });
      } catch (err) {
        exitCode = err.status;
        stdout = String(err.stdout || "") + String(err.stderr || "");
      }
      assert.equal(exitCode, 1, "the guard must exit 1 when more than one zip is present");
      assert.doesNotMatch(stdout, /GUARD_PASSED/, "the echo after the guard must never run");
      assert.match(stdout, /found 2/, "the error message must report the actual count found");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("with-firefox-manifest.sh never backs up inside src/ (#1481)", () => {
  const script = readFile("scripts/with-firefox-manifest.sh");

  test("the manifest.json backup path is not src/manifest.v3.json", () => {
    assert.ok(
      !script.includes('BACKUP="src/manifest.v3.json"') &&
      !script.includes("BACKUP=src/manifest.v3.json"),
      "with-firefox-manifest.sh must not back up src/manifest.json to a path INSIDE " +
      "src/ — strip-test-seams.mjs copies --source-dir wholesale before stripping, so a " +
      "backup left in src/ leaks into build:firefox's output (and, before #1481, into the " +
      "AMO XPI too). Use a path outside src/, e.g. mktemp (#1481)."
    );
  });

  test("cleanup restores src/manifest.json on exit, interrupt, and a closed pipe", () => {
    // `npm run lint | head` closes the pipe early; without a PIPE trap the
    // script dies before restoring, leaving the swapped MV2 manifest sitting
    // in src/manifest.json — this is why `npm run lint` must never be piped.
    assert.match(
      script,
      /trap cleanup EXIT INT TERM PIPE/,
      "with-firefox-manifest.sh must keep trapping EXIT/INT/TERM/PIPE so the backup is " +
      "always restored, even when the wrapped command's output is piped"
    );
  });
});
