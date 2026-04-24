/**
 * Regression test: CHANGELOG.md link references
 *
 * Asserts:
 *   1. Every ## [x.y.z] header in CHANGELOG.md has a matching [x.y.z]: ...compare/...
 *      link reference at the bottom of the file.
 *   2. The [Unreleased] link references the latest version header, not a stale one.
 *
 * This prevents the Unreleased link from silently freezing when new releases are tagged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

// Extract all versioned headers: ## [1.2.3]
const headerVersions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
  .map(m => m[1]);

// Extract all link reference definitions: [x.y.z]: https://...
const linkDefs = new Map(
  [...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]:\s*(https?:\/\/\S+)/gm)]
    .map(m => [m[1], m[2]])
);

// Extract the [Unreleased] link reference
const unreleasedMatch = changelog.match(/^\[Unreleased\]:\s*https?:\/\/\S+compare\/v?(\d+\.\d+\.\d+)\.\.\.HEAD/m);

describe("CHANGELOG.md link references", () => {
  it("every ## [x.y.z] header has a matching link reference", () => {
    const missing = headerVersions.filter(v => !linkDefs.has(v));
    assert.deepEqual(
      missing,
      [],
      `Missing link references for versions: ${missing.join(", ")}\n` +
      "Add [x.y.z]: https://github.com/yocreoquesi/muga/compare/vPREV...vx.y.z for each."
    );
  });

  it("[Unreleased] link references the latest released version", () => {
    assert.ok(
      unreleasedMatch,
      "[Unreleased] link reference not found or does not follow ...compare/vX.Y.Z...HEAD format"
    );

    const latestVersion = headerVersions[0]; // first header = most recent release
    const unreleasedBase = unreleasedMatch[1];

    assert.equal(
      unreleasedBase,
      latestVersion,
      `[Unreleased] points to v${unreleasedBase} but latest release header is ## [${latestVersion}].\n` +
      `Update to: [Unreleased]: https://github.com/yocreoquesi/muga/compare/v${latestVersion}...HEAD`
    );
  });

  it("link references follow the compare URL format", () => {
    for (const [version, url] of linkDefs) {
      const isCompare = url.includes("/compare/");
      const isTag = url.includes("/releases/tag/");
      assert.ok(
        isCompare || isTag,
        `[${version}] link does not use compare or releases/tag format: ${url}`
      );
    }
  });
});
