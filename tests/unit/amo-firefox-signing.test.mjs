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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

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

  test("the AMO sign step's --source-dir variable never resolves (indirectly) to raw src/", () => {
    const varNames = findSourceDirVarUsages(signStep);
    assert.ok(
      varNames.length > 0,
      "expected --source-dir in the 'Submit to Firefox AMO' step to be passed via a shell " +
      "variable (e.g. $AMO_SOURCE_DIR) rather than a bare literal — if that changed " +
      "intentionally, the raw-src literal check above already covers a hardcoded path"
    );
    for (const varName of varNames) {
      const resolved = normalizeDirLiteral(lastVarAssignment(releaseYml, varName));
      assert.notEqual(
        resolved,
        "src",
        `--source-dir variable "${varName}" resolves to raw src/ (assigned: ${lastVarAssignment(releaseYml, varName)}) ` +
        "— variable indirection must not be used to smuggle a raw src/ sign back in (#1481)."
      );
    }
  });

  test("the Unpack step derives the AMO source from dist/firefox and exports AMO_SOURCE_DIR", () => {
    assert.match(
      unpackStep,
      /dist\/firefox/,
      "the 'Unpack the built Firefox artifact for AMO signing' step must read from " +
      "dist/firefox — the build:firefox artifact produced earlier in this job (the same " +
      "strip-test-seams output shipped in the GitHub release), not a fresh unstripped copy (#1481)."
    );
    assert.match(
      unpackStep,
      /AMO_SOURCE_DIR=/,
      "the Unpack step must export AMO_SOURCE_DIR so the sign step below can consume it"
    );
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
