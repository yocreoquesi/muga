/**
 * MUGA — what ships is decided in package.json, and this makes that true (#1267 item 6)
 *
 * `web-ext-config.mjs` looks like the file that decides what gets excluded from
 * the shipped artefact. It is not. `web-ext build`'s CLI `--ignore-files`
 * REPLACES the config's `ignoreFiles` rather than merging with it, so the real
 * source of truth is the inline flag list in `package.json`'s `build:chrome`
 * and `build:firefox`.
 *
 * The config says so in a comment at the top. A comment is a warning only to
 * whoever reads it, and the specific mistake here is silent in both directions:
 * a contributor adds an exclusion to the config, the build ignores it, and the
 * file ships anyway with nothing to notice.
 *
 * So the invariant is enforced from the direction the mistake comes from: any
 * exclusion the config names INSIDE the packaged source tree must also be in
 * the build flags. The config's other entries (tests/, *.md, .git,
 * package.json, the config files themselves) live outside `src/` and cannot
 * reach an artefact built from it, so they are none of this test's business.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import webExtConfig from "../../web-ext-config.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** The `--ignore-files` list a build script passes, in order. */
function ignoreFilesOf(script) {
  const at = script.indexOf("--ignore-files");
  assert.ok(at > -1, `expected --ignore-files in: ${script}`);
  return script
    .slice(at + "--ignore-files".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const chrome = ignoreFilesOf(pkg.scripts["build:chrome"]);
const firefox = ignoreFilesOf(pkg.scripts["build:firefox"]);

describe("packaging exclusions (#1267)", () => {
  test("both store builds exclude exactly the same files", () => {
    // A divergence here ships a file to one store and not the other, which is
    // the kind of asymmetry nobody looks for until a reviewer asks about it.
    assert.deepStrictEqual(
      [...chrome].sort(),
      [...firefox].sort(),
      "build:chrome and build:firefox must exclude the same set",
    );
  });

  test("the four that must never ship are excluded", () => {
    for (const mustNotShip of [
      "manifest.v2.json", // the MV2 manifest, in a Chrome artefact
      "content/cleaner-bundle-src.mjs", // ES-module source of the bundle
      "icons/newicon.png", // a design-tool upload, not the brand mark
      "rules/manifest.json", // Chrome-generated DNR artefact
    ]) {
      assert.ok(
        chrome.includes(mustNotShip),
        `${mustNotShip} must be in the build's --ignore-files`,
      );
    }
  });

  test("anything web-ext-config excludes inside src/ is excluded by the build too", () => {
    // The drift this file exists for. `web-ext build` throws the config's
    // ignoreFiles away, so an exclusion added there and nowhere else is a
    // no-op that looks like a change.
    const inSource = (webExtConfig.ignoreFiles ?? []).filter((entry) => {
      const literal = entry.replace(/\/\*+$/, "").replace(/\/$/, "");
      return existsSync(join(ROOT, "src", literal));
    });

    assert.ok(inSource.length > 0, "expected the config to name at least one packaged path");

    const missing = inSource.filter((entry) => !chrome.includes(entry));
    assert.deepStrictEqual(
      missing,
      [],
      `${missing.join(", ")} is excluded by web-ext-config.mjs but NOT by the build. ` +
        "web-ext build replaces ignoreFiles with the CLI flags, so that exclusion does " +
        "nothing: add it to build:chrome and build:firefox in package.json.",
    );
  });

  test("the config still says out loud that it does not decide what ships", () => {
    // The comment is the first thing a contributor reads, and this test is the
    // second. Losing the comment loses the explanation for both.
    const source = readFileSync(join(ROOT, "web-ext-config.mjs"), "utf8");
    assert.match(
      source,
      /SOURCE OF TRUTH/,
      "web-ext-config.mjs must keep the note that package.json decides what ships",
    );
  });
});
