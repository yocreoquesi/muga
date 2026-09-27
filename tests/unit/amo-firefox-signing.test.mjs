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
 * they assert the shape of the fix, not just today's exact wording.
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

describe("AMO Firefox signing does not use raw src/ (#1481)", () => {
  const releaseYml = readFile(".github/workflows/release.yml");

  test("release.yml has an AMO submission step", () => {
    assert.match(
      releaseYml,
      /web-ext sign/,
      "release.yml must still submit to AMO via `web-ext sign`"
    );
  });

  test("web-ext sign is never invoked with --source-dir=src/ or --source-dir src/", () => {
    const rawSrcDir = /--source-dir[= ]"?src\/?"?(\s|$)/;
    assert.ok(
      !rawSrcDir.test(releaseYml),
      "release.yml must not sign raw src/ for AMO — src/ still contains live test seams " +
      "(lib/test-fixtures.js, the __MUGA_TRUSTED_KEYS__ override) and build-only files " +
      "that tools/strip-test-seams.mjs strips for the Chrome build and the GitHub release. " +
      "Sign the already-built, already-stripped dist/firefox artifact instead (#1481)."
    );
  });

  test("the AMO sign step signs the built dist/firefox artifact, not a fresh unstripped copy", () => {
    assert.match(
      releaseYml,
      /dist\/firefox/,
      "release.yml's AMO submission must reference the dist/firefox build artifact " +
      "produced by `npm run build:firefox` (the same strip-test-seams output shipped " +
      "in the GitHub release), so AMO gets an identical, already-stripped artifact (#1481)."
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
    // The PIPE trap matters: `npm run lint | head` closes the pipe early, and
    // without it the script dies before restoring, leaving the swapped MV2
    // manifest sitting in src/manifest.json (memory lesson — never pipe lint).
    assert.match(
      script,
      /trap cleanup EXIT INT TERM PIPE/,
      "with-firefox-manifest.sh must keep trapping EXIT/INT/TERM/PIPE so the backup is " +
      "always restored, even when the wrapped command's output is piped"
    );
  });
});
